# Methane Point Source Dashboard

An interactive dashboard showing global oil & gas point sources on a world
map. Clicking a point source opens a panel with its metadata and a plot of
individual satellite observations plus the annual average emission rate
over time.

## Getting started

```bash
npm install
npm run dev       # starts a local dev server (with hot reload) at http://localhost:5173/pointsource-dashboard/
```

Other commands:

```bash
npm run build      # builds an optimized, static production bundle into dist/
npm run preview    # serves the dist/ build locally, to sanity-check it before deploying
```

Because the map data is loaded via `fetch()`, the app must be served over
HTTP (via `npm run dev` or a real web server) - opening `index.html` directly
as a `file://` URL will not work.

## Deployment (GitHub Pages)

This is set up as its own, independent GitHub Pages **project site** - it
lives in its own repo and gets its own URL
(`https://<your-username>.github.io/pointsource-dashboard/`), so it can sit
alongside an existing `<your-username>.github.io` site without touching it.
`.github/workflows/deploy.yml` builds and publishes it automatically on
every push to `main`.

**One-time setup:**

1. Create a new, empty repo on GitHub named `pointsource-dashboard` (via the
   web UI, or `gh repo create pointsource-dashboard --public --source=. --remote=origin`).
2. From this directory:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/pointsource-dashboard.git
   git push -u origin main
   ```
3. On GitHub: repo **Settings -> Pages -> Build and deployment -> Source ->
   "GitHub Actions"**. The push in step 2 will already have triggered the
   workflow under the **Actions** tab - once it finishes (~1 minute), the
   site is live at `https://<your-username>.github.io/pointsource-dashboard/`.
4. Add a link to that URL from your existing site - the two are unrelated
   repos, so this is the only change needed there.

**If you ever rename the repo**, update `base` in `vite.config.js` to match
(it must equal `/<repo-name>/`) and push again.

**After the first deploy**, every future `git push` to `main` re-builds and
re-publishes automatically - no need to repeat steps 3-4.

## The dataset

The app loads and joins two CSVs from [`public/data/`](public/data/), on
`site_id`:

**`portaldata_sources.csv`** - one row per `(site, year)`: the site's
location plus its annual average emission rate.

| Column | Meaning |
|---|---|
| `site_id` | Unique, stable identifier for the point source - the join key with `portaldata_plumes.csv`. Used only internally for matching; never shown in the UI. |
| `IMEO_source_ID` | IMEO catalogue identifier for the site, where known (shown above the chart) |
| `year` | Calendar year the average covers |
| `lat` / `lon` | Decimal degrees |
| `Qs` | Annual average emission rate for that site/year. Blank means no average was computed for that year. Documented units are unclear in the source data; treated as `kg CH4/hour` (same unit as `ch4_fluxrate` below) because the magnitudes line up for matching site/year - see the comment at the top of `dataLoader.js` if that assumption needs correcting. |
| `Qslower` / `Qsupper` | Asymmetric lower/upper bound for `Qs`, plotted as an error bar |
| `country` | Shown as part of the detail panel heading and map tooltip (`<country> <facility type>`) |

**`portaldata_plumes.csv`** - one row per individual satellite observation
("plume") of a site.

| Column | Meaning |
|---|---|
| `site_id` | Join key, see above |
| `IMEO_name` | Same identifier as `IMEO_source_ID` above, just named differently in this file |
| `satellite` | Instrument that made the observation (e.g. `EMIT`, `S2`) - each gets its own color/shape/legend entry on the chart |
| `tile_date` | Observation timestamp, ISO 8601 (e.g. `2022-08-10 06:51:32+00:00`) |
| `ch4_fluxrate` | Emission rate for this single observation, in kg/hour |
| `ch4_fluxrate_std` | Standard deviation of `ch4_fluxrate` - a symmetric uncertainty, plotted as an error bar |
| `source_type` | Facility type (e.g. "Compressor station", "Well pad") - shown in the detail panel heading and map tooltip |

A site with no annual averages at all still plots (just without the black
"Annual average" trace); a plume row with a blank `satellite` or unparseable
`tile_date` is dropped with a `console.warn` rather than crashing the app.
If either file's column headers change, update `SOURCE_COLUMNS` /
`PLUME_COLUMNS` at the top of
[`src/modules/dataLoader.js`](src/modules/dataLoader.js).

## Project structure

```
index.html                       Page shell + Content-Security-Policy 
src/
  main.js                        Entry point: wires map, data, and detail panel together
  style.css                      Layout and theme (light/dark) for the dashboard shell
  modules/
    dataLoader.js                Fetches + parses the CSV into per-source time series
    mapView.js                   Leaflet map setup, markers, tooltips
    chartView.js                 Detail panel + Plotly time series rendering
    format.js                    Shared text formatting (coordinates, "<country> <facility type>")
public/
  data/portaldata_sources.csv    Per-site annual average emission rates
  data/portaldata_plumes.csv     Per-observation ("plume") emission rates
```

## Design notes

