# CLAUDE.md

Driver route planner for servicing merchant payment terminals across Jamaica. Terminal CSVs go in `data/`; `build_data.py` locates and publishes them; a static dashboard on Vercel plans routes live in the browser. **No Google API key is required anywhere.**

## Layout

- `data/*.csv`: source of truth. Terminal exports (columns include `Terminal ID`, `Retailer Name`, `Address`, `City` = parish, `Currency Code` 388/840, `Physical Location? (Y/N)`). Never hand-edit; replace with a new export.
- `data/locations.csv`: location cache, one row per stop key (sha1 of normalised address + parish). It is generated, but rows can be hand-corrected by setting `lat`/`lon` and `source=manual`, which is never overwritten.
- `build_data.py`: CSVs → group into stops → locate → publish to MongoDB if `MONGODB_URI` is set, else `dashboard/stops.json`.
  - Locating defaults to the offline gazetteer (`jamaica_geo.py`), which is town/area level.
  - **Optional:** with `GOOGLE_MAPS_API_KEY` set, it first tries Google Places text search, then the Geocoding API, for exact coordinates.
- `jamaica_geo.py`: offline gazetteer (town/area/Kingston-district centres) and the main-road hub graph used for long-leg distances.
- `dashboard/index.html`: the whole app in one file, with no build step:
  - **Route map:** Leaflet with OpenStreetMap tiles, no key. It draws all routes and pins.
  - **Google view:** a no-key Google Maps iframe embed (`maps.google.com/maps?q=…&output=embed`) of the selected stop. Google searches the merchant + address itself, so it shows the real place even when the pin is approximate. It is display-only: an iframe can't return coordinates to the page.
  - **Planner:** sweep split, then Held-Karp for ≤12 stops, else nearest-neighbour + 2-opt + Or-opt; open or closed paths.
  - Terminal selection, and Google/Waze/Apple navigation links (plain URLs, no key).
- `dashboard/api/stops.js`: Vercel function that reads `meta` + `stops` from MongoDB. The dashboard tries it first, then falls back to `stops.json`.
- `route_planner.py`: legacy CLI for CSVs that already have lat/lon. The dashboard doesn't use it.

## Commands

```bash
pip install -r requirements.txt
python build_data.py                 # locate new addresses, publish
python build_data.py --add new.csv   # upload: copy a CSV into data/, then build + publish
python build_data.py --offline       # never call Google, even if a key is set
python build_data.py --retry         # (with a Google key) re-try addresses that fell back to the gazetteer
python -m http.server -d dashboard 8000   # local preview (static stops.json only)
cd dashboard && npx vercel dev            # local preview including /api/stops (reads dashboard/.env)
```

## Config

`.env` in the project root (gitignored):

- `MONGODB_URI`, `MONGODB_DB` (default `driver_routes`). Vercel needs both in its own environment variables too.
- `GOOGLE_MAPS_API_KEY` (optional). It needs **Places API (New)** + **Geocoding API** on a billed project. Google's no-billing "demo" keys don't cover these. It's only used locally by `build_data.py`, never by the site.

## MongoDB collections

Mirrored exactly from `data/` on every build: rows missing from the CSVs are deleted.

- `terminals`: every CSV row with all original columns, `_id` = Terminal ID, plus `source_file`, `source_line`, `physical`, `stop_id`.
- `stops`: one per physical location (`_id` = stop key): merchants, address, parish, `listed_parish`, lat/lon, `source` (`gazetteer`/`google-places`/`google-geocode`/`manual`), `accuracy`, `approx`, `place_id`, and its terminals.
- `locations`: the location cache.
- `meta` (`_id: "current"`): build info, sources, road hubs/edges.

## Conventions and gotchas

- **Every CSV row is ingested and routed; nothing is filtered.** `build_data.py` exits if any row fails to land in a stop, and `npm run seed` refuses to run if `stops.json` is missing any CSV terminal. `Physical Location?` is only a label: each terminal gets `physical` = `Y`/`N`/`""`. Stops whose terminals are all `N` get `no_physical: true` and a **NO PHYSICAL** tag in the UI. A blank flag copies the row above only when that row is the same merchant at the same address; otherwise it stays blank.
- `npm run seed` mirrors the files: it replaces docs, deletes terminals/stops no longer in `data/`, keeps every original column under `terminals.csv`, and carries Google pins over by address + parish (stopIds `S1…` are positional and shift).
- Stops keep the CSV's parish unless the located point is more than 35 km from that parish's centre (`PARISH_RADIUS_KM`).
- Without Google, about 1,100 stops share about 100 town-level points. The dashboard fans out identical pins for display only. Approximate stops are tagged **APPROX**, and their navigation links and Google view search by merchant + address text, not coordinates.
- Free OpenStreetMap geocoding (Nominatim) was tested and found 1 of 8 sample addresses. Jamaican street addresses are poorly covered, so it isn't used.
- Saved dashboard selections are keyed by **terminal ID**, because stop ids can change if an address is edited.
- Google Maps direction links allow 9 waypoints, so routes are split into parts of 10 stops. Waze and Apple Maps links take one destination, so they are per stop. Multi-stop iframe directions embeds are undocumented and unreliable, so they aren't used.
- Keep the planner functions (`roadNetwork` … `googleRouteParts`) free of DOM access, so the block can be extracted and run in Node for tests.
- The data is bank merchant data: keep the Vercel deployment protected, and never commit `.env`.
