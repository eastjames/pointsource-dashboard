// ---------------------------------------------------------------------------
// mapView.js
//
// Sets up the Leaflet world map and plots one marker per point source.
// Uses CARTO's "Positron" basemap tiles, which give simple geographic and
// geopolitical (country) borders and labels without street/terrain detail -
// exactly the "simple map" this dashboard needs, with no separate borders
// dataset to bundle or maintain.
// ---------------------------------------------------------------------------

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fixed, explicit facility_type -> color mapping (colorblind-safe hues from
// the project's data-viz reference palette), so a given type always renders
// the same color everywhere, regardless of data load order or which subset
// of sites happens to be on screen. There are ~24 distinct source_type
// values in the real data but only 8 hues can stay reliably distinguishable
// on a scatter-style map (where any two markers can end up neighbors), so
// only the 8 most common facility types get their own color; everything
// else (including sites with no recorded type) shares a neutral "other" gray.
const FACILITY_TYPE_COLORS = {
  'Gas disposal facility': '#2a78d6', // blue
  'O&G facility (generic)': '#eb6834', // orange
  Flare: '#1baf7a', // aqua
  'Transmission Pipelines': '#eda100', // yellow
  'Gathering and boosting facilities': '#e87ba4', // magenta
  'Well head': '#008300', // green
  'Transmission Compressor Station': '#4a3aa7', // violet
  Pit: '#e34948', // red
};
const OVERFLOW_COLOR = '#898781'; // muted gray for any facility type not listed above (incl. "Unknown")

const MARKER_RADIUS_PX = 6; // renders as a ~12px dot, comfortably above the >=8px minimum marker size
const MARKER_RING_COLOR = '#fcfcfb'; // light "surface" ring so overlapping markers stay legible

/**
 * Create and return a Leaflet map attached to the element with id `elementId`.
 */
export function createMap(elementId) {
  const map = L.map(elementId, {
    worldCopyJump: true, // panning past +/-180 degrees wraps around instead of showing empty gray space
    minZoom: 2,
    maxZoom: 12,
  }).setView([20, 0], 2);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  return map;
}

/**
 * Add one circle marker per point source to `map`. Calls `onSelect(source)`
 * whenever a marker is clicked.
 */
export function addPointSources(map, sources, onSelect) {
  for (const source of sources.values()) {
    const fillColor = FACILITY_TYPE_COLORS[source.facilityType] || OVERFLOW_COLOR;

    const marker = L.circleMarker([source.lat, source.lon], {
      radius: MARKER_RADIUS_PX,
      color: MARKER_RING_COLOR, // stroke doubles as the surface ring, not a data-carrying border
      weight: 2,
      fillColor,
      fillOpacity: 0.9,
    }).addTo(map);

    // Leaflet inserts string tooltip content via innerHTML, which would let
    // a maliciously crafted CSV value inject markup/script into the page.
    // Building a plain DOM node with textContent instead sidesteps that -
    // Leaflet appends the node as-is rather than parsing it as HTML.
    const tooltipNode = document.createElement('span');
    tooltipNode.textContent = source.facilityType;
    marker.bindTooltip(tooltipNode, {
      direction: 'top',
      offset: [0, -4],
    });

    marker.on('click', () => onSelect(source));
  }
}
