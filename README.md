# Workforce Monitor

A map of the U.S. labor market that updates itself from Bureau of Labor Statistics data. It runs as a static site on GitHub Pages. A scheduled GitHub Action fetches new figures the day after each BLS release and commits them to the repository.

The map shows 114 metropolitan and micropolitan statistical areas: the 30 largest metros, the metro of every state capital, and a set of other regional centres. Each one is drawn as a burst of ten spokes, one per industry supersector. Clicking a burst, or a state, opens a profile with the area's labor force, employment, unemployment rate, industry mix and its most concentrated industry. A second view shades states and metros by unemployment rate.

## Reading the map

Every burst is one statistical area, and every figure in a profile covers that whole area. An MSA is a group of counties defined by the Office of Management and Budget, so the numbers for "Urban Honolulu, HI" describe Honolulu County, not the city of Honolulu. The profile lists the counties involved.

The ten spokes always appear in the same order, starting with construction at the top and running clockwise to government. The length of a spoke is the industry's percentage of the area's nonfarm jobs. The dot at the end is coloured by how that percentage compares with the national percentage: green where the area has proportionally fewer jobs than the U.S. in that industry, pink where it has more, grey where they match. The size of the whole burst follows total nonfarm jobs. A diamond at the centre means the area contains a state capital. A hollow ring instead of a burst means BLS publishes unemployment figures for the area but no industry series; this applies to the six micropolitan capitals (Juneau, Pierre, Frankfort, Concord, Augusta in Maine, and Barre, which contains Montpelier).

The grey shape under each burst is the area's actual boundary, built by merging its member counties from the Census Bureau's delineation file.

In the profile, the rose chart shows the same ten industries as petals. Petal area is proportional to the industry's percentage of jobs, the petal colour uses the same green-to-pink scale, and a black outline on each petal shows where it would sit if the area matched the national mix. Below the rose, a card names the industry with the highest ratio to the national percentage (the location quotient) and the area's largest employer. A table view gives the jobs, percentage and ratio for every industry.

## Data

| Source | Geography | Series | Adjustment |
|---|---|---|---|
| LAUS | states | unemployment rate, unemployed, employed, labor force | seasonally adjusted |
| LAUS | metros and micros | unemployment rate, unemployed, employed, labor force | not seasonally adjusted |
| CES | states and metros | total nonfarm and ten supersectors | not seasonally adjusted |
| CPS and CES | nation | unemployment rate, labor force, employment, unemployment, total nonfarm, ten supersectors | seasonally adjusted, except the supersectors |

BLS does not publish seasonally adjusted unemployment rates for metropolitan areas, so metro rates are not directly comparable with state and national rates. Industry percentages for all geographies use the not seasonally adjusted CES series so that local and national figures are computed the same way.

## Setup

Push the repository to GitHub. Get a free API key at data.bls.gov/registrationEngine and store it as a repository secret named `BLS_API_KEY`. Under Settings, Pages, choose deploy from branch with the `/docs` folder. Then open the Actions tab and run the "Update BLS data" workflow once by hand; this replaces the bundled sample data with real figures.

After that the workflow runs on its own. It starts every day at 12:00 UTC, checks `docs/data/release_dates.json`, and only calls the API on the day after a scheduled state or metro release. On other days it commits a small heartbeat file, which stops GitHub from disabling the schedule after 60 days without activity. The release calendar has to be refreshed each December from bls.gov/schedule/news_release/laus.htm and metro.htm.

## Changing the metro list

The only hand-edited list of metros is `config/metro_selection.json`, which holds CBSA codes, short labels for the map, and the capital city for each state. Everything else about a metro is derived from reference files. To rebuild after editing it:

    pip install requests openpyxl xlrd
    python scripts/build_areas.py
    node scripts/build_geo.js

The first script downloads the BLS area lists and the Census delineation files into `build/` (which git ignores), looks up each CBSA code, and writes `config/areas.json` with the exact LAUS area code, official title, member counties, and whether CES industry data exists for it. It stops with an error if a code is not in the BLS list, which catches retired or mistyped codes before they reach the API. The second script merges each area's counties into one outline on the same Albers projection as the state map and writes `docs/lib/metros-albers.json`.

Each metro costs four LAUS series plus eleven CES series where they exist. A full run is about 50 requests of 50 series each, against a daily limit of 500 requests.

## Files

    config/metro_selection.json  hand-edited list of metros and capitals
    config/areas.json            generated: states, supersectors, resolved metros
    docs/data/release_dates.json BLS release calendar (also read by the page for the next-release line)
    scripts/build_areas.py       metro_selection.json -> areas.json
    scripts/build_geo.js         county topology -> metro outlines and map anchors
    scripts/check_release.py     exits 0 only on the day after a release
    scripts/fetch_bls.py         API pull, tidying, percentages and location quotients
    scripts/make_sample_data.py  placeholder data so the page renders before the first fetch
    docs/                        the site (GitHub Pages root)
    docs/lib/                    d3, topojson-client, us-atlas states, metro outlines
