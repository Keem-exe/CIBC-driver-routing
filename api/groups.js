// GET /api/groups - recommended groups of terminals that one driver can cover in a day.
//   ?radiusKm=6 &maxStops=12 &dayHours=8 &serviceMin=15 &speedKmh=35
//   &parishes=Kingston,Saint Andrew (default all) &lat=..&lon=.. (depot)
//   &around=<terminalId or stopId>  -> only the group that stop belongs to
import { endpoint } from "../lib/http.js";
import { buildGroups } from "../lib/cluster.js";
import { allStops, resolveStart, resolveStops, planSettings } from "../lib/stops.js";

const clamp = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) && v !== "" && v != null ? Math.min(hi, Math.max(lo, x)) : d; };

export default endpoint(["GET"], async (q) => {
  const cfg = planSettings(q);
  const depot = await resolveStart({ lat: q.lat, lon: q.lon });
  const radiusKm = clamp(q.radiusKm, 6, 1, 40), maxStops = Math.round(clamp(q.maxStops, 12, 1, 40));
  const wanted = q.parishes ? new Set(String(q.parishes).split(",").map((p) => p.trim().toLowerCase()).filter(Boolean)) : null;
  let stops = await allStops();
  if (wanted) stops = stops.filter((s) => wanted.has(s.parish.toLowerCase()));

  let aroundId;
  if (q.around) {
    const a = String(q.around);
    const [seed] = await resolveStops(/^S\d+$/.test(a) ? { stopIds: [a] } : { terminalIds: [a] });
    aroundId = seed.id;
    if (!stops.some((s) => s.id === aroundId)) stops = [...stops, seed]; // keep it even if its parish was filtered out
  }
  const groups = await buildGroups(stops, { radiusKm, maxStops, depot, cfg, aroundId });
  return { settings: { radiusKm, maxStops, ...cfg, depot: { lat: depot.lat, lon: depot.lon } }, count: groups.length, groups };
});
