"""Fetch BLS workforce data and write static JSON for the dashboard.

Sources (BLS API v2, key required via env BLS_API_KEY):
  LAUS  state:  unemployment rate / unemployment / employment / labor force
  LAUS  metro:  unemployment rate / labor force
  CES-SM state & metro: employment by supersector (NSA), for location quotients
  CES   national: supersector employment (NSA) + national unemployment rate

Outputs to docs/data/:
  national.json  states.json  metros.json  rose.json  meta.json

Budget: ~27 API requests per full run (limit is 500/day with a key).
"""
import json
import os
import sys
import time
from datetime import date
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
DATA_OUT = ROOT / "docs" / "data"
API = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
KEY = os.environ.get("BLS_API_KEY")
START_YEAR = str(date.today().year - 10)
END_YEAR = str(date.today().year)

AREAS = json.loads((ROOT / "config" / "areas.json").read_text())
STATES = AREAS["states"]
METROS = AREAS["metros"]
SUPERSECTORS = AREAS["supersectors"]

# ---------------------------------------------------------------- series ids

def laus_state(fips: str, measure: str) -> str:
    # LAU + ST + fips + 13 zeros -> 15-char area code, + 2-char measure
    return f"LAUST{fips}{'0' * 13}{measure}"

def laus_metro(fips: str, cbsa: str, measure: str) -> str:
    return f"LAUMT{fips}{cbsa}{'0' * 8}{measure}"

def sm(fips: str, area: str, industry: str) -> str:
    # SMU = not seasonally adjusted, datatype 01 = all employees (thousands)
    return f"SMU{fips}{area}{industry}01"

def national_supersector(industry: str) -> str:
    # CEU = national CES, not seasonally adjusted
    return f"CEU{industry}01"


def build_catalog() -> dict[str, dict]:
    """series_id -> {kind, area, field}"""
    cat: dict[str, dict] = {}
    for fips in STATES:
        for m, field in (("03", "unemp_rate"), ("04", "unemployed"),
                         ("05", "employed"), ("06", "labor_force")):
            cat[laus_state(fips, m)] = {"kind": "state_laus", "area": fips, "field": field}
        cat[sm(fips, "00000", "00000000")] = {"kind": "state_ces", "area": fips, "field": "total"}
        for ind in SUPERSECTORS:
            cat[sm(fips, "00000", ind)] = {"kind": "state_ces", "area": fips, "field": ind}
    for m in METROS:
        for meas, field in (("03", "unemp_rate"), ("06", "labor_force")):
            cat[laus_metro(m["state_fips"], m["cbsa"], meas)] = {
                "kind": "metro_laus", "area": m["cbsa"], "field": field}
        cat[sm(m["state_fips"], m["cbsa"], "00000000")] = {
            "kind": "metro_ces", "area": m["cbsa"], "field": "total"}
        for ind in SUPERSECTORS:
            cat[sm(m["state_fips"], m["cbsa"], ind)] = {
                "kind": "metro_ces", "area": m["cbsa"], "field": ind}
    cat["LNS14000000"] = {"kind": "national", "area": "US", "field": "unemp_rate"}
    cat[national_supersector("00000000")] = {"kind": "national_ces", "area": "US", "field": "total"}
    for ind in SUPERSECTORS:
        cat[national_supersector(ind)] = {"kind": "national_ces", "area": "US", "field": ind}
    return cat

# ----------------------------------------------------------------- fetching

