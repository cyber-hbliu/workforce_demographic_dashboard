"""Fetch BLS workforce data and write static JSON for the dashboard.

Sources (BLS API v2, key required via env BLS_API_KEY):
  LAUS  state (seasonally adjusted, LAS): unemployment rate / unemployed / employed / labor force
  LAUS  metro & micro (not seasonally adjusted, LAU): unemployment rate / unemployed / employed / labor force
  CES-SM state & metro (NSA): total nonfarm + employment by supersector, for shares
        and location quotients
  CES   national (NSA): total nonfarm + supersector employment
  CPS   national unemployment rate and labor force / employment / unemployment levels (SA)
  CES   national total nonfarm, seasonally adjusted headline (CES0000000001)
  CES   average hourly earnings (data type 03) for total private and the private
        supersectors, state / metro / national
  CPI-U all items (NSA) for the nation and the four census regions

Series ids are built from the BLS area codes resolved by scripts/build_areas.py
(config/areas.json: laus_area, state_fips, ces) so nothing is hand-padded.
  state LAUS  = "LAS" + "ST" + fips + 11 zeros + measure   e.g. LASST060000000000003
  metro LAUS  = "LAU" + laus_area (15 chars)   + measure   e.g. LAUMT063108000000003
  CES         = "SMU" + state_fips + area5 + industry8 + "01"  e.g. SMU06310800000000001

Outputs to docs/data/:
  national.json  states.json  metros.json  rose.json  earnings.json  meta.json

Budget: ~85 API requests per full run (limit is 500/day with a key).
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

LAUS_MEASURES = {"03": "unemp_rate", "04": "unemployed", "05": "employed", "06": "labor_force"}

# CES average hourly earnings (data type 03): total private plus the private supersectors
EARN_INDUSTRIES = {"05000000": "Total private", **{k: v for k, v in SUPERSECTORS.items() if k != "90000000"}}
# CPI-U all items, not seasonally adjusted, for the nation and the four census regions
CPI_SERIES = {"US": "CUUR0000SA0", "0100": "CUUR0100SA0", "0200": "CUUR0200SA0", "0300": "CUUR0300SA0", "0400": "CUUR0400SA0"}
REGION_OF_STATE = {
    **dict.fromkeys(["09", "23", "25", "33", "44", "50", "34", "36", "42"], "0100"),
    **dict.fromkeys(["17", "18", "26", "39", "55", "19", "20", "27", "29", "31", "38", "46"], "0200"),
    **dict.fromkeys(["10", "11", "12", "13", "24", "37", "45", "51", "54", "01", "21", "28", "47", "05", "22", "40", "48"], "0300"),
    **dict.fromkeys(["04", "08", "16", "30", "32", "35", "49", "56", "02", "06", "15", "41", "53"], "0400"),
}

# ---------------------------------------------------------------- series ids

def laus_state(fips: str, measure: str) -> str:
    return f"LASST{fips}{'0' * 11}{measure}"

def laus_metro(laus_area: str, measure: str) -> str:
    return f"LAU{laus_area}{measure}"

def ces(state_fips: str, area5: str, industry: str) -> str:
    return f"SMU{state_fips}{area5}{industry}01"

def ces_national(industry: str) -> str:
    return f"CEU{industry}01"

def ahe(state_fips: str, area5: str, industry: str) -> str:
    return f"SMU{state_fips}{area5}{industry}03"

def ahe_national(industry: str) -> str:
    return f"CEU{industry}03"


def build_catalog() -> dict[str, dict]:
    """series_id -> {kind, area, field}"""
    cat: dict[str, dict] = {}
    for fips in STATES:
        for m, field in LAUS_MEASURES.items():
            cat[laus_state(fips, m)] = {"kind": "state_laus", "area": fips, "field": field}
        cat[ces(fips, "00000", "00000000")] = {"kind": "state_ces", "area": fips, "field": "total"}
        for ind in SUPERSECTORS:
            cat[ces(fips, "00000", ind)] = {"kind": "state_ces", "area": fips, "field": ind}
        for ind in EARN_INDUSTRIES:
            cat[ahe(fips, "00000", ind)] = {"kind": "state_ahe", "area": fips, "field": ind}
    for m in METROS:
        for meas, field in LAUS_MEASURES.items():
            cat[laus_metro(m["laus_area"], meas)] = {"kind": "metro_laus", "area": m["cbsa"], "field": field}
        if m["ces"]:
            cat[ces(m["state_fips"], m["cbsa"], "00000000")] = {
                "kind": "metro_ces", "area": m["cbsa"], "field": "total"}
            for ind in SUPERSECTORS:
                cat[ces(m["state_fips"], m["cbsa"], ind)] = {
                    "kind": "metro_ces", "area": m["cbsa"], "field": ind}
            for ind in EARN_INDUSTRIES:
                cat[ahe(m["state_fips"], m["cbsa"], ind)] = {"kind": "metro_ahe", "area": m["cbsa"], "field": ind}
    for ind in EARN_INDUSTRIES:
        cat[ahe_national(ind)] = {"kind": "national_ahe", "area": "US", "field": ind}
    for region, sid in CPI_SERIES.items():
        cat[sid] = {"kind": "cpi", "area": region, "field": "cpi"}
    for sid, field in (("LNS14000000", "unemp_rate"), ("LNS11000000", "labor_force"),
                       ("LNS12000000", "employed"), ("LNS13000000", "unemployed")):
        cat[sid] = {"kind": "national", "area": "US", "field": field}  # CPS, SA, levels in thousands
    cat["CES0000000001"] = {"kind": "national", "area": "US", "field": "payrolls_sa"}
    cat[ces_national("00000000")] = {"kind": "national_ces", "area": "US", "field": "total"}
    for ind in SUPERSECTORS:
        cat[ces_national(ind)] = {"kind": "national_ces", "area": "US", "field": ind}
    return cat

# ----------------------------------------------------------------- fetching

def fetch(series_ids: list[str]) -> list[dict]:
    out = []
    for i in range(0, len(series_ids), 50):
        chunk = series_ids[i:i + 50]
        payload = {"seriesid": chunk, "startyear": START_YEAR,
                   "endyear": END_YEAR, "registrationkey": KEY}
        for attempt in range(3):
            r = requests.post(API, json=payload, timeout=90)
            body = r.json()
            if r.ok and body.get("status") == "REQUEST_SUCCEEDED":
                for msg in body.get("message", []):
                    print(f"  note: {msg}", file=sys.stderr)
                out.extend(body["Results"]["series"])
                break
            print(f"retry {attempt + 1}: {body.get('message')}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
        else:
            raise RuntimeError(f"chunk starting {chunk[0]} failed")
        print(f"  {min(i + 50, len(series_ids))}/{len(series_ids)} series")
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

def latest(rows):
    return rows[-1] if rows else None


def at(rows, month):
    for r in reversed(rows or []):
        if r["date"] == month:
            return r
    return None


def industry_profile(area_ces: dict, us_ces: dict) -> tuple[list[dict], str | None]:
    """Per-supersector jobs (thousands), share of local nonfarm jobs and location
    quotient vs the U.S., all at the latest month the area's total is published."""
    a_tot = latest(area_ces.get("total", []))
    if not a_tot:
        return [], None
    month = a_tot["date"]
    u_tot = at(us_ces.get("total"), month) or latest(us_ces.get("total", []))
    out = []
    for ind, label in SUPERSECTORS.items():
        av = at(area_ces.get(ind), month)
        uv = at(us_ces.get(ind), month) if u_tot else None
        if not av:
            continue
        share = av["value"] / a_tot["value"]
        row = {"code": ind, "industry": label, "jobs": av["value"], "share": round(share, 4)}
        if uv and u_tot and uv["value"]:
            row["lq"] = round(share / (uv["value"] / u_tot["value"]), 3)
        out.append(row)
    return out, month


