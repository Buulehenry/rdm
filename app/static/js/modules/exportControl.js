// modules/exportControl.js
import { getActiveFilterState } from './filtersControl.js';
import { fitToDistrict } from './districtLayer.js';

let _districtsCache = null;

async function ensureDistricts() {
  if (_districtsCache) return _districtsCache;
  try {
    const r = await fetch('/api/districts/');
    if (r.ok) _districtsCache = await r.json();
  } catch {}
  _districtsCache = _districtsCache || { type: 'FeatureCollection', features: [] };
  return _districtsCache;
}

// Utility wait so tiles/markers render before snapshot
const wait = ms => new Promise(r => setTimeout(r, ms));

export async function exportWithScope(map, renderer, { scope = 'current', fileBase = 'Uganda' } = {}) {
  const state = getActiveFilterState(); // region/district + toggles
  const fc = renderer?.getStationsGeoJSON ? renderer.getStationsGeoJSON() : null;

  // Focus blur (ours/competitors)
  applyFocus(scope);

  // Fit bounds for chosen scope
  await fitForScope(map, scope, state, fc);

  // Small settle time
  await wait(500);

  // Snapshot
  await exportJpg('map', `${fileBase}_${scopeName(scope, state)}_${timestamp()}`);

  // Reset focus
  applyFocus('all');
}

function applyFocus(mode) {
  // Accept 'our' alias (toolbar uses it) in addition to 'ours'
  const normalized = mode === 'our' ? 'ours' : mode;

  const ours = document.querySelector('.leaflet-pane.oursPane');
  const comps = document.querySelector('.leaflet-pane.competitorsPane');
  const targs = document.querySelector('.leaflet-pane.targetsPane');
  [ours, comps, targs].forEach(p => p && p.classList.remove('blurred'));

  if (normalized === 'ours') { comps?.classList.add('blurred'); targs?.classList.add('blurred'); }
  if (normalized === 'competitors') { ours?.classList.add('blurred'); targs?.classList.add('blurred'); }
}

async function fitForScope(map, scope, state, fc) {
  const pad = { padding: [20, 20] };

  if (scope === 'current') return;

  if (scope === 'country') {
    // Try districts bounds; fallback to all stations
    const d = await ensureDistricts();
    const bounds = boundsOfFeatures(d.features);
    if (bounds) map.fitBounds(bounds, pad);
    else if (fc) fitBoundsFromStations(map, fc, () => true, pad);
    return;
  }

  if (scope === 'district') {
    const dist = state.district?.trim();
    if (dist) {
      if (!fitToDistrict(map, dist)) {
        if (fc) fitBoundsFromStations(map, fc, p => (p.district || '').toLowerCase() === dist.toLowerCase(), pad);
      }
    }
    return;
  }

  if (scope === 'region') {
    const reg = state.region?.trim();
    if (reg) {
      const d = await ensureDistricts();
      const feats = d.features.filter(f => (f.properties?.region || '').toLowerCase() === reg.toLowerCase());
      const b = boundsOfFeatures(feats);
      if (b) map.fitBounds(b, pad);
      else if (fc) fitBoundsFromStations(map, fc, p => (p.region || '').toLowerCase() === reg.toLowerCase(), pad);
    }
    return;
  }

  if (scope === 'ours' || scope === 'our') {
    if (fc) fitBoundsFromStations(map, fc, p => p.category === 'rubis', pad);
    return;
  }

  if (scope === 'competitors') {
    if (fc) fitBoundsFromStations(map, fc, p => p.category === 'competitor', pad);
    return;
  }
}

function fitBoundsFromStations(map, fc, predicate, pad) {
  const latlngs = [];
  for (const f of (fc?.features || [])) {
    const p = f.properties || {};
    if (!predicate(p)) continue;
    const [lng, lat] = f.geometry?.coordinates || [];
    if (typeof lat === 'number' && typeof lng === 'number') latlngs.push([lat, lng]);
  }
  if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs), pad);
}

function boundsOfFeatures(features = []) {
  let bounds = null;
  for (const f of features) {
    if (!f || !f.geometry) continue;
    const layer = L.geoJSON(f);
    const b = layer.getBounds();
    if (!b.isValid()) continue;
    bounds = bounds ? bounds.extend(b) : b;
  }
  return bounds;
}

