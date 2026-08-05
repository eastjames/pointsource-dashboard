// ---------------------------------------------------------------------------
// dataLoader.js
//
// Loads and joins two CSVs on `site_id` into one record per point source:
//
//   portaldata_sources.csv - one row per (site, year): the site's location
//     and country, plus its annual average emission rate for that year
//     (Qs), with asymmetric uncertainty bounds (Qslower/Qsupper). A blank
//     Qs means no annual average was computed for that site/year.
//   portaldata_plumes.csv  - one row per individual satellite observation
//     ("plume") of a site: a timestamped emission rate (ch4_fluxrate, in
//     kg/hour) with a symmetric standard-deviation uncertainty
//     (ch4_fluxrate_std), which instrument observed it (satellite), and the
//     site's facility type (source_type).
//
// The two files name the site's IMEO catalogue identifier differently
// (`IMEO_source_ID` in the sources file, `IMEO_name` in the plumes file) and
// don't always both have it filled in for a given site - wherever either
// file has a non-blank value, that value is used (spot-checked that the two
// never disagree for the same site_id).
//
// Units: ch4_fluxrate is documented as kg/hour. Qs (the annual average) has
// no explicit unit in the source data, but its magnitudes line up with
// ch4_fluxrate for the same site/year, so it is treated as the same
// kg CH4/hour quantity aggregated to an annual mean - if that assumption
// turns out to be wrong, update EMISSION_UNITS below.
// ---------------------------------------------------------------------------

import Papa from 'papaparse';

const SOURCES_CSV_URL = `${import.meta.env.BASE_URL}data/portaldata_sources.csv`;
const PLUMES_CSV_URL = `${import.meta.env.BASE_URL}data/portaldata_plumes.csv`;

export const EMISSION_UNITS = 'kg CH4/hour';

const SOURCE_COLUMNS = {
  id: 'site_id',
  imeoName: 'IMEO_source_ID',
  year: 'year',
  lat: 'lat',
  lon: 'lon',
  value: 'Qs',
  low: 'Qslower',
  high: 'Qsupper',
  country: 'country',
};

const PLUME_COLUMNS = {
  id: 'site_id',
  imeoName: 'IMEO_name',
  date: 'tile_date',
  value: 'ch4_fluxrate',
  std: 'ch4_fluxrate_std',
  instrument: 'satellite',
  facilityType: 'source_type',
};

/**
 * Load and join both CSVs.
 * @returns {Promise<Map<string, object>>} Map of site_id -> {
 *   id, facilityType, imeoName, country, lat, lon,
 *   annual: [{ year: number, date: string, value: number, low: number, high: number }],
 *   plumes: [{ date: string, value: number, std: number, instrument: string }],
 * }
 */
