// ---------------------------------------------------------------------------
// format.js
//
// Small text-formatting helpers shared between the map tooltip and the
// detail panel, so both present a site's location/identity the same way.
// ---------------------------------------------------------------------------

/** e.g. (31.9686, -102.0779) -> "31.968600°N, 102.077900°W" */
export function formatCoordinates(lat, lon) {
  const latDirection = lat >= 0 ? 'N' : 'S';
  const lonDirection = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(6)}°${latDirection}, ${Math.abs(lon).toFixed(6)}°${lonDirection}`;
}

// A few raw CSV values read oddly in the UI as-is - this remaps just their
// *displayed* text. Every internal lookup (filtering, color/symbol
// assignment, Set membership, etc.) still keys off the raw CSV value
// unchanged; only text actually shown to the user goes through this.
const DISPLAY_LABEL_OVERRIDES = {
  'Gathering and boosting facilities': 'Gathering and boosting facility',
  S2: 'Sentinel-2',
};

/** Maps a raw facility-type/instrument value to its display text, or returns it unchanged if there's no override. */
export function displayLabel(rawValue) {
  return DISPLAY_LABEL_OVERRIDES[rawValue] || rawValue;
}

/** e.g. ("Algeria", "Gas disposal facility") -> "Algeria Gas disposal facility". Drops either part if blank. */
export function formatSiteLabel(country, facilityType) {
  return [country, displayLabel(facilityType)].filter(Boolean).join(' ');
}
