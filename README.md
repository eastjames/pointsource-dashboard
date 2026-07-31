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
| `site_id` | Unique, stable identifier for the point source - the join key with `portaldata_plumes.csv` |
| `IMEO_source_ID` | IMEO catalogue identifier for the site, where known (shown above the chart) |
| `year` | Calendar year the average covers |
| `lat` / `lon` | Decimal degrees |
| `Qs` | Annual average emission rate for that site/year. Blank means no average was computed for that year. Documented units are unclear in the source data; treated as `kg CH4/hour` (same unit as `ch4_fluxrate` below) because the magnitudes line up for matching site/year - see the comment at the top of `dataLoader.js` if that assumption needs correcting. |
| `Qslower` / `Qsupper` | Asymmetric lower/upper bound for `Qs`, plotted as an error bar |

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
| `source_type` | Facility type (e.g. "Compressor station", "Well pad") - used to color-code map markers |

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
public/
  data/portaldata_sources.csv    Per-site annual average emission rates
  data/portaldata_plumes.csv     Per-observation ("plume") emission rates
```

## Design notes

- **Map:** [Leaflet](https://leafletjs.com/) with CARTO's "Positron" tile
  set - a light basemap with simple country borders and place labels but no
  street/terrain clutter, matching the "simple geographic and geopolitical
  borders" requirement without bundling a separate borders dataset.
- **Markers:** color-coded by `facility_type` via an explicit, hardcoded
  mapping (`FACILITY_TYPE_COLORS` in `mapView.js`), so a given type always
  renders the same color everywhere rather than depending on data load
  order. The real dataset has ~24 distinct `source_type` values but only 8
  colorblind-safe hues can stay reliably distinguishable on a scatter-style
  map; the 8 most common facility types get their own color (chosen by
  inspecting site counts per type), and everything else - including sites
  with no recorded type - shares a neutral gray. Update
  `FACILITY_TYPE_COLORS` directly if the dataset's most common types change.
- **Chart:** [Plotly.js](https://plotly.com/javascript/) (the "basic" dist
  bundle - scatter/bar/pie traces only, to keep the bundle small), rendered
  on click. Individual plume observations are one marker-only trace per
  instrument (`satellite`), color- and shape-coded and drawn first so they
  sit behind the annual average, which is a single bold black
  lines+markers trace centered on July 2 of each year (the approximate
  midpoint of a calendar year). The x-axis is a real date scale fixed to
  Jan 1, 2022 - Dec 31, 2025 for every source, so sites are visually
  comparable. Instrument color/shape assignments live in
  `INSTRUMENT_STYLES` in `chartView.js` - six fixed hues plus a distinct
  marker symbol per instrument, since a plain 6-color legend can't clear
  the palette's colorblind-safe threshold for a scatter plot (where any two
  markers can end up adjacent) the way it can for a bar chart or line chart;
  the marker shape is the accessible backup channel.
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