export async function loadPointSourceData() {
  const [sourceRows, plumeRows] = await Promise.all([fetchCsv(SOURCES_CSV_URL), fetchCsv(PLUMES_CSV_URL)]);

  const sites = new Map();

  for (const row of sourceRows) {
    const record = normalizeSourceRow(row);
    if (!record) continue; // invalid row - already logged in normalizeSourceRow

    const site = getOrCreateSite(sites, record.id);
    site.lat = record.lat;
    site.lon = record.lon;
    if (record.imeoName) site.imeoName = record.imeoName;
    if (record.country) site.country = record.country;
    if (record.annualPoint) site.annual.push(record.annualPoint);
  }

  for (const row of plumeRows) {
    const record = normalizePlumeRow(row);
    if (!record) continue; // invalid row - already logged in normalizePlumeRow

    const site = getOrCreateSite(sites, record.id);
    if (record.facilityType) site.facilityType = record.facilityType;
    if (record.imeoName) site.imeoName = record.imeoName;
    site.plumes.push(record.plumePoint);
  }

  // A site needs coordinates (only present in portaldata_sources.csv) to be
  // placed on the map - drop anything that never appeared there.
  for (const site of [...sites.values()]) {
    if (site.lat == null || site.lon == null) {
      console.warn(`Dropping site "${site.id}" - no coordinates found in portaldata_sources.csv`);
      sites.delete(site.id);
    }
  }

  for (const site of sites.values()) {
    site.annual.sort((a, b) => a.year - b.year);
    site.plumes.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  return sites;
}

function getOrCreateSite(sites, id) {
  let site = sites.get(id);
  if (!site) {
    site = {
      id, // used only to join the two CSVs and as the internal map key - never shown in the UI
      facilityType: 'Unknown',
      imeoName: null,
      country: '',
      lat: null,
      lon: null,
      annual: [],
      plumes: [],
    };
    sites.set(id, site);
  }
  return site;
}

/** Validate + coerce one portaldata_sources.csv row. Returns null (and logs) if unusable. */
function normalizeSourceRow(row) {
  const id = (row[SOURCE_COLUMNS.id] ?? '').trim();
  const year = Number(row[SOURCE_COLUMNS.year]);
  const lat = Number(row[SOURCE_COLUMNS.lat]);
  const lon = Number(row[SOURCE_COLUMNS.lon]);

  if (!id || !Number.isFinite(year)) {
    console.warn('Skipping sources row with missing site_id/year:', row);
    return null;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    console.warn(`Skipping sources row with invalid coordinates for site "${id}":`, row);
    return null;
  }

  const imeoName = (row[SOURCE_COLUMNS.imeoName] ?? '').trim() || null;
  const country = (row[SOURCE_COLUMNS.country] ?? '').trim() || null;
  const annualPoint = parseAnnualPoint(row, id, year);

  return { id, lat, lon, imeoName, country, annualPoint };
}

/**
 * Parse the annual-average value + bounds for one sources row. Returns null
 * if Qs is blank (no average computed for this site/year - expected, not a
 * warning) or if the numbers present are inconsistent/non-numeric.
 */
function parseAnnualPoint(row, id, year) {
  const rawValue = (row[SOURCE_COLUMNS.value] ?? '').trim();
  if (!rawValue) return null;

  const value = Number(rawValue);
  const low = Number(row[SOURCE_COLUMNS.low]);
  const high = Number(row[SOURCE_COLUMNS.high]);

  if (!Number.isFinite(value) || !Number.isFinite(low) || !Number.isFinite(high)) {
    console.warn(`Skipping annual average with non-numeric Qs/Qslower/Qsupper for site "${id}", year ${year}:`, row);
    return null;
  }
  if (low > value || high < value) {
    console.warn(`Skipping annual average with inconsistent Qslower/Qsupper for site "${id}", year ${year}:`, row);
    return null;
  }

  return { year, date: midYearDate(year), value, low, high };
}

/** Approximate midpoint of a calendar year (day ~183/184) - close enough for a "centered on the year" x-position. */
function midYearDate(year) {
  return `${year}-07-02`;
}

/** Validate + coerce one portaldata_plumes.csv row. Returns null (and logs) if unusable. */
function normalizePlumeRow(row) {
  const id = (row[PLUME_COLUMNS.id] ?? '').trim();
  const rawDate = (row[PLUME_COLUMNS.date] ?? '').trim();
  const value = Number(row[PLUME_COLUMNS.value]);
  const std = Number(row[PLUME_COLUMNS.std]);
  const instrument = (row[PLUME_COLUMNS.instrument] ?? '').trim();

  if (!id || !rawDate) {
    console.warn('Skipping plumes row with missing site_id/tile_date:', row);
    return null;
  }
  const date = toIsoDate(rawDate);
  if (!date) {
    console.warn(`Skipping plumes row with unparseable tile_date for site "${id}":`, rawDate);
    return null;
  }
  if (!Number.isFinite(value) || !Number.isFinite(std)) {
    console.warn(`Skipping plumes row with non-numeric ch4_fluxrate/ch4_fluxrate_std for site "${id}":`, row);
    return null;
  }
  if (!instrument) {
    console.warn(`Skipping plumes row with missing instrument (satellite) for site "${id}":`, row);
    return null;
  }

  return {
    id,
    imeoName: (row[PLUME_COLUMNS.imeoName] ?? '').trim() || null,
    facilityType: (row[PLUME_COLUMNS.facilityType] ?? '').trim() || null,
    plumePoint: { date, value, std, instrument },
  };
}

/** tile_date is ISO8601 (e.g. "2022-08-10 06:51:32+00:00") - normalize to a strict ISO string Plotly's date axis can parse. */
function toIsoDate(rawDate) {
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Fetch a CSV file and parse it with headers. Throws if the file can't be fetched. */
async function fetchCsv(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  }
  const csvText = await response.text();

  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    // We validate and convert types ourselves (see the normalize*Row functions)
    // so a bad value is dropped with a clear warning rather than silently
    // becoming NaN partway through the app.
    dynamicTyping: false,
  });

  if (parsed.errors.length > 0) {
    console.warn(`CSV parsing warnings for ${url}:`, parsed.errors);
  }

  return parsed.data;
}
