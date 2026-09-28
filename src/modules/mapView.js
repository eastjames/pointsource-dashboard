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
import { displayLabel, formatCoordinates, formatSiteLabel } from './format.js';

// Markers are colored by how many years of annual-average data a site has
// (1-4, the only values possible across the fixed 2022-2025 window) - an
// ordinal quantity, not an identity, so it gets a single hue stepped
// light-to-dark rather than distinct categorical colors (see the project's
// data-viz reference palette). Keyed by site.annual.length.
const YEARS_OF_DATA_COLORS = {
  1: '#86b6ef',
  2: '#3987e5',
  3: '#1c5cab',
  4: '#0d366b',
};
const UNKNOWN_YEARS_COLOR = '#898781'; // defensive fallback - not expected with the current data (always 1-4)

// The fixed window every chart's x-axis also uses (see X_AXIS_RANGE in
// chartView.js) - every annual average in the real data falls in one of
// these four years.
const AVAILABLE_YEARS = [2022, 2023, 2024, 2025];

const MARKER_RADIUS_PX = 6; // renders as a ~12px dot, comfortably above the >=8px minimum marker size
const MARKER_RING_COLOR = '#fcfcfb'; // light "surface" ring so overlapping markers stay legible

/**
 * Create and return a Leaflet map attached to the element with id `elementId`.
 */
export function createMap(elementId) {
  const map = L.map(elementId, {
    worldCopyJump: true, // panning past +/-180 degrees wraps around instead of showing empty gray space
    minZoom: 2,
    maxZoom: 16,
  }).setView([20, 0], 2);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_3u4m_1_67d64592e32d130bffd701fe', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(map);

  return map;
}

/**
 * Add one circle marker per point source to `map`. Calls `onSelect(source)`
 * whenever a marker is clicked. Also adds four floating map controls: a
 * legend for the years-of-data color ramp, a facility-type filter, a
 * data-year filter, and an instrument filter - a marker is visible only
 * while it passes all three filters. See setUpFilters for how each filter
 * combines its own checkboxes internally.
 *
 * Markers are stacked by years-of-data - 4-year sources drawn on top, then
 * 3, then 2, then 1-year sources at the bottom - see setUpFilters, which
 * actually adds them to the map and establishes that order.
 */
export function addPointSources(map, sources, onSelect) {
  const entries = []; // { marker, facilityType, years: number[], instruments: string[] } for every source, so all filters (and the stacking order) can be computed together

  for (const source of sources.values()) {
    const fillColor = YEARS_OF_DATA_COLORS[source.annual.length] || UNKNOWN_YEARS_COLOR;

    // Not added to the map here - setUpFilters's initial updateVisibility()
    // call does that, in the right stacking order, since it's the one
    // function that already knows how to add markers correctly.
    const marker = L.circleMarker([source.lat, source.lon], {
      radius: MARKER_RADIUS_PX,
      color: MARKER_RING_COLOR, // stroke doubles as the surface ring, not a data-carrying border
      weight: 2,
      fillColor,
      fillOpacity: 0.9,
    });

    // Leaflet inserts string tooltip content via innerHTML, which would let
    // a maliciously crafted CSV value inject markup/script into the page.
    // Building a plain DOM node with textContent instead sidesteps that -
    // Leaflet appends the node as-is rather than parsing it as HTML.
    const tooltipNode = document.createElement('span');
    tooltipNode.textContent = `${formatSiteLabel(source.country, source.facilityType)} (${formatCoordinates(source.lat, source.lon)})`;
    marker.bindTooltip(tooltipNode, {
      direction: 'top',
      offset: [0, -4],
    });

    marker.on('click', () => onSelect(source));

    entries.push({
      marker,
      facilityType: source.facilityType,
      years: source.annual.map((point) => point.year),
      instruments: [...new Set(source.plumes.map((point) => point.instrument))],
    });
  }

  addYearsOfDataLegend(map);
  setUpFilters(map, entries);
}

/**
 * Floating, always-visible legend for the years-of-data color ramp.
 * A Leaflet control (not a marker), so it's pinned to a map corner and
 * never moves as the map is panned/zoomed - placed on the left so it can
 * never be covered by the detail panel, which only ever occupies the right
 * side of the screen.
 */
