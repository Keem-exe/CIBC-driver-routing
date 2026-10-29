// Loads data/*.csv (raw terminals) and dashboard/stops.json (merged stops) into MongoDB.
// Safe to re-run: documents are upserted, and a stop's Google geocode is never overwritten.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { getDb, closeDb } from "../lib/db.js";

const root = join(fileURLToPath(import.meta.url), "..", "..");

function readTerminals() {
  const out = [];
  for (const file of readdirSync(join(root, "data")).filter((f) => f.endsWith(".csv"))) {
    const rows = parse(readFileSync(join(root, "data", file)), { columns: true, bom: true, skip_empty_lines: true });
    let physical = "Y"; // a blank flag inherits the row above (USD twin of a JMD terminal)
    for (const r of rows) {
      physical = (r["Physical Location? (Y/N)"] || "").trim().toUpperCase() || physical;
      out.push({
        terminalId: r["Terminal ID"].trim(),
        checkDigit: r["Check Digit"],
        pwcTerminalId: r["PWC Terminal ID"],
        merchantId: r["Original Merchant ID"],
        physical: physical === "Y",
        retailer: r["Retailer Name"].trim(),
        address: r["Address"].trim(),
        parish: r["City"].trim(),
        currency: r["Currency Code"].trim() === "840" ? "USD" : "JMD",
        mcc: r["MCC"],
        industry: r["Industry"],
        model: r["Term Model"],
        connectivity: r["Connectivity"],
        source: basename(file, ".csv"),
      });
    }
  }
  return out;
}

const db = await getDb();
const terminals = readTerminals();
const stopsFile = JSON.parse(readFileSync(join(root, "dashboard", "stops.json"), "utf8"));

const stopOf = new Map();
for (const s of stopsFile.stops) for (const t of s.terminals) stopOf.set(t.id, s.id);

await db.collection("terminals").bulkWrite(
  terminals.map((t) => ({
    updateOne: { filter: { terminalId: t.terminalId }, update: { $set: { ...t, stopId: stopOf.get(t.terminalId) ?? null } }, upsert: true },
  })),
);

await db.collection("stops").bulkWrite(
  stopsFile.stops.map(({ id, lat, lon, precision, ...s }) => ({
    updateOne: {
      filter: { stopId: id },
      // approx* is the offline estimate. lat/lon/precision/geocode are only set on insert: after the
      // Google backfill they hold the better pin, and a re-seed must not overwrite it.
      update: { $set: { ...s, approxLat: lat, approxLon: lon }, $setOnInsert: { lat, lon, precision, geocode: null } },
      upsert: true,
    },
  })),
);

// Road network for the free distance estimates (entries, not an object: hub names may contain dots).
await db.collection("meta").replaceOne(
  { _id: "roads" },
  { _id: "roads", hubs: Object.entries(stopsFile.hubs), roads: stopsFile.roads },
  { upsert: true },
);

await db.collection("terminals").createIndex({ terminalId: 1 }, { unique: true });
await db.collection("terminals").createIndex({ stopId: 1 });
await db.collection("stops").createIndex({ stopId: 1 }, { unique: true });
await db.collection("stops").createIndex({ parish: 1 });

const counts = {
  terminals: await db.collection("terminals").countDocuments(),
  physical: await db.collection("terminals").countDocuments({ physical: true }),
  stops: await db.collection("stops").countDocuments(),
};
console.log("csv rows:", terminals.length, "| mongo:", counts);
await closeDb();
