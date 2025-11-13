// modules/mapCore.js
//
// Renders stations & targets with filter support.
// Assumes station features have properties:
//   id, name, category ('rubis' | 'competitor' | 'target'), competitor_id,
//   competitor_name, pin_color, pin_shape, region, district
//
// Requires:
//   getActiveFilterState() from filtersControl.js
//   isEditMode(), isDeleteMode() from modes.js
//   fetchStationSeries() from volumesApi.js (for side-panel chart)
//
// Uses:
//   buildStationMarker() from stationIcons.js (centralized icon logic)

import { getActiveFilterState } from './filtersControl.js';
import { isEditMode, isDeleteMode } from './modes.js';
import { fetchStationSeries } from './volumesApi.js';
import { updateHeatFromStations } from './heatmapLayer.js';
import { buildStationMarker } from './stationIcons.js';

export function StationTargetRenderer(map) {
  let stationLayer = null;
  let targetLayer  = null;

  let _lastStationGeoJSON = null;
  let _lastTargetGeoJSON  = null;
  let _loadingStations = false;
  let _loadingTargets  = false;

  /* -------------------- Public Loads -------------------- */

  async function loadStations() {
    if (_loadingStations) return;
    _loadingStations = true;
    try {
      const r = await fetch('/api/stations');
      if (!r.ok) throw new Error(`Stations HTTP ${r.status}`);
      _lastStationGeoJSON = await r.json();
      renderStationsFiltered();
    } catch (err) {
      console.error('Failed to load stations:', err);
    } finally {
      _loadingStations = false;
    }
  }

  async function loadTargets() {
    if (_loadingTargets) return;
    _loadingTargets = true;
    try {
      const r = await fetch('/api/targets');
      if (!r.ok) throw new Error(`Targets HTTP ${r.status}`);
      _lastTargetGeoJSON = await r.json();
      renderTargetsFiltered();
    } catch (err) {
      console.error('Failed to load targets:', err);
    } finally {
      _loadingTargets = false;
    }
  }

  /* -------------------- Filtering / Rendering -------------------- */

  function renderStationsFiltered() {
    if (!_lastStationGeoJSON) return;
    const filters = getActiveFilterState();
    const reg = (filters.region || '').trim().toLowerCase();
    const distQ = (filters.district || '').trim().toLowerCase();

    const filteredFeatures = _lastStationGeoJSON.features.filter(f => {
      const p = f.properties || {};
      const t = (p.category || p.type || '').toLowerCase();

      // Own/Competitors/Targets toggles
      if (t === 'rubis' && !filters.own) return false;
      if (t === 'competitor') {
        const cid = Number(p.competitor_id);
        if (!filters.competitorIds.includes(cid)) return false;
      }
      if (t === 'target' && !filters.targets) return false;

      // Region filter (exact match)
      if (reg && (String(p.region || '').toLowerCase() !== reg)) return false;

      // District filter (substring match for convenience)
      if (distQ) {
        const pd = String(p.district || '').toLowerCase();
        if (!pd.includes(distQ)) return false;
      }

      return true;
    });

    const fc = { ..._lastStationGeoJSON, features: filteredFeatures };

    if (stationLayer) {
      map.removeLayer(stationLayer);
      stationLayer = null;
    }

    // Heatmap should reflect the filtered view (clears when empty)
    updateHeatFromStations(fc);

    stationLayer = L.geoJSON(fc, { pointToLayer: stationPointToLayer }).addTo(map);
  }

  function renderTargetsFiltered() {
    if (!_lastTargetGeoJSON) return;
    const { targets } = getActiveFilterState();

    if (targetLayer) {
      map.removeLayer(targetLayer);
      targetLayer = null;
    }
    if (!targets) return;

    targetLayer = L.geoJSON(_lastTargetGeoJSON, {
      style: feature => ({
        color: feature.properties?.outline_color || '#d9534f',
        weight: 2,
        dashArray: '4 4',
        fill: false
      }),
      onEachFeature: (feature, layer) => {
        const nm = feature.properties?.name;
        if (nm) layer.bindTooltip(escapeHtml(nm), { sticky: true });
      }
    }).addTo(map);
  }

  function refreshAll() {
    // Use cached data; just re-filter
    renderStationsFiltered();
    renderTargetsFiltered();
  }

  /* -------------------- Station Marker Construction -------------------- */

  function stationPointToLayer(feature, latlng) {
    const p = feature.properties || {};

    // Centralized, brand-aware marker builder
    const marker = buildStationMarker(latlng, p);

    marker.on('click', () => {
      if (map._stationInteraction) {
        if (isDeleteMode()) return map._stationInteraction.delete(p, marker);
        if (isEditMode())   return map._stationInteraction.edit(p, marker);
      }
      showPopup(marker, p);
    });

    return marker;
  }

  /* -------------------- Popups + Side Panel -------------------- */

  function showPopup(marker, p) {
    const cat = p.category || p.type || 'station';
    const lines = [];
    lines.push(`<strong>${escapeHtml(p.name || 'Unnamed')}</strong>`);
    if (cat === 'competitor') {
      lines.push(`<small>Competitor: ${escapeHtml(p.competitor_name || ('#' + p.competitor_id))}</small>`);
    } else {
      lines.push(`<small>${escapeHtml(cat)}</small>`);
    }
    marker.bindPopup(lines.join('<br>')).openPopup();

    // Open side panel with chart
    openSidePanel(p);
  }

  async function openSidePanel(props) {
    const panel = document.getElementById('side-panel');
    if (!panel) return;
    panel.classList.add('open');
    panel.querySelector('#sp-title').textContent = props.name || 'Station';
    panel.querySelector('#sp-meta').innerHTML = `
      <div><strong>Category:</strong> ${escapeHtml(props.category || '-')}</div>
      ${props.region ? `<div><strong>Region:</strong> ${escapeHtml(props.region)}</div>` : ''}
      ${props.district ? `<div><strong>District:</strong> ${escapeHtml(props.district)}</div>` : ''}
    `;
    panel.querySelector('#sp-close').onclick = () => panel.classList.remove('open');

    try {
      const series = await fetchStationSeries(props.id);
      drawMiniChart(series);
    } catch (e) {
      console.warn('Series fetch failed', e);
      drawMiniChart([]); // empty
    }
  }

  // very small, dependency-free mini chart using <canvas>
  function drawMiniChart(rows) {
    const c = document.getElementById('sp-chart');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width = c.clientWidth || 320;
    const h = c.height = Number(c.getAttribute('height') || 160);
    ctx.clearRect(0, 0, w, h);

    if (!rows || !rows.length) {
      ctx.fillStyle = '#777'; ctx.font = '12px sans-serif';
      ctx.fillText('No data', 10, 20);
      return;
    }

    const ys = rows.map(r => Number(r.volume) || 0);
    const ymin = Math.min(...ys);
    const ymax = Math.max(...ys);
    const padX = 24, padY = 16;

    const xN = ys.length - 1;
    const xscale = i => padX + (i * (w - 2 * padX)) / Math.max(1, xN);
    const yscale = v => (ymax === ymin) ? h / 2 : (h - padY - ((v - ymin) * (h - 2 * padY) / (ymax - ymin)));

    // axes
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padX, padY/2); ctx.lineTo(padX, h - padY); ctx.lineTo(w - padX/2, h - padY); ctx.stroke();

    // line
    ctx.strokeStyle = '#0b7'; ctx.lineWidth = 2;
    ctx.beginPath();
    ys.forEach((v, i) => {
      const px = xscale(i), py = yscale(v);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  function escapeHtml(str = '') {
    return str.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* -------------------- Public API -------------------- */

  return {
    loadStations,
    loadTargets,
    refreshAll,
    reloadAll: () => { loadStations(); loadTargets(); },
    getStationsGeoJSON: () => _lastStationGeoJSON, // used by export/heatmap
    _debug: () => ({ stationLayer, targetLayer })
  };
}
