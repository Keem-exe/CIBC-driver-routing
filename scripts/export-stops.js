// Writes the Google-improved coordinates from MongoDB back into dashboard/stops.json, so the
// browser map and its instant planner use the same pins as the API. Run after geocode-backfill.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, closeDb } from "../lib/db.js";

const file = join(fileURLToPath(import.meta.url), "..", "..", "dashboard", "stops.json");
const json = JSON.parse(readFileSync(file, "utf8"));
const db = await getDb();
const live = new Map((await db.collection("stops").find({}, { projection: { stopId: 1, lat: 1, lon: 1, geocode: 1 } }).toArray()).map((s) => [s.stopId, s]));

let moved = 0;
for (const s of json.stops) {
  const d = live.get(s.id);
  if (!d || (d.lat === s.lat && d.lon === s.lon)) continue;
  s.lat = d.lat; s.lon = d.lon;
  s.precision = d.geocode?.locationType === "ROOFTOP" ? "street" : "google";
  moved++;
}
json.generated_at = new Date().toISOString().slice(0, 19);
writeFileSync(file, JSON.stringify(json));
console.log(`updated ${moved} of ${json.stops.length} stops in dashboard/stops.json`);
await closeDb();
