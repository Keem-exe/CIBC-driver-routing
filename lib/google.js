// Google Routes API calls, guarded by a daily budget kept in MongoDB.
// The budget mirrors the daily quota set on the Google Cloud project, so the app falls back to
// free estimates *before* Google starts rejecting calls (and long before anything could be billed).

const KEY = () => process.env.GOOGLE_MAPS_API_KEY;
const CAPS = {
  matrixElements: Number(process.env.GOOGLE_MATRIX_DAILY_CAP) || 160,
  routeRequests: Number(process.env.GOOGLE_ROUTES_DAILY_CAP) || 150,
};
export const MATRIX_MAX_NODES = 25; // Routes API allows 625 elements per matrix request

// Google's quotas reset at midnight Pacific time.
const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());

export const googleEnabled = () => !!KEY();

export async function usageToday(db) {
  const u = (await db.collection("usage").findOne({ _id: day() })) ?? {};
  return {
    day: day(),
    matrixElements: u.matrixElements ?? 0, matrixCap: CAPS.matrixElements,
    routeRequests: u.routeRequests ?? 0, routeCap: CAPS.routeRequests,
  };
}

/** Atomically claim `n` units of today's budget. False if that would exceed the cap. */
async function reserve(db, field, n) {
  if (n > CAPS[field]) return false;
  try {
    const r = await db.collection("usage").findOneAndUpdate(
      { _id: day(), $or: [{ [field]: { $exists: false } }, { [field]: { $lte: CAPS[field] - n } }] },
      { $inc: { [field]: n } },
      { upsert: true, returnDocument: "after" },
    );
    return !!r;
  } catch (e) {
    if (e.code === 11000) return false; // doc exists but the $or failed: over budget
    throw e;
  }
}

const wp = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } });
const secs = (d) => Number(String(d ?? "0").replace("s", ""));

async function post(url, mask, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": KEY(), "X-Goog-FieldMask": mask },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Routes ${res.status}: ${json.error?.message ?? res.statusText}`);
  return json;
}

/**
 * Road distance/time for specific pairs. `rows` is [[originIdx, [destIdx...]], ...]; each row is one
 * request, so only the pairs asked for are billed (not a full origins x destinations grid).
 * Returns [{i, j, km, min}] or null when over budget / unavailable. Traffic-unaware (basic SKU).
 */
export async function routeMatrix(db, pts, rows) {
  if (!googleEnabled() || pts.length > MATRIX_MAX_NODES) return null;
  const elements = rows.reduce((a, [, dests]) => a + dests.length, 0);
  if (!(await reserve(db, "matrixElements", elements))) return null;
  const results = await Promise.all(rows.map(async ([i, dests]) => {
    const out = await post(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
      "originIndex,destinationIndex,duration,distanceMeters,condition",
      {
        origins: [{ waypoint: wp(pts[i]) }],
        destinations: dests.map((j) => ({ waypoint: wp(pts[j]) })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
      },
    );
    return (Array.isArray(out) ? out : [])
      .filter((r) => r.condition === "ROUTE_EXISTS")
      // proto3 JSON omits zero values, so a missing index means 0
      .map((r) => ({ i, j: dests[r.destinationIndex ?? 0], km: (r.distanceMeters ?? 0) / 1000, min: secs(r.duration) / 60 }));
  }));
  return { elements, rows: results.flat() };
}

/**
 * The drivable path through `stops` in order: encoded polyline plus real per-leg km/minutes.
 * `origin` first; ends at `destination` (the origin again for a closed loop). One request.
 */
export async function routePath(db, origin, stops, destination) {
  if (!googleEnabled() || stops.length > 25) return null;
  if (!(await reserve(db, "routeRequests", 1))) return null;
  const inter = destination ? stops : stops.slice(0, -1);
  const dest = destination ?? stops[stops.length - 1];
  const out = await post(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    "routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters",
    {
      origin: wp(origin), destination: wp(dest),
      intermediates: inter.map(wp),
      travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE",
    },
  );
  const route = out.routes?.[0];
  if (!route) return null;
  return {
    polyline: route.polyline?.encodedPolyline ?? null,
    legs: (route.legs ?? []).map((l) => ({ km: (l.distanceMeters ?? 0) / 1000, min: secs(l.duration) / 60 })),
  };
}
