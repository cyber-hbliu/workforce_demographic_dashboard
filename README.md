# USA Workforce Snapshot

An interactive map of the U.S. labor market for people who work on it: workforce development boards, economic development departments, nonprofits, journalists, and researchers. It turns monthly Bureau of Labor Statistics releases into a single page that answers, for any state or metropolitan area, three questions: who is working, what they do, and whether their pay is keeping up with prices. It updates itself on each BLS release day.

Live site: https://workforce.usllab.org

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

One page, four lenses. Employment structure, unemployment, earnings and industry type are four views of the same places, so they should be four buttons on one map rather than separate pages, and clicking a place should open a profile that changes with the lens.

Compare, don't just report. A 4.2% unemployment rate means little on its own. It means something next to the national rate, the state's other metros, and the same month a year earlier. Every figure on the page is shown with at least one comparison.

Be honest about geography. Most published metro statistics describe a metropolitan statistical area (MSA), a group of counties defined by the federal Office of Management and Budget, not a city. "Urban Honolulu, HI" is Honolulu County. The dashboard says this on every profile and lists the counties, because conflating the two is the most common misreading of this data.

## Methods

Data comes directly from the BLS public API, from four programs.

| Program | What it provides | Geography |
|---|---|---|
| Local Area Unemployment Statistics (LAUS) | labor force, employment, unemployment, unemployment rate | states, metros, micropolitan areas; counties from the program's monthly county table |
| Current Employment Statistics (CES) | nonfarm jobs by industry supersector; average hourly earnings | states, metros, nation |
| Current Population Survey (CPS) | national labor force, employment, unemployment | nation |
| Quarterly Census of Employment and Wages (QCEW) | average weekly wage of all employers and its year-on-year change | nation, states, metros, counties |
| Consumer Price Index (CPI-U) | all-items price index | nation and the four census regions |

The dashboard covers every metropolitan statistical area for which BLS publishes local unemployment data (Puerto Rico excluded), plus the micropolitan areas that contain a state capital, all 50 states, the District of Columbia and the nation. A curated list in `config/metro_selection.json` sets short labels and map anchors for the largest metros, and `include_all_metros` adds the rest.

Four derived measures do most of the work. An industry's percentage of local nonfarm jobs is compared with the same percentage nationally, and the ratio between the two (the location quotient) shows which industries the area has more or less of than the country. The largest sector is simply the industry with the most jobs. Real earnings growth is the year-on-year change in average hourly earnings for private employers minus the year-on-year change in the CPI for the area's census region; a positive figure means pay rose faster than prices. On the county map the same idea uses the QCEW average weekly wage, which BLS publishes for every county: the wage's year-on-year change for the latest quarter minus the year-on-year change in the regional CPI averaged over the same three months. The industry type groups metropolitan areas by the log of their ten location quotients, each averaged over the latest twelve months so that seasonal swings do not move an area between types, using k-means (k-means++ seeding, a fixed seed, k chosen by mean silhouette over 2 to 8); each type is named by the sectors it over-represents, states are assigned to the nearest type, and the grouping is recomputed with each release, so a type can change as the data does. Each release also stores three checks with the grouping: its agreement with the groupings computed on each of the previous twelve windows (adjusted Rand index), its agreement with a grouping of only the areas that have all ten sectors, and the number of areas left out and why. The clustering is in `scripts/typology.py` and uses nothing beyond the Python standard library.

Two limits of the source data are carried through rather than hidden. BLS does not seasonally adjust metro unemployment rates, so metro rates are labelled as such and are not directly comparable with state and national rates. BLS publishes hourly earnings by industry for states but only a private-sector total for metros, so the industry earnings chart appears for states and the nation only. Counties are a resolution, not a unit of analysis: the unemployment and earnings lenses draw every county with its own figure, but clicking a county opens the profile of its metropolitan area, or of its state outside metros, with the county's numbers on top. BLS publishes neither industry employment nor hourly earnings below the metro level, so the industry and types lenses stay at the MSA.

Geography is built from reference files, not typed by hand. A script resolves each metro's code against the BLS area list, reads its member counties from the Census Bureau's delineation file, and merges those counties into the area's real outline on the map. If a code has been retired or mistyped, the script stops rather than sending a bad request.

The update job is scheduled only on BLS release days, at 16:00 and 20:00 UTC after the 10:00 ET release, with one retry the following day. Before fetching, it compares the time of the last successful refresh with the most recent release, so a run that finds the data already current does nothing and a failed run is retried at the next scheduled time. The same run downloads the LAUS county table and the latest QCEW quarter and writes the county file. If that download fails, the previous county file is kept, the run page shows a warning, `meta.json` records the failure, and the page says which month the county layer shows. Each run is recorded in `docs/data/run_log.csv`, including the county month, the QCEW quarter and whether the county file was refreshed. Nothing has to be done by hand between releases.