function addYearsOfDataLegend(map) {
  const legend = L.control({ position: 'bottomleft' });

  legend.onAdd = () => {
    const container = L.DomUtil.create('div', 'map-legend');

    const title = document.createElement('div');
    title.className = 'map-legend-title';
    title.textContent = 'Years of data';
    container.appendChild(title);

    const scale = document.createElement('div');
    scale.className = 'map-legend-scale';
    const labels = document.createElement('div');
    labels.className = 'map-legend-labels';

    for (const years of Object.keys(YEARS_OF_DATA_COLORS)) {
      const swatch = document.createElement('span');
      swatch.className = 'map-legend-swatch';
      swatch.style.backgroundColor = YEARS_OF_DATA_COLORS[years];
      scale.appendChild(swatch);

      const label = document.createElement('span');
      label.textContent = years;
      labels.appendChild(label);
    }

    container.append(scale, labels);
    return container;
  };

  legend.addTo(map);
}

/**
 * Wires up the facility-type filter, the data-year filter, and the
 * instrument filter as three dropdown controls (stacked in that order at
 * topleft, below Leaflet's own zoom control), and re-evaluates every
 * marker's visibility whenever any one of them changes. A marker is shown
 * only when it passes all three filters at once - the filters combine with
 * AND. Within each filter, the checkboxes combine differently:
 *   - Facility type: OR (any checked type passes) - createCheckboxDropdownControl.
 *   - Years: exact match (a source's own year-set must equal the checked
 *     set exactly, with an "All data" bypass) - createExactMatchDropdownControl.
 *   - Instruments: AND/subset (a source passes if it has data from every
 *     checked instrument, regardless of what other instruments it also
 *     has) - createSubsetMatchDropdownControl.
 */
function setUpFilters(map, entries) {
  // "Unknown" (sites with no recorded type) goes last - it's a catch-all,
  // not a real category, so it doesn't belong alphabetized with the rest.
  const facilityTypes = [...new Set(entries.map((entry) => entry.facilityType))].sort((a, b) => {
    if (a === 'Unknown') return 1;
    if (b === 'Unknown') return -1;
    return a.localeCompare(b);
  });
  // Unlike years (a fixed, known 2022-2025 window) or facility type
  // (defaulted to "Unknown" when missing), instruments have no fixed
  // domain and every plume always has one (see dataLoader.js) - so this is
  // simply every distinct value found in the data, alphabetically.
  const instruments = [...new Set(entries.flatMap((entry) => entry.instruments))].sort();

  const selectedTypes = new Set(facilityTypes);
  const selectedYears = new Set(AVAILABLE_YEARS);
  // Instruments starts with none checked - under the AND/subset rule below,
  // an empty checked set imposes no constraint, so every source passes
  // (matching the filter's default "not yet narrowed" state).
  const selectedInstruments = new Set();
  let allYearsMode = true; // "All data" bypasses the year filter entirely - see createExactMatchDropdownControl

  // Stacking order: 4-year sources on top, then 3, then 2, then 1-year
  // sources at the bottom. bringToFront() moves a layer to the end of its
  // SVG group (frontmost), so applying it to every visible marker in
  // ascending order (fewest years first) leaves the most-years markers
  // frontmost once the pass finishes.
  const byYearsAscending = [...entries].sort((a, b) => a.years.length - b.years.length);

  function updateVisibility() {
    for (const entry of entries) {
      const passesType = selectedTypes.has(entry.facilityType);
      const passesYears = allYearsMode || arrayMatchesSetExactly(entry.years, selectedYears);
      const passesInstruments = arrayContainsSetAsSubset(entry.instruments, selectedInstruments);
      if (passesType && passesYears && passesInstruments) {
        entry.marker.addTo(map);
      } else {
        map.removeLayer(entry.marker);
      }
    }
    // Re-adding a previously-removed layer appends it to the end of the
    // SVG group regardless of years-of-data, so the stacking order has to
    // be re-established every time visibility changes, not just once.
    for (const entry of byYearsAscending) {
      if (map.hasLayer(entry.marker)) {
        entry.marker.bringToFront();
      }
    }
  }

  updateVisibility(); // adds every marker (default filter state) and establishes the initial stacking order

  createCheckboxDropdownControl({
    label: 'Facility type',
    options: facilityTypes.map((type) => ({ value: type, label: displayLabel(type) })),
    selected: selectedTypes,
    onChange: updateVisibility,
  }).addTo(map);

  createExactMatchDropdownControl({
    label: 'Years',
    options: AVAILABLE_YEARS.map((year) => ({ value: year, label: String(year) })),
    selectedSet: selectedYears,
    getAllDataMode: () => allYearsMode,
    setAllDataMode: (value) => {
      allYearsMode = value;
    },
    onChange: updateVisibility,
  }).addTo(map);

  createSubsetMatchDropdownControl({
    label: 'Instruments',
    options: instruments.map((instrument) => ({ value: instrument, label: displayLabel(instrument) })),
    selectedSet: selectedInstruments,
    onChange: updateVisibility,
  }).addTo(map);
}

