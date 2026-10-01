# USA Workforce Snapshot: developer and methods document

This document describes how the system is built and why, for people who will maintain it, reuse it, or evaluate it. It is written to be cited from a methods section. The README covers the same ground for a general audience; this document goes one level deeper and names files, series, parameters and decisions.

Live site: https://workforce.usllab.org. Source: https://github.com/cyber-hbliu/workforce_demographic_dashboard. All figures below are from the release of 2026-10-01 (August 2026 data) unless stated.

## 1. Analytical framework

### 1.1 Questions, indicators, encodings

The system is organised as a chain from a reader's question to a visual encoding. Each row of the table is one such chain; everything else in the system exists to keep these chains current and consistent.

| Question a reader brings | Indicator | Source series | Where it appears |
|---|---|---|---|
| How is my area doing now, and is it getting better or worse? | Unemployment rate; change vs last month and vs the same month a year earlier; number unemployed | LAUS (states, metros, counties), CPS (nation) | Unemployment lens: county choropleth, profile tiles, ten-year trend, rank among peers, county list |
| What do people here do, and what is this place known for? | Nonfarm jobs and their change; percentage of nonfarm jobs by supersector; location quotient vs the U.S.; largest sector; specialty | CES employment by supersector (states, metros, nation) | Industry lens; profile tiles; rose chart; largest-sector and specialty cards; hover card |
| Which places have the same economic shape? | Industry type (cluster of location-quotient profiles); distance to each type centre | Derived from CES | Types lens choropleth; type card, fit to each type and same-type peers in the profile |
| Is pay keeping up with prices? | Average hourly earnings, year-on-year change, minus CPI change for the census region (real earnings growth); the same for the QCEW average weekly wage (real wage growth) | CES average hourly earnings; QCEW average weekly wage (nation, states, metros, counties); CPI-U for nation and four regions | Earnings lens: county choropleth of real wage growth, earnings tiles, earnings-by-industry burst, earnings-vs-prices index |