## Design

The page is one full-screen map with a small set of floating panels, so the data never scrolls away from the geography it describes.

Top left: the title, the month of the latest data, and two national figures, nonfarm employment and the unemployment rate with its monthly and annual change. Under it, the four lens buttons and a search box that finds any metro, capital, state or county.

The map: every metro is a marker sized by its nonfarm jobs, drawn over the area's real county footprint. A diamond marks a state capital; a hollow ring marks an area for which BLS publishes unemployment but no industry data. The unemployment and earnings lenses shade every county by its own value, on a single blue ramp for the unemployment rate and a green-to-pink scale for real wage growth, with green meaning pay is ahead of prices; state borders stay visible over the counties. The types lens colors each metro by its industry type and lists the types in the legend with their member counts.

Hover: a card with the official name and the figures of the current lens. In the industry and types lenses these are nonfarm jobs, the largest sector and the specialty; in the unemployment lens the rate, its change over the year and the month, and the number unemployed; in the earnings lens hourly-earnings growth, real growth and the weekly wage. A county shows its own rate or wage and names the metropolitan area it belongs to.

The profile: clicking a place slides out a panel whose content depends on the lens. The industry lens shows nonfarm jobs, their change over the year and the private-sector percentage, then a rose chart in which each of ten industries is a petal sized by its percentage of jobs, coloured green where the area has proportionally fewer of those jobs than the nation and pink where it has more, with a black outline showing the national mix. Two cards below name the largest sector and the specialty, the industry most concentrated relative to the U.S. among those with a meaningful share of local jobs. The unemployment lens shows only unemployment figures: the rate with its monthly and annual change, the number unemployed, the national rate for comparison, a ten-year trend against the nation, where the area ranks among its peers, and the rate of every county in the area. The earnings lens shows hourly earnings, regional price change and real growth, the QCEW weekly wage with its real change, a burst chart of earnings by industry against the U.S. average for each, and an index chart of earnings against prices since 2016. The types lens shows the type card, the distance from the area to every type, and the other metropolitan areas of the same type; a state sees its metros with the type of each. When a county was clicked, its own figures sit at the top of the panel. A state profile also lists the metros inside it.

Typography and colour were chosen for reading numbers: a monospaced face so figures align, black text on light panels, and a dark surround so the country reads as the subject. Every colour scale has a legend on screen.

## Results

The result is a page that a program officer can open on the morning after a BLS release and, in under a minute, see the latest month for their metro and the counties inside it, how it compares with the state and the nation, which industries carry the local economy, and whether local pay is beating inflation. No spreadsheet, no API key, no waiting for a quarterly report.

Because the pipeline is automatic, the page is refreshed on the day of each release without manual work, and every number on it can be traced to a named BLS series. The delay between each release and the refresh is recorded in the run log. Because the code is open, another lab or agency can change the list of metros, add its own areas, or re-skin the page and run it under its own domain.

## Testing and verification

Series identifiers are validated against the BLS area lists before any request is made, and the fetch refuses to overwrite good data if a run returns empty results for most states. The figures shown on the site were checked against the BLS data tables for several areas (Philadelphia employment, Texas unemployment, Colorado hourly earnings among them) and against the seasonally adjusted national figures in the monthly Employment Situation release. The page was rendered in a headless browser across desktop and mobile sizes at each stage of development, and every chart has a hover readout so a reader can verify any value by pointing at it.

The county file was checked for completeness after the first run: 3,143 counties and county equivalents, of which 3,132 match a shape in the map topology. Known limits are stated on the page itself: metro and county rates are not seasonally adjusted, and county rates are model-based estimates that are less precise for small counties; county wages come from a quarterly census that is published about five months after the quarter ends, and a change in the average weekly wage can reflect a change in the mix of jobs as well as in pay; the six micropolitan capitals have no industry series; metro earnings are published only as a private-sector total; regional CPI is used for metros because BLS publishes metro CPIs for fewer than 25 areas; the industry types depend on the clustering settings and on the data window, the separation between types is weak (mean silhouette about 0.2), and an area near the boundary between two types can move between releases. Each workflow run appends a line to `docs/data/run_log.csv` (time, trigger, outcome, data months, county month, QCEW quarter, county status), which is the record used to evaluate the pipeline.

