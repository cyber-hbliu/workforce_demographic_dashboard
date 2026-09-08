"""Resolve the curated metro selection against authoritative reference files.

Reads  config/metro_selection.json  (hand-curated: which CBSAs, capital cities)
Writes config/areas.json            (states, supersectors, fully resolved metros)
       build/cbsa_counties.json      (intermediate for scripts/build_geo.js)

Sources (downloaded into build/ on first run, then cached):
  BLS  la.area   -> exact LAUS area code + official title for each CBSA
  BLS  sm.area   -> which CBSAs have CES (industry) coverage
  Census list1_2023.xlsx / list1_2020.xls -> county membership per CBSA
  us-atlas counties-albers-10m.json       -> which county ids exist in the map

Nothing about a metro is typed by hand except its CBSA code and a short label,
so series ids, titles, county footprints and state lists cannot drift apart.
Run:  pip install requests openpyxl xlrd && python scripts/build_areas.py && node scripts/build_geo.js
"""
import json
import re
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
BUILD = ROOT / "build"
CONFIG = ROOT / "config"

SOURCES = {
    "la.area": "https://download.bls.gov/pub/time.series/la/la.area",
    "sm.area": "https://download.bls.gov/pub/time.series/sm/sm.area",
    "list1_2023.xlsx": "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx",
    "list1_2020.xls": "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2020/delineation-files/list1_2020.xls",
    "counties-albers-10m.json": "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-albers-10m.json",
}
UA = {"User-Agent": "Mozilla/5.0 (workforce-monitor build script)"}

STATE_ABBR = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08", "CT": "09", "DE": "10",
    "DC": "11", "FL": "12", "GA": "13", "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19",
    "KS": "20", "KY": "21", "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27",
    "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33", "NJ": "34", "NM": "35",
    "NY": "36", "NC": "37", "ND": "38", "OH": "39", "OK": "40", "OR": "41", "PA": "42", "RI": "44",
    "SC": "45", "SD": "46", "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53",
    "WV": "54", "WI": "55", "WY": "56",
}


def fetch_sources() -> None:
    BUILD.mkdir(exist_ok=True)
    for name, url in SOURCES.items():
        p = BUILD / name
        if p.exists() and p.stat().st_size > 0:
            continue
        print(f"downloading {name}")
        r = requests.get(url, headers=UA, timeout=120)
        r.raise_for_status()
        p.write_bytes(r.content)


def read_la_area() -> dict[str, dict]:
    """cbsa -> {laus_area, title, kind} for metropolitan (B) and micropolitan (D) areas."""
    out = {}
    for line in (BUILD / "la.area").read_text(encoding="latin-1").splitlines()[1:]:
        p = line.split("\t")
        if p[0] not in ("B", "D"):
            continue
        code, text = p[1], p[2]
        kind = "metro" if p[0] == "B" else "micro"
        title = re.sub(r" (Metropolitan|Micropolitan) Statistical Area$", "", text)
        out[code[4:9]] = {"laus_area": code, "title": title, "kind": kind}
    return out


def read_sm_area() -> set[str]:
    return {l.split("\t")[0] for l in (BUILD / "sm.area").read_text(encoding="latin-1").splitlines()[1:]}