Three rules apply to every chain. A value is always shown with at least one comparison (the nation, the state's peers, or the same month a year earlier). A value always names its geography and its month. A derived indicator is computed in the pipeline, once, in Python, and the browser only draws it; nothing is recomputed client-side, so the page and the data files always agree.

### 1.2 Geography

The unit of analysis for metros is the core-based statistical area as delineated by the Office of Management and Budget (metropolitan statistical areas, plus the six micropolitan areas that contain a state capital). States and the nation are the other two levels. The system treats the city-versus-MSA distinction as a first-class concern: every metro profile states that its figures cover the whole area, lists the member counties, and draws the area's real county footprint on the map. Counties are a resolution, not a unit of analysis. The Unemployment and Earnings lenses draw every county with its own LAUS unemployment rate or QCEW real wage growth, and a county is searchable, but clicking one opens the profile of its metropolitan area, or of its state outside metros, with the county's figures in a strip at the top. BLS publishes neither industry employment nor hourly earnings below the metro level, so the Industry and Types lenses stay at the MSA, and the page never mixes a county figure into an MSA comparison.

### 1.3 Derived measures

Location quotient. For area a, sector i and month t, the proportion of nonfarm jobs is s(a,i,t) = E(a,i,t) / E(a,total,t), and the location quotient is LQ(a,i,t) = s(a,i,t) / s(US,i,t). The U.S. proportions use the national CES series at the same month, not seasonally adjusted, so numerator and denominator are computed the same way. The rose chart draws s as petal area and LQ as petal colour; the specialty is the sector with the highest LQ among sectors holding at least 5% of local jobs and an LQ of at least 1.05, so a tiny sector cannot be called the specialty; the largest sector is the sector with the highest s.

Real earnings growth. For area a at month t, with regional CPI P for the area's census region, g(a,t) = [AHE(a,t) / AHE(a,t-12) - 1] - [P(r(a),t) / P(r(a),t-12) - 1], expressed in percentage points. AHE is the CES average hourly earnings of all employees, total private, not seasonally adjusted. Regional CPI is used because BLS publishes metropolitan CPIs for fewer than 25 areas. The earnings-vs-prices chart indexes both series to 100 at the start of the data window (January 2016).

Real wage growth (counties). QCEW publishes, for every county, the average weekly wage of all covered employment by quarter and its change over the same quarter a year earlier. For county c in quarter q, w(c,q) is that change minus the year-on-year change in the regional CPI averaged over the three months of q, in percentage points, so wages and prices cover the same period. Using the last month of the quarter instead, as an earlier version did, overstated price growth in 2026Q1 by 0.3 points (West) to 0.8 points (South), and by 0.6 points for the nation. The same measure is computed for the nation, states and metros from the QCEW aggregation levels 10, 50 and 40, so the profile can show it beside the hourly-earnings figure. The two measures differ in source (a census of unemployment-insurance records against a survey of establishments), coverage (all employers against private employers) and timing (quarterly, about five months after the quarter, against monthly), and the page labels each. An average weekly wage also changes when the mix of jobs changes (losing low-paid jobs raises the average with no change in any worker's pay), so w is a measure of the average wage bill per worker, not of pay for a given job; the page says so in the Earnings legend.

Industry type. For each metro, the feature vector is x(a) = [mean over the twelve months ending at the latest CES month of log2 LQ(a,i,t)] over the ten sectors, so the feature is the log of the geometric-mean location quotient for the year. Averaging removes seasonal swings (leisure and hospitality, education) that would otherwise move an area between types from one month to the next. A sector counts if it is published in at least ten of the twelve months; an area is clustered if at least eight of the ten sectors count, and a missing sector is set to 0, the national mix. Types are k-means clusters of these vectors with k-means++ seeding, a fixed random seed, eight restarts (lowest inertia kept), and k chosen from 2 to 8 by the highest mean silhouette (Rousseeuw 1987). Types are ordered by membership and named from their centroid: sectors with a mean LQ of at least 1.15 name the type ("Manufacturing-led", "Information and finance"); a type with none is named by the sectors it is light on (mean LQ at most 0.85), or "Diversified, near the U.S. mix". States are not in the clustering pool; each state is assigned the type whose centroid is nearest to its own twelve-month vector, and the page labels this as "nearest type". The clustering is recomputed with every release, so types can change as the data changes; this is by design and stated in the interface. The implementation is in `scripts/typology.py` (k-means, silhouette, adjusted Rand index) and `scripts/fetch_bls.py` (`window_profile`, `typology_with_checks`), and uses only the Python standard library.

Each release stores four checks in `rose.json` under `typology.diagnostics` and `typology.silhouette_by_k`. Silhouette by k shows how clearly the chosen k beats the others. Stability: the same method is run on the windows ending one to twelve months earlier, and each result is compared with the current grouping by the adjusted Rand index (Hubert and Arabie 1985), which is 1 for identical partitions and about 0 for chance agreement. Sensitivity to missing sectors: the method is run on only the areas with all ten sectors and compared with the main grouping on those areas. Coverage: the number of metros typed, left out for having too few sectors, and without any CES series, with the median nonfarm jobs of the typed and left-out groups, and the number of typed areas missing each sector. On the August 2026 data with the earlier single-month features and k from 3 to 8, the method selected k = 3 (mean silhouette 0.197): Manufacturing-led (121 metros), Diversified near the U.S. mix (111), Government-led (91), with 323 of 392 areas typed. A mean silhouette below 0.25 indicates weak separation, so the types are a description of the industry mix rather than sharply distinct groups; the page states this beside the types. The figures under the current method are written with the next release.

## 2. System structure

The system has three layers with one direction of dependency: configuration and build produce geography; the pipeline produces data; the page consumes both. Nothing runs on a server. The page is static files on GitHub Pages; the pipeline is a GitHub Actions workflow; the only external service at run time is the BLS public API.

### 2.1 Configuration and build (run when the area list changes)

`config/metro_selection.json` is the only hand-edited input: short labels and map anchors for the largest metros, the capital city of each state, and the flag `include_all_metros` that adds every other metropolitan area BLS publishes (Puerto Rico excluded).

`scripts/build_areas.py` resolves that list against three reference files it downloads into `build/`: the BLS LAUS area list (`la.area`), which gives the exact 15-character LAUS area code and the official title; the BLS CES area list (`sm.area`), which says whether industry series exist for the area; and the Census Bureau's CBSA delineation files (2023 vintage, with the 2020 vintage as a fallback where 2023 county equivalents, the Connecticut planning regions, are not in the map topology). It writes `config/areas.json`: 392 areas with code, title, member counties, member states, capital flags and CES coverage. A code not found in the BLS list stops the build with an error, so a retired or mistyped CBSA can never reach the API.

`scripts/build_geo.js` merges each area's counties from the us-atlas county topology (pre-projected Albers USA, 10 m) into one outline, derives a map anchor from the central counties, records the county names, and writes `docs/lib/metros-albers.json` (217 KB for 392 areas). Because the state topology and the county topology share the same projection, footprints and state boundaries align without any projection at run time.

The same two steps are available as the "Rebuild areas and fetch" workflow for maintainers without a local toolchain.

### 2.2 Pipeline (runs on BLS release days)

Scheduling. `docs/data/release_dates.json` holds the BLS release calendar for state and metro figures. `scripts/make_schedule.py` turns it into the cron lines of `.github/workflows/update-data.yml`: on each release day, runs at 16:00 and 20:00 UTC (the release is at 10:00 Eastern), and one run at 16:00 UTC the following day. The calendar is refreshed once a year.

Gate. Every scheduled run first executes `scripts/check_release.py`, which compares the timestamp of the last successful refresh (`meta.json`, `updated_at`) with the most recent release that has already happened. The run proceeds only if the site is older than that release. This turns the schedule from "fire on a date" into "reconcile state": a second run on the same day is a no-op if the first succeeded, and the next-day run is a retry only if both failed. A manual dispatch bypasses the gate.

Fetch and compute. `scripts/fetch_bls.py` builds a catalog of 7,506 series from `areas.json` (1,568 LAUS metro, 204 LAUS state, 4,246 CES metro employment, 561 CES state employment, 386 metro and 510 state hourly-earnings, 11 national CES, 10 national earnings, 5 national CPS/CES headline, 5 CPI) and requests them in batches of 50 (151 requests against the daily limit of 500 with a registration key), with three attempts per batch and a 0.5 s pause between batches. Each series is tidied to monthly rows, oldest first; preliminary and not-disclosed values are handled as BLS marks them. The script then computes the derived measures of section 1.3, builds the county file from the LAUS county table and the latest QCEW quarter, and writes seven files. It refuses to write anything if fewer than 49 of the 51 state unemployment series came back, so a partial API outage cannot overwrite good data with empty data.

Outputs (`docs/data/`): `states.json` (294 KB), `metros.json` (2.3 MB), `national.json`, `rose.json` (industry profiles and typology, 335 KB), `earnings.json` (1.9 MB), `counties.json` (465 KB: per county the name, state, CBSA, unemployment rate with the previous and year-ago rates, number unemployed, weekly wage and its nominal and real change; plus the QCEW figures for the nation, states and metros), `meta.json` (timestamps, months covered, the county month and QCEW quarter, series requested and empty). Level series other than the unemployment rate keep 13 months, because the page reads only their latest and year-ago values; the unemployment rate keeps the full ten years for the trend chart.

Run log. The workflow appends one line per run to `docs/data/run_log.csv`: UTC time, trigger (schedule or dispatch), outcome, data date, series requested, series empty, latest state month, latest metro month, county month, QCEW quarter, and county status (`refreshed`, or `kept previous file` with the error). When columns are added the step rewrites the header and leaves earlier rows blank in the new columns. The log is the primary record for evaluating the pipeline (section 5).

### 2.3 Page (static, drawn in the browser)

`docs/index.html`, `docs/style.css` and `docs/app.js` (about 980 lines) with D3 v7 and topojson-client vendored in `docs/lib/`. On load the page fetches the seven data files and the three topologies (states, metro footprints, counties) in parallel and keeps them in memory; every interaction is a re-render from memory with no further requests. Deep links of the form `#metro=12420` or `#state=48` open a profile directly.

## 3. Problems and how they are solved

County resolution. LAUS county series exist in the API, but four measures for 3,143 counties would exceed the daily request limit on their own. The pipeline instead reads the program's monthly county table (`laucntycur14`, a workbook with the latest 14 months) and the QCEW quarterly CSV for aggregation level 70, both from download.bls.gov, and keeps the latest, the previous and the year-ago month per county. `scripts/county_data.py` tries the most recent quarters in turn and skips a quarter whose file is not yet a data file, so the step works in the weeks after a quarter ends when the next QCEW release is not out. If the county step fails for any reason the previous county file is kept and the run still succeeds, because the county layer is a resolution added to the page rather than a dependency of it. The failure is not silent: the script writes a warning annotation to the run page, `meta.json` records `county_status` with the error, the run log records it, and the page's masthead states which month the county layer shows.

Series identifiers. BLS series codes are positional strings (for example `LAUMT063108000000003`) and an early version of the pipeline padded them wrongly, returning empty results silently. The fix was structural: codes are built from the area codes BLS itself publishes in `la.area`, never typed, and the build refuses unknown codes. Empty series are counted per program on every run and reported in `meta.json` (804 of 7,506 on the August run, almost all expected gaps such as industries not published for small metros).

Scheduling and failure. A daily cron with a date gate ran every day and could miss a release if the single run failed (as happened on 18 September 2026). The current design runs only on release days, twice, with a next-day retry, and the gate reconciles against the site's own timestamp rather than the calendar, so any later run heals a missed one without manual action.

Geography drift. CBSA definitions change (2020 and 2023 vintages differ; Connecticut replaced counties with planning regions in 2022). The build prefers the 2023 delineation and falls back per area to 2020 when the newer county codes are not in the map, and logs the one area it cannot draw (Waterbury-Shelton, CT). Footprints are rebuilt from the reference files, never edited.

City versus MSA. Every profile header states the statistical unit and lists the counties; the hover card uses the official title with state suffix; the search index labels results MSA, µSA or State. This is a presentation decision, but it addresses the most common misreading of metropolitan statistics.

Comparability. Metro unemployment rates are not seasonally adjusted while state and national rates are; the page labels each and does not rank metros against states. All industry proportions, local and national, use not-seasonally-adjusted CES so the ratio is internally consistent.

Payload size. With 392 areas the raw export was 8.5 MB for metros alone. Keeping 13 months for level series cut it to 2.3 MB; the unemployment rate keeps its full history because it is drawn.

Clustering stability. k-means is sensitive to initialisation and to the month of data. A fixed seed, k-means++ and eight restarts make the result deterministic for a given release; twelve-month features remove seasonal movement; naming types from centroids rather than from cluster indices keeps names meaningful when membership shifts. Stability across releases is measured, not assumed: each release records the adjusted Rand index against the groupings of the twelve previous windows. The Types profile shows each area's distance to every type centre, so a reader can see when an area sits near a boundary.

Map density. At 392 areas, markers and labels collide at the national scale. Marker size is a square-root scale of nonfarm jobs capped at 13 px; labels are placed greedily, largest areas first, and appear as the user zooms; the Types lens uses the county footprint as the symbol, which removes the collision problem for that lens entirely.

## 4. Presentation

### 4.1 Layout

The map is the page. Three floating panels sit over it: the masthead (title, month of the latest data, two national figures, data-pulled date and next release date), the controls (four lens buttons and a search box) and the legend, which changes with the lens. Zoom controls sit bottom right. Clicking any area slides out a profile panel on the right whose content depends on the lens.

### 4.2 Lenses and encodings

Industry. One marker per area, area proportional to nonfarm jobs; a diamond where the area holds a state capital; a hollow ring where BLS publishes unemployment but no industry series; the county footprint in grey beneath. Profile: nonfarm jobs, their change over the year and the private-sector percentage of jobs; the rose (ten petals in a fixed order, area = percentage of jobs, colour = LQ on a green-grey-pink diverging scale centred on 1.0, a black outline at the national percentage for each petal); a table view; cards for the largest sector and the specialty.

Unemployment. Every county shaded by its own rate on a single blue sequential ramp (2nd to 98th percentile), state borders drawn over the counties. Profile, unemployment figures only: the rate with monthly and annual change, the number unemployed with the same changes, the U.S. rate for comparison; ten-year trend against the nation with a crosshair readout; a "where it stands" card (rank among the 392 metros or 51 states, distance from the U.S. rate, the year-ago rate and the twelve-month range); for a metro the rates of its member counties, for a state its metros ranked by rate and its counties outside metros; when a county was clicked, its figures in a strip at the top.

Earnings. Every county shaded by real wage growth (QCEW) on the same green-grey-pink diverging scale (±3 points). Profile: hourly earnings, regional price change and real growth (CES); the QCEW weekly wage with its nominal and real change; for states and the nation, a burst of earnings by industry (spoke length = hourly earnings, tip colour = that industry's real change, a ring at the area's private average, a tick at the U.S. average for the industry); an index chart of earnings against regional prices since 2016.

Types. A choropleth: each metro's county footprint filled with its type colour (a fixed categorical order, at most eight), states tinted with their nearest type, untyped areas grey. Profile: the type card (name, membership count, the sectors that define the type with the type's mean LQ beside the area's own); the distance from the area to every type centre in log-LQ space, nearest first, so a reader can see whether the area sits near a boundary; for a metro, the other members of its type, largest first; for a state, its metros with the type of each. The industry rose is not repeated here; it belongs to the Industry lens.

Hover. A dark card with the official name and the large figures of the current lens: nonfarm jobs, largest sector and specialty in the Industry and Types lenses (with a type pill in Types); the rate, its change over the year and the month, and the number unemployed in the Unemployment lens; hourly-earnings growth, real growth and the weekly wage in the Earnings lens. A county's card shows its own figure and names its metropolitan area.

### 4.3 Design rules

One typeface (Source Code Pro) so figures align; black text on light panels; a dark surround so the country is the subject; every colour scale has an on-screen legend; a colour is never the only carrier of a value (the number is always present in the profile or the hover); charts have a table or a hover readout; text is set with `textContent`-safe escaping. Marks follow fixed specs: 2 px lines, hairline grids, a 2 px surface gap between adjacent fills.

## 5. Evaluation hooks

The system records what is needed to evaluate it without instrumenting users.

Pipeline latency and reliability: `run_log.csv` gives, per run, the trigger, the outcome and the months covered; the delay from a release (known from the calendar) to a successful refresh is derivable from the run time, and the number of retries from the count of runs per release day. The git history of `docs/data/` is a second, independent record of every data change.

Data coverage: `meta.json` reports series requested and series empty per run; the per-program breakdown is printed in the workflow log. Coverage by level (nation, state, metro) and by program can be tabulated from `rose.json` and `earnings.json` directly.

Typology: `rose.json` carries the silhouette for each k, the stability series, the complete-case comparison and the coverage counts described in section 1.3, so the robustness of the types can be reported for any release from the published file alone.

Correctness: every number on the page is traceable to a named BLS series and month, so a spot check is a direct comparison with the BLS API for the same identifier. The pipeline validates identifiers against the BLS area lists before any request.

User tasks: the page supports task-based testing against BLS's own "Economy at a Glance" pages because the same questions (current rate, change, industry mix, pay) can be answered on both; deep links allow a fixed starting state per task.

## 6. Embedding and reuse

Data. All inputs are public: the BLS public API (registration key, 500 requests per day), the BLS reference files and county tables on download.bls.gov, www.bls.gov and data.bls.gov (requested with a User-Agent that names the project, and a contact address when the optional `BLS_CONTACT_EMAIL` secret is set), the Census CBSA delineation files, and the us-atlas topologies (CDN). No data is scraped from HTML.

Infrastructure. GitHub Actions runs the pipeline on a free tier; GitHub Pages serves the site; a CNAME record points `workforce.usllab.org` at it. There is no database and no server-side code, so a copy can be run by forking the repository and adding one secret.

Reuse. The area list is a configuration file; a user can restrict the map to one state's metros or extend it with micropolitan areas by editing it and running two scripts. The typology module is independent of the rest and can be run on any set of LQ profiles. The page reads a documented JSON schema, so another front end can consume the same files.

Presentation elsewhere. The Urban Spatial Lab site links to the dashboard as a project page with screenshots and a process diagram (`press/`); the dashboard is not embedded in an iframe because it is a full-viewport application. Deep links let a project page or an article open the map at a specific area and lens.

## 7. Limitations

Metro and county unemployment rates are not seasonally adjusted, and county rates are model-based estimates that are less precise for small counties; the county colour scale runs from the 2nd to the 98th percentile so that a few extreme values do not set the range. County wages are quarterly and lag the monthly figures by about five months, so the county map of the Earnings lens and the hourly-earnings tiles describe different periods, which the page labels. The average weekly wage reflects the mix of jobs as well as pay. Eleven county equivalents in the LAUS table have no shape in the map topology and are not drawn. Metro hourly earnings are published for total private only, so the earnings-by-industry chart exists for states and the nation. CPI is regional, not metropolitan. CES supersectors are coarse (ten sectors), which bounds what the typology can distinguish. The typology depends on its settings (feature definition, twelve-month window, k range, silhouette criterion), its separation is weak (mean silhouette about 0.2), and areas with fewer than eight published sectors, mostly small metros, are not typed. One area (Waterbury-Shelton, CT) cannot be drawn with the current topology. The operating record is short: the pipeline in its current form has run since October 2026.

## 8. Reproducibility

Clone the repository; set the `BLS_API_KEY` secret (free registration); run the "Update BLS data" workflow once. To rebuild geography: `pip install requests openpyxl xlrd`, `python scripts/build_areas.py`, `node scripts/build_geo.js`. To regenerate the schedule after editing the release calendar: `python scripts/make_schedule.py`. To run the typology on a saved `rose.json`: `python -c "import json, sys; sys.path.insert(0, 'scripts'); from typology import build_typology; print(build_typology(json.load(open('docs/data/rose.json'))['metros'])['types'])"`. Every data refresh is a commit, so any past state of the site can be checked out by date.
