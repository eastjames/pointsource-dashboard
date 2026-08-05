// ---------------------------------------------------------------------------
// chartView.js
//
// Renders the detail panel shown when a point source marker is clicked: its
// metadata plus a plot of methane emission rate vs. time, combining two
// kinds of observation for the site:
//
//   - Individual satellite "plume" detections (small, color-coded by
//     instrument, symmetric std-dev error bars, no connecting line), drawn
//     first so they sit behind...
//   - ...the annual average (large black dots connected by a line, centered
//     on the middle of each year, with asymmetric uncertainty bounds).
//
// Uses the "basic" Plotly bundle (scatter/bar/pie traces only) rather than
// the full ~4MB Plotly build, since this chart only ever draws scatter
// traces with markers/lines/error bars.
// ---------------------------------------------------------------------------

import Plotly from 'plotly.js-basic-dist-min';
import { EMISSION_UNITS } from './dataLoader.js';
import { displayLabel, formatCoordinates, formatSiteLabel } from './format.js';

// Every chart shows the same window regardless of which years a given site
// has data for, so sites are visually comparable at a glance.
const X_AXIS_RANGE = ['2022-01-01', '2025-12-31'];

// Fixed color + marker shape per instrument, so a given instrument always
// reads the same way across every source's chart. Six categorical hues (see
// the project's data-viz reference palette) plus a distinct Plotly marker
// symbol as a second identity channel - hue alone can't safely carry 6
// all-pairs-visible scatter series (the validated palette only clears that
// bar for its first 3 slots), so shape carries the rest of the distinction.
const INSTRUMENT_STYLES = {
  EMIT: { color: '#2a78d6', symbol: 'circle' },
  EnMAP: { color: '#eb6834', symbol: 'square' },
  Landsat: { color: '#1baf7a', symbol: 'diamond' },
  PRISMA: { color: '#eda100', symbol: 'triangle-up' },
  S2: { color: '#e87ba4', symbol: 'cross' },
  Tanager: { color: '#008300', symbol: 'star' },
};
const UNKNOWN_INSTRUMENT_STYLE = { color: '#898781', symbol: 'x' }; // any instrument not in the list above

const ANNUAL_COLOR = '#0b0b0b'; // primary ink - the annual average is deliberately the most prominent series
const ANNUAL_ERROR_COLOR = 'rgba(11, 11, 11, 0.45)';
const GRIDLINE_COLOR = '#e1e0d9';
const AXIS_COLOR = '#c3c2b7';
const TEXT_MUTED = '#898781';

let chartRendered = false; // tracks whether Plotly has a live plot in the container to purge

function panelElement() {
  return document.getElementById('detail-panel');
}

/**
 * Populate and reveal the detail panel for the given point source.
 * @param {{facilityType: string, imeoName: string|null, country: string, lat: number, lon: number,
 *   annual: {year: number, date: string, value: number, low: number, high: number}[],
 *   plumes: {date: string, value: number, std: number, instrument: string}[]}} source
 */
export function showTimeSeries(source) {
  panelElement().classList.remove('hidden');

  // textContent (never innerHTML) for every value pulled from the CSV, so a
  // crafted data file can't inject markup/script into the page.
  document.getElementById('detail-title').textContent = formatSiteLabel(source.country, source.facilityType);
  document.getElementById('detail-coords').textContent = formatCoordinates(source.lat, source.lon);
  document.getElementById('detail-imeo').textContent = `IMEO Source ID: ${source.imeoName || 'n/a'}`;

  // Deferred to the next frame: Safari can report a stale (pre-reveal) width
  // for #timeseries-chart if Plotly measures it in the same tick the panel
  // goes from display:none to visible, which clips the right edge of the
  // chart. Waiting a frame lets Safari finish layout for the now-visible
  // panel before Plotly sizes itself against it.
  requestAnimationFrame(() => renderChart(source));
}

/** Hide the detail panel and tear down the plot so it doesn't leak memory. */
export function hidePanel() {
  panelElement().classList.add('hidden');
  if (chartRendered) {
    Plotly.purge('timeseries-chart');
    chartRendered = false;
  }
}

