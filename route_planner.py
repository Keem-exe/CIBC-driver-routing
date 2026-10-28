"""
Delivery route planner.

Reads a deliveries CSV (stdlib `csv` module only), decides which deliveries
should go out, groups them into driver routes, orders each route as a
Hamiltonian cycle (depot -> every stop once -> depot), and writes
dashboard/routes.json for the static dashboard.

Pipeline
  1. Parse     - csv.DictReader with flexible header matching.
  2. Select    - drop delivered/cancelled rows and anything due after the
                 horizon; if total load exceeds fleet capacity, keep the most
                 urgent (due date, then priority) and defer the rest.
  3. Distances - straight-line (haversine) by default. With --roads, each stop
                 is snapped to a road network and Dijkstra's algorithm gives the
                 real shortest path between every pair of stops.
  4. Group     - sweep algorithm: sort stops by bearing from the depot and cut
                 the circle into one wedge per driver, balanced by load and
                 capped by vehicle capacity.
  5. Order     - shortest Hamiltonian cycle per driver: exact Held-Karp DP for
                 <= 12 stops, otherwise nearest-neighbour + 2-opt.

Usage
  python route_planner.py deliveries.csv --drivers 4 --capacity 40
  python route_planner.py deliveries.csv --depot 51.5072,-0.1276 --roads roads.csv
"""

import argparse
import csv
import heapq
import json
import math
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

# --------------------------------------------------------------------------
# 1. Parsing
# --------------------------------------------------------------------------

# Accepted header names (lowercased, spaces/dashes -> underscores).
ALIASES = {
    "id": ["id", "order_id", "delivery_id", "order", "order_no", "ref", "reference", "tracking"],
    "customer": ["customer", "name", "recipient", "client", "customer_name"],
    "address": ["address", "addr", "street", "destination", "delivery_address", "location"],
    "lat": ["lat", "latitude", "y"],
    "lon": ["lon", "lng", "long", "longitude", "x"],
    "zone": ["zone", "area", "region", "postcode", "zip", "zipcode", "postal_code"],
    "qty": ["qty", "quantity", "packages", "items", "parcels", "load", "units", "weight", "size"],
    "priority": ["priority", "prio", "urgency"],
    "due": ["due", "due_date", "deadline", "delivery_date", "date", "scheduled", "ship_date"],
    "status": ["status", "state", "delivery_status"],
}
DONE_STATUSES = {"delivered", "complete", "completed", "cancelled", "canceled", "returned", "done"}
PRIORITY_WORDS = {"urgent": 1, "high": 1, "express": 1, "medium": 2, "normal": 2, "standard": 2, "low": 3}
DATE_FORMATS = ["%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d.%m.%Y",
                "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"]


def norm(header):
    return header.strip().lower().replace(" ", "_").replace("-", "_")


def map_columns(headers):
    by_norm = {norm(h): h for h in headers}
    return {field: next((by_norm[a] for a in names if a in by_norm), None)
            for field, names in ALIASES.items()}


def parse_date(text):
    text = (text or "").strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def parse_priority(text):
    text = (text or "").strip().lower()
    if text in PRIORITY_WORDS:
        return PRIORITY_WORDS[text]
    try:
        return int(float(text))
    except ValueError:
        return 2


def parse_float(text, default=None):
    try:
        return float(str(text).strip())
    except (TypeError, ValueError):
        return default


