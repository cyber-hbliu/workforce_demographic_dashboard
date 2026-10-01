"""County-level unemployment and wages, for the county resolution of the
Unemployment and Earnings lenses.

Sources (no API budget used):
  LAUS  county file  https://www.bls.gov/web/metro/laucntycur14.zip
        (one workbook, every county, the last 14 months, not seasonally adjusted)
  QCEW  quarterly CSV https://data.bls.gov/cew/data/api/<year>/<q>/industry/10.csv
        (all ownerships, all industries: average weekly wage and its year-on-year
        change for every county, metropolitan area, state and the nation)

Output: docs/data/counties.json
  month     latest LAUS month, quarter  latest QCEW quarter ("2026Q1")
  counties  fips -> {n name, st state fips, cbsa or null, r rate, m1 rate a month
            earlier, y1 rate a year earlier, lf labor force, un unemployed,
            uny unemployed a year earlier, w weekly wage, wy wage change y/y (%),
            real wy minus the year-on-year change in the regional CPI averaged over
            the same quarter (points)}
  qcew      weekly wage, y/y and real growth for metros, states and the nation,
            so the Earnings profile can show the same measure at every level
Puerto Rico is excluded. If either download fails the caller keeps the previous file.
"""
import csv
import io
import os
import re
import sys
import zipfile
from datetime import date
from pathlib import Path

import requests

LAUS_URL = "https://www.bls.gov/web/metro/laucntycur14.zip"
QCEW_URL = "https://data.bls.gov/cew/data/api/{year}/{q}/industry/10.csv"
CONTACT = os.environ.get("BLS_CONTACT_EMAIL", "")
UA = {"User-Agent": f"USA Workforce Snapshot build script ({CONTACT or 'https://workforce.usllab.org'})"}
CACHE = Path(os.environ.get("COUNTY_CACHE", "")) if os.environ.get("COUNTY_CACHE") else None
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def _get(url: str, name: str) -> bytes:
    if CACHE and (CACHE / name).exists():
        return (CACHE / name).read_bytes()
    r = requests.get(url, headers=UA, timeout=180)
    r.raise_for_status()
    if CACHE:
        (CACHE / name).write_bytes(r.content)
    return r.content


def _month(label) -> str | None:
    m = re.match(r"([A-Z][a-z]{2})-(\d{2})", str(label or ""))
    return f"20{m.group(2)}-{MONTHS[m.group(1)]:02d}" if m else None


def laus_counties() -> dict[str, dict]:
    """fips -> {name, state, rows: {month: (lf, employed, unemployed, rate)}}"""
    import openpyxl
    z = zipfile.ZipFile(io.BytesIO(_get(LAUS_URL, "laucntycur14.zip")))
    wb = openpyxl.load_workbook(io.BytesIO(z.read(z.namelist()[0])), read_only=True)
    out: dict[str, dict] = {}
    for r in wb.worksheets[0].iter_rows(values_only=True):
        if not r or not str(r[0]).startswith("CN") or str(r[1]) == "72":
            continue
        fips, month = f"{r[1]}{r[2]}", _month(r[4])
        if not month:
            continue
        vals = r[5:9]
        if any(v is None or isinstance(v, str) for v in vals):
            continue  # dash = not available
        c = out.setdefault(fips, {"name": str(r[3]), "state": str(r[1]), "rows": {}})
        c["rows"][month] = tuple(float(v) for v in vals)
    return out


def qcew_latest() -> tuple[str, dict[str, tuple[float, float | None]]]:
    """Newest published quarter: ("2026Q1", {area_fips: (weekly wage, y/y % change)})."""
    today = date.today()
    candidates = []
    y, q = today.year, (today.month - 1) // 3 + 1
    for _ in range(6):
        q -= 1
        if q == 0:
            y, q = y - 1, 4
        candidates.append((y, q))
    for y, q in candidates:
        try:
            raw = _get(QCEW_URL.format(year=y, q=q), f"qcew_{y}_{q}.csv")
        except requests.HTTPError:
            continue
        if b"area_fips" not in raw[:300]:
            continue  # not a data file (an error page, or a quarter not yet published)
        out = {}
        for row in csv.DictReader(io.StringIO(raw.decode("utf-8"))):
            if row["own_code"] != "0" or row["agglvl_code"] not in ("10", "40", "50", "70"):
                continue
            try:
                wage = float(row["avg_wkly_wage"])
                yoy = float(row["oty_avg_wkly_wage_pct_chg"]) if row["oty_avg_wkly_wage_pct_chg"] not in ("", "-") else None
            except ValueError:
                continue
            if wage > 0:
                out[row["area_fips"]] = (wage, yoy)
        if out:
            return f"{y}Q{q}", out
    raise RuntimeError("no QCEW quarter could be downloaded")


