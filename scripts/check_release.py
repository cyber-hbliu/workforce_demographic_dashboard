"""Gate for the scheduled workflow.

Exits 0 (proceed) only if today is the day after a BLS state or metro
release date, so the daily cron is a no-op on every other day.
Prints which release triggered the run, consumed by the workflow.
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

CONFIG = Path(__file__).parent.parent / "config" / "release_dates.json"


def main() -> int:
    dates = json.loads(CONFIG.read_text())
    yesterday = (date.today() - timedelta(days=1)).isoformat()

    triggered = [k for k in ("state", "metro") if yesterday in dates[k]]
    if triggered:
        print(f"release={'+'.join(triggered)}")
        return 0
    print("no release yesterday, skipping")
    return 78  # neutral-ish; workflow treats nonzero as skip


if __name__ == "__main__":
    sys.exit(main())