def fetch(series_ids: list[str]) -> list[dict]:
    out = []
    for i in range(0, len(series_ids), 50):
        chunk = series_ids[i:i + 50]
        payload = {"seriesid": chunk, "startyear": START_YEAR,
                   "endyear": END_YEAR, "registrationkey": KEY}
        for attempt in range(3):
            r = requests.post(API, json=payload, timeout=60)
            body = r.json()
            if r.ok and body.get("status") == "REQUEST_SUCCEEDED":
                out.extend(body["Results"]["series"])
                break
            print(f"retry {attempt + 1}: {body.get('message')}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
        else:
            raise RuntimeError(f"chunk starting {chunk[0]} failed")
        time.sleep(0.5)
    return out


def tidy(series: dict) -> list[dict]:
    """BLS rows -> [{date: 'YYYY-MM', value: float}], oldest first."""
    rows = []
    for d in series.get("data", []):
        if not d["period"].startswith("M") or d["period"] == "M13":
            continue
        try:
            v = float(d["value"])
        except ValueError:
            continue  # '-' = not disclosed
        rows.append({"date": f"{d['year']}-{d['period'][1:]}", "value": v})
    rows.sort(key=lambda r: r["date"])
    return rows

# ------------------------------------------------------------------ shaping

def latest(rows: list[dict]):
    return rows[-1] if rows else None


def location_quotients(area_ces: dict, us_ces: dict) -> list[dict]:
    """LQ per supersector at the latest common month."""
    if "total" not in area_ces or "total" not in us_ces:
        return []
    a_tot, u_tot = latest(area_ces["total"]), latest(us_ces["total"])
    if not a_tot or not u_tot:
        return []
    out = []
    for ind, label in SUPERSECTORS.items():
        a, u = area_ces.get(ind), us_ces.get(ind)
        av, uv = latest(a or []), latest(u or [])
        if not av or not uv or uv["value"] == 0 or u_tot["value"] == 0:
            continue
        share = av["value"] / a_tot["value"]
        us_share = uv["value"] / u_tot["value"]
        out.append({"industry": label, "share": round(share, 4),
                    "lq": round(share / us_share, 3)})
    return out


def main() -> None:
    if not KEY:
        sys.exit("BLS_API_KEY is not set")
    catalog = build_catalog()
    print(f"{len(catalog)} series, ~{-(-len(catalog) // 50)} requests")
    raw = fetch(list(catalog))

    buckets: dict[str, dict[str, dict[str, list]]] = {}
    for s in raw:
        info = catalog.get(s["seriesID"])
        if not info:
            continue
        buckets.setdefault(info["kind"], {}).setdefault(info["area"], {})[info["field"]] = tidy(s)

    us_ces = buckets.get("national_ces", {}).get("US", {})

    states_out = {}
    for fips, name in STATES.items():
        laus = buckets.get("state_laus", {}).get(fips, {})
        states_out[fips] = {"name": name, "series": laus}
    metros_out = {}
    for m in METROS:
        laus = buckets.get("metro_laus", {}).get(m["cbsa"], {})
        metros_out[m["cbsa"]] = {**{k: m[k] for k in ("name", "short", "lon", "lat")},
                                 "series": laus}
    rose_out = {
        "states": {fips: location_quotients(buckets.get("state_ces", {}).get(fips, {}), us_ces)
                   for fips in STATES},
        "metros": {m["cbsa"]: location_quotients(buckets.get("metro_ces", {}).get(m["cbsa"], {}), us_ces)
                   for m in METROS},
    }
    national_out = {
        "unemp_rate": buckets.get("national", {}).get("US", {}).get("unemp_rate", []),
        "payrolls": us_ces.get("total", []),
    }

    DATA_OUT.mkdir(parents=True, exist_ok=True)
    for fname, obj in (("states.json", states_out), ("metros.json", metros_out),
                       ("rose.json", rose_out), ("national.json", national_out)):
        (DATA_OUT / fname).write_text(json.dumps(obj, separators=(",", ":")))

    latest_state = max((r["date"] for s in states_out.values()
                        for r in s["series"].get("unemp_rate", [])), default=None)
    latest_metro = max((r["date"] for s in metros_out.values()
                        for r in s["series"].get("unemp_rate", [])), default=None)
    (DATA_OUT / "meta.json").write_text(json.dumps({
        "updated": date.today().isoformat(),
        "latest_state_month": latest_state,
        "latest_metro_month": latest_metro,
        "source": "bls_api",
    }))
    print(f"done: state data through {latest_state}, metro through {latest_metro}")


if __name__ == "__main__":
    main()
