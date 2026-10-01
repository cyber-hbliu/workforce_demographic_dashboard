"""Write the workflow schedule from the BLS release calendar.

GitHub Actions cannot read a calendar, so the cron lines in
.github/workflows/update-data.yml are generated from docs/data/release_dates.json.
Each release day gets two runs (16:00 and 20:00 UTC, after the 10:00 ET release)
and the following day one retry. scripts/check_release.py skips any run that
finds the data already refreshed.

Run after updating release_dates.json each December:
    python scripts/make_schedule.py
"""
import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parent.parent
CAL = ROOT / "docs" / "data" / "release_dates.json"
WF = ROOT / ".github" / "workflows" / "update-data.yml"
START, END = "    # --- release schedule (generated) ---", "    # --- end release schedule ---"


def main() -> None:
    cal = json.loads(CAL.read_text())
    release_days = sorted({date.fromisoformat(d) for k in ("state", "metro") for d in cal[k]})
    same_day, next_day = defaultdict(set), defaultdict(set)
    for d in release_days:
        same_day[d.month].add(d.day)
        n = d + timedelta(days=1)
        next_day[n.month].add(n.day)

    lines = []
    for month in sorted(same_day):
        days = ",".join(str(x) for x in sorted(same_day[month]))
        lines.append(f'    - cron: "0 16,20 {days} {month} *"')
    for month in sorted(next_day):
        days = ",".join(str(x) for x in sorted(next_day[month]))
        lines.append(f'    - cron: "0 16 {days} {month} *"')

    wf = WF.read_text()
    head, rest = wf.split(START + "\n", 1)
    _, tail = rest.split(END, 1)
    WF.write_text(head + START + "\n" + "\n".join(lines) + "\n" + END + tail)
    print(f"{len(release_days)} release days -> {len(lines)} cron lines")


if __name__ == "__main__":
    main()
