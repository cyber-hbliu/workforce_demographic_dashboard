# Workforce Monitor

A full-screen, self-updating atlas of the U.S. labor market built on Bureau of Labor Statistics data. Every state capital and major metropolitan area is drawn on the map as a *burst* of its industries; click one and its profile pops out: unemployment, labor force, nonfarm jobs, an industry rose, and a ten-year trend against the nation. A second lens shades states and metros by unemployment rate.

Hosted entirely on GitHub Pages, refreshed by a scheduled Action the day after each BLS release.

## How to read the map

- **Burst** = one metro or micropolitan area (114 in total: the 30 largest metros, every state capital's metro, and other regional centres). Each of the ten spokes is a CES supersector in a fixed order; spoke length is that industry's percentage of local nonfarm jobs, the dot at the tip is coloured by how that percentage compares with the U.S. mix (blue below, red above), and the burst's overall size is total nonfarm jobs. A diamond core marks a state capital.
- **Footprint** = the area's real boundary, merged from its member counties in the Census delineation file, not an approximate dot.
- **Rose** (in the pop-out) = the same ten industries as petals whose area is proportional to the percentage of jobs, with a thin outline showing what each petal would be if the area matched the national mix. A table view lists jobs, percentage of jobs and the ratio to the U.S. percentage (location quotient).

## Data

| Source | Series | Adjustment |
|---|---|---|
| LAUS, states | unemployment rate, unemployed, employed, labor force | seasonally adjusted |
| LAUS, metros & micros | unemployment rate, labor force | not seasonally adjusted |
| CES, states & metros | total nonfarm + 10 supersectors | not seasonally adjusted |
| CES + CPS, national | supersectors, total nonfarm, unemployment rate | NSA / SA |

Micropolitan capitals (Juneau, Pierre, Frankfort, Concord, Augusta ME, Barre/Montpelier) have no CES industry series, so they show unemployment only.

## Setup

1. Push this repo to GitHub.
2. Get a free BLS API key at data.bls.gov/registrationEngine and add it as a repository secret named `BLS_API_KEY`.
3. Settings > Pages > deploy from branch, folder `/docs`.
4. Run the "Update BLS data" workflow once manually (Actions tab) to replace the bundled sample data with real data.

After that it maintains itself. The daily cron at 12:00 UTC checks `config/release_dates.json` and only fetches on the day after a scheduled state or metro release. A heartbeat commit keeps the schedule from being disabled by GitHub's 60-day inactivity rule.

## Changing the metro list

Edit `config/metro_selection.json` (CBSA codes, short labels, capital cities), then rebuild:

    pip install requests openpyxl xlrd
    python scripts/build_areas.py      # resolves BLS area codes, titles, CES coverage, counties
    node scripts/build_geo.js          # merges counties into footprints -> docs/lib/metros-albers.json

`build_areas.py` downloads the BLS area lists and Census delineation files into `build/` (git-ignored) and refuses to write if a code is not in the BLS list, so a retired or mistyped CBSA is caught before it ever reaches the API. Each metro costs 2 LAUS series plus 11 CES series where covered; the API allows 500 requests of 50 series per day.

## Annual maintenance

Refresh `config/release_dates.json` each December from bls.gov/schedule/news_release/laus.htm and /metro.htm.

## Files

    config/metro_selection.json  the only hand-edited list of metros
    config/areas.json            generated: states, supersectors, resolved metros
    config/release_dates.json    BLS release calendar (the fetch gate)
    scripts/build_areas.py       metro_selection -> areas.json (+ county membership)
    scripts/build_geo.js         county topology -> metro footprints and anchors
    scripts/check_release.py     exits 0 only the day after a release
    scripts/fetch_bls.py         API pull, tidying, shares and location quotients
    scripts/make_sample_data.py  placeholder data so the page renders pre-fetch
    docs/                        the site (GitHub Pages root)
    docs/lib/                    d3, topojson-client, us-atlas states, metro footprints
