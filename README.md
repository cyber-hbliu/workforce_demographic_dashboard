# USA Workforce Snapshot

An interactive map of the U.S. labor market for people who work on it: workforce development boards, economic development departments, nonprofits, journalists, and researchers. It turns monthly Bureau of Labor Statistics releases into a single page that answers, for any state or metropolitan area, three questions: who is working, what they do, and whether their pay is keeping up with prices. It updates itself the day after each BLS release.

Live site: https://cyber-hbliu.github.io/workforce_demographic_dashboard/

USA Workforce Snapshot is the first program of Urban Spatial Lab. The code and data pipeline are open source under this repository so that any organisation can run its own copy.

## The problem

The Bureau of Labor Statistics publishes the best labor-market data in the country, every month, for free. Almost nobody outside a statistics office reads it. The numbers sit in dozens of tables with names like LAUMT063108000000003, split across four programs (LAUS, CES, CPS and CPI) that use different geographies, different seasonal adjustments and different release dates. A workforce board that wants to know how its metro compares with the state, or whether wages in its region have beaten inflation this year, has to pull five series from two APIs, align the months, compute the comparison, and repeat the exercise next month.

The result is that decisions about training programs, job fairs and grant applications are made from last year's report or from a national headline that may not describe the local economy at all.

## The questions

The dashboard is built around the questions we heard most often from people who use this data without being statisticians.

How is my area doing right now, and is it getting better or worse? Which industries actually employ people here, and what is this place known for compared with the rest of the country? Are wages here keeping pace with prices? Where does my metro stand among its peers and against the nation? And, underneath all of these, what exactly is "my area": a city, a county, or a metropolitan area?

## Assumptions and ideas

We started from four positions.

The map should be the interface. Labor-market data is spatial; the first thing a reader wants to do is find their own place. A full-screen map with a search box beats a table with a dropdown.

One page, three lenses. Employment structure, unemployment and earnings are three views of the same places, so they should be three buttons on one map rather than three separate pages, and clicking a place should open a profile that changes with the lens.

Compare, don't just report. A 4.2% unemployment rate means little on its own. It means something next to the national rate, the state's other metros, and the same month a year earlier. Every figure on the page is shown with at least one comparison.

Be honest about geography. Most published metro statistics describe a metropolitan statistical area (MSA), a group of counties defined by the federal Office of Management and Budget, not a city. "Urban Honolulu, HI" is Honolulu County. The dashboard says this on every profile and lists the counties, because conflating the two is the most common misreading of this data.

## Methods

Data comes directly from the BLS public API, from four programs.

| Program | What it provides | Geography |
|---|---|---|
| Local Area Unemployment Statistics (LAUS) | labor force, employment, unemployment, unemployment rate | states, metros, micropolitan areas |
| Current Employment Statistics (CES) | nonfarm jobs by industry supersector; average hourly earnings | states, metros, nation |
| Current Population Survey (CPS) | national labor force, employment, unemployment | nation |
| Consumer Price Index (CPI-U) | all-items price index | nation and the four census regions |

The dashboard covers 114 metropolitan and micropolitan areas: the 30 largest metros, the metro of every state capital, and a set of other regional centres, plus all 50 states, the District of Columbia and the nation.

Three derived measures do most of the work. An industry's percentage of local nonfarm jobs is compared with the same percentage nationally, and the ratio between the two (the location quotient) shows which industries the area has more or less of than the country. The largest sector is simply the industry with the most jobs. Real earnings growth is the year-on-year change in average hourly earnings for private employers minus the year-on-year change in the CPI for the area's census region; a positive figure means pay rose faster than prices.

Two limits of the source data are carried through rather than hidden. BLS does not seasonally adjust metro unemployment rates, so metro rates are labelled as such and are not directly comparable with state and national rates. BLS publishes hourly earnings by industry for states but only a private-sector total for metros, so the industry earnings chart appears for states and the nation only.

Geography is built from reference files, not typed by hand. A script resolves each metro's code against the BLS area list, reads its member counties from the Census Bureau's delineation file, and merges those counties into the area's real outline on the map. If a code has been retired or mistyped, the script stops rather than sending a bad request.

A scheduled job checks the BLS release calendar every day and, on the day after a state or metro release, pulls about 4,000 series, recomputes every figure and publishes the new files. Nothing has to be done by hand between releases.

## Design

The page is one full-screen map with a small set of floating panels, so the data never scrolls away from the geography it describes.

