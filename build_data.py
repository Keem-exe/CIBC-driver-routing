"""
Turn the terminal CSVs in data/ into dashboard/stops.json.

Every row of every terminal CSV is kept: nothing is filtered out. Terminals at
the same address and parish (e.g. a merchant's JMD and USD terminals) are
grouped into one stop. Addresses are located offline with jamaica_geo.locate,
and the main-road network is exported alongside so the dashboard can plan
routes in the browser.

The CSV's "Physical Location? (Y/N)" flag is recorded on each terminal
("Y", "N", or "" when blank and not resolvable), never used to drop rows.
A blank flag is taken from the row above only when that row is the same
merchant at the same address (the USD twin of a JMD terminal).

Usage
  python build_data.py                      # every terminal *.csv in data/
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
REQUIRED = {"Terminal ID", "Retailer Name", "Address", "City"}
FLAG = "Physical Location? (Y/N)"


def clean_name(name):
    """'A & E PHARMACY-1USD' -> 'A & E PHARMACY'."""
    return re.sub(r"\s*-\s*\d*\s*(USD|JMD)?\s*$", "", name.strip(), flags=re.I) or name.strip()


def nearest_parish(lat, lon):
    return min(geo.PARISH_CENTRES, key=lambda p: (geo.PARISH_CENTRES[p][0] - lat) ** 2 + (geo.PARISH_CENTRES[p][1] - lon) ** 2)


def read_terminals(path):
    """Every row of one CSV, with the physical flag resolved as described above."""
    rows, prev = [], None
    with open(path, newline="", encoding="utf-8-sig") as f:
        for line, row in enumerate(csv.DictReader(f), start=2):  # line 1 is the header
            flag = (row.get(FLAG) or "").strip().upper()
            if not flag and prev and clean_name(prev["Retailer Name"]) == clean_name(row["Retailer Name"]) \
                    and prev["Address"].strip() == row["Address"].strip():
                flag = prev["_physical"]
            row = {**row, "_physical": flag, "_source": path.stem, "_line": line}
            rows.append(row)
            prev = row
    return rows


def terminal_csvs(paths):
    """Only files with the terminal export's columns; anything else in data/ is reported and ignored."""
    out = []
    for p in paths:
        with open(p, newline="", encoding="utf-8-sig") as f:
            missing = REQUIRED - set(csv.DictReader(f).fieldnames or [])
        if missing:
            print(f"Ignoring {p.name}: not a terminal export (missing {', '.join(sorted(missing))})")
        else:
            out.append(p)
    return out


def build(paths):
    stops, rows = {}, 0
    for path in paths:
        for r in read_terminals(path):
            rows += 1
            address, parish = r["Address"].strip(), r["City"].strip().upper()
            key = (geo.normalise(address), parish)
            if key not in stops:
                lat, lon, place, precision, mismatch = geo.locate(address, parish)
                if lat is None:  # nothing matched, not even the parish: keep the stop, pin it at Kingston
                    (lat, lon), place, precision = geo.PARISH_CENTRES["KINGSTON"], "Unknown", "unknown"
                # The address names a town in another parish: route it where the address is.
                routed = nearest_parish(lat, lon) if mismatch else parish
                stops[key] = {"id": f"S{len(stops) + 1}", "merchants": [], "address": address,
                              "parish": routed.title() or "Unknown", "listed_parish": parish.title(),
                              "lat": lat, "lon": lon, "place": place,
                              "precision": precision, "parish_mismatch": mismatch, "terminals": []}
            s = stops[key]
            name = clean_name(r["Retailer Name"])
            if name not in s["merchants"]:
                s["merchants"].append(name)
            s["terminals"].append({
                "id": r["Terminal ID"].strip(),
                "currency": "USD" if r.get("Currency Code", "").strip() == "840" else "JMD",
                "model": (r.get("Term Model") or "").strip(),
                "physical": r["_physical"],
                "source": r["_source"],
                "line": r["_line"],
            })
    for s in stops.values():
        # Flag stops where the CSV says no terminal has a physical location (still routed, just labelled).
        s["no_physical"] = all(t["physical"] == "N" for t in s["terminals"])
    return list(stops.values()), rows


def main():
    paths = terminal_csvs([Path(p) for p in sys.argv[1:]] or sorted((ROOT / "data").glob("*.csv")))
    if not paths:
        sys.exit("No terminal CSVs found in data/")
    stops, rows = build(paths)
    terminals = [t for s in stops for t in s["terminals"]]
    if len(terminals) != rows:  # every CSV row must land in exactly one stop
        sys.exit(f"Row count mismatch: {rows} CSV rows but {len(terminals)} terminals in stops")
    flags = {v: sum(t["physical"] == v for t in terminals) for v in ("Y", "N", "")}
    result = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "sources": [p.name for p in paths],
        "csv_rows": rows,
        "physical_flags": {"Y": flags["Y"], "N": flags["N"], "blank": flags[""]},
        "stops": stops,
        "hubs": geo.HUBS,
        "roads": geo.ROADS,
    }
    OUT.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    print(f"{rows} CSV rows -> {len(terminals)} terminals in {len(stops)} stops (none omitted). "
          f"Physical flag: {flags['Y']} Y, {flags['N']} N, {flags['']} blank. "
          f"{sum(s['no_physical'] for s in stops)} stops are N-only. Wrote {OUT}")


if __name__ == "__main__":
    main()
