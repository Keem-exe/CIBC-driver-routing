// Groups of terminals that one driver can cover in a working day because they sit close together.
// Greedy seed-and-grow: seed at the stop with the most unassigned neighbours, then keep adding the
// stop nearest the group's centre while it stays within the radius and the day's work still fits.
import { getNet, hav } from "./roadnet.js";

const WIND = 1.35; // straight line -> rough road km, same winding factor as roadnet.js

export async function buildGroups(stops, { radiusKm, maxStops, depot, cfg, aroundId }) {
  const net = await getNet();
  const n = stops.length;
  const P = stops.map((s) => [s.lat, s.lon]);
  const dNode = net.node([depot.lat, depot.lon]);
  const depotKm = P.map((p) => net.km(dNode, net.node(p))); // the drive out to the group matters
  const dayMin = cfg.dayHours * 60;

  const nb = Array.from({ length: n }, () => []); // neighbours within 2x radius (centre drift allowance)
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = hav(P[i], P[j]) * WIND;
    if (d <= radiusKm * 2) { nb[i].push([j, d]); nb[j].push([i, d]); }
  }

  /**
   * Round trip depot -> group -> depot, via nearest-neighbour from the stop closest to the depot.
   * `remote` groups are too far for a day trip from the depot: only the driving between their own stops counts.
   */
  function workMinutes(members, remote = false) {
    const left = [...members];
    let at = left.reduce((b, i) => (depotKm[i] < depotKm[b] ? i : b));
    left.splice(left.indexOf(at), 1);
    let km = remote ? 0 : depotKm[at];
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((j, x) => { const d = hav(P[at], P[j]) * WIND; if (d < bd) { bd = d; bi = x; } });
      km += bd; at = left[bi]; left.splice(bi, 1);
    }
    if (!remote) km += depotKm[at];
    return { km, min: (km / cfg.speedKmh) * 60 + cfg.serviceMin * members.length };
  }

  const free = new Set(stops.map((_, i) => i));

  function grow(seed) {
    const members = [seed];
    const remote = workMinutes([seed]).min > dayMin;
    free.delete(seed);
    let cLat = P[seed][0], cLon = P[seed][1];
    const cand = new Set(nb[seed].map(([j]) => j).filter((j) => free.has(j)));
    while (members.length < maxStops && cand.size) {
      let best = -1, bd = Infinity;
      for (const j of cand) {
        if (!free.has(j)) { cand.delete(j); continue; }
        const d = hav([cLat, cLon], P[j]) * WIND;
        if (d > radiusKm) continue;
        if (d < bd) { bd = d; best = j; }
      }
      if (best < 0) break;
      if (workMinutes([...members, best], remote).min > dayMin) { cand.delete(best); continue; } // would not fit the day
      members.push(best); free.delete(best); cand.delete(best);
      cLat = members.reduce((a, i) => a + P[i][0], 0) / members.length;
      cLon = members.reduce((a, i) => a + P[i][1], 0) / members.length;
      for (const [j] of nb[best]) if (free.has(j)) cand.add(j);
    }
    return { members, remote };
  }

  const groups = [];
  const emit = ({ members, remote }) => {
    const w = workMinutes(members, remote);
    const cLat = members.reduce((a, i) => a + P[i][0], 0) / members.length;
    const cLon = members.reduce((a, i) => a + P[i][1], 0) / members.length;
    const parishes = {};
    members.forEach((i) => (parishes[stops[i].parish] = (parishes[stops[i].parish] || 0) + 1));
    groups.push({
      stopIds: members.map((i) => stops[i].id),
      stops: members.map((i) => stops[i]),
      terminals: members.reduce((a, i) => a + stops[i].terminals.length, 0),
      parishes: Object.entries(parishes).sort((a, b) => b[1] - a[1]).map(([p]) => p),
      center: { lat: +cLat.toFixed(5), lon: +cLon.toFixed(5) },
      spreadKm: +Math.max(...members.map((i) => hav([cLat, cLon], P[i]) * WIND)).toFixed(1),
      estKm: +w.km.toFixed(1), estWorkMin: Math.round(w.min), overDay: w.min > dayMin, remote,
    });
  };

  if (aroundId) { // just the group a given stop belongs to
    const seed = stops.findIndex((s) => s.id === aroundId);
    if (seed < 0) return [];
    emit(grow(seed));
    return groups;
  }

  while (free.size) {
    let seed = -1, most = -1;
    for (const i of free) {
      let c = 0;
      for (const [j, d] of nb[i]) if (d <= radiusKm && free.has(j)) c++;
      if (c > most) { most = c; seed = i; }
    }
    emit(grow(seed));
  }
  return groups.sort((a, b) => b.terminals - a.terminals || a.estKm - b.estKm).map((g, i) => ({ group: i + 1, ...g }));
}
