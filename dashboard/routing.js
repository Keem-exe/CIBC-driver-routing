// Routing code shared by the scheduler page (index.html) and the driver page (driver.html).
// Classic script: everything here is a page-level global.
const COLORS = ["#2563eb", "#d97706", "#059669", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#65a30d", "#c026d3", "#475569"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtMin = m => { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`; };

// ---------------------------------------------------------------------------
// Road distances: straight line x a winding factor for local hops; long hops
// follow the main-road network between towns (shortest paths, Floyd-Warshall).
// ---------------------------------------------------------------------------
const ROAD_FACTOR = 1.35; // fitted: median road/straight-line ratio of 80 Google pairs (scripts/calibrate.js)
const LOCAL_KM = 10;
const hav = (a, b) => {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

function roadNetwork(hubs, roads) {
  const ids = Object.keys(hubs), pts = ids.map(k => hubs[k]), n = ids.length;
  const D = ids.map((_, i) => ids.map((_, j) => i === j ? 0 : Infinity));
  for (const [a, b] of roads) {
    const i = ids.indexOf(a), j = ids.indexOf(b), w = hav(pts[i], pts[j]) * ROAD_FACTOR;
    D[i][j] = D[j][i] = Math.min(D[i][j], w);
  }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++)
    if (D[i][k] + D[k][j] < D[i][j]) D[i][j] = D[i][k] + D[k][j];
  const node = p => {
    let hub = 0, best = Infinity;
    pts.forEach((q, i) => { const d = hav(p, q); if (d < best) { best = d; hub = i; } });
    return { p, hub, access: best * ROAD_FACTOR, near: ids[hub] };
  };
  const km = (a, b) => {
    const direct = hav(a.p, b.p) * ROAD_FACTOR;
    if (direct < LOCAL_KM || a.hub === b.hub) return direct;
    const via = a.access + D[a.hub][b.hub] + b.access;
    return Number.isFinite(via) ? Math.max(direct, via) : direct * 1.5;
  };
  return { node, km };
}

// ---------------------------------------------------------------------------
// Route ordering on a local distance matrix m (n x n, node 0 = depot).
// Exact Held-Karp up to 12 stops; otherwise nearest neighbour, then 2-opt and
// Or-opt until neither finds a shorter tour.
// ---------------------------------------------------------------------------
function heldKarp(n, m) {
  const k = n - 1, size = 1 << k, full = size - 1;
  const dp = new Float64Array(size * k).fill(Infinity), par = new Int8Array(size * k).fill(-1);
  for (let j = 0; j < k; j++) dp[(1 << j) * k + j] = m[j + 1];
  for (let mask = 1; mask <= full; mask++) for (let j = 0; j < k; j++) {
    const cur = dp[mask * k + j];
    if (!(mask & (1 << j)) || cur === Infinity) continue;
    for (let x = 0; x < k; x++) {
      if (mask & (1 << x)) continue;
      const nm = mask | (1 << x), c = cur + m[(j + 1) * n + x + 1];
      if (c < dp[nm * k + x]) { dp[nm * k + x] = c; par[nm * k + x] = j; }
    }
  }
  let last = 0, best = Infinity;
  for (let j = 0; j < k; j++) { const c = dp[full * k + j] + m[(j + 1) * n]; if (c < best) { best = c; last = j; } }
  const order = [];
  for (let mask = full; last >= 0;) { order.push(last + 1); const p = par[mask * k + last]; mask ^= 1 << last; last = p; }
  return [0, ...order.reverse(), 0];
}

function nearestNeighbour(n, m) {
  const tour = [0], left = new Set(Array.from({ length: n - 1 }, (_, i) => i + 1));
  while (left.size) {
    let best = -1, bd = Infinity;
    const from = tour[tour.length - 1];
    for (const j of left) if (m[from * n + j] < bd) { bd = m[from * n + j]; best = j; }
    tour.push(best); left.delete(best);
  }
  return [...tour, 0];
}

function twoOpt(t, n, m) {
  let improved = false;
  for (let i = 1; i < t.length - 2; i++) for (let j = i + 1; j < t.length - 1; j++) {
    const a = t[i - 1], b = t[i], c = t[j], d = t[j + 1];
    if (m[a * n + c] + m[b * n + d] < m[a * n + b] + m[c * n + d] - 1e-9) {
      for (let x = i, y = j; x < y; x++, y--) [t[x], t[y]] = [t[y], t[x]];
      improved = true;
    }
  }
  return improved;
}

function orOpt(t, n, m) {  // move runs of 1-3 stops to a better spot, either way round
  let improved = false;
  for (let len = 1; len <= 3; len++) for (let i = 1; i + len < t.length; i++) {
    const p = t[i - 1], s0 = t[i], s1 = t[i + len - 1], q = t[i + len];
    const gain = m[p * n + s0] + m[s1 * n + q] - m[p * n + q];
    for (let j = 0; j < t.length - 1; j++) {
      if (j >= i - 1 && j <= i + len - 1) continue;
      const a = t[j], b = t[j + 1];
      const fwd = m[a * n + s0] + m[s1 * n + b] - m[a * n + b];
      const rev = m[a * n + s1] + m[s0 * n + b] - m[a * n + b];
      if (Math.min(fwd, rev) < gain - 1e-9) {
        const seg = t.splice(i, len);
        if (rev < fwd) seg.reverse();
        t.splice(j < i ? j + 1 : j + 1 - len, 0, ...seg);
        improved = true;
        break;
      }
    }
  }
  return improved;
}

function solveTour(n, m) {
  if (n <= 1) return { tour: [0, 0], method: "—" };
  if (n <= 13) return { tour: heldKarp(n, m), method: "exact (Held-Karp)" };
  const t = nearestNeighbour(n, m);
  for (let pass = 0; pass < 200; pass++) {
    const a = twoOpt(t, n, m), b = orOpt(t, n, m);
    if (!a && !b) break;
  }
  return { tour: t, method: "2-opt + Or-opt" };
}

// ---------------------------------------------------------------------------
// Split stops between drivers (sweep around the depot), rebalance the cuts so
// working days are even, then order each driver's stops.
// ---------------------------------------------------------------------------
// opts.closed: return to the start (a cycle) or finish at the last stop (open path).
// opts.rank: stop id -> position in the user's selection, to compare / follow their own order.
function plan(stops, depot, k, cfg, net, opts = {}) {
  const closed = opts.closed !== false, rank = opts.rank;
  const nodes = [net.node(depot), ...stops.map(s => s.node)];
  const S = nodes.length, M = new Float64Array(S * S);
  for (let i = 0; i < S; i++) for (let j = i + 1; j < S; j++) M[i * S + j] = M[j * S + i] = net.km(nodes[i], nodes[j]);
  const minutes = km => km / cfg.speed * 60;

  const cos = Math.cos(depot[0] * Math.PI / 180);
  const ang = stops.map(s => Math.atan2(s.lat - depot[0], (s.lon - depot[1]) * cos));
  let order = stops.map((_, i) => i + 1).sort((a, b) => ang[a - 1] - ang[b - 1]);
  let gapAt = 0, gap = -1;  // start the sweep after the widest empty wedge
  order.forEach((x, i) => {
    const g = (ang[order[(i + 1) % order.length] - 1] - ang[x - 1] + 2 * Math.PI) % (2 * Math.PI);
    if (g > gap) { gap = g; gapAt = i; }
  });
  order = order.slice(gapAt + 1).concat(order.slice(0, gapAt + 1));

  const N = order.length, cuts = Array.from({ length: k + 1 }, (_, g) => Math.round(g * N / k));
  const estimate = g => {  // quick nearest-neighbour working time for group g
    const left = order.slice(cuts[g], cuts[g + 1]);
    let at = 0, km = 0;
    while (left.length) {
      let bi = 0;
      for (let i = 1; i < left.length; i++) if (M[at * S + left[i]] < M[at * S + left[bi]]) bi = i;
      km += M[at * S + left[bi]]; at = left[bi]; left.splice(bi, 1);
    }
    if (closed) km += M[at * S];
    return minutes(km) + (cuts[g + 1] - cuts[g]) * cfg.serviceMin;
  };
  const est = Array.from({ length: k }, (_, g) => estimate(g));
  const deadline = performance.now() + 250;
  while (k > 1 && performance.now() < deadline) {
    const g = est.indexOf(Math.max(...est));
    if (cuts[g + 1] - cuts[g] < 2) break;
    const options = [g - 1, g + 1].filter(x => x >= 0 && x < k).sort((a, b) => est[a] - est[b]);
    let moved = false;
    for (const nb of options) {
      const edge = nb < g ? g : g + 1, before = cuts[edge];
      cuts[edge] += nb < g ? 1 : -1;  // hand the boundary stop to the neighbour
      const eg = estimate(g), en = estimate(nb);
      if (Math.max(eg, en) < est[g] - 1e-6) { est[g] = eg; est[nb] = en; moved = true; break; }
      cuts[edge] = before;
    }
    if (!moved) break;
  }

  const groups = Array.from({ length: k }, (_, g) => order.slice(cuts[g], cuts[g + 1]));
  if (opts.pin) for (const [id, d] of opts.pin) {  // user said: this driver takes this stop, whatever the day limit
    const x = stops.findIndex(s => s.id === id) + 1;
    if (x < 1 || d >= k) continue;
    groups.forEach(gr => { const at = gr.indexOf(x); if (at >= 0) gr.splice(at, 1); });
    groups[d].push(x);
  }

  return Array.from({ length: k }, (_, g) => {
    const ids = [0, ...groups[g]], n = ids.length;
    const m = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) m[i * n + j] = M[ids[i] * S + ids[j]];
    // Open path: make every edge back into the start free, so the solver picks the best place to finish.
    if (!closed) for (let i = 1; i < n; i++) m[i * n] = 0;
    const best = solveTour(n, m);
    const length = t => t.slice(1).reduce((a, x, i) => a + m[t[i] * n + x], 0);
    const pos = i => rank.get(stops[ids[i] - 1].id);
    const mine = rank ? [0, ...ids.slice(1).map((_, i) => i + 1).sort((a, b) => pos(a) - pos(b)), 0] : null;
    const useMine = mine && opts.keepOrder;
    const tour = useMine ? mine : best.tour, method = useMine ? "your selection order" : best.method;
    let clock = 0, km = 0;
    const visits = [];
    for (let x = 1; x < tour.length; x++) {
      const leg = m[tour[x - 1] * n + tour[x]];
      km += leg; clock += minutes(leg);
      if (tour[x] !== 0) {
        visits.push({ stop: stops[ids[tour[x]] - 1], seq: visits.length + 1, eta: clock, legKm: leg });
        clock += cfg.serviceMin;
      }
    }
    return { visits, km, min: n > 1 ? clock : 0, method, closed,
             altKm: mine ? length(useMine ? best.tour : mine) : null };  // the order not being used
  });
}

