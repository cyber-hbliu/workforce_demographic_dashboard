"""One-off patch: pull series that scripts/fetch_bls.py started collecting after
the last workflow run, and merge them into the existing docs/data files without
touching anything else. Works without an API key (25 series per request).
Usage: python scripts/backfill_series.py
"""
import json
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
DATA = ROOT / "docs" / "data"
API = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
AREAS = json.loads((ROOT / "config" / "areas.json").read_text())


def tidy(series):
    rows = []
    for d in series.get("data", []):
        if not d["period"].startswith("M") or d["period"] == "M13":
            continue
        try:
            rows.append({"date": f"{d['year']}-{d['period'][1:]}", "value": float(d["value"])})
        except ValueError:
            continue
    rows.sort(key=lambda r: r["date"])
    return rows


def fetch(ids, start="2017", end="2026"):  # unkeyed requests allow ten years
    out = {}
    for i in range(0, len(ids), 25):
        chunk = ids[i:i + 25]
        r = requests.post(API, json={"seriesid": chunk, "startyear": start, "endyear": end}, timeout=90)
        body = r.json()
        if body.get("status") != "REQUEST_SUCCEEDED":
            sys.exit(f"API refused: {body.get('message')}")
        for s in body["Results"]["series"]:
            out[s["seriesID"]] = tidy(s)
        print(f"  {min(i + 25, len(ids))}/{len(ids)}", file=sys.stderr)
        time.sleep(0.5)
    return out


metros = json.loads((DATA / "metros.json").read_text())
national = json.loads((DATA / "national.json").read_text())

def stale(rows, ref):
    """missing, or ending earlier than the reference series"""
    return not rows or (ref and rows[-1]["date"] < ref[-1]["date"])


wanted = {}
for m in AREAS["metros"]:
    for meas, field in (("04", "unemployed"), ("05", "employed")):
        ser = metros[m["cbsa"]]["series"]
        if stale(ser.get(field), ser.get("unemp_rate")):
            wanted[f"LAU{m['laus_area']}{meas}"] = ("metro", m["cbsa"], field)
for sid, field in (("LNS11000000", "labor_force"), ("LNS12000000", "employed"),
                   ("LNS13000000", "unemployed"), ("CES0000000001", "payrolls_sa")):
    if stale(national.get(field), national.get("unemp_rate")):
        wanted[sid] = ("national", None, field)
print(f"{len(wanted)} series to backfill", file=sys.stderr)

got = fetch(list(wanted))
filled = 0
for sid, (kind, area, field) in wanted.items():
    rows = got.get(sid, [])
    if not rows:
        continue
    filled += 1
    if kind == "metro":
        metros[area]["series"][field] = rows
    else:
        national[field] = rows
(DATA / "metros.json").write_text(json.dumps(metros, separators=(",", ":")))
(DATA / "national.json").write_text(json.dumps(national, separators=(",", ":")))
print(f"filled {filled}/{len(wanted)} series", file=sys.stderr)
