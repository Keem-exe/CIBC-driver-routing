// Distance/time matrix for a set of points: real Google road times where we have them (cached in
// MongoDB forever, since roads rarely change), the free road-network estimate everywhere else.
import { getDb } from "./db.js";
import { getNet } from "./roadnet.js";
import { routeMatrix, MATRIX_MAX_NODES } from "./google.js";

const keyOf = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`; // ~11 m: also survives a re-geocode
const pairId = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);   // A->B is treated as B->A

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 1);

/**
 * pts: [{lat, lon}], index 0 is the start. Returns flat n*n matrices `km` and `min`, plus how they
 * were produced: source = "google" | "mixed" | "estimate", and how many Google elements were spent.
 */
export async function buildMatrix(pts, { speedKmh = 35, useGoogle = true } = {}) {
  const n = pts.length;
  const net = await getNet();
  const nodes = pts.map((p) => net.node([p.lat, p.lon]));
  const keys = pts.map(keyOf);
  const estKm = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) estKm[i * n + j] = estKm[j * n + i] = net.km(nodes[i], nodes[j]);

  const real = new Map(); // pairId -> {km, min}
  const info = { source: "estimate", googleElements: 0, cachedPairs: 0, note: null };

  if (useGoogle && n >= 2 && n <= MATRIX_MAX_NODES) {
    const db = await getDb();
    const ids = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (keys[i] !== keys[j]) ids.push(pairId(keys[i], keys[j]));
    for (const d of await db.collection("pairs").find({ _id: { $in: ids } }).toArray()) real.set(d._id, d);
    info.cachedPairs = real.size;

    const missing = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
      if (keys[i] !== keys[j] && !real.has(pairId(keys[i], keys[j]))) missing.push([i, j]);

    // Ask Google only for pairs a good tour is likely to use: each stop's nearest neighbours and
    // everything touching the start. Other pairs fall back to (rescaled) estimates. Small sets: all pairs.
    const K = 5, dense = n <= 6, want = new Set();
    for (let i = 0; i < n; i++) {
      const near = [...Array(n).keys()].filter((j) => j !== i).sort((a, b) => estKm[i * n + a] - estKm[i * n + b]);
      for (const j of i === 0 ? near : near.slice(0, K)) want.add(i < j ? `${i},${j}` : `${j},${i}`);
    }
    const byOrigin = new Map(), asked = new Set(); // stops sharing a pin would otherwise ask for the same pair twice
    for (const [i, j] of missing) {
      const id = pairId(keys[i], keys[j]);
      if ((!dense && !want.has(`${i},${j}`)) || asked.has(id)) continue;
      asked.add(id);
      byOrigin.set(i, [...(byOrigin.get(i) ?? []), j]);
    }

    if (byOrigin.size) {
      try {
        const got = await routeMatrix(db, pts, [...byOrigin]);
        if (!got) info.note = "Google daily budget used up (or unavailable); used free road-network estimates for the rest.";
        else {
          info.googleElements = got.elements;
          const fresh = [];
          for (const r of got.rows) {
            const id = pairId(keys[r.i], keys[r.j]);
            if (real.has(id) || keys[r.i] === keys[r.j]) continue;
            const doc = { _id: id, km: r.km, min: r.min, at: new Date() };
            real.set(id, doc); fresh.push(doc);
          }
          if (fresh.length) await db.collection("pairs").bulkWrite(fresh.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })));
        }
      } catch (e) {
        console.error("routeMatrix failed:", e.message);
        info.note = `Google routing unavailable (${e.message}); used free estimates.`;
      }
    }
  }

  // Estimates are rescaled to Google's level so real and estimated pairs stay comparable.
  const ratios = { km: [], min: [] };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const g = real.get(pairId(keys[i], keys[j]));
    if (g && estKm[i * n + j] > 0.2) { ratios.km.push(g.km / estKm[i * n + j]); ratios.min.push(g.min / (estKm[i * n + j] / speedKmh * 60)); }
  }
  const kmScale = median(ratios.km), minScale = median(ratios.min);

  const km = new Float64Array(n * n), min = new Float64Array(n * n);
  let have = 0, total = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const g = keys[i] === keys[j] ? { km: 0, min: 0 } : real.get(pairId(keys[i], keys[j]));
    total++;
    if (g) have++;
    const k = g ? g.km : estKm[i * n + j] * kmScale;
    const m = g ? g.min : (estKm[i * n + j] / speedKmh) * 60 * minScale;
    km[i * n + j] = km[j * n + i] = k;
    min[i * n + j] = min[j * n + i] = m;
  }
  if (total && have === total) info.source = "google";
  else if (have) info.source = "mixed";
  return { n, km, min, ...info, estKm };
}
