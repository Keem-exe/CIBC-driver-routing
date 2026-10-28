# Driver Routes

Plans daily driver routes to the merchant terminals in `data/*.csv` (Jamaica) and shows them on a map. Planning runs live in the browser: change the number of drivers, the parishes to visit, the depot or the time per stop, and the routes are re-optimised instantly.

## Update the data

```bash
python build_data.py        # reads every CSV in data/, writes dashboard/stops.json
```

- Terminals at the same address and parish (e.g. a merchant's JMD and USD terminals) become one stop.
- Rows with `Physical Location? = N` are skipped. A blank value inherits the row above (the USD twin of a JMD terminal).
- Addresses are geocoded offline by `jamaica_geo.py` to an area, Kingston postal district, town or parish centre. Where the address names a town in a different parish than the `City` column, the stop is routed to the parish in the address and tagged **APPROX** in the dashboard.

Commit and push `dashboard/stops.json` after re-running to update the live site.

## Using the dashboard

- **Drivers / Min per stop / Avg km/h / Day (hrs):** planning inputs. Routes over the working day are flagged, with a suggested driver count.
- **Depot:** drag the **D** pin. Defaults to New Kingston.
- **Parishes:** choose which parishes to visit today.
- **Select terminals:** search by terminal ID, merchant or address, or use **Add to selection** on a map pin. While terminals are selected, only those stops are routed and the parish filter is ignored.
  - **Start from:** the depot or any selected stop. Two selected terminals give a simple A→B route.
  - **Order:** *Recommended* is the shortest order the planner finds. *As I selected them* keeps your order. Each route shows the distance of the other order for comparison.
  - Uses as few drivers as fit the working day, up to the **Drivers** setting.
- **Return to start at the end:** off means the route ends at the last stop, and the planner picks the best stop to finish on. This setting is remembered separately for parish routes (default on) and selections (default off).
- **Driver names:** click a name to rename it.
- Settings and names are saved in each browser.

### Navigation

- **Google Maps:** each route has links that open the whole route in order. Google allows 9 waypoints per link, so a route is split into parts of 10 stops.
- **Waze and Apple Maps:** their links only support one destination, so every stop has its own Google Maps, Waze and Apple Maps buttons. Drivers tap them in order.
- Links search for the merchant name and address, which is more precise than the town-level map pins.

## How it plans

1. **Distances:** short hops use straight-line distance × 1.3. Longer hops follow the main-road network between towns (`HUBS`/`ROADS` in `jamaica_geo.py`), so routes go around the mountains rather than over them.
2. **Split between drivers:** sweeps around the depot so each driver gets a compact area. The boundaries are then shifted until working days are as even as possible.
3. **Order each route:** routes of up to 12 stops are solved exactly with Held-Karp. Longer routes use nearest-neighbour, then 2-opt and Or-opt until no shorter tour is found.

## Deploy (Vercel)

In the Vercel project settings, set **Root Directory** to `dashboard`, set **Framework Preset** to **Other**, and leave the build, output and install commands empty. No API keys are needed: the map uses OpenStreetMap tiles.

**Privacy:** `stops.json` contains merchant names, addresses and terminal IDs, and anyone with the link can read it. Turn on Vercel **Deployment Protection** (Settings → Deployment Protection), and check that it covers the production URL you share.

## Other files

`route_planner.py` is the earlier command-line planner for CSVs that already have latitude and longitude. The dashboard no longer uses it.
