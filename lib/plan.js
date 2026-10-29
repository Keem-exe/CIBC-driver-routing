// Route planning and "add-on" suggestions for a driver's selected terminals.
import { getDb } from "./db.js";
import { getNet } from "./roadnet.js";
import { buildMatrix } from "./matrix.js";
import { routePath, usageToday } from "./google.js";
import { solveOrder, pathCost } from "./solver.js";
import { allStops, resolveStops, resolveStart, planSettings } from "./stops.js";

const clampInt = (v, d, lo, hi) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };

/** Split stops into k compact wedges by angle around the origin (equal counts). */
function sweep(stops, origin, k) {
  if (k <= 1) return [stops];
  const cos = Math.cos((origin.lat * Math.PI) / 180);
  const ang = (s) => Math.atan2(s.lat - origin.lat, (s.lon - origin.lon) * cos);
  const sorted = [...stops].sort((a, b) => ang(a) - ang(b));
  let at = 0, gap = -1; // start after the widest empty wedge so no cluster is cut in two
  sorted.forEach((s, i) => {
    const g = (ang(sorted[(i + 1) % sorted.length]) - ang(s) + 2 * Math.PI) % (2 * Math.PI);
    if (g > gap) { gap = g; at = i; }
  });
  const ring = sorted.slice(at + 1).concat(sorted.slice(0, at + 1));
  return Array.from({ length: k }, (_, g) => ring.slice(Math.round((g * ring.length) / k), Math.round(((g + 1) * ring.length) / k)));
}

