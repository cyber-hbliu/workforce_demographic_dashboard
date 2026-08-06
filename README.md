# The Workforce Monitor

A self-updating dashboard of BLS workforce data. State and metro unemployment (LAUS), industry structure as location quotients (CES), rendered with D3 in a print-magazine layout. Hosted entirely on GitHub Pages, refreshed by a scheduled Action the day after each BLS release.

## Setup

1. Push this repo to GitHub.
2. Get a free BLS API key at data.bls.gov/registrationEngine and add it as a repository secret named `BLS_API_KEY`.
3. Settings > Pages > deploy from branch, folder `/docs`.
4. Run the "Update BLS data" workflow once manually (Actions tab) to replace the bundled sample data with real data.

After that it maintains itself. The daily cron at 12:00 UTC checks `config/release_dates.json` and only fetches on the day after a scheduled state or metro release. A heartbeat commit keeps the schedule from being disabled by GitHub's 60-day inactivity rule.

## Annual maintenance

Refresh `config/release_dates.json` each December from bls.gov/schedule/news_release/laus.htm and /metro.htm.

## Extending coverage

Add metros to `config/areas.json` with their CBSA code, primary state FIPS, and an approximate centroid. Each metro costs about 13 series (2 LAUS + 11 CES), and the API allows 500 requests of 50 series per day, so full MSA coverage is possible if wanted.

## Files

    config/release_dates.json   2026 BLS release calendar (the fetch gate)
    config/areas.json           states, metros, supersector codes
    scripts/check_release.py    exits 0 only the day after a release
    scripts/fetch_bls.py        API pull, tidying, location quotients
    scripts/make_sample_data.py placeholder data so the page renders pre-fetch
    docs/                       the site (GitHub Pages root)