/** True only if `sourceValues` and `selectedSet` contain exactly the same values - not a subset/superset/overlap check. */
function arrayMatchesSetExactly(sourceValues, selectedSet) {
  return sourceValues.length === selectedSet.size && sourceValues.every((value) => selectedSet.has(value));
}

/** True if every value in `selectedSet` is present in `sourceValues` (an empty `selectedSet` always passes) - `sourceValues` may also contain other, unselected values. */
function arrayContainsSetAsSubset(sourceValues, selectedSet) {
  return [...selectedSet].every((value) => sourceValues.includes(value));
}

/**
 * Builds a floating Leaflet dropdown control: a toggle button, a "Select
 * all" master checkbox, and one checkbox per option, OR-combined (any
 * checked option passes). `selected` is mutated in place to track the
 * current selection (starts with every option selected); `onChange()`
 * fires after every change, once the mutation is done. Used for the
 * facility-type filter - the years and instrument filters have different
 * (exact-match) semantics and are built by createExactMatchDropdownControl
 * below instead.
 * Placed at topleft, where controls stack top-to-bottom in the order
 * they're added - so it's never covered by the right-side detail panel.
 */
function createCheckboxDropdownControl({ label, options, selected, onChange }) {
  const control = L.control({ position: 'topleft' });

  control.onAdd = () => {
    const container = L.DomUtil.create('div', 'map-filter');
    // Without these, clicking/scrolling inside the control would pan/zoom
    // the map underneath it instead of interacting with the control.
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'map-filter-toggle';
    toggleButton.textContent = `${label} ▾`;

    const menu = document.createElement('div');
    menu.className = 'map-filter-menu hidden';
    toggleButton.addEventListener('click', () => menu.classList.toggle('hidden'));

    const selectAllRow = document.createElement('label');
    selectAllRow.className = 'map-filter-row map-filter-select-all';
    const selectAllCheckbox = document.createElement('input');
    selectAllCheckbox.type = 'checkbox';
    selectAllCheckbox.checked = true;
    const selectAllLabel = document.createElement('span');
    selectAllLabel.textContent = 'Select all';
    selectAllRow.append(selectAllCheckbox, selectAllLabel);
    menu.appendChild(selectAllRow);

    const optionCheckboxes = [];

    /** Keeps "Select all" checked only when every option is checked, unchecked otherwise (no indeterminate - a plain on/off toggle). */
    function syncSelectAllCheckbox() {
      selectAllCheckbox.checked = optionCheckboxes.every((checkbox) => checkbox.checked);
    }

    for (const option of options) {
      const row = document.createElement('label');
      row.className = 'map-filter-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selected.add(option.value);
        } else {
          selected.delete(option.value);
        }
        syncSelectAllCheckbox();
        onChange();
      });
      optionCheckboxes.push(checkbox);

      const text = document.createElement('span');
      text.textContent = option.label;

      row.append(checkbox, text);
      menu.appendChild(row);
    }

    selectAllCheckbox.addEventListener('change', () => {
      for (const checkbox of optionCheckboxes) {
        checkbox.checked = selectAllCheckbox.checked;
      }
      selected.clear();
      if (selectAllCheckbox.checked) {
        for (const option of options) selected.add(option.value);
      }
      onChange();
    });

    container.append(toggleButton, menu);
    return container;
  };

  return control;
}