async function planOne(origin, group, { closed, cfg, order: orderMode, path, useGoogle }) {
  const pts = [origin, ...group];
  const n = pts.length;
  const mat = await buildMatrix(pts, { speedKmh: cfg.speedKmh, useGoogle });
  const mine = Array.from({ length: n - 1 }, (_, i) => i + 1);
  const best = solveOrder(n, mat.min, closed);
  const keepMine = orderMode === "mine";
  const order = keepMine ? mine : best.order;
  const otherOrder = keepMine ? best.order : mine;

  let legs = [], at = 0;
  for (const j of order) { legs.push({ km: mat.km[at * n + j], min: mat.min[at * n + j] }); at = j; }
  if (closed && order.length) legs.push({ km: mat.km[at * n], min: mat.min[at * n] });

  const ordered = order.map((j) => group[j - 1]);
  let polyline = null, legsFrom = mat.source, note = mat.note;
  if (path && ordered.length) {
    try {
      const p = await routePath(await getDb(), origin, ordered, closed ? origin : null);
      if (p && p.legs.length === legs.length) { legs = p.legs; polyline = p.polyline; legsFrom = "google"; }
      else if (!p) note = [note, "Road path unavailable (Google daily budget used up); drawn as straight lines."].filter(Boolean).join(" ");
    } catch (e) {
      console.error("routePath failed:", e.message);
      note = [note, `Road path unavailable (${e.message}).`].filter(Boolean).join(" ");
    }
  }

  let clock = 0;
  const stops = ordered.map((s, i) => {
    clock += legs[i].min;
    const out = { seq: i + 1, ...s, legKm: round(legs[i].km, 2), legMin: round(legs[i].min, 1), etaMin: round(clock, 1) };
    clock += cfg.serviceMin;
    return out;
  });
  const km = legs.reduce((a, l) => a + l.km, 0), driveMin = legs.reduce((a, l) => a + l.min, 0);
  return {
    stops, closed,
    km: round(km, 2), driveMin: round(driveMin, 1), workMin: round(driveMin + cfg.serviceMin * stops.length, 1),
    orderedBy: keepMine ? "selection order" : best.method,
    otherOrderKm: stops.length ? round(pathCost(n, mat.km, otherOrder, closed), 2) : null, // for "saves X km" comparisons
    distances: mat.source, legs: legsFrom, polyline, note,
    googleElementsUsed: mat.googleElements, cachedPairs: mat.cachedPairs,
  };
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

/** Best route(s) for the selected terminals. */
export async function planRoute(input) {
  const cfg = planSettings(input);
  const origin = await resolveStart(input.start);
  const selected = await resolveStops(input, { min: 1, max: 40 });
  const visit = origin.stop ? selected.filter((s) => s.id !== origin.stop.id) : selected;
  const closed = !!input.closed;
  const drivers = clampInt(input.drivers, 1, 1, Math.min(10, Math.max(1, visit.length)));
  const useGoogle = input.useGoogle !== false;

  const routes = [];
  for (const [i, group] of sweep(visit, origin, drivers).entries()) { // sequential: Google budget is shared
    routes.push({ driver: i + 1, ...(await planOne(origin, group, { closed, cfg, order: input.order, path: !!input.path, useGoogle })) });
  }
  return {
    origin: { lat: origin.lat, lon: origin.lon, stopId: origin.stop?.id ?? null },
    settings: { ...cfg, closed },
    routes,
    totals: { km: round(routes.reduce((a, r) => a + r.km, 0), 2), workMin: round(Math.max(0, ...routes.map((r) => r.workMin)), 1) },
    usage: await usageToday(await getDb()),
  };
}

/**
 * Terminals worth adding to a driver's selection: for each unselected stop, the cheapest detour
 * (extra km) to fit it into the current best tour. Uses stored coordinates only, so no Google calls.
 */
export async function suggestAddOns(input) {
  const cfg = planSettings(input);
  const net = await getNet();
  const origin = await resolveStart(input.start);
  const selected = await resolveStops(input, { min: 1, max: 40 });
  const visit = origin.stop ? selected.filter((s) => s.id !== origin.stop.id) : selected;
  const closed = !!input.closed;
  const limit = clampInt(input.limit, 8, 1, 25);
  const maxExtraKm = Math.max(1, Number(input.maxExtraKm) || 15);

  const seq = [origin, ...visit];
  const nodes = seq.map((p) => net.node([p.lat, p.lon]));
  const n = seq.length;
  const km = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) km[i * n + j] = net.km(nodes[i], nodes[j]);
  const order = solveOrder(n, km, closed).order;
  const tour = [0, ...order, ...(closed ? [0] : [])];
  const tourKm = pathCost(n, km, order, closed);
  const workNow = (tourKm / cfg.speedKmh) * 60 + cfg.serviceMin * visit.length;

  const taken = new Set(selected.map((s) => s.id));
  const out = [];
  for (const c of await allStops()) {
    if (taken.has(c.id)) continue;
    const cn = net.node([c.lat, c.lon]);
    let bestExtra = Infinity, after = 0;
    for (let e = 0; e < tour.length - 1; e++) {
      const a = nodes[tour[e]], b = nodes[tour[e + 1]];
      const extra = net.km(a, cn) + net.km(cn, b) - net.km(a, b);
      if (extra < bestExtra) { bestExtra = extra; after = tour[e]; }
    }
    if (!closed) { // or tack it on after the last stop
      const extra = net.km(nodes[tour[tour.length - 1]], cn);
      if (extra < bestExtra) { bestExtra = extra; after = tour[tour.length - 1]; }
    }
    if (bestExtra > maxExtraKm) continue;
    // Stops that merely lie on the way from the depot cost ~0 km extra but are no closer to the
    // driver's terminals, so rank by detour plus a penalty for distance from the nearest selection.
    let nearKm = Infinity;
    for (let i = 1; i < n; i++) nearKm = Math.min(nearKm, net.km(nodes[i], cn));
    const extraMin = (bestExtra / cfg.speedKmh) * 60 + cfg.serviceMin;
    const fitsDay = workNow + extraMin <= cfg.dayHours * 60;
    if (!fitsDay && !input.includeOverDay) continue;
    out.push({ ...c, nearKm: round(nearKm, 2), score: bestExtra + 0.3 * nearKm, extraKm: round(bestExtra, 2), extraMin: round(extraMin, 1), fitsDay, insertAfter: after === 0 ? (origin.stop?.id ?? "start") : seq[after].id });
  }
  out.sort((a, b) => a.score - b.score);
  return {
    current: { stops: visit.length, km: round(tourKm, 2), workMin: round(workNow, 1), dayMin: cfg.dayHours * 60 },
    suggestions: out.slice(0, limit).map(({ score, ...s }) => s),
  };
}