def read_delineation_2023() -> dict[str, dict]:
    import openpyxl
    wb = openpyxl.load_workbook(BUILD / "list1_2023.xlsx", read_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    return _delineation_rows(rows)


def read_delineation_2020() -> dict[str, dict]:
    import xlrd
    sh = xlrd.open_workbook(BUILD / "list1_2020.xls").sheet_by_index(0)
    rows = [[c.value for c in sh.row(i)] for i in range(sh.nrows)]
    return _delineation_rows(rows)


def _delineation_rows(rows) -> dict[str, dict]:
    hi = next(i for i, r in enumerate(rows) if r and any("CBSA Code" in str(c) for c in r))
    hdr = [str(c) for c in rows[hi]]
    ci = {h: i for i, h in enumerate(hdr)}
    out: dict[str, dict] = {}
    for r in rows[hi + 1:]:
        if not r or r[ci["CBSA Code"]] in (None, ""):
            continue
        cbsa = str(r[ci["CBSA Code"]]).split(".")[0]
        sf = str(r[ci["FIPS State Code"]]).split(".")[0].zfill(2)
        cf = str(r[ci["FIPS County Code"]]).split(".")[0].zfill(3)
        o = out.setdefault(cbsa, {"counties": [], "central": []})
        o["counties"].append(sf + cf)
        if str(r[ci["Central/Outlying County"]]).startswith("Central"):
            o["central"].append(sf + cf)
    return out


def short_name(title: str) -> str:
    city = re.split(r"[-,/]", title)[0].strip()
    return city.removeprefix("Urban ")


def main() -> None:
    fetch_sources()
    sel = json.loads((CONFIG / "metro_selection.json").read_text())
    areas = json.loads((CONFIG / "areas.json").read_text())
    la, sm = read_la_area(), read_sm_area()
    d23, d20 = read_delineation_2023(), read_delineation_2020()
    topo_ids = {g["id"] for g in json.loads((BUILD / "counties-albers-10m.json").read_text())
                ["objects"]["counties"]["geometries"]}

    capital_of: dict[str, list[dict]] = {}
    for fips, c in sel["capitals"].items():
        capital_of.setdefault(c["cbsa"], []).append({"state": fips, "city": c["city"]})

    metros, county_out, problems = [], {}, []
    for m in sel["metros"]:
        cbsa = m["cbsa"]
        ref = la.get(cbsa)
        if not ref:
            problems.append(f"{cbsa}: not in BLS la.area (code retired or mistyped)")
            continue
        # county footprint: prefer 2023 vintage, fall back to 2020 where the 2023
        # county equivalents are not in the map (Connecticut planning regions)
        d = d23.get(cbsa) or d20.get(cbsa) or {"counties": [], "central": []}
        if not d["counties"] or any(c not in topo_ids for c in d["counties"]):
            d = d20.get(cbsa, d)
        missing = [c for c in d["counties"] if c not in topo_ids]
        if missing:
            problems.append(f"{cbsa} {ref['title']}: counties missing from map {missing}")
        states = [STATE_ABBR[a] for a in ref["title"].rsplit(", ", 1)[-1].split("-") if a in STATE_ABBR]
        entry = {
            "cbsa": cbsa,
            "name": ref["title"],
            "short": m.get("short") or short_name(ref["title"]),
            "kind": ref["kind"],
            "laus_area": ref["laus_area"],
            "state_fips": ref["laus_area"][2:4],
            "states": states,
            "ces": cbsa in sm,
            "capital_of": capital_of.get(cbsa, []),
        }
        if "lon" in m and "lat" in m:
            entry["lon"], entry["lat"] = m["lon"], m["lat"]
        metros.append(entry)
        county_out[cbsa] = {"counties": [c for c in d["counties"] if c in topo_ids],
                            "central": [c for c in d["central"] if c in topo_ids]}

    if problems:
        print("\n".join(problems), file=sys.stderr)
        sys.exit("fix config/metro_selection.json")

    areas["metros"] = metros
    areas["_note"] = ("Generated by scripts/build_areas.py from config/metro_selection.json plus BLS la.area / sm.area "
                      "and Census CBSA delineations. Edit metro_selection.json, not this file.")
    (CONFIG / "areas.json").write_text(json.dumps(areas, indent=1, ensure_ascii=False) + "\n")
    (BUILD / "cbsa_counties.json").write_text(json.dumps(county_out))
    n_ces = sum(m["ces"] for m in metros)
    print(f"{len(metros)} metros ({n_ces} with CES industry data, "
          f"{sum(m['kind'] == 'micro' for m in metros)} micropolitan), "
          f"{sum(len(v['counties']) for v in county_out.values())} counties")


if __name__ == "__main__":
    main()
