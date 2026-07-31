// ---------------------------------------------------------------------------
// main.js
//
// Application entry point: builds the map, loads the point source data, and
// wires marker clicks to the detail/time-series panel.
// ---------------------------------------------------------------------------

import './style.css';
import { loadPointSourceData } from './modules/dataLoader.js';
import { createMap, addPointSources } from './modules/mapView.js';
import { showTimeSeries, hidePanel } from './modules/chartView.js';

async function init() {
  const map = createMap('map');

  document.getElementById('detail-close').addEventListener('click', hidePanel);

  try {
    const sources = await loadPointSourceData();
    addPointSources(map, sources, showTimeSeries);
  } catch (err) {
    // Show a plain-text notice rather than leaving an unexplained empty map -
    // but never inject the raw error message as HTML.
    console.error('Failed to load point source data:', err);
    const notice = document.createElement('p');
    notice.id = 'load-error';
    notice.textContent = 'Could not load point source data. Check the browser console for details.';
    document.getElementById('map-root').appendChild(notice);
  }
}

init();
