// Route ordering on a flat n x n cost matrix m (node 0 = start). Exact Held-Karp up to 12 stops,
// otherwise nearest neighbour then 2-opt and Or-opt. Cost can be minutes or km; this only compares sums.

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

function orOpt(t, n, m) { // move runs of 1-3 stops to a better spot, either way round
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

/**
 * Best visiting order. Returns indices 1..n-1 in order (node 0, the start, is implied).
 * closed=false finishes at the last stop; the solver picks the cheapest place to finish.
 */
export function solveOrder(n, matrix, closed) {
  if (n <= 1) return { order: [], method: "none" };
  const m = Float64Array.from(matrix);
  if (!closed) for (let i = 1; i < n; i++) m[i * n] = 0; // returning to the start is free
  let tour, method;
  if (n <= 13) { tour = heldKarp(n, m); method = "exact (Held-Karp)"; }
  else {
    tour = nearestNeighbour(n, m);
    for (let pass = 0; pass < 200; pass++) {
      const a = twoOpt(tour, n, m), b = orOpt(tour, n, m);
      if (!a && !b) break;
    }
    method = "2-opt + Or-opt";
  }
  return { order: tour.slice(1, -1), method };
}

/** Cost of visiting `order` (indices 1..n-1) from node 0, optionally returning. */
export function pathCost(n, m, order, closed) {
  let at = 0, cost = 0;
  for (const j of order) { cost += m[at * n + j]; at = j; }
  return closed ? cost + m[at * n] : cost;
}
