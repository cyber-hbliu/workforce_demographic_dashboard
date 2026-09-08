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
    series = {"unemp_rate": unemp_series(random.uniform(2.8, 5.5)), "labor_force": level_series(lf)}
    if m["ces"]:
        series["payrolls"] = level_series(lf / 1000 * 0.95, 1)
        rose["metros"][m["cbsa"]] = profile(m["cbsa"], lf / 1000 * 0.95)
    else:
        series["payrolls"] = []
        rose["metros"][m["cbsa"]] = []
    metros[m["cbsa"]] = {**{k: m[k] for k in ("name", "short", "kind", "states", "capital_of")},
                         "series": series}

national = {"unemp_rate": unemp_series(3.9),
            "payrolls": [{"date": d, "value": round(151_000 + 90 * i + random.uniform(-150, 150))}
                         for i, d in enumerate(MONTHS)],
            "industries": [{"code": ind, "industry": label, "jobs": round(158_600 * US_SHARE[ind], 1),
                            "share": US_SHARE[ind], "lq": 1.0} for ind, label in SUPERSECTORS.items()]}

OUT.mkdir(parents=True, exist_ok=True)
for name, obj in (("states.json", states), ("metros.json", metros),
                  ("rose.json", rose), ("national.json", national)):
    (OUT / name).write_text(json.dumps(obj, separators=(",", ":")))
(OUT / "meta.json").write_text(json.dumps({
    "updated": "sample", "latest_state_month": MONTHS[-1], "latest_metro_month": MONTHS[-2],
    "latest_ces_month": MONTHS[-1], "source": "sample"}))
print(f"sample data written to {OUT}")
