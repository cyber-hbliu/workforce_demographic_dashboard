# USA Workforce Snapshot: developer and methods document

This document describes how the system is built and why, for people who will maintain it, reuse it, or evaluate it. It is written to be cited from a methods section. The README covers the same ground for a general audience; this document goes one level deeper and names files, series, parameters, thresholds and decisions.

Live site: https://workforce.usllab.org. Source: https://github.com/cyber-hbliu/workforce_demographic_dashboard. All figures below are from the refresh of 2026-10-02 at 23:37 UTC (August 2026 LAUS, September 2026 CES, 2026Q1 wages), the first run of the pipeline in its current form, unless stated.

Contents

1. Analytical framework
2. System structure
3. Data files and their schemas
4. Problems and how they are solved
5. Presentation
6. Evaluation hooks
7. Embedding and reuse
8. Limitations
9. Maintenance
10. Reproducibility

## 1. Analytical framework

### 1.1 Questions, indicators, encodings

The system is organized as a chain from a reader's question to a visual encoding. Each row of the table is one such chain; everything else in the system exists to keep these chains current and consistent.

| Question a reader brings | Indicator | Source series | Where it appears |
|---|---|---|---|
| How is my area doing now, and is it getting better or worse? | Unemployment rate; change vs last month and vs the same month a year earlier; number unemployed | LAUS (states, metros, counties), CPS (nation) | Unemployment lens: county choropleth, profile tiles, ten-year trend, rank among peers, county list |
| What do people here do, and what is this place known for? | Nonfarm jobs and their change; percentage of nonfarm jobs by supersector; location quotient vs the U.S.; largest sector; specialty | CES employment by supersector (states, metros, nation) | Industry lens; profile tiles; rose chart; largest-sector and specialty cards; hover card |
| Which places have the same economic shape? | Industry type (cluster of twelve-month location-quotient profiles); distance to each type center | Derived from CES | Types lens choropleth; type card, fit to each type and same-type peers in the profile |
| Is pay keeping up with prices? | Average hourly earnings, year-on-year change, minus CPI change for the census region (real earnings growth); the same for the QCEW average weekly wage (real wage growth) | CES average hourly earnings; QCEW average weekly wage (nation, states, metros, counties); CPI-U for the nation and four regions | Earnings lens: county choropleth of real wage growth, earnings tiles, earnings-by-industry burst, earnings-vs-prices index |