def _year_before(month: str) -> str:
    return f"{int(month[:4]) - 1}{month[4:]}"


def _month_before(month: str) -> str:
    y, m = int(month[:4]), int(month[5:])
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"


def cpi_yoy(cpi_rows: list[dict], month: str) -> float | None:
    by = {r["date"]: r["value"] for r in cpi_rows}
    now, prev = by.get(month), by.get(_year_before(month))
    return (now / prev - 1) * 100 if now and prev else None


def cpi_yoy_quarter(cpi_rows: list[dict], quarter: str) -> float | None:
    """Year-on-year change of the quarter's average CPI ("2026Q1": Jan-Mar 2026 against
    Jan-Mar 2025), so prices are measured over the same period as the QCEW quarterly wage."""
    by = {r["date"]: r["value"] for r in cpi_rows}
    y, q = int(quarter[:4]), int(quarter[5])
    months = [f"{y}-{m:02d}" for m in range(3 * q - 2, 3 * q + 1)]
    now = [by.get(m) for m in months]
    prev = [by.get(_year_before(m)) for m in months]
    if not all(now) or not all(prev):
        return None
    return (sum(now) / sum(prev) - 1) * 100


def build(areas: dict, cpi: dict[str, list[dict]], region_of_state: dict[str, str]) -> dict:
    laus = laus_counties()
    quarter, qcew = qcew_latest()
    cbsa_of = {c: m["cbsa"] for m in areas["metros"] for c in m.get("counties", [])}
    latest = max(mo for c in laus.values() for mo in c["rows"])

    def real(area_key: str, state: str):
        w = qcew.get(area_key)
        if not w:
            return None
        inflation = cpi_yoy_quarter(cpi.get(region_of_state.get(state, "US"), cpi.get("US", [])), quarter)
        return {"w": w[0], "wy": w[1], "real": round(w[1] - inflation, 1) if w[1] is not None and inflation is not None else None}

    counties = {}
    for fips, c in laus.items():
        rows = c["rows"]
        now = rows.get(latest)
        if not now:
            continue
        m1, y1 = rows.get(_month_before(latest)), rows.get(_year_before(latest))
        entry = {"n": c["name"], "st": c["state"], "cbsa": cbsa_of.get(fips),
                 "r": now[3], "m1": m1[3] if m1 else None, "y1": y1[3] if y1 else None,
                 "lf": int(now[0]), "un": int(now[2]), "uny": int(y1[2]) if y1 else None}
        entry.update(real(fips, c["state"]) or {})
        counties[fips] = entry

    out_q = {"nation": real("US000", "US"), "states": {}, "metros": {}}
    for fips in areas["states"]:
        out_q["states"][fips] = real(f"{fips}000", fips)
    for m in areas["metros"]:
        out_q["metros"][m["cbsa"]] = real(f"C{m['cbsa'][:4]}", m["state_fips"])
    return {"month": latest, "quarter": quarter, "counties": counties, "qcew": out_q}


if __name__ == "__main__":
    import json
    root = Path(__file__).parent.parent
    areas = json.loads((root / "config" / "areas.json").read_text())
    earn = json.loads((root / "docs" / "data" / "earnings.json").read_text())
    sys.path.insert(0, str(Path(__file__).parent))
    from fetch_bls import REGION_OF_STATE
    data = build(areas, earn["cpi"], REGION_OF_STATE)
    (root / "docs" / "data" / "counties.json").write_text(json.dumps(data, separators=(",", ":")))
    print(f"{len(data['counties'])} counties, LAUS {data['month']}, QCEW {data['quarter']}")