/**
 * Builds an "AND/subset match" floating dropdown - used for the Instruments
 * filter. Every checkbox starts unchecked, imposing no constraint (every
 * source passes). Checking an option requires sources to have data from
 * *that* instrument - checking several combines them with AND, so a source
 * passes only once it has data from every checked instrument, regardless of
 * which other, unchecked instruments it also has. There's no "select all"
 * row: checking every option is a legitimate (if narrow) selection here -
 * "sources observed by every listed instrument" - not a "show everything"
 * shortcut the way it is for the OR-combined facility-type filter.
 */
function createSubsetMatchDropdownControl({ label, options, selectedSet, onChange }) {
  const control = L.control({ position: 'topleft' });

  control.onAdd = () => {
    const container = L.DomUtil.create('div', 'map-filter');
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'map-filter-toggle';
    toggleButton.textContent = `${label} ▾`;

    const menu = document.createElement('div');
    menu.className = 'map-filter-menu hidden';
    toggleButton.addEventListener('click', () => menu.classList.toggle('hidden'));

    for (const option of options) {
      const row = document.createElement('label');
      row.className = 'map-filter-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedSet.has(option.value);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedSet.add(option.value);
        } else {
          selectedSet.delete(option.value);
        }
        onChange();
      });

      const text = document.createElement('span');
      text.textContent = option.label;

      row.append(checkbox, text);
      menu.appendChild(row);
    }

    container.append(toggleButton, menu);
    return container;
  };

  return control;
}

/**
 * Builds an "exact match" floating dropdown - used for the Years filter.
 * Unlike the facility-type filter (any checked option passes), selection
 * here is an *exact match*: checking a combination of options shows only
 * sources whose own set of values equals the checked set exactly - e.g.
 * checking 2022+2024 hides a source that has 2022+2023+2024 data, because
 * 2023 isn't part of the selection.
 *
 * "All data" is a separate bypass mode, not just "every option checked" -
 * checking every individual option would (correctly, by the exact-match
 * rule) show only sources whose data covers *every* option. So the
 * individual checkboxes are disabled while "All data" is active, since
 * they don't apply to anything while it's on.
 */
function createExactMatchDropdownControl({ label, options, selectedSet, getAllDataMode, setAllDataMode, onChange }) {
  const control = L.control({ position: 'topleft' });

  control.onAdd = () => {
    const container = L.DomUtil.create('div', 'map-filter');
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'map-filter-toggle';
    toggleButton.textContent = `${label} ▾`;

    const menu = document.createElement('div');
    menu.className = 'map-filter-menu hidden';
    toggleButton.addEventListener('click', () => menu.classList.toggle('hidden'));

    const allDataRow = document.createElement('label');
    allDataRow.className = 'map-filter-row map-filter-select-all';
    const allDataCheckbox = document.createElement('input');
    allDataCheckbox.type = 'checkbox';
    allDataCheckbox.checked = getAllDataMode();
    const allDataLabel = document.createElement('span');
    allDataLabel.textContent = 'All data';
    allDataRow.append(allDataCheckbox, allDataLabel);
    menu.appendChild(allDataRow);

    const optionRows = [];

    for (const option of options) {
      const row = document.createElement('label');
      row.className = 'map-filter-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedSet.has(option.value);
      checkbox.disabled = getAllDataMode();
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedSet.add(option.value);
        } else {
          selectedSet.delete(option.value);
        }
        onChange();
      });
      optionRows.push({ row, checkbox });

      const text = document.createElement('span');
      text.textContent = option.label;

      row.append(checkbox, text);
      menu.appendChild(row);
    }

    allDataCheckbox.addEventListener('change', () => {
      setAllDataMode(allDataCheckbox.checked);
      for (const { row, checkbox } of optionRows) {
        checkbox.disabled = allDataCheckbox.checked;
        row.classList.toggle('map-filter-row-disabled', allDataCheckbox.checked);
      }
      onChange();
    });

    container.append(toggleButton, menu);
    return container;
  };

  return control;
}
