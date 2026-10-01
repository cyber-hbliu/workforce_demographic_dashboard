"""Gate for the scheduled workflow.

Exits 0 (proceed) when the site has not been refreshed since the most
recent BLS state or metro release. A failed run is therefore retried on
the next scheduled run instead of waiting for the next release.
"""
import json
import sys
from datetime import date
from pathlib import Path

DATA = Path(__file__).parent.parent / "docs" / "data"


def main() -> int:
    dates = json.loads((DATA / "release_dates.json").read_text())
    updated = json.loads((DATA / "meta.json").read_text()).get("updated", "1900-01-01")
    today = date.today().isoformat()

    # releases come out at 10:00 ET, after the 12:00 UTC run, so only count earlier days
    past = [(d, k) for k in ("state", "metro") for d in dates[k] if d < today]
    if not past:
        print("no past release in calendar, skipping")
        return 78
    last_date, last_kind = max(past)

    if updated <= last_date:
        print(f"release={last_kind} {last_date}; last refresh {updated}")
        return 0
    print(f"up to date: last refresh {updated} is after release {last_date}")
    return 78


if __name__ == "__main__":
    sys.exit(main())