// ---------------------------------------------------------------------------
// Navigation links. Places are passed as search text (merchant + address),
// which the apps resolve far more precisely than our town-level coordinates.
// ---------------------------------------------------------------------------
const placeText = s => `${s.merchants[0]}, ${s.address}, ${s.parish}, Jamaica`;
const enc = encodeURIComponent;
const nav = {
  google: s => `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${enc(placeText(s))}`,
  waze: s => `https://waze.com/ul?q=${enc(placeText(s))}&navigate=yes`,
  apple: s => `https://maps.apple.com/?daddr=${enc(placeText(s))}&dirflg=d`,
  bing: s => `https://www.bing.com/maps?rtp=~adr.${enc(placeText(s))}&mode=D`
};
const navLinks = s => `<div class="nav">
  <a class="primary" href="${nav.google(s)}" target="_blank" rel="noopener">Navigate</a>
  <a href="${nav.waze(s)}" target="_blank" rel="noopener">Waze</a>
  <a class="alt" href="${nav.bing(s)}" target="_blank" rel="noopener" title="Try this when Google Maps can't find the address">Bing Maps</a>
  <a class="alt" href="${nav.apple(s)}" target="_blank" rel="noopener">Apple Maps</a>
  <button type="button" data-more>More ▾</button></div>`;

