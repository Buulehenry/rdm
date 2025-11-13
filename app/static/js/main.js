// main.js
console.log('MAIN JS LOADED (start)');

import { createMap } from './modules/mapConfig.js';
import { loadCompetitors } from './modules/competitorsApi.js';
import { StationTargetRenderer } from './modules/mapCore.js';
import { addTitleControl, addFiltersControl, getActiveFilterState } from './modules/filtersControl.js';
import { initAddStationModal } from './modules/addStationModal.js';
import { addToolbar } from './modules/toolbarControl.js';
import { setEditMode, setDeleteMode } from './modules/modes.js';
import { initCompetitorModal } from './modules/competitorModal.js';
import { initCompetitorManager } from './modules/competitorManager.js';
import { addDistrictLayer, fitToDistrict } from './modules/districtLayer.js';
import { mountRankingsDrawer } from './modules/rankingsDrawer.js';

document.addEventListener('DOMContentLoaded', async () => {
  const mapEl = document.getElementById('map');
  if (!mapEl) {
    console.warn('No #map element found; skipping map initialization.');
    return;
  }

  // Competitor manager + modal
  initCompetitorManager({
    onChange: () => {
      try { renderer.loadStations(); } catch (e) { console.debug(e); }
    }
  });
  initCompetitorModal();

  // Map + districts layer
  const map = createMap();
  addDistrictLayer(map);

  // Coordinate HUD
  const coordControl = L.control({ position: 'bottomleft' });
  coordControl.onAdd = () => {
    const el = L.DomUtil.create('div', 'coordinate-display');
    el.innerHTML = 'Lat: --, Lng: --';
    return el;
  };
  coordControl.addTo(map);

  map.on('mousemove', e => {
    const { lat, lng } = e.latlng;
    const el = document.querySelector('.coordinate-display');
    if (el) el.textContent = `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
  });
  map.on('click', e => {
    const { lat, lng } = e.latlng;
    const el = document.querySelector('.coordinate-display');
    if (el) el.textContent = `Clicked at → Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
  });

  // Title control
  addTitleControl(map);

  // Ensure competitors loaded before building filters
  try {
    await loadCompetitors();
  } catch (e) {
    console.warn('loadCompetitors failed:', e);
  }

  // Renderer
  const renderer = StationTargetRenderer(map);
  map._rendererRef = renderer;

  // Filters: refresh & auto-zoom to district
  addFiltersControl(map, () => {
    renderer.refreshAll();
    try {
      const state = getActiveFilterState?.();
      if (state?.district) fitToDistrict(map, state.district);
    } catch (_) {}
  });

  // Add-station modal
  initAddStationModal(map);

  // Toolbar
  addToolbar(map, renderer.refreshAll);

  // Initial loads
  renderer.loadStations();
  renderer.loadTargets();

  // Refresh after station create/update
  document.getElementById('add-station-form')
    ?.addEventListener('station:changed', () => {
      setEditMode(false, map);
      setDeleteMode(false, map);
      renderer.loadStations();
    });

  // Rankings (this month by default)
  mountRankingsDrawer({ width: 560 });

  // Expose for debugging
  window._MAP = map;
});
