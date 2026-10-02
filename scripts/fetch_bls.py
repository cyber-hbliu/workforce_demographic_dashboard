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
  County unemployment (LAUS county file) and weekly wages (QCEW) via scripts/county_data.py

Series ids are built from the BLS area codes resolved by scripts/build_areas.py
(config/areas.json: laus_area, state_fips, ces) so nothing is hand-padded.
  state LAUS  = "LAS" + "ST" + fips + 11 zeros + measure   e.g. LASST060000000000003
  metro LAUS  = "LAU" + laus_area (15 chars)   + measure   e.g. LAUMT063108000000003
  CES         = "SMU" + state_fips + area5 + industry8 + "01"  e.g. SMU06310800000000001

Outputs to docs/data/:
  national.json  states.json  metros.json  rose.json  earnings.json  counties.json  meta.json

Budget: about 16 series per metro with CES coverage; all metros fit in about 150 requests (limit 500/day).
"""
import json
import math
import os
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from typology import SECTORS, adjusted_rand, build_typology, nearest_type  # noqa: E402
import county_data  # noqa: E402

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

# BLS publishes construction (20000000) and mining and logging (10000000) separately for
# large areas, and for most metros only their sum, the "mining, logging and construction"
# supersector (15000000). The pipeline uses the combined sector everywhere and builds it
# from the parts where only the parts are published (combine_sector).
COMBINED = "15000000"
PARTS = ("10000000", "20000000")
CES_CODES = list(SUPERSECTORS) + [c for c in PARTS if c not in SUPERSECTORS]

# CES average hourly earnings (data type 03): total private plus the private supersectors;
# earnings are published for construction proper, not for the combined sector
EARN_INDUSTRIES = {"05000000": "Total private", "20000000": "Construction",
                   **{k: v for k, v in SUPERSECTORS.items() if k not in ("90000000", COMBINED)}}
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
        for ind in CES_CODES:
            cat[ces(fips, "00000", ind)] = {"kind": "state_ces", "area": fips, "field": ind}
        for ind in EARN_INDUSTRIES:
            cat[ahe(fips, "00000", ind)] = {"kind": "state_ahe", "area": fips, "field": ind}
    for m in METROS:
        for meas, field in LAUS_MEASURES.items():
            cat[laus_metro(m["laus_area"], meas)] = {"kind": "metro_laus", "area": m["cbsa"], "field": field}
        if m["ces"]:
            cat[ces(m["state_fips"], m["cbsa"], "00000000")] = {
                "kind": "metro_ces", "area": m["cbsa"], "field": "total"}
            for ind in CES_CODES:
                cat[ces(m["state_fips"], m["cbsa"], ind)] = {
                    "kind": "metro_ces", "area": m["cbsa"], "field": ind}
            # BLS publishes metro hourly earnings for total private only
            cat[ahe(m["state_fips"], m["cbsa"], "05000000")] = {"kind": "metro_ahe", "area": m["cbsa"], "field": "05000000"}
    for ind in EARN_INDUSTRIES:
        cat[ahe_national(ind)] = {"kind": "national_ahe", "area": "US", "field": ind}
    for region, sid in CPI_SERIES.items():
        cat[sid] = {"kind": "cpi", "area": region, "field": "cpi"}
    for sid, field in (("LNS14000000", "unemp_rate"), ("LNS11000000", "labor_force"),
                       ("LNS12000000", "employed"), ("LNS13000000", "unemployed")):
        cat[sid] = {"kind": "national", "area": "US", "field": field}  # CPS, SA, levels in thousands
    cat["CES0000000001"] = {"kind": "national", "area": "US", "field": "payrolls_sa"}
    cat[ces_national("00000000")] = {"kind": "national_ces", "area": "US", "field": "total"}
    for ind in CES_CODES:
        cat[ces_national(ind)] = {"kind": "national_ces", "area": "US", "field": ind}
    return cat


def combine_sector(area_ces: dict) -> str:
    """Fill the combined mining, logging and construction series (15000000) from its parts
    where BLS publishes only the parts, then drop the parts. Returns how the series was
    obtained: 'published', 'summed', 'construction only', 'mining only' or 'none'."""
    how = "published" if area_ces.get(COMBINED) else "none"
    if how == "none":
        mining, constr = area_ces.get(PARTS[0]) or [], area_ces.get(PARTS[1]) or []
        if mining and constr:
            by = {r["date"]: r["value"] for r in mining}
            area_ces[COMBINED] = [{"date": r["date"], "value": round(r["value"] + by[r["date"]], 1)}
                                  for r in constr if r["date"] in by]
            how = "summed"
        elif constr or mining:
            area_ces[COMBINED] = constr or mining
            how = "construction only" if constr else "mining only"
    for part in PARTS:
        area_ces.pop(part, None)
    return how

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


def month_shift(month: str, n: int) -> str:
    """'2026-08' shifted by n months (negative = earlier)."""
    y, m = int(month[:4]), int(month[5:]) - 1 + n
    return f"{y + m // 12}-{m % 12 + 1:02d}"


WINDOW = 12      # months averaged for the typology features
MIN_MONTHS = 10  # a sector needs this many of the twelve months to count


def window_profile(area_ces: dict, us_ces: dict, end: str) -> list[dict]:
    """Location quotient per supersector averaged over the twelve months ending at
    `end`, as the geometric mean of the monthly ratios (the arithmetic mean of
    log2 LQ, which is the clustering feature). A sector missing in more than two
    of the twelve months is left out."""
    months = [month_shift(end, -i) for i in range(WINDOW)]
    by = lambda rows: {r["date"]: r["value"] for r in rows or []}  # noqa: E731
    a_tot, u_tot = by(area_ces.get("total")), by(us_ces.get("total"))
    out = []
    for ind in SUPERSECTORS:
        a, u = by(area_ces.get(ind)), by(us_ces.get(ind))
        logs = [math.log2((a[mo] / a_tot[mo]) / (u[mo] / u_tot[mo]))
                for mo in months if a.get(mo) and a_tot.get(mo) and u.get(mo) and u_tot.get(mo)]
        if len(logs) >= MIN_MONTHS:
            out.append({"code": ind, "lq": round(2 ** (sum(logs) / len(logs)), 3)})
    return out


K_TOL = 0.01  # a k whose mean silhouette is within this of the best is a candidate


def choose_k(windows: dict[str, dict], end: str) -> tuple[dict, list[dict], dict]:
    """The number of types by a stated rule. Among k from 2 to 8 whose mean silhouette on
    the current window is within K_TOL of the best, take the k whose grouping is most
    stable: the highest median adjusted Rand index between the current grouping and the
    groupings of the twelve earlier windows clustered with the same k; on a tie, the
    larger k. Returns the chosen typology, its stability history, and the rule's record."""
    current = build_typology(windows[end])
    by_k = current["silhouette_by_k"]
    best = max(by_k.values())
    candidates = sorted(k for k, s in by_k.items() if s >= best - K_TOL)
    past_ends = [e for e in windows if e != end]
    record, fixed, histories = {}, {}, {}
    for k in candidates:
        fixed[k] = current if k == current["k"] else build_typology(windows[end], k_range=[k])
        rows = []
        for e in past_ends:
            past = build_typology(windows[e], k_range=[k])
            rows.append({"end": e, "k": k, "silhouette": past["silhouette"],
                         "ari": adjusted_rand(fixed[k]["assignments"], past["assignments"])})
        aris = sorted(r["ari"] for r in rows if r["ari"] is not None)
        median = aris[len(aris) // 2] if len(aris) % 2 else round((aris[len(aris) // 2 - 1] + aris[len(aris) // 2]) / 2, 3)
        record[k] = {"silhouette": by_k[k], "median_ari": median}
        histories[k] = rows
    chosen = max(candidates, key=lambda k: (record[k]["median_ari"] if record[k]["median_ari"] is not None else -1, k))
    rule = {"tolerance": K_TOL, "candidates": record, "chosen": chosen,
            "rule": "among k with mean silhouette within the tolerance of the best, the highest median "
                    "adjusted Rand index against the twelve earlier windows at the same k; larger k on a tie"}
    return fixed[chosen], histories[chosen], rule


def typology_with_checks(metro_ces: dict, state_ces: dict, us_ces: dict, end: str) -> dict:
    """The typology on twelve-month features, with the checks a reader needs to judge it:
    silhouette by k and the rule that chose k, stability against the groupings of each of
    the previous twelve windows, sensitivity to the treatment of missing sectors, and
    which areas are left out."""
    windows = {month_shift(end, -back): {c: window_profile(ces, us_ces, month_shift(end, -back)) for c, ces in metro_ces.items()}
               for back in range(0, 13)}
    profiles = windows[end]
    typ, history, k_rule = choose_k(windows, end)

    # sensitivity: cluster only areas with all ten sectors, compare on those areas
    complete = {c: p for c, p in profiles.items() if len(p) == len(SECTORS)}
    cc = build_typology(complete)
    shared = {c: typ["assignments"][c] for c in cc["assignments"] if c in typ["assignments"]}

    # coverage: which metros could not be typed and how large they are
    jobs = {c: (ces.get("total") or [{}])[-1].get("value") for c, ces in metro_ces.items()}
    typed = set(typ["assignments"])
    no_ces = [m["cbsa"] for m in METROS if not m["ces"]]
    too_few = [c for c in profiles if c not in typed]
    med = lambda xs: round(sorted(xs)[len(xs) // 2], 1) if xs else None  # noqa: E731  thousands of jobs
    missing = {SUPERSECTORS[s]: sum(1 for c in typed if s not in {r["code"] for r in profiles[c]}) for s in SECTORS}

    states = {f: window_profile(ces, us_ces, end) for f, ces in state_ces.items()}
    return {
        "k": typ["k"], "silhouette": typ["silhouette"], "silhouette_by_k": typ["silhouette_by_k"],
        "features": f"log2 location quotient, ten CES supersectors, mean of the {WINDOW} months ending {end}",
        "window_end": end,
        "types": typ["types"],
        "metros": typ["assignments"],
        "states": {f: t for f, p in states.items() if (t := nearest_type(p, typ)) is not None},
        "profiles": {"metros": {c: {r["code"]: r["lq"] for r in p} for c, p in profiles.items() if p},
                     "states": {f: {r["code"]: r["lq"] for r in p} for f, p in states.items() if p}},
        "diagnostics": {
            "k_rule": k_rule,
            "stability": history,
            "complete_case": {"n": len(complete), "k": cc["k"], "ari_vs_main": adjusted_rand(shared, cc["assignments"])},
            "coverage": {"metros": len(METROS), "typed": len(typed), "no_ces": len(no_ces),
                         "too_few_sectors": len(too_few),
                         "median_jobs_typed": med([jobs[c] for c in typed if jobs.get(c)]),
                         "median_jobs_too_few": med([jobs[c] for c in too_few if jobs.get(c)])},
            "missing_sector_counts": {k: v for k, v in missing.items() if v},
        },
    }


RECENT = 13  # months kept for level series the page only reads the latest and year-ago values of


def trim(series: dict) -> dict:
    """Keep the full unemployment-rate history (ten-year trend); other series keep RECENT months."""
    return {k: (v if k == "unemp_rate" else v[-RECENT:]) for k, v in series.items()}


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

    # the combined mining, logging and construction sector at every level
    sector_source: dict[str, int] = {}
    for kind in ("state_ces", "metro_ces", "national_ces"):
        for area in buckets.get(kind, {}).values():
            how = combine_sector(area)
            if kind == "metro_ces":
                sector_source[how] = sector_source.get(how, 0) + 1
    print("mining, logging and construction for metros: " + ", ".join(f"{k} {v}" for k, v in sorted(sector_source.items())))

    us_ces = buckets.get("national_ces", {}).get("US", {})
    us_profile, us_month = industry_profile(us_ces, us_ces)

    states_out = {}
    for fips, name in STATES.items():
        laus = buckets.get("state_laus", {}).get(fips, {})
        payrolls = buckets.get("state_ces", {}).get(fips, {}).get("total", [])
        states_out[fips] = {"name": name, "series": trim({**laus, "payrolls": payrolls})}

    metros_out = {}
    for m in METROS:
        laus = buckets.get("metro_laus", {}).get(m["cbsa"], {})
        payrolls = buckets.get("metro_ces", {}).get(m["cbsa"], {}).get("total", [])
        metros_out[m["cbsa"]] = {
            **{k: m[k] for k in ("name", "short", "kind", "states", "capital_of")},
            "series": trim({**laus, "payrolls": payrolls}),
        }

    rose_out = {"month": us_month, "states": {}, "metros": {}}
    for fips in STATES:
        prof, _ = industry_profile(buckets.get("state_ces", {}).get(fips, {}), us_ces)
        rose_out["states"][fips] = prof
    for m in METROS:
        prof, _ = industry_profile(buckets.get("metro_ces", {}).get(m["cbsa"], {}), us_ces)
        rose_out["metros"][m["cbsa"]] = prof

    # industry-structure typology on twelve-month features: metros are the pool,
    # states take the nearest type; diagnostics are stored with it
    typ = typology_with_checks(buckets.get("metro_ces", {}), buckets.get("state_ces", {}), us_ces, us_month)
    rose_out["typology"] = typ
    dg = typ["diagnostics"]
    print(f"typology: k={typ['k']} silhouette={typ['silhouette']} " +
          ", ".join(f"{t['name']} ({t['n']})" for t in typ["types"]) +
          f"; ARI vs 12 months earlier {dg['stability'][-1]['ari']}; complete-case ARI {dg['complete_case']['ari_vs_main']}")

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

    # county resolution for the Unemployment and Earnings lenses; a failed download
    # keeps the previous counties.json rather than failing the whole refresh
    county_month = county_quarter = None
    county_status = "refreshed"
    try:
        counties_out = county_data.build(AREAS, earnings_out["cpi"], REGION_OF_STATE)
        county_month, county_quarter = counties_out["month"], counties_out["quarter"]
        (DATA_OUT / "counties.json").write_text(json.dumps(counties_out, separators=(",", ":")))
        print(f"counties: {len(counties_out['counties'])} areas, LAUS {county_month}, QCEW {county_quarter}")
    except Exception as e:  # noqa: BLE001
        county_status = f"kept previous file: {type(e).__name__}: {str(e)[:160]}"
        # a GitHub Actions annotation, so the run page shows the problem
        print(f"::warning title=County data not refreshed::{county_status}")
        try:
            prev = json.loads((DATA_OUT / "counties.json").read_text())
            county_month, county_quarter = prev.get("month"), prev.get("quarter")
        except OSError:
            pass

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
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "latest_state_month": latest_state,
        "latest_metro_month": latest_metro,
        "latest_ces_month": us_month,
        "latest_county_month": county_month,
        "latest_qcew_quarter": county_quarter,
        "county_status": county_status,
        "construction_sector_source": sector_source,
        "source": "bls_api",
        "series_requested": len(catalog),
        "series_empty": sum(empty.values()),
    }))
    print(f"done: state data through {latest_state}, metro through {latest_metro}, CES through {us_month}")


if __name__ == "__main__":
    main()