function renderChart(source) {
  const traces = [...buildPlumeTraces(source.plumes), ...buildAnnualTrace(source.annual)];

  const layout = {
    margin: { l: 56, r: 16, t: 16, b: 40 },
    paper_bgcolor: 'transparent', // let the detail panel's own surface color show through
    plot_bgcolor: 'transparent',
    dragmode: 'pan', // dragging pans the chart by default, rather than drawing a zoom box
    showlegend: true,
    legend: { orientation: 'h', x: 0, y: 1.15, font: { color: TEXT_MUTED, size: 14 } },
    font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: TEXT_MUTED, size: 12 },
    xaxis: {
      type: 'date',
      range: X_AXIS_RANGE,
      dtick: 'M12', // one tick per calendar year, aligned to tick0 below
      tick0: X_AXIS_RANGE[0],
      ticklabelmode: 'period', // label reads "2022" centered between the Jan-1 tick marks, not pinned to the tick itself
      gridcolor: GRIDLINE_COLOR,
      linecolor: AXIS_COLOR,
      tickcolor: AXIS_COLOR,
    },
    yaxis: {
      title: { text: EMISSION_UNITS, font: { color: TEXT_MUTED } },
      gridcolor: GRIDLINE_COLOR,
      linecolor: AXIS_COLOR,
      tickcolor: AXIS_COLOR,
      zeroline: false,
    },
  };

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'], // not useful for a time series
  };

  Plotly.newPlot('timeseries-chart', traces, layout, config);
  chartRendered = true;
}

/** One marker-only trace per instrument, each with its own color/shape/legend entry and symmetric error bars. */
function buildPlumeTraces(plumes) {
  const byInstrument = groupBy(plumes, (p) => p.instrument);

  // Known instruments first, in a fixed order, so the legend reads the same
  // way for every source; any unrecognized instrument is appended after.
  const orderedInstruments = [
    ...Object.keys(INSTRUMENT_STYLES).filter((name) => byInstrument.has(name)),
    ...[...byInstrument.keys()].filter((name) => !(name in INSTRUMENT_STYLES)),
  ];

  return orderedInstruments.map((instrument) => {
    const points = byInstrument.get(instrument);
    const style = INSTRUMENT_STYLES[instrument] || UNKNOWN_INSTRUMENT_STYLE;

    return {
      type: 'scatter',
      mode: 'markers', // no connecting line between individual plume observations
      name: displayLabel(instrument),
      x: points.map((p) => p.date),
      y: points.map((p) => p.value),
      marker: { color: style.color, symbol: style.symbol, size: 7, line: { color: '#fcfcfb', width: 1 } },
      error_y: {
        type: 'data',
        symmetric: true, // ch4_fluxrate_std is a single standard deviation, not separate bounds
        array: points.map((p) => p.std),
        color: `${style.color}88`,
        thickness: 1.25,
        width: 3,
      },
      hovertemplate: `%{y:.0f} ${EMISSION_UNITS}<extra>${displayLabel(instrument)}</extra>`,
    };
  });
}

/** The annual-average trace: larger black markers connected by a line, with asymmetric error bars. Omitted if the site has no annual averages at all. */
function buildAnnualTrace(annual) {
  if (annual.length === 0) return [];

  return [
    {
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Annual average',
      x: annual.map((p) => p.date),
      y: annual.map((p) => p.value),
      line: { color: ANNUAL_COLOR, width: 2, shape: 'linear' }, // straight segments between years - no invented smoothing
      marker: { color: ANNUAL_COLOR, size: 11, line: { color: '#fcfcfb', width: 2 } }, // surface-color ring keeps markers legible where the line crosses them
      error_y: {
        type: 'data',
        symmetric: false,
        array: annual.map((p) => p.high - p.value),
        arrayminus: annual.map((p) => p.value - p.low),
        color: ANNUAL_ERROR_COLOR,
        thickness: 2,
        width: 5,
      },
      hovertemplate: `%{y:.0f} ${EMISSION_UNITS}<extra>Annual average</extra>`,
    },
  ];
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}
