// Free road-distance estimate: straight line x a winding factor for local hops, and the
// main-road network between towns (Floyd-Warshall over hubs) for long ones.
// Same model as the dashboard's roadNetwork(), so server and browser agree.
import { getDb } from "./db.js";

const ROAD_FACTOR = 1.35; // fitted: median road/straight-line ratio of 80 Google pairs (scripts/calibrate.js)
const LOCAL_KM = 10;

export const hav = (a, b) => {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

export function roadNetwork(hubs, roads) {
  const ids = Object.keys(hubs), pts = ids.map((k) => hubs[k]), n = ids.length;
  const D = ids.map((_, i) => ids.map((_, j) => (i === j ? 0 : Infinity)));
  for (const [a, b] of roads) {
    const i = ids.indexOf(a), j = ids.indexOf(b), w = hav(pts[i], pts[j]) * ROAD_FACTOR;
    D[i][j] = D[j][i] = Math.min(D[i][j], w);
  }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++)
    if (D[i][k] + D[k][j] < D[i][j]) D[i][j] = D[i][k] + D[k][j];
  const node = (p) => {
    let hub = 0, best = Infinity;
    pts.forEach((q, i) => { const d = hav(p, q); if (d < best) { best = d; hub = i; } });
    return { p, hub, access: best * ROAD_FACTOR };
  };
  const km = (a, b) => {
    const direct = hav(a.p, b.p) * ROAD_FACTOR;
    if (direct < LOCAL_KM || a.hub === b.hub) return direct;
    const via = a.access + D[a.hub][b.hub] + b.access;
    return Number.isFinite(via) ? Math.max(direct, via) : direct * 1.5;
  };
  return { node, km };
}

let net;
/** The network built from the `meta` collection (written by scripts/seed-mongo.js), once per cold start. */
export function getNet() {
  net ??= (async () => {
    const meta = await (await getDb()).collection("meta").findOne({ _id: "roads" });
    if (!meta) throw new Error("road network missing from MongoDB - run `npm run seed`");
    return roadNetwork(Object.fromEntries(meta.hubs), meta.roads);
  })();
  net.catch(() => (net = undefined)); // don't cache a failure
  return net;
}
