"""Gate for the scheduled workflow.

The workflow is scheduled only on BLS release days (see scripts/make_schedule.py).
This gate exits 0 (proceed) when the site has not been refreshed since the most
recent release that has already come out, so a second run on the same day or a
retry the next day only fetches if the earlier run failed.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).parent.parent / "docs" / "data"
RELEASE_UTC = "15:00:00Z"  # BLS releases at 10:00 ET, which is 14:00 or 15:00 UTC


def main() -> int:
    dates = json.loads((DATA / "release_dates.json").read_text())
    meta = json.loads((DATA / "meta.json").read_text())
    updated_at = meta.get("updated_at") or f"{meta.get('updated', '1900-01-01')}T00:00:00Z"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    past = [(f"{d}T{RELEASE_UTC}", k) for k in ("state", "metro") for d in dates[k]
            if f"{d}T{RELEASE_UTC}" <= now]
    if not past:
        print("no past release in calendar, skipping")
        return 78
    last_release, kind = max(past)

    if updated_at < last_release:
        print(f"release={kind} {last_release}; last refresh {updated_at}")
        return 0
    print(f"up to date: last refresh {updated_at} is after release {last_release}")
    return 78


if __name__ == "__main__":
    sys.exit(main())
