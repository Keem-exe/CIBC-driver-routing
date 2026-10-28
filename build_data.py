"""
Turn the terminal CSVs in data/ into dashboard/stops.json.

Each stop is one physical place: terminals at the same address and parish
(e.g. a merchant's JMD and USD terminals) are visited together. Addresses are
geocoded offline with jamaica_geo.locate, and the main-road network is
exported alongside so the dashboard can plan routes in the browser.

Usage
  python build_data.py                      # every *.csv in data/
  python build_data.py data/single_currency.csv
"""

import csv
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import jamaica_geo as geo

ROOT = Path(__file__).parent
OUT = ROOT / "dashboard" / "stops.json"


def clean_name(name):
    """'A & E PHARMACY-1USD' -> 'A & E PHARMACY'."""
    return re.sub(r"\s*-\s*\d*\s*(USD|JMD)?\s*$", "", name.strip(), flags=re.I) or name.strip()


def nearest_parish(lat, lon):
    return min(geo.PARISH_CENTRES, key=lambda p: (geo.PARISH_CENTRES[p][0] - lat) ** 2 + (geo.PARISH_CENTRES[p][1] - lon) ** 2)


def read_terminals(path):
    """Rows of one CSV. A blank 'Physical Location?' inherits the row above (dual-currency twins)."""
    rows, physical = [], "Y"
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            flag = (row.get("Physical Location? (Y/N)") or "").strip().upper()
            physical = flag or physical
            rows.append({**row, "_physical": physical == "Y", "_source": path.stem})
    return rows


def build(paths):
    stops, virtual = {}, 0
    for path in paths:
        for r in read_terminals(path):
            if not r["_physical"]:
                virtual += 1
                continue
            address, parish = r["Address"].strip(), r["City"].strip().upper()
            key = (geo.normalise(address), parish)
            if key not in stops:
                lat, lon, place, precision, mismatch = geo.locate(address, parish)
                # The address names a town in another parish: route it where the address is.
                routed = nearest_parish(lat, lon) if mismatch else parish
                stops[key] = {"id": f"S{len(stops) + 1}", "merchants": [], "address": address,
                              "parish": routed.title(), "listed_parish": parish.title(),
                              "lat": lat, "lon": lon, "place": place,
                              "precision": precision, "parish_mismatch": mismatch, "terminals": []}
            s = stops[key]
            name = clean_name(r["Retailer Name"])
            if name not in s["merchants"]:
                s["merchants"].append(name)
            s["terminals"].append({
                "id": r["Terminal ID"].strip(),
                "currency": "USD" if r["Currency Code"].strip() == "840" else "JMD",
                "model": r["Term Model"].strip(),
                "source": r["_source"],
            })
    return list(stops.values()), virtual


def main():
    paths = [Path(p) for p in sys.argv[1:]] or sorted((ROOT / "data").glob("*.csv"))
    stops, virtual = build(paths)
    located = [s for s in stops if s["lat"] is not None]
    result = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "sources": [p.name for p in paths],
        "stops": located,
        "unlocated": [s for s in stops if s["lat"] is None],
        "virtual_terminals": virtual,
        "hubs": geo.HUBS,
        "roads": geo.ROADS,
    }
    OUT.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    terminals = sum(len(s["terminals"]) for s in stops)
    print(f"{terminals} physical terminals -> {len(stops)} stops ({len(result['unlocated'])} unlocated); "
          f"{virtual} terminals without a physical location skipped. Wrote {OUT}")


if __name__ == "__main__":
    main()