// Google Maps takes at most 9 waypoints per link, so long routes are split into parts.
function googleRouteParts(origin, visits, closed) {
  const pts = [origin.text, ...visits.map(v => placeText(v.stop)), ...(closed ? [origin.text] : [])];
  const parts = [];
  for (let i = 0; i < pts.length - 1; i += 10) {
    const seg = pts.slice(i, i + 11), end = i + seg.length - 1;  // this part drives to pts i+1..end
    const from = i + 1, to = Math.min(end, visits.length);
    parts.push({
      label: from > visits.length ? "back to start"
        : `${from === to ? `stop ${from}` : `stops ${from}–${to}`}${end > visits.length ? " → start" : ""}`,
      url: "https://www.google.com/maps/dir/?api=1&travelmode=driving"
        + `&origin=${enc(seg[0])}&destination=${enc(seg[seg.length - 1])}`
        + (seg.length > 2 ? `&waypoints=${seg.slice(1, -1).map(enc).join("%7C")}` : ""),
      bing: "https://www.bing.com/maps?mode=D&rtp=" + seg.map(p => `adr.${enc(p)}`).join("~")
    });
  }
  return parts;
}


function decodePolyline(str) {  // Google's encoded polyline format
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 31) << shift; shift += 5; } while (b >= 32);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      axis ? lon += d : lat += d;
    }
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}

