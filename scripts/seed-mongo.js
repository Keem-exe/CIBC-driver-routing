// Loads data/*.csv (raw terminals) and dashboard/stops.json (merged stops) into MongoDB.
// MongoDB is made to match the files exactly: every CSV row becomes a terminal (nothing is
// filtered), and terminals/stops no longer in the files are deleted. Safe to re-run.
// Google geocodes from geocode-backfill are carried over by address + parish, not by stopId,
// because stopIds (S1, S2, ...) are positional and shift when rows are added.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { getDb, closeDb } from "../lib/db.js";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const REQUIRED = ["Terminal ID", "Retailer Name", "Address", "City"];
const placeKey = (address, parish) => `${String(address).trim().toUpperCase()}|${String(parish).trim().toUpperCase()}`;

function readTerminals(physicalOf) {
  const out = [];
  for (const file of readdirSync(join(root, "data")).filter((f) => f.endsWith(".csv"))) {
    const rows = parse(readFileSync(join(root, "data", file)), { columns: true, bom: true, skip_empty_lines: true });
    if (rows.length && !REQUIRED.every((c) => c in rows[0])) {
      console.log(`Ignoring ${file}: not a terminal export`);
      continue;
    }
    rows.forEach((r, i) => {
      const terminalId = r["Terminal ID"].trim();
      out.push({
        terminalId,
        checkDigit: r["Check Digit"],
        pwcTerminalId: r["PWC Terminal ID"],
        merchantId: r["Original Merchant ID"],
        physicalFlag: physicalOf.get(terminalId) ?? "", // Y / N / "" as resolved by build_data.py
        physical: physicalOf.get(terminalId) !== "N",
        retailer: r["Retailer Name"].trim(),
        address: r["Address"].trim(),
        parish: r["City"].trim(),
        currency: r["Currency Code"]?.trim() === "840" ? "USD" : "JMD",
        mcc: r["MCC"],
        industry: r["Industry"],
        model: r["Term Model"],
        connectivity: r["Connectivity"],
        source: basename(file, ".csv"),
        sourceLine: i + 2, // line 1 is the header
        csv: r,            // every original column, untouched
      });
    });
  }
  return out;
}

const stopsFile = JSON.parse(readFileSync(join(root, "dashboard", "stops.json"), "utf8"));
const stopOf = new Map(), physicalOf = new Map();
for (const s of stopsFile.stops) for (const t of s.terminals) { stopOf.set(t.id, s.id); physicalOf.set(t.id, t.physical); }

const terminals = readTerminals(physicalOf);
const orphans = terminals.filter((t) => !stopOf.has(t.terminalId));
if (orphans.length) {
  console.error(`${orphans.length} CSV rows have no stop in dashboard/stops.json (e.g. ${orphans.slice(0, 5).map((t) => t.terminalId).join(", ")}).`);
  console.error("Run `python build_data.py` first so stops.json matches data/.");
  process.exit(1);
}

const db = await getDb();
const T = db.collection("terminals"), S = db.collection("stops");

// Google pins already in MongoDB, keyed by place so they follow the stop when its id changes.
const geocoded = new Map();
// Failed lookups are kept too (so they aren't re-billed); only a pin Google actually moved replaces the estimate.
for (const d of await S.find({ geocode: { $ne: null } }, { projection: { address: 1, listed_parish: 1, parish: 1, lat: 1, lon: 1, approxLat: 1, approxLon: 1, precision: 1, geocode: 1 } }).toArray()) {
  const moved = d.lat !== d.approxLat || d.lon !== d.approxLon;
  geocoded.set(placeKey(d.address, d.listed_parish ?? d.parish), { geocode: d.geocode, ...(moved && { lat: d.lat, lon: d.lon, precision: d.precision }) });
}

await T.bulkWrite(terminals.map((t) => ({
  replaceOne: { filter: { terminalId: t.terminalId }, replacement: { ...t, stopId: stopOf.get(t.terminalId) }, upsert: true },
})));
const staleTerminals = (await T.deleteMany({ terminalId: { $nin: terminals.map((t) => t.terminalId) } })).deletedCount;

let kept = 0;
await S.bulkWrite(stopsFile.stops.map(({ id, lat, lon, precision, ...s }) => {
  const g = geocoded.get(placeKey(s.address, s.listed_parish));
  if (g?.lat != null) kept++;
  return {
    replaceOne: {
      filter: { stopId: id },
      // approx* is always the offline estimate; lat/lon/precision/geocode keep a Google pin when there is one.
      replacement: { stopId: id, ...s, approxLat: lat, approxLon: lon,
                     lat: g?.lat ?? lat, lon: g?.lon ?? lon, precision: g?.precision ?? precision, geocode: g?.geocode ?? null },
      upsert: true,
    },
  };
}));
const staleStops = (await S.deleteMany({ stopId: { $nin: stopsFile.stops.map((s) => s.id) } })).deletedCount;

// Road network for the free distance estimates (entries, not an object: hub names may contain dots).
await db.collection("meta").replaceOne(
  { _id: "roads" },
  { _id: "roads", hubs: Object.entries(stopsFile.hubs), roads: stopsFile.roads },
  { upsert: true },
);

await T.createIndex({ terminalId: 1 }, { unique: true });
await T.createIndex({ stopId: 1 });
await S.createIndex({ stopId: 1 }, { unique: true });
await S.createIndex({ parish: 1 });

const counts = {
  terminals: await T.countDocuments(),
  withoutStop: await T.countDocuments({ stopId: null }),
  physicalN: await T.countDocuments({ physicalFlag: "N" }),
  stops: await S.countDocuments(),
};
console.log(`csv rows: ${terminals.length} | mongo:`, counts,
            `| removed stale: ${staleTerminals} terminals, ${staleStops} stops | Google pins carried over: ${kept}`);
if (counts.terminals !== terminals.length || counts.withoutStop) console.error("WARNING: MongoDB does not match the CSVs");
if (kept) console.log("Run `npm run export` to copy the Google pins into dashboard/stops.json.");
await closeDb();