- **Map:** [Leaflet](https://leafletjs.com/) with CARTO's "Positron" tile
  set - a light basemap with simple country borders and place labels but no
  street/terrain clutter, matching the "simple geographic and geopolitical
  borders" requirement without bundling a separate borders dataset.
- **Markers:** color-coded by number of years of annual-average data the
  site has (1-4, since the fixed window is 2022-2025) via an explicit,
  hardcoded ordinal ramp (`YEARS_OF_DATA_COLORS` in `mapView.js`) - a single
  hue stepped light-to-dark, since "more years of data" is a magnitude, not
  a set of unrelated categories. Hovering a marker shows
  `<country> <facility type> (<coordinates>, 6 decimal places)`; clicking
  opens the detail panel. Markers are also *stacked* by years-of-data -
  4-year sources drawn on top, then 3, then 2, then 1-year sources at the
  bottom - so a densely-overlapping cluster still shows its
  most-data-rich sites. This is re-established every time a filter changes
  (see `updateVisibility()` in `setUpFilters` in `mapView.js`), since
  re-adding a previously-hidden marker would otherwise put it above
  everything else regardless of its years-of-data.
- **Map controls:** four floating Leaflet controls, all pinned to the left
  side of the map (so the right-side detail panel can never cover them) -
  a legend for the years-of-data color ramp (bottom-left), and three dropdown
  filters stacked top-left, in this order:
  - **Facility type** (`createCheckboxDropdownControl` in `mapView.js`):
    one checkbox per distinct `source_type` value, all checked by default,
    OR-combined (any checked type passes), plus a "Select all" master
    checkbox kept in sync with the individual checkboxes in both
    directions.
  - **Years** (`createExactMatchDropdownControl`): defaults to an "All
    data" mode that shows every source regardless of its years. Turning
    "All data" off enables one checkbox per year in the fixed 2022-2025
    window (`AVAILABLE_YEARS`) and switches to an **exact-match** rule: a
    source is shown only if the *exact set* of years it has data for
    equals the checked set, not merely overlaps it (checking 2022+2024
    hides a source with 2022+2023+2024 data, since 2023 isn't part of the
    selection). The individual checkboxes are disabled while "All data" is
    on, since checking every option individually means something
    different (only sources with data in *every* year) than "All data"
    does.
  - **Instruments** (`createSubsetMatchDropdownControl`): one checkbox per
    distinct `satellite` value found in the data, all unchecked by
    default (an empty selection imposes no constraint, so every source
    passes). Checking an option requires sources to have data from *that*
    instrument; checking several combines them with **AND** - a source
    passes once it has data from every checked instrument, regardless of
    which other, unchecked instruments it also has (checking EMIT+S2 shows
    any source seen by both, including one also seen by Landsat). Unlike
    Years, there's no "All data" bypass here, since the unchecked state
    already means "no constraint."

  A marker is shown only when it passes *all three* dropdowns at once
  (facility type AND years AND instruments); all four controls are added
  in `addPointSources` in `mapView.js`.
- **Chart:** [Plotly.js](https://plotly.com/javascript/) (the "basic" dist
  bundle - scatter/bar/pie traces only, to keep the bundle small), rendered
  on click. Individual plume observations are one marker-only trace per
  instrument (`satellite`), color- and shape-coded and drawn first so they
  sit behind the annual average, which is a single bold black
  lines+markers trace centered on July 2 of each year (the approximate
  midpoint of a calendar year). The x-axis is a real date scale fixed to
  Jan 1, 2022 - Dec 31, 2025 for every source (so sites are visually
  comparable), with one tick per calendar year at Jan 1 but the "2022" /
  "2023" / etc. label centered *between* ticks (`ticklabelmode: 'period'`)
  rather than pinned to the tick line. Instrument color/shape assignments
  live in `INSTRUMENT_STYLES` in `chartView.js` - six fixed hues plus a
  distinct marker symbol per instrument, since a plain 6-color legend can't
  clear the palette's colorblind-safe threshold for a scatter plot (where
  any two markers can end up adjacent) the way it can for a bar chart or
  line chart; the marker shape is the accessible backup channel.
- **CSV parsing:** [PapaParse](https://www.papaparse.com/).

## Security notes

This is a static, fully client-side app - no server, database, or user
accounts - so most of the usual web-app attack surface doesn't apply. What's
still worth keeping in mind if you extend it:

- **No CDNs at runtime.** All JS dependencies are installed via npm and
  bundled by Vite, rather than loaded from third-party CDNs, so the app
  doesn't depend on an external script host being trustworthy/available.
  (Map tile *images* still come from CARTO's CDN - that's unavoidable for a
  slippy map - but images can't execute script.)
- **Content-Security-Policy** (see the `<meta http-equiv="Content-Security-Policy">`
  tag in `index.html`) restricts the page to loading its own bundled
  scripts/styles plus map tiles from CARTO, and blocks inline `<script>`
  tags and `eval`.
- **No `innerHTML` with untrusted data.** Every value that comes from the
  CSVs (site ID, facility type, IMEO ID, etc.) is written into the page via
  `textContent` or as a plain DOM node's text, never concatenated into an
  HTML string - so a maliciously crafted data file can't inject markup or
  script into the dashboard.
- **Defensive CSV parsing.** `dataLoader.js` validates coordinates and
  numeric fields and skips bad rows (with a logged warning) instead of
  letting malformed data crash the app or silently propagate as `NaN`.

If you later add a backend (e.g. to serve a much larger dataset from a
database instead of a static CSV), revisit the CSP's `connect-src` and add
server-side input validation - the above only covers the current
static-file architecture.