Top left: the title, the month of the latest data, and two national figures, nonfarm employment and the unemployment rate with its monthly and annual change. Under it, the three lens buttons and a search box that finds any metro, capital or state.

The map: every metro is a marker sized by its nonfarm jobs, drawn over the area's real county footprint. A diamond marks a state capital; a hollow ring marks an area for which BLS publishes unemployment but no industry data. The unemployment and earnings lenses shade states and metros by their value, on a single blue ramp for unemployment and a green-to-pink scale for real earnings growth, with green meaning pay is ahead of prices.

Hover: a card with the area's official name, its unemployment rate, hourly-earnings growth, its largest sector and its specialty.

The profile: clicking a place slides out a panel whose content depends on the lens. The industry lens shows labor force, employment and the unemployment rate with monthly and annual change, then a rose chart in which each of ten industries is a petal sized by its percentage of jobs, coloured green where the area has proportionally fewer of those jobs than the nation and pink where it has more, with a black outline showing the national mix. Two cards below name the largest sector and the specialty, the industry most concentrated relative to the U.S. among those with a meaningful share of local jobs. The unemployment lens shows a ten-year trend against the nation and where the area ranks among its peers. The earnings lens shows hourly earnings, regional price change and real growth, a burst chart of earnings by industry against the U.S. average for each, and an index chart of earnings against prices since 2016. A state profile also lists the metros inside it.

Typography and colour were chosen for reading numbers: a monospaced face so figures align, black text on light panels, and a dark surround so the country reads as the subject. Every colour scale has a legend on screen.

## Results

The result is a page that a program officer can open on the morning after a BLS release and, in under a minute, see the latest month for their metro, how it compares with the state and the nation, which industries carry the local economy, and whether local pay is beating inflation. No spreadsheet, no API key, no waiting for a quarterly report.

Because the pipeline is automatic, the page is never more than one day behind the official release, and every number on it can be traced to a named BLS series. Because the code is open, another lab or agency can change the list of metros, add its own areas, or re-skin the page and run it under its own domain.

## Testing and verification

Series identifiers are validated against the BLS area lists before any request is made, and the fetch refuses to overwrite good data if a run returns empty results for most states. The figures shown on the site were checked against the BLS data tables for several areas (Philadelphia employment, Texas unemployment, Colorado hourly earnings among them) and against the seasonally adjusted national figures in the monthly Employment Situation release. The page was rendered in a headless browser across desktop and mobile sizes at each stage of development, and every chart has a hover readout so a reader can verify any value by pointing at it.

Known limits are stated on the page itself: metro rates are not seasonally adjusted; the six micropolitan capitals have no industry series; metro earnings are published only as a private-sector total; regional CPI is used for metros because BLS publishes metro CPIs for fewer than 25 areas.

## Running your own copy

Fork or clone the repository. Get a free API key at data.bls.gov/registrationEngine and store it as a repository secret named `BLS_API_KEY`. Under Settings, Pages, choose deploy from branch with the `/docs` folder. Open the Actions tab and run the "Update BLS data" workflow once; this replaces the bundled sample data with real figures. After that the workflow runs on its own: every day at 12:00 UTC it checks `docs/data/release_dates.json` and only calls the API on the day after a scheduled release. The release calendar has to be refreshed each December from bls.gov/schedule/news_release/laus.htm and metro.htm.

To change which metros appear, edit `config/metro_selection.json` (CBSA codes, short labels, and the capital city for each state) and rebuild:

    pip install requests openpyxl xlrd
    python scripts/build_areas.py
    node scripts/build_geo.js

A full data run is about 80 requests of 50 series each, against a daily limit of 500.

## Files

    config/metro_selection.json  hand-edited list of metros and capitals
    config/areas.json            generated: states, supersectors, resolved metros
    docs/data/release_dates.json BLS release calendar (also read by the page for the next-release line)
    scripts/build_areas.py       metro_selection.json -> areas.json
    scripts/build_geo.js         county topology -> metro outlines and map anchors
    scripts/check_release.py     exits 0 only on the day after a release
    scripts/fetch_bls.py         API pull, tidying, percentages, location quotients, earnings
    scripts/make_sample_data.py  placeholder data so the page renders before the first fetch
    docs/                        the site (GitHub Pages root)
    docs/lib/                    d3, topojson-client, us-atlas states, metro outlines
    docs/assets/usl-logo.svg     Urban Spatial Lab mark shown in the masthead