def read_deliveries(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        sample = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        reader = csv.DictReader(f, dialect=dialect)
        cols = map_columns(reader.fieldnames or [])
        if not cols["lat"] or not cols["lon"]:
            sys.exit(f"CSV needs latitude/longitude columns. Found headers: {reader.fieldnames}")

        rows, skipped = [], []
        for i, row in enumerate(reader, start=2):  # line 1 is the header
            get = lambda k: row.get(cols[k], "") if cols[k] else ""
            lat, lon = parse_float(get("lat")), parse_float(get("lon"))
            if lat is None or lon is None:
                skipped.append({"line": i, "reason": "missing coordinates", "raw": row})
                continue
            rows.append({
                "id": get("id") or f"row-{i}",
                "customer": get("customer"),
                "address": get("address"),
                "zone": get("zone"),
                "lat": lat,
                "lon": lon,
                "qty": parse_float(get("qty"), 1.0),
                "priority": parse_priority(get("priority")),
                "due": parse_date(get("due")),
                "status": (get("status") or "pending").strip().lower(),
            })
    return rows, skipped, cols


# --------------------------------------------------------------------------
# 2. Selection
# --------------------------------------------------------------------------

def select_deliveries(rows, today, horizon_days, fleet_capacity):
    """Return (to_deliver, deferred). Deferred items carry a reason."""
    cutoff = today + timedelta(days=horizon_days)
    open_rows, deferred = [], []
    for r in rows:
        if r["status"] in DONE_STATUSES:
            continue
        if r["due"] and r["due"] > cutoff:
            deferred.append({**r, "reason": f"due {r['due']} (after {cutoff})"})
            continue
        open_rows.append(r)

    # Most urgent first: overdue/earliest due date, then priority (1 = highest).
    open_rows.sort(key=lambda r: (r["due"] or date.max, r["priority"]))
    chosen, load = [], 0.0
    for r in open_rows:
        if load + r["qty"] <= fleet_capacity:
            chosen.append(r)
            load += r["qty"]
        else:
            deferred.append({**r, "reason": "fleet capacity reached"})
    # Copies, so planning several fleet sizes from the same rows never leaks state.
    return [{**r, "overdue": bool(r["due"] and r["due"] < today)} for r in chosen], deferred


# --------------------------------------------------------------------------
# 3. Distances: haversine, or Dijkstra over a road network
# --------------------------------------------------------------------------

def haversine_km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


class RoadGraph:
    """
    Road network from a CSV of edges:
        from_lat,from_lon,to_lat,to_lon[,distance_km][,oneway]
    Nodes are coordinates; edge weight defaults to haversine length.
    """

    def __init__(self, path):
        self.adj = {}
        with open(path, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                row = {norm(k): v for k, v in row.items()}
                a = (round(float(row["from_lat"]), 6), round(float(row["from_lon"]), 6))
                b = (round(float(row["to_lat"]), 6), round(float(row["to_lon"]), 6))
                w = parse_float(row.get("distance_km"), None) or haversine_km(a, b)
                self.adj.setdefault(a, []).append((b, w))
                self.adj.setdefault(b, [])
                if str(row.get("oneway", "")).strip().lower() not in ("1", "true", "yes", "y"):
                    self.adj[b].append((a, w))
        self.nodes = list(self.adj)

    def snap(self, point):
        return min(self.nodes, key=lambda n: haversine_km(n, point))

    def dijkstra(self, source):
        """Single-source shortest paths. Returns (dist, prev)."""
        dist, prev = {source: 0.0}, {}
        heap = [(0.0, source)]
        while heap:
            d, u = heapq.heappop(heap)
            if d > dist.get(u, math.inf):
                continue
            for v, w in self.adj[u]:
                nd = d + w
                if nd < dist.get(v, math.inf):
                    dist[v], prev[v] = nd, u
                    heapq.heappush(heap, (nd, v))
        return dist, prev

    @staticmethod
    def path(prev, source, target):
        out = [target]
        while out[-1] != source:
            if out[-1] not in prev:
                return None
            out.append(prev[out[-1]])
        return out[::-1]


def build_matrix(points, graph=None):
    """
    Distance matrix between points (index 0 is the depot).
    Returns (matrix, paths) where paths[i][j] is a list of [lat, lon] to draw.
    """
    n = len(points)
    if graph is None:
        m = [[haversine_km(points[i], points[j]) for j in range(n)] for i in range(n)]
        return m, None

    snapped = [graph.snap(p) for p in points]
    m = [[0.0] * n for _ in range(n)]
    paths = [[None] * n for _ in range(n)]
    for i in range(n):
        dist, prev = graph.dijkstra(snapped[i])
        for j in range(n):
            if i == j:
                continue
            if snapped[j] in dist:
                # access legs: stop -> nearest road node, road node -> stop
                m[i][j] = (haversine_km(points[i], snapped[i]) + dist[snapped[j]]
                           + haversine_km(snapped[j], points[j]))
                road = RoadGraph.path(prev, snapped[i], snapped[j]) or []
                paths[i][j] = [list(points[i])] + [list(p) for p in road] + [list(points[j])]
            else:  # unreachable on the network; fall back to straight line
                m[i][j] = haversine_km(points[i], points[j]) * 1.4
                paths[i][j] = [list(points[i]), list(points[j])]
    return m, paths


# --------------------------------------------------------------------------
# 4. Grouping: sweep algorithm
# --------------------------------------------------------------------------

def bearing(depot, p):
    return math.atan2(p[0] - depot[0], (p[1] - depot[1]) * math.cos(math.radians(depot[0])))


def sweep_groups(stops, depot, drivers, capacity, max_stops):
    """
    Order stops by angle around the depot, then cut into contiguous wedges so
    neighbouring deliveries share a driver. Each wedge targets an equal share
    of the load and never exceeds vehicle capacity or max_stops.
    """
    if not stops:
        return [[] for _ in range(drivers)], []
    ordered = sorted(stops, key=lambda s: bearing(depot, (s["lat"], s["lon"])))
    # Start the sweep at the biggest angular gap so no cluster is split in two.
    angles = [bearing(depot, (s["lat"], s["lon"])) for s in ordered]
    gaps = [(angles[(i + 1) % len(angles)] - angles[i]) % (2 * math.pi) for i in range(len(angles))]
    start = (max(range(len(gaps)), key=gaps.__getitem__) + 1) % len(ordered)
    ordered = ordered[start:] + ordered[:start]

    total = sum(s["qty"] for s in ordered)
    groups, overflow = [[] for _ in range(drivers)], []
    g, load, remaining = 0, 0.0, total
    for s in ordered:
        if g < drivers and groups[g]:
            target = remaining / (drivers - g)
            if (load + s["qty"] > capacity or len(groups[g]) >= max_stops
                    or (load >= target and g < drivers - 1)):
                remaining -= load
                g, load = g + 1, 0.0
        if g >= drivers or s["qty"] > capacity:
            overflow.append({**s, "reason": "no driver capacity left in this area"})
            continue
        groups[g].append(s)
        load += s["qty"]
    return groups, overflow


# --------------------------------------------------------------------------
# 5. Ordering: shortest Hamiltonian cycle (travelling salesman)
# --------------------------------------------------------------------------

def tour_length(tour, m):
    return sum(m[tour[i]][tour[i + 1]] for i in range(len(tour) - 1))


def held_karp(nodes, m):
    """
    Exact shortest Hamiltonian cycle starting/ending at nodes[0], via
    Held-Karp dynamic programming: O(n^2 * 2^n). Use for n <= ~12.
    """
    depot, rest = nodes[0], nodes[1:]
    k = len(rest)
    if k == 0:
        return [depot, depot]
    # best[(mask, j)] = (cost, parent) for paths depot -> subset(mask) ending at rest[j]
    best = {(1 << j, j): (m[depot][rest[j]], None) for j in range(k)}
    for size in range(2, k + 1):
        for mask in range(1 << k):
            if bin(mask).count("1") != size:
                continue
            for j in range(k):
                if not mask & (1 << j):
                    continue
                prev_mask = mask ^ (1 << j)
                best[(mask, j)] = min(
                    (best[(prev_mask, i)][0] + m[rest[i]][rest[j]], i)
                    for i in range(k) if prev_mask & (1 << i)
                )
    full = (1 << k) - 1
    _, last = min((best[(full, j)][0] + m[rest[j]][depot], j) for j in range(k))
    order, mask = [], full
    while last is not None:
        order.append(rest[last])
        mask, last = mask ^ (1 << last), best[(mask, last)][1]
    return [depot] + order[::-1] + [depot]


def nearest_neighbour(nodes, m):
    tour, todo = [nodes[0]], set(nodes[1:])
    while todo:
        nxt = min(todo, key=lambda j: m[tour[-1]][j])
        tour.append(nxt)
        todo.remove(nxt)
    return tour + [nodes[0]]


def two_opt(tour, m):
    """Reverse segments while it shortens the cycle."""
    best = tour[:]
    best_len = tour_length(best, m)
    improved = True
    while improved:
        improved = False
        for i in range(1, len(best) - 2):
            for j in range(i + 1, len(best) - 1):
                cand = best[:i] + best[i:j + 1][::-1] + best[j + 1:]
                cand_len = tour_length(cand, m)
                if cand_len < best_len - 1e-9:
                    best, best_len, improved = cand, cand_len, True
    return best


def solve_cycle(nodes, m):
    if len(nodes) <= 13:  # depot + 12 stops
        return held_karp(nodes, m), "held-karp (exact)"
    return two_opt(nearest_neighbour(nodes, m), m), "nearest-neighbour + 2-opt"


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------

def serialise(stop):
    out = {k: v for k, v in stop.items() if k != "due"}
    out["due"] = stop["due"].isoformat() if stop.get("due") else None
    return out


def maps_link(depot, stops):
    """Google Maps directions URL (max 9 waypoints in a URL)."""
    pts = [f"{s['lat']},{s['lon']}" for s in stops[:9]]
    origin = f"{depot[0]},{depot[1]}"
    return ("https://www.google.com/maps/dir/?api=1&travelmode=driving"
            f"&origin={origin}&destination={origin}&waypoints={'|'.join(pts)}")


def plan_routes(rows, depot, drivers, names, graph, today, args):
    """Plan one fleet size. Returns the per-plan part of routes.json."""
    to_deliver, deferred = select_deliveries(rows, today, args.horizon, drivers * args.capacity)
    groups, overflow = sweep_groups(to_deliver, depot, drivers, args.capacity, args.max_stops)
    deferred += overflow

    routes = []
    for gi, group in enumerate(groups):
        name = names[gi] if gi < len(names) else f"Driver {gi + 1}"
        if not group:
            routes.append({"driver": name, "stops": [], "distance_km": 0, "duration_min": 0,
                           "load": 0, "method": None, "path": [], "maps_url": None})
            continue
        points = [depot] + [(s["lat"], s["lon"]) for s in group]
        m, paths = build_matrix(points, graph)
        tour, method = solve_cycle(list(range(len(points))), m)
        dist = tour_length(tour, m)

        ordered, clock = [], 0.0
        for a, b in zip(tour, tour[1:]):
            clock += m[a][b] / args.speed * 60
            if b != 0:
                s = group[b - 1]
                ordered.append({**serialise(s), "seq": len(ordered) + 1,
                                "eta_min": round(clock), "leg_km": round(m[a][b], 2)})
                clock += args.service_min
        if paths:
            line = [pt for a, b in zip(tour, tour[1:]) for pt in paths[a][b]]
        else:
            line = [list(points[i]) for i in tour]

        routes.append({
            "driver": name,
            "stops": ordered,
            "distance_km": round(dist, 2),
            "duration_min": round(clock),
            "load": round(sum(s["qty"] for s in group), 2),
            "method": method + (" on road network (Dijkstra)" if graph else " on straight-line distance"),
            "path": line,
            "maps_url": maps_link(depot, ordered),
        })

    return {
        "settings": {"drivers": drivers, "capacity": args.capacity, "max_stops": args.max_stops,
                     "horizon_days": args.horizon, "speed_kmh": args.speed,
                     "service_min": args.service_min, "road_network": bool(graph)},
        "summary": {
            "planned": sum(len(r["stops"]) for r in routes),
            "deferred": len(deferred),
            "total_km": round(sum(r["distance_km"] for r in routes), 2),
        },
        "routes": routes,
        "deferred": [serialise(d) for d in deferred],
    }


def main():
    ap = argparse.ArgumentParser(description="Plan delivery routes from a CSV.")
    ap.add_argument("csv", help="deliveries CSV")
    ap.add_argument("--drivers", type=int, default=3, help="driver count the dashboard opens with (default 3)")
    ap.add_argument("--max-drivers", type=int, default=10,
                    help="plan every fleet size from 1 to this, for the dashboard's driver picker (default 10)")
    ap.add_argument("--driver-names", help="comma-separated default names, e.g. 'Ana,Ben,Cy' (renamable in the dashboard)")
    ap.add_argument("--capacity", type=float, default=50, help="load per vehicle, in the CSV's qty unit")
    ap.add_argument("--max-stops", type=int, default=25, help="max stops per driver")
    ap.add_argument("--depot", help="'lat,lon' of the depot (default: centre of deliveries)")
    ap.add_argument("--horizon", type=int, default=0, help="include deliveries due within N days (default 0 = today/overdue/undated)")
    ap.add_argument("--today", help="override today's date, YYYY-MM-DD")
    ap.add_argument("--speed", type=float, default=30, help="average speed km/h for time estimates")
    ap.add_argument("--service-min", type=float, default=5, help="minutes spent at each stop")
    ap.add_argument("--roads", help="optional road-network edges CSV; enables Dijkstra distances")
    ap.add_argument("--out", default=str(Path(__file__).parent / "dashboard" / "routes.json"))
    args = ap.parse_args()

    today = date.fromisoformat(args.today) if args.today else date.today()
    rows, skipped, cols = read_deliveries(args.csv)
    print(f"Read {len(rows)} deliveries ({len(skipped)} skipped). Column map: "
          + ", ".join(f"{k}={v}" for k, v in cols.items() if v))

    if args.depot:
        depot = tuple(float(x) for x in args.depot.split(","))
    elif rows:
        depot = (sum(r["lat"] for r in rows) / len(rows), sum(r["lon"] for r in rows) / len(rows))
    else:
        sys.exit("No deliveries with coordinates found.")

    graph = RoadGraph(args.roads) if args.roads else None
    names = [n.strip() for n in args.driver_names.split(",")] if args.driver_names else []
    max_drivers = max(args.max_drivers, args.drivers)

    plans = {}
    for n in range(1, max_drivers + 1):
        p = plan_routes(rows, depot, n, names, graph, today, args)
        plans[str(n)] = p
        print(f"  {n} driver(s): {p['summary']['planned']} stops, {p['summary']['total_km']:.1f} km, "
              f"{p['summary']['deferred']} deferred")

    # Shared fields live at the top; the dashboard merges them with plans[<driver count>].
    result = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "plan_date": today.isoformat(),
        "source": Path(args.csv).name,
        "depot": list(depot),
        "total_rows": len(rows),
        "skipped": skipped,
        "default_drivers": args.drivers,
        "plans": plans,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Planned 1-{max_drivers} drivers (dashboard opens on {args.drivers}). Wrote {out}")


if __name__ == "__main__":
    main()
