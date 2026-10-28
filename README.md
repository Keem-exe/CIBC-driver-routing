# Delivery Routes

`route_planner.py` reads a deliveries CSV, decides what should go out today, groups stops by driver, and orders each driver's route. It writes `dashboard/routes.json`, which the static dashboard in `dashboard/` reads and shows on a map.

## Run

```bash
python route_planner.py deliveries.csv --drivers 3 --capacity 35 --depot 51.5072,-0.1276 --driver-names "Ana,Ben,Cy"
```

| Flag | Meaning | Default |
|---|---|---|
| `--drivers` | Number of vehicles | 3 |
| `--capacity` | Load per vehicle, in the CSV's quantity unit | 50 |
| `--max-stops` | Most stops one driver can take | 25 |
| `--depot` | `lat,lon` where routes start and end | centre of all deliveries |
| `--horizon` | Also include deliveries due in the next N days | 0 |
| `--today` | Plan for a different date (`YYYY-MM-DD`) | today |
| `--speed`, `--service-min` | Average km/h, and minutes spent at each stop (used for ETAs) | 30, 5 |
| `--roads` | Road-network edges CSV, which turns on Dijkstra | off |

## CSV columns

Headers are matched loosely, so `Latitude`, `lat` and `y` all work. Only latitude and longitude are required.

id · customer · address · postcode/zone · **latitude** · **longitude** · qty/packages/weight · priority (1–3 or high/normal/low) · due date · status

## How it plans

1. **Select.** Drops delivered and cancelled orders, and anything due after the horizon. If the fleet can't carry everything, it keeps overdue orders first, then those due soonest, then the highest priority. The rest are shown as deferred, each with a reason.
2. **Group.** Uses the sweep algorithm: it sorts stops by bearing from the depot and cuts them into wedges, one per driver, balanced by load and limited by capacity.
3. **Order.** Finds the shortest Hamiltonian cycle (depot → each stop once → depot) for each driver. Routes of up to 12 stops are solved exactly with Held-Karp dynamic programming. Longer routes use nearest-neighbour followed by 2-opt.
4. **Distances.** Uses straight-line (haversine) distance by default. If you pass `--roads edges.csv` (`from_lat,from_lon,to_lat,to_lon[,distance_km][,oneway]`), it runs Dijkstra from every stop over the road graph. Those real shortest-path distances then feed the route ordering, and the map draws the actual road paths.

## Deploy the dashboard to Vercel

```bash
python route_planner.py deliveries.csv ...   # regenerates dashboard/routes.json
cd dashboard
npx vercel login        # first time only
npx vercel --prod
```

Re-run both commands whenever the CSV changes. Run `npx vercel` without `--prod` to get a preview URL instead.

To preview it locally, run `python -m http.server -d dashboard 8000` and open http://localhost:8000.

Note: the published dashboard includes customer names and addresses. Turn on Vercel's Deployment Protection, or remove those fields, before you share the link.