Three rules apply to every chain. A value is always shown with at least one comparison (the nation, the state's peers, or the same month a year earlier). A value always names its geography and its month. A derived indicator is computed in the pipeline, once, in Python, and the browser only draws it; nothing is recomputed client-side, so the page and the data files always agree. The one exception is the distance from an area to each type center in the Types profile, which the page computes from the stored twelve-month features because it is a display of the stored clustering rather than a new result.

### 1.2 Geography

Levels. The unit of analysis for metros is the core-based statistical area as delineated by the Office of Management and Budget: every metropolitan statistical area for which BLS publishes local unemployment data (Puerto Rico excluded), plus the six micropolitan statistical areas that contain a state capital (Juneau AK, Frankfort KY, Augusta-Waterville ME, Concord NH, Pierre SD and Barre VT, which holds Montpelier), 393 areas in all. The 50 states and the District of Columbia are the second level and the nation the third.

City versus MSA. The system treats the distinction as a first-class concern: every metro profile states that its figures cover the whole area, lists the member counties, draws the area's real county footprint on the map, and names the capital city separately from the area. "Urban Honolulu, HI" is Honolulu County; "Austin-Round Rock-San Marcos, TX" is five counties. The search index labels each result MSA, µSA, State or County.

Counties. Counties are a resolution, not a unit of analysis. The Unemployment and Earnings lenses draw every county with its own LAUS unemployment rate or QCEW real wage growth, a county is searchable, and hovering one shows its figures, but clicking one opens the profile of its metropolitan area, or of its state outside metros, with the county's figures in a strip at the top. BLS publishes neither industry employment nor hourly earnings below the metro level, so the Industry and Types lenses stay at the MSA, and the page never mixes a county figure into an MSA comparison. Each county is linked to its MSA through the 2023 delineation, so a county's rate is always shown beside the right area.

County equivalents. Connecticut replaced its eight counties with nine planning regions as county equivalents in 2022, and BLS adopted the new codes (FIPS 09110 to 09190) in its county table; Alaska split the Valdez-Cordova census area into Chugach (02063) and Copper River (02066) in 2019. The us-atlas county topology predates both, so the build patches it (section 2.1). After the patch every county in the LAUS table has a shape; Kalawao County, HI has a shape but no LAUS estimate and is drawn grey.

Projection. All geometry is pre-projected on the Albers USA grid used by us-atlas (D3's `geoAlbersUsa`, scale 1300, translate 487.5 by 305, a 975 by 610 frame) so that states, county footprints and counties align without any projection at run time, and Alaska and Hawaii sit in their usual insets.

### 1.3 Derived measures

Location quotient. For area a, sector i and month t, the proportion of nonfarm jobs is s(a,i,t) = E(a,i,t) / E(a,total,t), and the location quotient is LQ(a,i,t) = s(a,i,t) / s(US,i,t). The U.S. proportions use the national CES series at the same month, not seasonally adjusted, so numerator and denominator are computed the same way. The ten sectors are the CES supersectors: mining, logging and construction (one sector, see the next paragraph), manufacturing, trade, transportation and utilities, information, financial activities, professional and business services, education and health services, leisure and hospitality, other services, and government. The rose chart draws s as petal area and LQ as petal color.

Construction coding. BLS publishes construction (supersector code 20000000) and mining and logging (10000000) as separate series for large areas and for states, and for most metropolitan areas only their sum, the "mining, logging and construction" supersector (15000000). In the August 2026 data only 56 of the 386 metros with industry series had a construction series, so an earlier version of the pipeline, which requested construction alone, treated the sector as missing for the other 330 and set it to the national mix in the typology features. The pipeline now requests all three codes and uses the combined sector at every level: where BLS publishes 15000000 it is used as is; where only the parts are published they are summed month by month (the nation, states and the largest metros); where one part alone is published it stands for the sector. `meta.json` records how many metros fell into each case (`construction_sector_source`): on the first run with the new catalog, 334 of the 387 metros with industry series publish the combined sector, 1 publishes both parts (summed), 1 publishes construction alone, and 51 publish none of the three. Hourly earnings are published for construction proper, so the earnings-by-industry chart keeps construction (20000000) as its first spoke.

Largest sector and specialty. The largest sector is the sector with the highest s. The specialty is the sector with the highest LQ among sectors holding at least 5% of local jobs and an LQ of at least 1.05; an area with no such sector has no specialty and the page says so. The 5% floor keeps a tiny sector with a high ratio (information in a small metro with one call center, for example) from being called the area's specialty.

Real earnings growth. For area a at month t, with regional CPI P for the area's census region, g(a,t) = [AHE(a,t) / AHE(a,t-12) - 1] - [P(r(a),t) / P(r(a),t-12) - 1], expressed in percentage points. AHE is the CES average hourly earnings of all employees, total private, not seasonally adjusted. Regional CPI is used because BLS publishes metropolitan CPIs for fewer than 25 areas. A metro takes the region of its first-listed state. The earnings-vs-prices chart indexes both series to 100 at the start of the data window (January 2016).

Real wage growth (counties and every other level). QCEW publishes, for every county, the average weekly wage of all covered employment by quarter and its change over the same quarter a year earlier. For county c in quarter q, w(c,q) is that change minus the year-on-year change in the regional CPI averaged over the three months of q, in percentage points, so wages and prices cover the same period. Using the last month of the quarter instead, as an earlier version did, overstated price growth in 2026Q1 by 0.3 points (West) to 0.8 points (South), and by 0.6 points for the nation. The same measure is computed for the nation, states and metros from the QCEW aggregation levels 10, 50 and 40, so the profile shows it beside the hourly-earnings figure at every level. The two measures differ in source (a census of unemployment-insurance records against a survey of establishments), coverage (all employers against private employers) and timing (quarterly, about five months after the quarter, against monthly), and the page labels each. An average weekly wage also changes when the mix of jobs changes (losing low-paid jobs raises the average with no change in any worker's pay), so w is a measure of the average wage bill per worker, not of pay for a given job; the Earnings legend says so.

Industry type: features. For each metro, the feature vector is x(a) = [mean over the twelve months ending at the latest CES month of log2 LQ(a,i,t)] over the ten sectors, so each feature is the log of the geometric-mean location quotient for the year. Averaging removes seasonal swings (leisure and hospitality, education) that would otherwise move an area between types from one month to the next. A sector counts if it is published in at least ten of the twelve months; an area is clustered if at least eight of the ten sectors count, and a missing sector is set to 0, the national mix.

Industry type: clustering. Types are k-means clusters of these vectors with k-means++ seeding, a fixed random seed (7), eight restarts with the lowest inertia kept, and up to 100 iterations per run. The mean silhouette (Rousseeuw 1987) is computed for each k from 2 to 8.

Industry type: the number of types. k is chosen by a rule adopted after the first release and applied unchanged to every release since, so the choice of k in later releases does not depend on which grouping looks most useful. Among the values of k whose mean silhouette on the current window is within 0.01 of the best, the pipeline clusters the current window and each of the twelve earlier windows with that k fixed, computes the adjusted Rand index between the current grouping and each earlier one, and takes the k with the highest median; on a tie it takes the larger k. The tolerance of 0.01 is a set convention. In the 2026-10-02 release the mean silhouette is 0.200 at k = 2 and 0.184 at k = 3, a gap of 0.016, so k = 3 falls outside the tolerance. The rule, its candidates and the chosen k are stored with every release (`typology.diagnostics.k_rule`) and stated in the Types legend and profile. The implementation is `choose_k` in `scripts/fetch_bls.py`. Types are ordered by membership, largest first, and named from their centroid: sectors with a mean LQ of at least 1.15 name the type ("Manufacturing-led"; "Information and finance" when two qualify); a type with none is named by the sectors it is light on (mean LQ at most 0.85), or "Diversified, near the U.S. mix"; duplicate names get roman numerals. States are not in the clustering pool; each state is assigned the type whose centroid is nearest to its own twelve-month vector, and the page labels this as "nearest type", not membership. The clustering is recomputed with every release, so types can change as the data changes; this is by design and stated in the interface. The implementation is in `scripts/typology.py` (k-means, silhouette, adjusted Rand index) and `scripts/fetch_bls.py` (`window_profile`, `typology_with_checks`), and uses only the Python standard library. One metropolitan area publishes construction but not mining and logging, so its combined-sector location quotient is understated. The effect on the typology is confined to that area.

Industry type: checks. Each release stores the checks in `rose.json` under `typology.diagnostics` and `typology.silhouette_by_k`. Silhouette by k shows how clearly the chosen k beats the others, and the k rule's record shows the candidates and their stability. Stability: the windows ending one to twelve months earlier are clustered with the chosen k, and each result is compared with the current grouping by the adjusted Rand index (Hubert and Arabie 1985), which is 1 for identical partitions and about 0 for chance agreement. Sensitivity to missing sectors: the method is run on only the areas with all ten sectors and compared with the main grouping on those areas. Coverage: the number of metros typed, left out for having too few sectors, and without any CES series, with the median nonfarm jobs of the typed and left-out groups, and the number of typed areas missing each sector.

Industry type: result on the current data. On the window ending September 2026, with the combined construction sector, the mean silhouette is 0.200 for k = 2, 0.184 for k = 3, 0.174 for k = 4 and lower beyond, so k = 2 is the only candidate within the rule's tolerance and is chosen (its median adjusted Rand index against the twelve earlier windows is 0.835). The types are Manufacturing-led (180 metros; centroid LQ 1.43 for manufacturing, 0.45 for information, 0.67 for finance and for professional services) and Diversified, light on manufacturing and information (145; manufacturing 0.58, information 0.72). 325 of 393 areas are typed; 6 have no CES series and 62, with a median of 55,000 nonfarm jobs against 139,000 for the typed areas, have fewer than eight published sectors. Every one of the twelve earlier windows clustered at k = 2 agrees with the current grouping at an adjusted Rand index between 0.79 and 1.00. The complete-case check now covers 319 areas (only information, professional and business services, and education and health are missing for a handful), and on those areas the complete-case grouping agrees with the main one at 0.855, so the result no longer depends on imputed values. A mean silhouette of 0.2 indicates weak separation, so the types describe the industry mix and are not sharply distinct groups; the page states this beside the types.

Before the construction recoding, on the refresh of 2026-10-01, the same method with construction alone had given k = 2 at 0.205 against 0.200 for k = 3 (Manufacturing-led 170, Diversified 154), with construction imputed for 269 of 324 typed areas and a complete-case check on 55 areas that agreed with the main grouping at only 0.10. The recoding changed two things: the complete-case check became meaningful (319 areas, 0.855), and k = 3 fell outside the rule's tolerance, so the two-group result stands on its own rather than on a near tie. Two groups means that the typology on this data is close to a single split on manufacturing intensity; the Types profile shows each area's distance to both centers so that a reader can see how far from the boundary it sits.

### 1.4 Provenance and limits of each source

A reader of any figure should be able to answer what it measures, who collected it and why, when and how, and what is missing (Chapple, Urban Data Storytelling). The table collects those answers for the five programs the page draws on; the page itself carries the parts that matter at the point of reading (month, geography, program, adjustment).

| Program | What it measures and the unit | How it is collected | Census or sample | Frequency, lag, revisions | Adjustment | What is missing |
|---|---|---|---|---|---|---|
| LAUS | Labor force, employment, unemployment and the rate for states, metros and counties; people, by place of residence | Model-based estimates that combine the CPS household survey, the CES payroll survey and unemployment insurance claims; county figures are built by a disaggregation method and summed to the state | Estimate | Monthly; states about three weeks after the month, metros and counties about five; revised in the following month and each spring for the previous year | States seasonally adjusted; metros and counties not | Error widens as areas get smaller; no demographic breakdown at these geographies |
| CES | Nonfarm jobs by industry and average hourly earnings for states, metros and the nation; jobs, by place of work | Monthly survey of employer payrolls | Sample | Monthly; revised in the two following months and benchmarked each year to QCEW | Industry series used here are not seasonally adjusted; the masthead headline is | Self-employed, farm workers, private household workers and unpaid family workers; a person with two jobs counts twice; small metros lack many industries |
| CPS | National labor force, employment, unemployment; people | Monthly household survey | Sample | Monthly, usually the first Friday after the month; seasonal factors revised each year | Seasonally adjusted | Used only at the national level here |
| QCEW | Average weekly wage of covered employment for counties, metros, states and the nation; jobs | Quarterly reports that employers file under unemployment insurance law | Near census (BLS states coverage above 95% of jobs) | Quarterly, about five months after the quarter; revised with the next quarter | None | Self-employed and other uncovered workers; the average moves with the mix of jobs as well as with pay |
| CPI-U | All-items price index for the nation and four census regions; prices faced by urban consumers | Price collection from retail outlets, service providers and rental units | Sample | Monthly; regional indexes not seasonally adjusted here | Not seasonally adjusted | Metropolitan indexes exist for fewer than 25 areas, so metros take their region's index |

Levels of measurement. Rates and changes are ratio data and are shown to one decimal place, as BLS publishes them; location quotients are ratios shown to two decimals; the industry type is a nominal category produced by the project, not by BLS, and is labeled as such. The page adds no decimal places beyond the source, because the model-based county and metro figures do not support them.

Aggregation. An MSA figure is an aggregate over its counties and a county figure over its residents or its employers; neither describes every town or every person inside the boundary, and inferring individual conditions from them is the ecological fallacy. The county layer exists so that variation within an area is shown, and the profile states the unit at the top of every panel. The page draws no conclusion about individuals and offers no breakdown that the source does not publish.

Boundaries. The areas are administrative. The Office of Management and Budget redraws core-based statistical areas after each census and between censuses; the 2023 delineation differs from the 2020 one, and Connecticut's county equivalents changed altogether. An area's figures change when its boundary does (Hartford's area moved from three legacy counties to two planning regions, and Bridgeport's from one county to two regions), so the vintage is named in this document and the member counties are listed on the page. A reader who knows a place may draw its boundary differently from OMB, and the county layer lets them read the part they mean.

## 2. System structure

The system has three layers with one direction of dependency: configuration and build produce geography; the pipeline produces data; the page consumes both. Nothing runs on a server. The page is static files on GitHub Pages; the pipeline is a GitHub Actions workflow; the only external services at run time are the BLS public API, three BLS download sites and the Census Bureau's TIGERweb service, all public.

Repository layout:

| Path | Role |
|---|---|
| `config/metro_selection.json` | the only hand-edited input: curated metros with short labels and map anchors, state capitals, `include_all_metros` |
| `config/areas.json` | generated: every area with its BLS codes, member counties and states, capital flags, CES coverage |
| `scripts/patch_counties.js` | brings the us-atlas county topology up to the current county equivalents |
| `scripts/build_areas.py` | resolves the selection against BLS and Census reference files; writes `areas.json` |
| `scripts/build_geo.js` | merges counties into metro footprints; writes `docs/lib/metros-albers.json` |
| `scripts/fetch_bls.py` | the data pipeline: catalog, fetch, derived measures, typology with checks, county step, output files |
| `scripts/typology.py` | k-means, silhouette, adjusted Rand index; no dependencies |
| `scripts/county_data.py` | LAUS county table and QCEW quarterly file; writes `counties.json` |
| `scripts/check_release.py` | the gate: fetch only if the site is older than the last release |
| `scripts/make_schedule.py` | writes the workflow's cron lines from the release calendar |
| `scripts/backfill_series.py` | one-off: merge newly added series into existing data files without a key |
| `scripts/make_sample_data.py` | synthetic data files for working on the page offline |
| `.github/workflows/update-data.yml` | scheduled refresh (generated cron lines) and manual refresh |
| `.github/workflows/rebuild-areas.yml` | manual: patch topology, rebuild areas and footprints, then fetch |
| `docs/` | the site: `index.html`, `style.css`, `app.js`, `lib/` (D3, topojson-client, three topologies), `data/`, `assets/`, `CNAME` |
| `press/` | copy, screenshots list and two diagrams for the Urban Spatial Lab site |
| `build/` | downloaded reference files (ignored by git) |

### 2.1 Configuration and build (run when the area list or the geography changes)

Selection. `config/metro_selection.json` holds 114 curated metros (CBSA code, short label, longitude and latitude of the map anchor), the capital city and CBSA of each of the 51 states and the District, and the flag `include_all_metros`, which adds every other metropolitan area BLS publishes. Curated entries come first so that their labels win collisions on the map.

Topology patch. `scripts/patch_counties.js` downloads the us-atlas county topology (`counties-albers-10m.json`, 3,143 counties, states and nation objects, quantized to 1e5) if `build/` does not already have it, fetches the Connecticut planning regions and the two Alaska census areas as GeoJSON from the Census TIGERweb State_County service, projects them with the same Albers USA parameters, simplifies them with topojson-simplify to about the atlas's level of detail (minimum triangle weight 0.12 in projected units), removes the superseded shapes, rebuilds the topology with topojson-server at the same quantization, and writes it to `build/` and `docs/lib/`. It is idempotent: a topology that already contains 09110 is left alone. The result has 3,144 geometries (Kalawao included) and is 779 KB.

Areas. `scripts/build_areas.py` resolves the selection against three reference files it downloads into `build/`: the BLS LAUS area list (`la.area`), which gives the exact 15-character LAUS area code and the official title; the BLS CES area list (`sm.area`), which says whether industry series exist for the area; and the Census Bureau's CBSA delineation files (2023 vintage, with the 2020 vintage as a fallback for any area whose county codes are not in the map topology; after the patch no area needs the fallback). It writes `config/areas.json`: 393 areas with CBSA code, official name, short label, kind (metro or micro), LAUS area code, principal state, member states, CES flag, capital flags and member counties, plus the state list and the supersector codes. A CBSA not found in the BLS list stops the build with an error, so a retired or mistyped code can never reach the API. Requests to download.bls.gov carry a User-Agent that names the project and, when the optional `BLS_CONTACT_EMAIL` secret is set, a contact address.

Footprints. `scripts/build_geo.js` merges each area's counties from the patched topology into one outline with topojson-client, derives a map anchor from the central counties, records the county names, rounds coordinates to a tenth of a pixel, and writes `docs/lib/metros-albers.json` (219 KB for 393 areas). Because the state topology, the county topology and the footprints share one projection, nothing is projected at run time.

Workflow. The "Rebuild areas and fetch" workflow runs the four steps in order (patch, areas, footprints, fetch) and commits the result, for maintainers without a local toolchain. The npm packages it installs are not committed.

### 2.2 Pipeline (runs on BLS release days)

Calendar and schedule. `docs/data/release_dates.json` holds the BLS release dates for state and metro figures (eleven state and thirteen metro dates in 2026). `scripts/make_schedule.py` turns them into the cron lines of `.github/workflows/update-data.yml`, between two marker comments: on each release day, runs at 16:00 and 20:00 UTC (the release is at 10:00 Eastern), and one run at 16:00 UTC the following day. The calendar is refreshed each December from the BLS schedule pages and the script run again.

Gate. Every scheduled run first executes `scripts/check_release.py`, which compares the timestamp of the last successful refresh (`meta.json`, `updated_at`) with the most recent release that has already happened (release dates are taken as 15:00 UTC). The run proceeds only if the site is older than that release. This turns the schedule from "fire on a date" into "reconcile state": a second run on the same day is a no-op if the first succeeded, and the next-day run is a retry only if both failed. A manual dispatch bypasses the gate. A run that does nothing still updates a heartbeat file, `.last-run`, so that GitHub does not disable the schedule after sixty days without a commit.

Catalog. `scripts/fetch_bls.py` builds a catalog of 8,400 series from `areas.json`: 1,572 LAUS metro (four measures per area: rate, unemployed, employed, labor force), 204 LAUS state (the same four, seasonally adjusted), 5,031 CES metro employment (total nonfarm, the ten supersectors and the two parts of the combined mining, logging and construction sector), 663 CES state employment, 387 metro and 510 state average-hourly-earnings series (total private for metros; total private and the nine private supersectors for states), 13 national CES, 10 national earnings, 5 national CPS and CES headline series, and 5 CPI series (U.S. city average and the four census regions, all items, not seasonally adjusted). Every identifier is assembled from the codes in the BLS area lists, never typed.

Fetch. Series are requested from the BLS API v2 in batches of 50 (168 requests against the daily limit of 500 with a registration key), with three attempts per batch and a 0.5 s pause between batches, from ten years before the current year. Each series is tidied to monthly rows, oldest first; annual averages (period M13) are dropped, preliminary values are kept (BLS revises the latest month in the next release, and the next refresh picks up the revision), and non-numeric values (a dash for not disclosed or not available) are skipped.

Guards. The script refuses to write anything if fewer than 49 of the 51 state unemployment series came back, so a partial API outage cannot overwrite good data with empty data. Empty series are counted per program and reported in `meta.json` (1,194 of 8,400 on the refresh of 2026-10-02; most are industries not published for small metros and the separate mining and construction series for areas that publish only the combined one) and in the workflow log.

Sector combination. After bucketing, `combine_sector` fills the combined mining, logging and construction series for every area from whichever of the three series BLS publishes (section 1.3) and drops the parts, so every later step sees one sector list.

Derived measures. The script computes the section 1.3 measures: industry profiles for the latest CES month (states, metros, nation), the typology with its checks on twelve-month windows, earnings profiles with the regional CPI attached, and the national headline figures (CPS labor force, employment and unemployment in thousands; CES nonfarm jobs, both the not-seasonally-adjusted series that matches the industry profiles and the seasonally adjusted headline the masthead shows).

County step. The script then calls `county_data.build`, which downloads the LAUS county table (`laucntycur14.zip`, one workbook with every county for the latest fourteen months, not seasonally adjusted) and the newest QCEW quarterly file (`industry/10.csv` for the quarter, all ownerships, all industries), trying the most recent quarters in turn and skipping a file that is not yet a data file. For each county it keeps the name, state, CBSA (from `areas.json`), the latest rate with the previous and year-ago rates, labor force, unemployed and year-ago unemployed, and the QCEW weekly wage with its nominal and real change; it also keeps the QCEW figures for the nation, states and metros. Puerto Rico is excluded. If the step fails for any reason the previous `counties.json` is kept and the run still succeeds: the script writes a warning annotation to the run page, `meta.json` records `county_status` with the error, the run log records it, and the page's masthead states which month the county layer shows. The first run of the step on 2026-10-01 refreshed all 3,143 counties (LAUS August 2026, QCEW 2026Q1).

Outputs. Seven files in `docs/data/` (section 3). Level series other than the unemployment rate keep 13 months, because the page reads only their latest and year-ago values; the unemployment rate keeps the full ten years for the trend chart. Files are written without whitespace.

Run log. The workflow appends one line per run to `docs/data/run_log.csv`: UTC time, trigger (schedule or dispatch), outcome, data date, series requested, series empty, latest state month, latest metro month, county month, QCEW quarter, and county status (`refreshed`, or `kept previous file` with the error). When columns are added the step rewrites the header and leaves earlier rows blank in the new columns. The log is the primary record for evaluating the pipeline (section 6).

### 2.3 Page (static, drawn in the browser)

Files. `docs/index.html` (the three floating panels, the map container and the profile drawer), `docs/style.css` (design tokens and all styling) and `docs/app.js` (about 1,050 lines) with D3 v7 and topojson-client vendored in `docs/lib/`, so the page has no build step and no package manager.

Loading. On load the page fetches the seven data files and the three topologies (states, 80 KB; metro footprints, 219 KB; counties, 779 KB) in parallel; `counties.json` and the county topology are optional, and the page runs without the county layer if either is missing. Everything stays in memory; every interaction is a re-render from memory with no further requests. Fonts (Source Code Pro) come from Google Fonts with a monospace fallback.

State. A single object holds the lens, the selected level and id, the clicked county if any, and the rose view (chart or table). Deep links of the form `#metro=12420`, `#state=48` or `#nation=` open a profile directly and are updated as the reader moves, so any area's profile can be linked; a county is reached by opening its area and clicking it, since the county strip is a state of the profile rather than a profile of its own.

Map layers, bottom to top: state fills; the county layer (counties and a state mesh), shown in the Unemployment and Earnings lenses; the nation outline; state names; metro footprints (grey outlines in Industry, filled in Types); metro markers (Industry and Types); metro dots (Unemployment and Earnings when the county layer is absent). The state-name layer moves above the footprints in the Types lens so that filled footprints do not cover it, and switches to ink with a light halo whenever counties or footprints are filled.

Zoom. D3 zoom from 1x to 14x with buttons, wheel and drag; the map flies to a selected area's bounds. Marker and county strokes keep their width under zoom (`vector-effect: non-scaling-stroke`). Metro labels are placed greedily at each zoom level, largest areas first, and a label is dropped when it would overlap one already placed, so labels appear as the reader zooms in.

Search. One index over metros, capitals, states and counties, matched on name, short label and capital city; selecting a county switches to the Unemployment lens if the current lens has no county layer, then opens the profile with the county on top.

Hover. A dark card follows the pointer with the official name, the geography type, and the large figures of the current lens (section 5.2). Cards are plain HTML strings built with an escaping helper.

Profile. The drawer renders from the data in memory: a header with the release month, the geography type and the lens; the official name; a line that states the statistical unit and lists the counties; the capital line; for a state, chips for its metros; the county strip when a county was clicked; three tiles that follow the lens; the lens section (section 5.2); and a footnote on sources and adjustment.

Accessibility. Markers are focusable and open on Enter or Space; lens buttons carry `aria-pressed`; the drawer is a labeled `aside`; every chart has a table view or a hover readout; text is never set from data without escaping.

### 2.4 Hosting

GitHub Pages serves `docs/` on the default branch; `docs/CNAME` holds `workforce.usllab.org`, and a CNAME record at the registrar points the subdomain at GitHub Pages. A data refresh is a commit by the workflow, so the site is redeployed by the push; a merged pull request redeploys the page the same way. There is no database, no server-side code and no analytics script.

## 3. Data files and their schemas

All files are JSON objects keyed by FIPS (states) or CBSA (metros). Monthly rows are `{"date": "YYYY-MM", "value": number}`, oldest first.

| File | Size | Content |
|---|---|---|
| `meta.json` | <1 KB | `updated`, `updated_at` (UTC), `latest_state_month`, `latest_metro_month`, `latest_ces_month`, `latest_county_month`, `latest_qcew_quarter`, `county_status`, `construction_sector_source` (metros by how the combined sector was obtained), `source`, `series_requested`, `series_empty` |
| `national.json` | 27 KB | `unemp_rate`, `labor_force`, `employed`, `unemployed` (CPS, seasonally adjusted, thousands), `payrolls` (CES, not seasonally adjusted, thousands), `payrolls_sa` (CES headline), `industries` (the national profile rows) |
| `states.json` | 294 KB | per state: `name`, `series` with `unemp_rate` (ten years), `unemployed`, `employed`, `labor_force`, `payrolls` (13 months each) |
| `metros.json` | 2.3 MB | per metro: `name`, `short`, `kind`, `states`, `capital_of`, and `series` as for states (LAUS not seasonally adjusted) |
| `rose.json` | 436 KB | `month`; `states` and `metros`: profile rows `{code, industry, jobs (thousands), share, lq}` for the latest month; `typology`: `k`, `silhouette`, `silhouette_by_k`, `features`, `window_end`, `types` (id, name, lead sectors, n, center as LQ per sector), `metros` and `states` (assignments), `profiles` (twelve-month LQ per sector for metros and states), `diagnostics` (`k_rule`, `stability`, `complete_case`, `coverage`, `missing_sector_counts`) |
| `earnings.json` | 1.9 MB | `cpi` (U.S. and four regions, monthly index); `national`, `states`, `metros`: `region`, `total` (monthly average hourly earnings, total private), `industries` rows `{code, industry, ahe, month, yoy}` |
| `counties.json` | 464 KB | `month`, `quarter`; `counties`: per FIPS `n` (name), `st`, `cbsa` or null, `r` (rate), `m1`, `y1` (rate a month and a year earlier), `lf`, `un`, `uny`, `w` (weekly wage), `wy` (change, %), `real` (points); `qcew`: `nation`, `states`, `metros` with `w`, `wy`, `real` |
| `release_dates.json` | <1 KB | `state` and `metro` arrays of release dates |
| `run_log.csv` | grows | one row per workflow run (section 2.2) |

Geography files in `docs/lib/`: `states-albers-10m.json` (us-atlas, unchanged), `counties-albers-10m.json` (patched, section 2.1), `metros-albers.json` (`{cbsa: {a: [x, y], c: [county names], g: GeoJSON geometry}}`).

## 4. Problems and how they are solved

County resolution. LAUS county series exist in the API, but four measures for 3,143 counties would exceed the daily request limit on their own. The pipeline instead reads the program's monthly county table and the QCEW quarterly file, both published as downloads, and keeps the latest, the previous and the year-ago month per county. The county step is isolated: it cannot fail the refresh, and its failure is visible in four places (run page, `meta.json`, run log, masthead).

County geography. The LAUS county table uses the current county equivalents while the atlas used by the map did not, so Connecticut showed "no county data" and one metro (Waterbury-Shelton, CT) could not be drawn. Mapping new codes onto old shapes is not one-to-one, so the build fetches the new boundaries from the Census Bureau and rebuilds the topology (section 2.1). Footprints are rebuilt from the reference files, never edited by hand.

Series identifiers. BLS series codes are positional strings (for example `LAUMT063108000000003`) and an early version of the pipeline padded them wrongly, returning empty results silently. The fix was structural: codes are built from the area codes BLS itself publishes, the build refuses unknown codes, and empty series are counted per program on every run.

Scheduling and failure. A daily cron with a date gate ran every day and could miss a release if the single run failed (as happened on 18 September 2026). The current design runs only on release days, twice, with a next-day retry, and the gate reconciles against the site's own timestamp rather than the calendar, so any later run heals a missed one without manual action.

Geography drift. CBSA definitions change (2020 and 2023 vintages differ) and county equivalents change (Connecticut 2022, Alaska 2019). The build prefers the 2023 delineation, falls back per area to 2020 only when county codes are missing from the map, and patches the map for the known changes in county equivalents. A future change of either kind is handled by adding a swap to `patch_counties.js` or a delineation vintage to `build_areas.py` and running the rebuild workflow.

City versus MSA. Every profile header states the statistical unit and lists the counties; the hover card uses the official title with state suffix; the search index labels results by type. This is a presentation decision; a city and its metropolitan area are different things, and almost every published metro figure describes the area.

Comparability. Metro and county unemployment rates are not seasonally adjusted while state and national rates are; the page labels each and does not rank metros against states. All industry proportions, local and national, use not-seasonally-adjusted CES so the ratio is internally consistent. The county wage measure and the hourly-earnings measure describe different periods and populations, and the profile shows both with their sources.

Payload size. With 393 areas the raw export was 8.5 MB for metros alone. Keeping 13 months for level series cut it to 2.3 MB; the unemployment rate keeps its full history because it is drawn. The county file is kept small by storing only the fields the page reads.

Construction coding. The first release of the typology treated construction as missing for 269 of the 324 typed areas, and the complete-case check (55 areas, adjusted Rand index 0.10 against the main grouping) showed that the imputed values shaped the result. The cause was a coding gap, not a data gap: most metros publish the combined mining, logging and construction series rather than construction alone. The pipeline now requests both codings and builds one sector from whichever is published (section 1.3). On the first run with the new catalog, 336 of the 387 metros with industry series have the sector, the complete-case check covers 319 areas instead of 55, and its agreement with the main grouping rose from 0.10 to 0.855.

Clustering stability. k-means is sensitive to initialization and to the month of data. A fixed seed, k-means++ and eight restarts make the result deterministic for a given release; twelve-month features remove seasonal movement; naming types from centroids rather than from cluster indices keeps names meaningful when membership shifts; the number of types follows a rule applied unchanged to every release since the first (section 1.3). Stability across releases is measured, not assumed: each release records the adjusted Rand index against the groupings of the twelve previous windows (0.79 to 1.00 on the September 2026 window, with the same k throughout). The Types profile shows each area's distance to every type center, so a reader can see when an area sits near a boundary.

Map density. At 393 areas, markers and labels collide at the national scale. Marker size is a square-root scale of nonfarm jobs capped at 13 px; labels are placed greedily, largest areas first, and appear as the reader zooms; the Types lens uses the county footprint as the symbol, which removes the collision problem for that lens entirely; the Unemployment and Earnings lenses use counties as the symbol and need no markers at all.

Legibility over filled maps. State names in a light beige read well on the dark surround but not over filled counties. The names switch to ink with a light halo in the three filled lenses and are drawn above the metro footprints in the Types lens. Metro labels sit in a layer above every marker, so a large neighbor's marker cannot cover a smaller area's name.

## 5. Presentation

### 5.1 Layout

The map is the page. Three floating panels sit over it: the masthead (title, month of the latest data, two national figures with their monthly and annual change, data-pulled date and next release date, and a notice if the county layer is older than the rest), the controls (four lens buttons and a search box) and the legend, which changes with the lens. Zoom controls sit bottom right. Clicking any area slides out a profile panel on the right whose content depends on the lens. The country is the subject: a near-black surround, light land, and panels in translucent paper.

### 5.2 Lenses and encodings

Industry. One marker per area, area proportional to nonfarm jobs; a diamond where the area holds a state capital; a hollow ring where BLS publishes unemployment but no industry series; the county footprint in grey beneath. Profile tiles: nonfarm jobs, their change over the year (percent and jobs), and the private-sector percentage of jobs with the government percentage beneath. Then the rose: ten petals in a fixed order, area = percentage of jobs (square-root scale to 30%), color = LQ on a one-sided scale from grey at or below the U.S. percentage to pink at twice the U.S. percentage or more, a black outline at the national percentage for each petal, labels with percentage and ratio, and the specialty's label in pink; a table view; cards for the largest sector and the specialty with a two-bar comparison against the U.S. Petals that fall inside the national outline show under-representation, so color marks only concentration.

Unemployment. Every county shaded by its own rate on a yellow-green sequential ramp, lemon through watermelon to olive, with lightness falling at every step. The hue stays between 107 and 133 degrees (CIE LCH), apart from the mint of the Earnings ramp at 152 to 156, so the two county maps do not share a color. The ramp covers the 2nd to 98th percentile of county rates so that a few extreme values do not set the range; state borders drawn over the counties. Profile, unemployment figures only, with every change printed in plain ink and no color for better or worse: the rate with monthly and annual change, the number unemployed with the same changes, the U.S. rate for comparison (for the nation, the twelve-month range instead); the ten-year trend against the nation with a crosshair readout; a "where it stands" card (rank among the 393 metros or 51 states on a strip in the same ramp, distance from the U.S. rate, the year-ago rate and the twelve-month range); for a metro the rates of its member counties, for a state its metros ranked by rate and its counties outside metros; when a county was clicked, its figures in a strip at the top.

Earnings. Every county shaded by real wage growth (QCEW) on a lavender-white-mint diverging scale over ±3 points, lavender for wages trailing prices, near-white at zero and mint green for wages ahead. Profile: hourly earnings, regional price change and real growth (CES); the QCEW weekly wage with its nominal and real change; for states and the nation, a burst of earnings by industry (spoke length = hourly earnings, tip color = that industry's real change on the same scale, a ring at the area's private average, a tick at the U.S. average for the industry); an index chart of earnings against regional prices since 2016. The burst legend shows the two end colors of this scale. Metros have no industry earnings series, so the burst does not appear for them and the page says why.

Types. A choropleth: each metro's county footprint filled with its type color (a fixed categorical order of at most eight colors from the site palette, salmon, brown-green, ochre, pink, sage, peach, wine and lavender), untyped areas grey, states unfilled because only metropolitan areas are clustered; a state's nearest type appears in its profile, labeled as nearest, not as membership. Profile: the type card (name, membership count, the sectors that define the type with the type's mean LQ beside the area's own twelve-month LQ); the distance from the area to every type center in log-LQ space, nearest first, so a reader can see whether the area sits near a boundary; for a metro, the other members of its type, largest first; for a state, its metros with the type of each; for the nation, the list of types with their defining sectors. The legend and the profile state k, the mean silhouette with a note when it is below 0.25, the window, and the stability against the previous windows. The industry rose is not repeated here; it belongs to the Industry lens.

Hover. A dark card with the official name and the large figures of the current lens: nonfarm jobs, largest sector and specialty in the Industry and Types lenses (with a type pill in Types); the rate, its change over the year and the month, and the number unemployed in the Unemployment lens; hourly-earnings growth, real growth and the weekly wage in the Earnings lens. A county's card shows its own figure and names its metropolitan area.

### 5.3 Palette

The page uses one palette so that the four lenses read as one piece. Surfaces: surround #1f1e1e, land #fbfaf6, paper #fcfcfb, ink #0b0b0b. Markers: #d6ce76 with edge #b3aa66. Rose: neutral #b5b3ab to pink #d4417f. Change figures for jobs and pay: teal #0F7C72 for a rise and orange-red #C2441C for a fall, #5FD1C4 and #F58A63 on dark backgrounds, all at 4.5:1 contrast or more. Changes in the unemployment rate are printed in ink. Unemployment ramp: #F3F6C8, #E0EC8F, #B8D96B, #86C05A, #5A9C47, #4C7A33, #45592A. Earnings ramp: #9686C2, #C9C0E0, #F6F5F1, #ABD9B9, #4FA376. Type colors, in order: #F28C74, #6B6A33, #D4B85A, #EF99B7, #A7B48A, #F7C3AE, #a92a60, #9686C2. Both ramps were checked in CIELAB. The unemployment ramp falls from 96 to 35 in lightness at a hue between 107 and 133 degrees (CIE LCH). The earnings poles sit at 59 (lavender) and 61 (mint) in lightness around a near-white center at 97. The hue ranges of the two county ramps do not overlap, so a county color means one thing on either map.

### 5.4 Design rules

One typeface (Source Code Pro) so figures align; black text on light panels; a dark surround so the country is the subject; every color scale has an on-screen legend; a color is never the only carrier of a value (the number is always present in the profile or the hover); charts have a table or a hover readout; text is set with an escaping helper. Marks follow fixed specs: 2 px lines, hairline grids, a 2 px surface gap between adjacent fills, white county strokes at 0.35 px that stay constant under zoom.

### 5.5 Rules for shared ground

Four rules, drawn from the data-storytelling practice described by Chapple and colleagues at the School of Cities, shape how the page speaks.

Credentials on every view. The what, who, when and how of each figure travel with it: the hover card and every tile name the figure, its geography, its month and its program; the legend names the adjustment; the footnote of each profile names the source and its limits. A cropped screenshot of any part of the page still identifies its data.

Assets before deficits. The first lens is the industry mix, and the profile opens with how many jobs a place has, its largest sector and its specialty, before any measure of what it lacks. Types group places by the shape of their economy and are not ranked. Where a measure has two directions, both are drawn on the same scale with the neutral point visible (pay ahead of or behind prices; a rate above or below the nation), so no place is shown only as a shortfall. Changes in the unemployment rate are printed in plain ink: a falling rate is not colored as good news, because the page cannot know whether it means more jobs or fewer people looking.

Precision that the data supports. Rates to one decimal, ratios to two, no more. The weak separation of the industry types is stated beside them in the legend and the profile, with the silhouette value; the crisp type colors do not get to imply otherwise.

Trends without forecasts. The ten-year trend and the earnings-vs-prices index show what happened; the page projects nothing and draws no trend line into the future, so a reader is left with the record and their own judgment.

## 6. Evaluation hooks

The system records what is needed to evaluate it without instrumenting users.

Pipeline latency and reliability: `run_log.csv` gives, per run, the trigger, the outcome and the months covered; the delay from a release (known from the calendar) to a successful refresh is derivable from the run time, and the number of retries from the count of runs per release day. The git history of `docs/data/` is a second, independent record of every data change.

Data coverage: `meta.json` reports series requested and series empty per run; the per-program breakdown is printed in the workflow log. Coverage by level (nation, state, metro, county) and by program can be tabulated from `rose.json`, `earnings.json` and `counties.json` directly.

Typology: `rose.json` carries the silhouette for each k, the stability series, the complete-case comparison and the coverage counts described in section 1.3, so the robustness of the types can be reported for any release from the published file alone, and the twelve-month features themselves are stored so that an alternative clustering can be run on the same inputs.

Correctness: every number on the page is traceable to a named BLS series and month, or to a row of a named BLS table, so a spot check is a direct comparison with the source for the same identifier. The pipeline validates identifiers against the BLS area lists before any request.

User tasks: the page supports task-based testing against BLS's own "Economy at a Glance" pages because the same questions (current rate, change, industry mix, pay) can be answered on both; deep links allow a fixed starting state per task.

## 7. Embedding and reuse

Data. All inputs are public: the BLS public API (registration key, 500 requests per day), the BLS reference files and county tables on download.bls.gov, www.bls.gov and data.bls.gov (requested with a User-Agent that names the project, and a contact address when the optional `BLS_CONTACT_EMAIL` secret is set), the Census CBSA delineation files, the Census TIGERweb boundary service, and the us-atlas topologies (CDN). No data is scraped from HTML.

Infrastructure. GitHub Actions runs the pipeline on a free tier; GitHub Pages serves the site; a CNAME record points `workforce.usllab.org` at it. There is no database and no server-side code, so a copy can be run by forking the repository and adding one secret.

Reuse. The area list is a configuration file; a user can restrict the map to one state's metros or extend it by editing it and running the rebuild workflow. The typology module is independent of the rest and can be run on any set of LQ profiles. The page reads the documented schema of section 3, so another front end can consume the same files, and the data files can be read directly by anyone who wants the figures without the page.

Ethics. Every figure is an aggregate published by BLS under its own disclosure rules; the page handles no record about any person or employer and cannot be used to identify one. The page collects nothing about its readers. It has no analytics and no accounts, and no request leaves the browser except for the page's own files and its fonts. Every number is auditable to a named series or table and a month (section 6), the code is open, and every data refresh is a commit, so a figure quoted from the page can be checked by anyone against the source and against the page as it stood on that day.

Presentation elsewhere. The Urban Spatial Lab site links to the dashboard as a project page with screenshots and two diagrams (`press/`); the dashboard is not embedded in an iframe because it is a full-viewport application. Deep links let a project page or an article open the map at a specific area and lens.

## 8. Limitations

Metro and county unemployment rates are not seasonally adjusted, and county rates are model-based estimates that are less precise for small counties; the county color scale runs from the 2nd to the 98th percentile so that a few extreme values do not set the range. County wages are quarterly and lag the monthly figures by about five months, so the county map of the Earnings lens and the hourly-earnings tiles describe different periods, which the page labels. The average weekly wage reflects the mix of jobs as well as pay. Metro hourly earnings are published for total private only, so the earnings-by-industry chart exists for states and the nation. CPI is regional, not metropolitan. CES supersectors are coarse (ten sectors), which bounds what the typology can distinguish. The typology depends on its settings (feature definition, twelve-month window, k range, silhouette criterion), its separation is weak (mean silhouette about 0.2), and areas with fewer than eight published sectors, mostly small metros, are not typed. Mining and logging cannot be separated from construction at the metro level, so the first sector mixes an extractive industry with a building one; in a few areas (Midland and Odessa, TX, for example) the sector is mostly mining. Kalawao County, HI has a shape but no LAUS estimate and is drawn grey. The operating record is short: the pipeline in its current form has run since October 2026.

## 9. Maintenance

Each December: copy the next year's state and metro release dates from the BLS schedule pages into `docs/data/release_dates.json` and run `python scripts/make_schedule.py`; commit the workflow file it rewrites.

When OMB issues new delineations or a state changes its county equivalents: add the delineation vintage to `build_areas.py` or a swap to `patch_counties.js`, run the "Rebuild areas and fetch" workflow, and check the run's log for areas it could not draw.

When a scheduled run fails: the next scheduled run retries on its own. A failure that persists shows on the Actions page; the fetch step's log names the program and the batch. A county failure does not fail the run; it shows as a warning annotation and in `meta.json`.

Secrets: `BLS_API_KEY` (required; free registration) and `BLS_CONTACT_EMAIL` (optional; sent in the User-Agent of download requests).

Request budget: a registered key allows 500 requests a day and a refresh uses 168, so a key supports two refreshes a day with room for the scheduled retry, and a third manual run on the same day fails partway with the API's daily-threshold message (the fetch stops at once and says so; the previous data files are kept). The runs of 2026-10-02 at 03:56 and 05:28 UTC failed this way after three refreshes on 2026-10-01; the second shows that the allowance had not been restored by 01:28 Eastern, so the day the API counts is not the Eastern calendar day; a run at 23:37 UTC the same day succeeded. A run that hits the limit should be repeated the following day.

After merging a change to the page: nothing to do; GitHub Pages redeploys on push. After merging a change to the pipeline: run "Update BLS data" by hand once so the data files reflect the new code before the next release day.

## 10. Reproducibility

Clone the repository; set the `BLS_API_KEY` secret; run the "Update BLS data" workflow once. To rebuild geography locally: `pip install requests openpyxl xlrd`, `npm install --no-save topojson-server topojson-simplify`, `node scripts/patch_counties.js`, `python scripts/build_areas.py`, `node scripts/build_geo.js`. To refresh data locally: `BLS_API_KEY=... python scripts/fetch_bls.py` (set `COUNTY_CACHE` to a directory to reuse downloaded county files). To regenerate the schedule after editing the release calendar: `python scripts/make_schedule.py`. To run the typology on the stored twelve-month features: `python -c "import json, sys; sys.path.insert(0, 'scripts'); from typology import build_typology; p = json.load(open('docs/data/rose.json'))['typology']['profiles']['metros']; print(build_typology({c: [{'code': k, 'lq': v} for k, v in d.items()] for c, d in p.items()})['types'])"`. To work on the page without data: `python scripts/make_sample_data.py` and serve `docs/` with any static server. Every data refresh is a commit, so any past state of the site can be checked out by date.

## References

Chapple, K. and Zhang, M. Urban Data Storytelling: Data literacy; Creating shared ground through data storytelling; Data ethics and equity; Communicating data in presentations. School of Cities, University of Toronto. https://schoolofcities.github.io/urban-data-storytelling/.

Hubert, L. and Arabie, P. (1985). Comparing partitions. Journal of Classification, 2(1), 193–218.

Rousseeuw, P. J. (1987). Silhouettes: a graphical aid to the interpretation and validation of cluster analysis. Journal of Computational and Applied Mathematics, 20, 53–65.

U.S. Bureau of Labor Statistics. Local Area Unemployment Statistics; Current Employment Statistics; Quarterly Census of Employment and Wages; Current Population Survey; Consumer Price Index. https://www.bls.gov.

U.S. Census Bureau. Core-based statistical area delineation files, 2020 and 2023 vintages; TIGERweb State_County service.