def earnings_profile(area_ahe: dict, region: str) -> dict:
    """Total-private hourly earnings series plus the latest level and year-on-year
    change for each industry that has a series."""
    total = area_ahe.get("05000000", [])
    inds = []
    for ind, label in EARN_INDUSTRIES.items():
        rows = area_ahe.get(ind, [])
        now = latest(rows)
        if not now:
            continue
        prev = at(rows, f"{int(now['date'][:4]) - 1}{now['date'][4:]}")
        inds.append({"code": ind, "industry": label, "ahe": now["value"], "month": now["date"],
                     "yoy": round((now["value"] - prev["value"]) / prev["value"], 4) if prev and prev["value"] else None})
    return {"region": region, "total": total, "industries": inds}


def main() -> None:
    if not KEY:
        sys.exit("BLS_API_KEY is not set")
    catalog = build_catalog()
    print(f"{len(catalog)} series, ~{-(-len(catalog) // 50)} requests")
    raw = fetch(list(catalog))

    buckets: dict[str, dict[str, dict[str, list]]] = {}
    empty: dict[str, int] = {}
    for s in raw:
        info = catalog.get(s["seriesID"])
        if not info:
            continue
        rows = tidy(s)
        if not rows:
            empty[info["kind"]] = empty.get(info["kind"], 0) + 1
        buckets.setdefault(info["kind"], {}).setdefault(info["area"], {})[info["field"]] = rows
    for kind, n in sorted(empty.items()):
        print(f"  {n} empty series in {kind}", file=sys.stderr)

    # refuse to overwrite good data with a broken pull
    state_rates = sum(bool(buckets.get("state_laus", {}).get(f, {}).get("unemp_rate")) for f in STATES)
    if state_rates < len(STATES) - 2:
        sys.exit(f"only {state_rates}/{len(STATES)} states returned unemployment data; not writing")

    us_ces = buckets.get("national_ces", {}).get("US", {})
    us_profile, us_month = industry_profile(us_ces, us_ces)

    states_out = {}
    for fips, name in STATES.items():
        laus = buckets.get("state_laus", {}).get(fips, {})
        payrolls = buckets.get("state_ces", {}).get(fips, {}).get("total", [])
        states_out[fips] = {"name": name, "series": {**laus, "payrolls": payrolls}}

    metros_out = {}
    for m in METROS:
        laus = buckets.get("metro_laus", {}).get(m["cbsa"], {})
        payrolls = buckets.get("metro_ces", {}).get(m["cbsa"], {}).get("total", [])
        metros_out[m["cbsa"]] = {
            **{k: m[k] for k in ("name", "short", "kind", "states", "capital_of")},
            "series": {**laus, "payrolls": payrolls},
        }

    rose_out = {"month": us_month, "states": {}, "metros": {}}
    for fips in STATES:
        prof, _ = industry_profile(buckets.get("state_ces", {}).get(fips, {}), us_ces)
        rose_out["states"][fips] = prof
    for m in METROS:
        prof, _ = industry_profile(buckets.get("metro_ces", {}).get(m["cbsa"], {}), us_ces)
        rose_out["metros"][m["cbsa"]] = prof

    nat = buckets.get("national", {}).get("US", {})
    national_out = {
        "unemp_rate": nat.get("unemp_rate", []),
        "labor_force": nat.get("labor_force", []),   # thousands of persons (CPS)
        "employed": nat.get("employed", []),
        "unemployed": nat.get("unemployed", []),
        "payrolls": us_ces.get("total", []),          # thousands of jobs (CES, NSA)
        "payrolls_sa": nat.get("payrolls_sa", []),    # thousands of jobs (CES, SA headline)
        "industries": us_profile,
    }

    earnings_out = {
        "cpi": {region: buckets.get("cpi", {}).get(region, {}).get("cpi", []) for region in CPI_SERIES},
        "national": earnings_profile(buckets.get("national_ahe", {}).get("US", {}), "US"),
        "states": {fips: earnings_profile(buckets.get("state_ahe", {}).get(fips, {}), REGION_OF_STATE.get(fips, "US"))
                   for fips in STATES},
        "metros": {m["cbsa"]: earnings_profile(buckets.get("metro_ahe", {}).get(m["cbsa"], {}),
                                               REGION_OF_STATE.get(m["state_fips"], "US"))
                   for m in METROS if m["ces"]},
    }

    DATA_OUT.mkdir(parents=True, exist_ok=True)
    for fname, obj in (("states.json", states_out), ("metros.json", metros_out),
                       ("rose.json", rose_out), ("national.json", national_out),
                       ("earnings.json", earnings_out)):
        (DATA_OUT / fname).write_text(json.dumps(obj, separators=(",", ":")))

    latest_state = max((r["date"] for s in states_out.values()
                        for r in s["series"].get("unemp_rate", [])), default=None)
    latest_metro = max((r["date"] for s in metros_out.values()
                        for r in s["series"].get("unemp_rate", [])), default=None)
    (DATA_OUT / "meta.json").write_text(json.dumps({
        "updated": date.today().isoformat(),
        "latest_state_month": latest_state,
        "latest_metro_month": latest_metro,
        "latest_ces_month": us_month,
        "source": "bls_api",
        "series_requested": len(catalog),
        "series_empty": sum(empty.values()),
    }))
    print(f"done: state data through {latest_state}, metro through {latest_metro}, CES through {us_month}")


if __name__ == "__main__":
    main()
