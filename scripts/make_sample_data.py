"""Generate plausible placeholder JSON so the frontend renders before the
first real fetch. meta.json marks it as sample; the Action overwrites all
of it on first run. Not real BLS data.

Usage: python scripts/make_sample_data.py [output_dir]   (default docs/data)
"""
import json
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "data"
AREAS = json.loads((ROOT / "config" / "areas.json").read_text())
SUPERSECTORS = AREAS["supersectors"]
random.seed(7)

MONTHS = [f"{y}-{m:02d}" for y in range(2016, 2027) for m in range(1, 13)][:127]  # through 2026-07

# rough U.S. supersector shares of nonfarm jobs (the LQ reference)
US_SHARE = {"20000000": 0.052, "30000000": 0.081, "40000000": 0.183, "50000000": 0.019,
            "55000000": 0.058, "60000000": 0.145, "65000000": 0.168, "70000000": 0.107,
            "80000000": 0.038, "90000000": 0.149}


def unemp_series(base: float) -> list[dict]:
    rows = []
    for i, d in enumerate(MONTHS):
        covid = 8.5 * math.exp(-((i - 51) ** 2) / 30) if 45 < i < 70 else 0  # 2020 spike
        drift = 0.6 * math.sin(i / 22)
        v = max(1.5, base + drift + covid + random.uniform(-0.15, 0.15))
        rows.append({"date": d, "value": round(v, 1)})
    return rows


def level_series(base: float, digits=0) -> list[dict]:
    return [{"date": d, "value": round(base * (1 + 0.0009 * i + random.uniform(-0.002, 0.002)), digits)}
            for i, d in enumerate(MONTHS)]


# characteristic specialisations so the roses read sensibly in the demo
FLAVOR = {"47900": {"90000000": 2.1, "60000000": 1.4}, "41860": {"50000000": 2.6, "60000000": 1.5},
          "41940": {"50000000": 3.0, "30000000": 1.5}, "29820": {"70000000": 2.4},
          "19820": {"30000000": 1.6}, "26420": {"20000000": 1.3, "30000000": 1.2},
          "35620": {"55000000": 1.5, "50000000": 1.3}, "37980": {"65000000": 1.5},
          "36740": {"70000000": 1.9}, "46520": {"70000000": 1.6, "90000000": 1.5},
          "16940": {"90000000": 1.8}, "45220": {"90000000": 2.0}, "27620": {"90000000": 2.2},
          "12740": {"90000000": 1.6}, "25740": {"90000000": 2.1}, "13900": {"90000000": 1.5},
          "38180": {"90000000": 2.4}, "27940": {"90000000": 2.6}}


def profile(key: str, total_k: float) -> list[dict]:
    lqs = {ind: FLAVOR.get(key, {}).get(ind, random.uniform(0.7, 1.3)) for ind in SUPERSECTORS}
    raw = {ind: lqs[ind] * US_SHARE[ind] for ind in SUPERSECTORS}
    norm = sum(raw.values())
    out = []
    for ind, label in SUPERSECTORS.items():
        share = raw[ind] / norm
        out.append({"code": ind, "industry": label, "jobs": round(total_k * share, 1),
                    "share": round(share, 4), "lq": round(share / US_SHARE[ind], 3)})
    return out


states, metros = {}, {}
rose = {"month": MONTHS[-1], "states": {}, "metros": {}}
for fips, name in AREAS["states"].items():
    lf = random.randint(300_000, 19_000_000)
    ur, lfs = unemp_series(random.uniform(2.6, 5.2)), level_series(lf)
    states[fips] = {"name": name, "series": {
        "unemp_rate": ur, "labor_force": lfs,
        "employed": [{"date": r["date"], "value": round(l["value"] * (1 - r["value"] / 100))}
                     for r, l in zip(ur, lfs)],
        "unemployed": [{"date": r["date"], "value": round(l["value"] * r["value"] / 100)}
                       for r, l in zip(ur, lfs)],
        "payrolls": level_series(lf / 1000 * 0.93, 1)}}
    rose["states"][fips] = profile(fips, lf / 1000 * 0.93)

