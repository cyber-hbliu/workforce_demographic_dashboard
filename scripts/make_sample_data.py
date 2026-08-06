"""Generate plausible placeholder JSON so the frontend renders before the
first real fetch. meta.json marks it as sample; the Action overwrites all
of it on first run. Not real BLS data."""
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / "docs" / "data"
AREAS = json.loads((ROOT / "config" / "areas.json").read_text())
random.seed(7)

MONTHS = [f"{y}-{m:02d}" for y in range(2016, 2027) for m in range(1, 13)][:127]  # through 2026-07


def unemp_series(base: float) -> list[dict]:
    rows = []
    for i, d in enumerate(MONTHS):
        covid = 8.5 * math.exp(-((i - 51) ** 2) / 30) if 45 < i < 70 else 0  # 2020 spike
        drift = 0.6 * math.sin(i / 22)
        v = max(1.5, base + drift + covid + random.uniform(-0.15, 0.15))
        rows.append({"date": d, "value": round(v, 1)})
    return rows


def lf_series(base: int) -> list[dict]:
    return [{"date": d, "value": round(base * (1 + 0.0009 * i + random.uniform(-0.002, 0.002)))}
            for i, d in enumerate(MONTHS)]


states, metros = {}, {}
for fips, name in AREAS["states"].items():
    base = random.uniform(2.6, 5.2)
    lf = random.randint(300_000, 19_000_000)
    ur = unemp_series(base)
    lfs = lf_series(lf)
    states[fips] = {"name": name, "series": {
        "unemp_rate": ur, "labor_force": lfs,
        "employed": [{"date": r["date"], "value": round(l["value"] * (1 - r["value"] / 100))}
                     for r, l in zip(ur, lfs)],
        "unemployed": [{"date": r["date"], "value": round(l["value"] * r["value"] / 100)}
                       for r, l in zip(ur, lfs)]}}

for m in AREAS["metros"]:
    metros[m["cbsa"]] = {**{k: m[k] for k in ("name", "short", "lon", "lat")},
                         "series": {"unemp_rate": unemp_series(random.uniform(2.8, 5.5)),
                                    "labor_force": lf_series(random.randint(400_000, 9_500_000))}}

# characteristic LQ flavors so the rose reads sensibly in the demo
FLAVOR = {"47900": {"Government": 2.1, "Professional & Business Services": 1.4},
          "41860": {"Information": 2.6, "Professional & Business Services": 1.5},
          "29820": {"Leisure & Hospitality": 2.4},
          "19820": {"Manufacturing": 1.6},
          "26420": {"Construction": 1.3, "Manufacturing": 1.2},
          "35620": {"Financial Activities": 1.5, "Information": 1.3},
          "37980": {"Education & Health Services": 1.5}}

def rose(seed_key: str) -> list[dict]:
    out = []
    for label in AREAS["supersectors"].values():
        lq = FLAVOR.get(seed_key, {}).get(label, random.uniform(0.65, 1.35))
        out.append({"industry": label, "share": round(lq * 0.09, 4), "lq": round(lq, 2)})
    return out

rose_out = {"states": {f: rose(f) for f in AREAS["states"]},
            "metros": {m["cbsa"]: rose(m["cbsa"]) for m in AREAS["metros"]}}

national = {"unemp_rate": unemp_series(3.9),
            "payrolls": [{"date": d, "value": round(151_000 + 90 * i + random.uniform(-150, 150))}
                         for i, d in enumerate(MONTHS)]}

OUT.mkdir(parents=True, exist_ok=True)
for name, obj in (("states.json", states), ("metros.json", metros),
                  ("rose.json", rose_out), ("national.json", national)):
    (OUT / name).write_text(json.dumps(obj, separators=(",", ":")))
(OUT / "meta.json").write_text(json.dumps({
    "updated": "sample", "latest_state_month": MONTHS[-1],
    "latest_metro_month": MONTHS[-2], "source": "sample"}))
print("sample data written")
