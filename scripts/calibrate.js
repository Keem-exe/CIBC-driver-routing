// Compare cached Google road distances (MongoDB `pairs`) with straight-line distance, to check the
// winding factor used by lib/roadnet.js and the dashboard. Read-only: `node scripts/calibrate.js`.
import { getDb, closeDb } from "../lib/db.js";
import { hav } from "../lib/roadnet.js";
import { pairKm } from "../lib/matrix.js";

const key = (lat, lon) => `${lat.toFixed(4)},${lon.toFixed(4)}`; // same key as lib/matrix.js
const q = (xs, f) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * f)];

const db = await getDb();

// --sample N: ask Google for N nearby pairs in the Kingston area first (counts against the daily budget,
// and the answers stay cached), so the fit below has data to work with.
const sample = Number(process.argv[process.argv.indexOf("--sample") + 1]) || 0;
if (sample) {
  const area = (await db.collection("stops").find({ parish: { $in: ["Kingston", "Saint Andrew"] } }, { projection: { lat: 1, lon: 1 } }).toArray());
  const pairs = [];
  for (let n = 0; pairs.length < sample && n < sample * 20; n++) {
    const a = area[Math.floor(Math.random() * area.length)], b = area[Math.floor(Math.random() * area.length)];
    const h = hav([a.lat, a.lon], [b.lat, b.lon]);
    if (h > 0.5 && h < 10) pairs.push({ a, b });
  }
  const got = (await pairKm(pairs)).filter((k) => k != null).length;
  console.log(`asked for ${pairs.length} pairs, got ${got} road distances`);
}
const stops = new Map((await db.collection("stops").find({}, { projection: { lat: 1, lon: 1, parish: 1 } }).toArray())
  .map((s) => [key(s.lat, s.lon), s]));
const rows = [];
for (const p of await db.collection("pairs").find({}).toArray()) {
  const [a, b] = p._id.split("|"), A = stops.get(a), B = stops.get(b);
  if (!A || !B) continue;
  const h = hav([A.lat, A.lon], [B.lat, B.lon]);
  if (h > 0.2) rows.push({ h, ratio: p.km / h, parish: A.parish === B.parish ? A.parish : "mixed" });
}
console.log(`${rows.length} usable pairs`);
const line = (label, xs) => xs.length && console.log(`${label.padEnd(18)} n=${String(xs.length).padStart(4)}  p10=${q(xs, .1).toFixed(2)}  median=${q(xs, .5).toFixed(2)}  p90=${q(xs, .9).toFixed(2)}`);
for (const [lo, hi] of [[0, 1], [1, 2], [2, 4], [4, 7], [7, 10], [10, 30], [30, 400]]) line(`${lo}-${hi} km`, rows.filter((r) => r.h >= lo && r.h < hi).map((r) => r.ratio));
const by = {};
rows.filter((r) => r.h < 10).forEach((r) => (by[r.parish] ??= []).push(r.ratio));
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) line(k, v);
await closeDb();