for m in AREAS["metros"]:
    lf = random.randint(40_000, 9_500_000) if m["kind"] == "metro" else random.randint(15_000, 60_000)
    if m["cbsa"] == "35620":
        lf = 9_900_000
    ur, lfs = unemp_series(random.uniform(2.8, 5.5)), level_series(lf)
    series = {"unemp_rate": ur, "labor_force": lfs,
              "employed": [{"date": r["date"], "value": round(l["value"] * (1 - r["value"] / 100))} for r, l in zip(ur, lfs)],
              "unemployed": [{"date": r["date"], "value": round(l["value"] * r["value"] / 100)} for r, l in zip(ur, lfs)]}
    if m["ces"]:
        series["payrolls"] = level_series(lf / 1000 * 0.95, 1)
        rose["metros"][m["cbsa"]] = profile(m["cbsa"], lf / 1000 * 0.95)
    else:
        series["payrolls"] = []
        rose["metros"][m["cbsa"]] = []
    metros[m["cbsa"]] = {**{k: m[k] for k in ("name", "short", "kind", "states", "capital_of")},
                         "series": series}

us_ur, us_lf = unemp_series(3.9), level_series(160_000, 0)
national = {"unemp_rate": us_ur, "labor_force": us_lf,
            "employed": [{"date": r["date"], "value": round(l["value"] * (1 - r["value"] / 100))} for r, l in zip(us_ur, us_lf)],
            "unemployed": [{"date": r["date"], "value": round(l["value"] * r["value"] / 100)} for r, l in zip(us_ur, us_lf)],
            "payrolls": [{"date": d, "value": round(151_000 + 90 * i + random.uniform(-150, 150))}
                         for i, d in enumerate(MONTHS)],
            "payrolls_sa": [{"date": d, "value": round(151_200 + 90 * i + random.uniform(-40, 40))}
                            for i, d in enumerate(MONTHS)],
            "industries": [{"code": ind, "industry": label, "jobs": round(158_600 * US_SHARE[ind], 1),
                            "share": US_SHARE[ind], "lq": 1.0} for ind, label in SUPERSECTORS.items()]}

# earnings: hourly earnings by industry with a regional CPI to compare against
EARN = {"05000000": "Total private", **{k: v for k, v in SUPERSECTORS.items() if k != "90000000"}}
BASE_AHE = {"05000000": 34.0, "20000000": 37.5, "30000000": 33.0, "40000000": 29.0, "50000000": 52.0,
            "55000000": 45.0, "60000000": 41.0, "65000000": 33.5, "70000000": 22.0, "80000000": 31.0}
REGION = {}
for r, fips_list in (("0100", ["09", "23", "25", "33", "44", "50", "34", "36", "42"]),
                     ("0200", ["17", "18", "26", "39", "55", "19", "20", "27", "29", "31", "38", "46"]),
                     ("0400", ["04", "08", "16", "30", "32", "35", "49", "56", "02", "06", "15", "41", "53"])):
    for f in fips_list:
        REGION[f] = r


def cpi_series(base, drift):
    return [{"date": d, "value": round(base * (1 + drift) ** (i / 12) * (1 + random.uniform(-0.002, 0.002)), 3)}
            for i, d in enumerate(MONTHS)]


def earn_profile(scale, region):
    inds, total = [], None
    for code, label in EARN.items():
        rows = [{"date": d, "value": round(BASE_AHE[code] * scale * (1 + 0.035) ** (i / 12) * (1 + random.uniform(-0.004, 0.004)), 2)}
                for i, d in enumerate(MONTHS)]
        now, prev = rows[-1], rows[-13]
        inds.append({"code": code, "industry": label, "ahe": now["value"], "month": now["date"],
                     "yoy": round((now["value"] - prev["value"]) / prev["value"], 4)})
        if code == "05000000":
            total = rows
    return {"region": region, "total": total, "industries": inds}


earnings = {"cpi": {"US": cpi_series(300, 0.03), "0100": cpi_series(310, 0.028), "0200": cpi_series(290, 0.029),
                    "0300": cpi_series(295, 0.032), "0400": cpi_series(320, 0.034)},
            "national": earn_profile(1.0, "US"),
            "states": {f: earn_profile(random.uniform(0.85, 1.2), REGION.get(f, "0300")) for f in AREAS["states"]},
            "metros": {m["cbsa"]: earn_profile(random.uniform(0.85, 1.3), REGION.get(m["state_fips"], "0300"))
                       for m in AREAS["metros"] if m["ces"]}}

OUT.mkdir(parents=True, exist_ok=True)
for name, obj in (("states.json", states), ("metros.json", metros),
                  ("rose.json", rose), ("national.json", national), ("earnings.json", earnings)):
    (OUT / name).write_text(json.dumps(obj, separators=(",", ":")))
(OUT / "meta.json").write_text(json.dumps({
    "updated": "sample", "latest_state_month": MONTHS[-1], "latest_metro_month": MONTHS[-2],
    "latest_ces_month": MONTHS[-1], "source": "sample"}))
print(f"sample data written to {OUT}")
