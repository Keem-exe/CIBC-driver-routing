import { getDb } from "./db.js";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const DEFAULT_DEPOT = { lat: 18.0075, lon: -76.785 }; // New Kingston, same as the dashboard

const PROJECTION = { projection: { _id: 0, stopId: 1, merchants: 1, address: 1, parish: 1, lat: 1, lon: 1, precision: 1, "geocode.locationType": 1, terminals: 1 } };

export const publicStop = (s) => ({
  id: s.stopId,
  merchants: s.merchants,
  address: s.address,
  parish: s.parish,
  lat: s.lat,
  lon: s.lon,
  pin: s.geocode?.locationType ?? s.precision,
  terminals: s.terminals,
});

let all, allAt = 0;
/** Every stop (about 1,100), cached briefly so back-to-back requests don't re-read MongoDB. */
export async function allStops() {
  if (!all || Date.now() - allAt > 5 * 60_000) {
    all = (await (await getDb()).collection("stops").find({}, PROJECTION).toArray()).map(publicStop);
    allAt = Date.now();
  }
  return all;
}

const asList = (v) => (Array.isArray(v) ? v.map(String) : []);

/** Stops for the given stopIds and/or terminalIds, in the order the caller listed them, no duplicates. */
export async function resolveStops({ stopIds, terminalIds }, { min = 1, max = 60 } = {}) {
  const ids = asList(stopIds), tids = asList(terminalIds);
  if (tids.length) {
    const docs = await (await getDb()).collection("terminals")
      .find({ terminalId: { $in: tids } }, { projection: { terminalId: 1, stopId: 1 } }).toArray();
    const byT = new Map(docs.map((d) => [d.terminalId, d.stopId]));
    const unknown = tids.filter((t) => !byT.get(t));
    if (unknown.length) throw new HttpError(400, `Unknown or non-physical terminal(s): ${unknown.join(", ")}`);
    for (const t of tids) ids.push(byT.get(t));
  }
  const unique = [...new Set(ids)];
  if (unique.length < min) throw new HttpError(400, `Provide at least ${min} stopIds/terminalIds`);
  if (unique.length > max) throw new HttpError(400, `At most ${max} stops per request`);
  const byId = new Map((await allStops()).map((s) => [s.id, s]));
  const missing = unique.filter((i) => !byId.has(i));
  if (missing.length) throw new HttpError(400, `Unknown stop(s): ${missing.join(", ")}`);
  return unique.map((i) => byId.get(i));
}

/** Start point: {lat, lon}, {stopId}, {terminalId}, or the default depot. */
export async function resolveStart(start) {
  if (start?.stopId || start?.terminalId) {
    const [s] = await resolveStops({ stopIds: start.stopId ? [start.stopId] : [], terminalIds: start.terminalId ? [start.terminalId] : [] });
    return { lat: s.lat, lon: s.lon, stop: s };
  }
  if (start && Number.isFinite(+start.lat) && Number.isFinite(+start.lon)) {
    const lat = +start.lat, lon = +start.lon;
    if (lat < 17.5 || lat > 18.7 || lon < -78.6 || lon > -76) throw new HttpError(400, "start is outside Jamaica");
    return { lat, lon };
  }
  return { ...DEFAULT_DEPOT };
}

/** Planning knobs shared by the endpoints, clamped to sane ranges. */
export function planSettings(q = {}) {
  const num = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) && v !== "" && v != null ? Math.min(hi, Math.max(lo, x)) : d; };
  return {
    speedKmh: num(q.speedKmh, 35, 5, 100),
    serviceMin: num(q.serviceMin, 15, 0, 240),
    dayHours: num(q.dayHours, 8, 1, 24),
  };
}