async function exportJpg(elementId, filenameBase) {
  const el = document.getElementById(elementId);
  const scale = Math.max(2, window.devicePixelRatio || 1);
  const canvas = await html2canvas(el, { useCORS: true, allowTaint: false, backgroundColor: '#ffffff', scale });
  const url = canvas.toDataURL('image/jpeg', 0.95);
  const a = document.createElement('a');
  a.href = url; a.download = `${filenameBase}.jpg`; a.click();
}

function scopeName(scope, state) {
  if ((scope === 'region' || scope === 'Region') && state.region) return `Region_${slug(state.region)}`;
  if ((scope === 'district' || scope === 'District') && state.district) return `District_${slug(state.district)}`;
  return scope[0].toUpperCase() + scope.slice(1);
}
function slug(s) { return (s || '').replace(/\s+/g, '_'); }
function timestamp() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); }

// -------- Batch District Exports (ZIP) --------
export async function exportDistrictBatch(map, renderer, { region = null, fileBase = 'Uganda_Districts' } = {}) {
  if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
    throw new Error('JSZip or FileSaver not loaded.');
  }

  const d = await ensureDistricts();
  const fc = renderer?.getStationsGeoJSON ? renderer.getStationsGeoJSON() : null;

  const feats = d.features.filter(f => region ? ((f.properties?.region || '').toLowerCase() === region.toLowerCase()) : true);
  if (!feats.length) throw new Error('No districts found for batch.');

  const zip = new JSZip();
  applyFocus('all');

  // Progress UI
  const ui = ensureBatchUi(); ui.progress.max = feats.length; ui.progress.value = 0; ui.status.textContent = 'Starting…';

  for (let i = 0; i < feats.length; i++) {
    const name = feats[i].properties?.name || `District_${i + 1}`;
    ui.status.textContent = `Exporting ${name} (${i + 1}/${feats.length}) …`;

    // Fit to district polygon or its stations
    if (!fitToDistrict(map, name) && fc) {
      fitBoundsFromStations(map, fc, p => (p.district || '').toLowerCase() === name.toLowerCase(), { padding: [20, 20] });
    }
    await wait(600); // settle

    // Snapshot to blob
    const blob = await snapshotBlob('map', 'image/jpeg', 0.95);
    zip.file(`${slug(name)}.jpg`, blob);

    ui.progress.value = i + 1;
    await wait(60);
  }

  ui.status.textContent = 'Zipping…';
  const out = await zip.generateAsync({ type: 'blob' });
  const ts = timestamp();
  saveAs(out, `${fileBase}_${region ? slug(region) + '_' : ''}${ts}.zip`);

  ui.status.textContent = 'Done';
  setTimeout(() => ui.host.remove(), 800);
}

function ensureBatchUi() {
  let host = document.getElementById('batch-export-ui');
  if (!host) {
    host = document.createElement('div');
    host.id = 'batch-export-ui';
    host.innerHTML = `
      <div style="position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:3000;background:#fff;padding:.5rem .75rem;border-radius:10px;box-shadow:0 10px 24px rgba(0,0,0,.2);display:flex;gap:.5rem;align-items:center;">
        <div id="batch-status" class="small text-muted">Preparing…</div>
        <progress id="batch-progress" value="0" max="100" style="width:240px;"></progress>
      </div>
    `;
    document.body.appendChild(host);
  }
  return {
    host,
    status: host.querySelector('#batch-status'),
    progress: host.querySelector('#batch-progress')
  };
}

async function snapshotBlob(elementId, type = 'image/jpeg', quality = 0.95) {
  const el = document.getElementById(elementId);
  const scale = Math.max(2, window.devicePixelRatio || 1);
  const canvas = await html2canvas(el, { useCORS: true, allowTaint: false, backgroundColor: '#ffffff', scale });
  const dataUrl = canvas.toDataURL(type, quality);
  const res = await fetch(dataUrl);
  return await res.blob();
}

export async function exportCurrentMap(map, { scope = 'current', fileBase = 'Map' } = {}) {
  const mapEl = document.getElementById('map');
  const scale = Math.max(2, window.devicePixelRatio || 1);
  const canvas = await html2canvas(mapEl, {
    ignoreElements: el => el.matches('.map-toolbar, .custom-filters, .coordinate-display, .leaflet-control-zoom, .snapshot-control'),
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#ffffff',
    scale
  });
  const url = canvas.toDataURL('image/jpeg', 0.95);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `${fileBase}_${scope}_${ts}.jpg`;
  a.click();
}
