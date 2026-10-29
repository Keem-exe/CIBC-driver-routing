// Geocodes every stop that has no Google result yet and stores it in stops.geocode.
// Idempotent: stops that already have a geocode are skipped, so re-runs cost nothing.
//   node scripts/geocode-backfill.js [--limit N]
import { getDb, closeDb } from "../lib/db.js";

const limit = Number(process.argv[process.argv.indexOf("--limit") + 1]) || Infinity;
const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) throw new Error("GOOGLE_MAPS_API_KEY is not set");

// Jamaica bounding box: anything outside is a wrong match (e.g. a same-named street abroad).
const inJamaica = ({ lat, lng }) => lat > 17.6 && lat < 18.6 && lng > -78.5 && lng < -76.1;

function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  return 6371 * Math.hypot((lat2 - lat1) * r, (lon2 - lon1) * r * Math.cos(lat1 * r));
}

async function geocode(stop) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.search = new URLSearchParams({
    address: `${stop.address}, ${stop.parish}, Jamaica`,
    components: "country:JM",
    region: "jm",
    key: KEY,
  });
  const body = await (await fetch(url)).json();
  if (body.status === "OVER_QUERY_LIMIT" || body.status === "REQUEST_DENIED") {
    throw new Error(`${body.status}: ${body.error_message ?? ""}`);
  }
  const hit = body.results?.[0];
  if (!hit || !inJamaica(hit.geometry.location)) return { status: hit ? "OUT_OF_BOUNDS" : body.status };
  return {
    status: "OK",
    lat: hit.geometry.location.lat,
    lon: hit.geometry.location.lng,
    locationType: hit.geometry.location_type, // ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE
    partialMatch: !!hit.partial_match,
    formattedAddress: hit.formatted_address,
    placeId: hit.place_id,
  };
}

const db = await getDb();
const stops = db.collection("stops");
const todo = await stops.find({ geocode: null }).limit(Number.isFinite(limit) ? limit : 0).toArray();
console.log(`${todo.length} stops to geocode`);

const tally = {};
let next = 0;
async function worker() {
  while (next < todo.length) {
    const stop = todo[next++];
    const g = await geocode(stop);
    // Only trust the pin if it is street-level and agrees with the offline estimate.
    const far = g.status === "OK" && km(stop.approxLat, stop.approxLon, g.lat, g.lon) > 15;
    const usable = g.status === "OK" && g.locationType !== "APPROXIMATE" && !far;
    if (far) g.suspect = true;
    await stops.updateOne(
      { _id: stop._id },
      // Failures are stored too (status != OK) so they are not re-billed on the next run.
      { $set: { geocode: { ...g, at: new Date() }, ...(usable && { lat: g.lat, lon: g.lon }) } },
    );
    const k = g.status === "OK" ? g.locationType : g.status;
    tally[k] = (tally[k] ?? 0) + 1;
  }
}
try {
  await Promise.all(Array.from({ length: 8 }, worker)); // ~8 in flight, far below the 1,500/min quota
} finally {
  console.log("results:", tally);
  await closeDb();
}
