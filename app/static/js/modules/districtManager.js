// modules/districtManager.js
// Pretty, icon-first Districts manager with boundary upload.
// Requires FontAwesome (for icons) and your Flask routes:
//   GET    /api/districts/                    -> FeatureCollection
//   POST   /api/districts/                    -> {id, name, region, ...}
//   PUT    /api/districts/<id>                -> updated row
//   DELETE /api/districts/<id>                -> {ok:true}
//
// If you don't have PUT/POST/DELETE yet, add them to your districts blueprint.

import {
  fetchDistrictsFC,
  createDistrict,
  updateDistrict,
  deleteDistrictById,
} from './districtsApi.js';

let _panel = null;
let _rows = [];          // [{id,name,region,geometry,_pendingGeom?}]
let _filter = '';
let _regions = [
  'Kampala Central',
  'Kampala Western',
  'Northern',
  'Western',
  'Eastern',
  'South Western'
];

export function toggleDistrictPanel() {
  if (_panel && _panel.classList.contains('open')) {
    _panel.classList.remove('open');
  } else {
    openPanel();
  }
}

async function openPanel() {
  if (!_panel) mountPanel();

  // load/refresh rows
  setBusy(true);
  try {
    const fc = await fetchDistrictsFC();
    _rows = (fc.features || []).map(f => ({
      id: f.properties?.id,
      name: f.properties?.name || '',
      region: f.properties?.region || '',
      geometry: f.geometry || null,
    })).sort((a,b)=> a.name.localeCompare(b.name));
    renderBody();
  } catch (e) {
    bodyEl().innerHTML = `<div class="dm-empty text-danger">Failed to load districts: ${e.message}</div>`;
  } finally {
    setBusy(false);
  }

  _panel.classList.add('open');
}

/* ---------- DOM + Render ---------- */

function mountPanel() {
  _panel = document.createElement('div');
  _panel.className = 'dm-panel';
  _panel.innerHTML = `
    <div class="dm-head">
      <div class="dm-title">
        <i class="fa fa-table-cells-large"></i>
        Districts
      </div>
      <div class="dm-actions">
        <input id="dm-search" class="form-control form-control-sm" placeholder="Search…">
        <button id="dm-close" class="btn btn-sm btn-dark"><i class="fa fa-xmark"></i> Close</button>
      </div>
    </div>
    <div class="dm-head-row">
      <div class="dm-col name">Name</div>
      <div class="dm-col region">Region</div>
      <div class="dm-col tools">Actions</div>
    </div>
    <div class="dm-body" id="dm-body"></div>
    <div class="dm-foot">
      <div class="dm-add">
        <input id="dm-new-name" class="form-control form-control-sm" placeholder="New district name">
        <select id="dm-new-region" class="form-select form-select-sm">
          <option value="">Region…</option>
          ${_regions.map(r => `<option>${r}</option>`).join('')}
        </select>
        <input id="dm-new-file" type="file" accept=".csv,.geojson,.json" class="d-none">
        <button id="dm-new-upload" class="btn btn-sm btn-outline-secondary" title="Upload boundary (CSV/GeoJSON)">
          <i class="fa fa-map"></i>
        </button>
        <button id="dm-add" class="btn btn-sm btn-primary" title="Add district">
          <i class="fa fa-plus"></i> Add
        </button>
        <span id="dm-new-hint" class="dm-hint text-muted">Optional: upload boundary before Add</span>
      </div>
    </div>
  `;
  document.body.appendChild(_panel);
  injectStyles();

  // Events
  _panel.querySelector('#dm-close').onclick = () => _panel.classList.remove('open');
  _panel.querySelector('#dm-search').oninput = (e)=> { _filter = (e.target.value||'').trim().toLowerCase(); renderBody(); };

  // New row
  const newFile = _panel.querySelector('#dm-new-file');
  let newGeom = null;
  _panel.querySelector('#dm-new-upload').onclick = () => newFile.click();
  newFile.onchange = async () => {
    if (!newFile.files?.length) return;
    try {
      newGeom = await parseBoundaryFile(newFile.files[0]);
      okToast('Boundary file attached for new district.');
    } catch (e) {
      errToast(e.message || 'Invalid boundary file.');
      newGeom = null;
    } finally {
      newFile.value = '';
    }
  };
  _panel.querySelector('#dm-add').onclick = async () => {
    const name = _panel.querySelector('#dm-new-name').value.trim();
    const region = _panel.querySelector('#dm-new-region').value.trim();
    if (!name || !region) return errToast('Name and Region are required.');
    setBusy(true);
    try {
      const saved = await createDistrict({ name, region, geojson: newGeom });
      _rows.push({ id:saved.id, name:saved.name, region:saved.region, geometry:saved.geojson || null });
      _rows.sort((a,b)=> a.name.localeCompare(b.name));
      _panel.querySelector('#dm-new-name').value = '';
      _panel.querySelector('#dm-new-region').value = '';
      newGeom = null;
      renderBody();
      okToast('District added.');
    } catch (e) {
      errToast(e.message || 'Add failed.');
    } finally {
      setBusy(false);
    }
  };
}

function bodyEl(){ return _panel.querySelector('#dm-body'); }

function renderBody() {
  const B = bodyEl();
  if (!_rows.length) {
    B.innerHTML = `<div class="dm-empty">No districts.</div>`;
    return;
  }

  const list = _rows.filter(r => {
    if (!_filter) return true;
    return r.name.toLowerCase().includes(_filter) || r.region.toLowerCase().includes(_filter);
  });

  // ❌ before: list.map(rowHTML)
  // ✅ pass the id each time
  B.innerHTML = list.map(r => rowHTML(r.id)).join('');

  // wire row actions
  list.forEach(r => wireRow(r.id));
}


function rowHTML(id) {
  const r = _rows.find(x => x.id === id) || { id, name: '', region: '', geometry: null };
  const hasGeom = !!r.geometry;
  return `
    <div class="dm-row" data-id="${id}">
      <div class="dm-col name">
        <input class="form-control form-control-sm dm-name" value="${escapeHtml(r.name)}">
      </div>
      <div class="dm-col region">
        <select class="form-select form-select-sm dm-region">
          ${_regions.map(x => `<option ${x===r.region?'selected':''}>${x}</option>`).join('')}
        </select>
      </div>
      <div class="dm-col tools">
        <input class="d-none dm-file" type="file" accept=".csv,.geojson,.json">
        <button class="btn btn-sm btn-outline-secondary dm-upload" title="Upload boundary (CSV/GeoJSON)">
          <i class="fa fa-map"></i>
        </button>
        <span class="dm-badge ${hasGeom?'ok':'miss'}" title="${hasGeom?'Boundary present':'No boundary'}">
          ${hasGeom?'<i class="fa fa-check"></i>':'<i class="fa fa-triangle-exclamation"></i>'}
        </span>
        <button class="btn btn-sm btn-success dm-save" title="Save">
          <i class="fa fa-floppy-disk"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger dm-del" title="Delete">
          <i class="fa fa-trash"></i>
        </button>
      </div>
    </div>
  `;
}


function wireRow(id) {
  const rowEl = _panel.querySelector(`.dm-row[data-id="${id}"]`);
  const r = _rows.find(x=>x.id===id);
  if (!rowEl || !r) return;

  // Upload
  const fileInp = rowEl.querySelector('.dm-file');
  rowEl.querySelector('.dm-upload').onclick = () => fileInp.click();
  fileInp.onchange = async () => {
    if (!fileInp.files?.length) return;
    try {
      const geom = await parseBoundaryFile(fileInp.files[0]);
      r._pendingGeom = geom;
      rowEl.querySelector('.dm-badge').className = 'dm-badge ok';
      rowEl.querySelector('.dm-badge').innerHTML = '<i class="fa fa-check"></i>';
      okToast('Boundary attached (not saved yet). Click Save.');
    } catch (e) {
      errToast(e.message || 'Invalid boundary file.');
    } finally {
      fileInp.value = '';
    }
  };

  // Save
  rowEl.querySelector('.dm-save').onclick = async () => {
    const name = rowEl.querySelector('.dm-name').value.trim();
    const region = rowEl.querySelector('.dm-region').value.trim();
    if (!name || !region) return errToast('Name and Region are required.');
    setBusy(true);
    try {
      const payload = { name, region };
      if (r._pendingGeom) payload.geojson = r._pendingGeom;
      const updated = await updateDistrict(r.id, payload);
      r.name = updated.name;
      r.region = updated.region;
      if (updated.geojson) r.geometry = updated.geojson;
      delete r._pendingGeom;
      okToast('Saved.');
    } catch (e) {
      errToast(e.message || 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  // Delete
  rowEl.querySelector('.dm-del').onclick = async () => {
    if (!confirm(`Delete district "${r.name}"?`)) return;
    setBusy(true);
    try {
      await deleteDistrictById(r.id);
      _rows = _rows.filter(x => x.id !== r.id);
      renderBody();
      okToast('Deleted.');
    } catch (e) {
      errToast(e.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };
}

/* ---------- File parsing (CSV/GeoJSON) ---------- */

async function parseBoundaryFile(file) {
  const text = await file.text();

  // JSON / GeoJSON
  if (/\{\s*"/.test(text.trim())) {
    let obj;
    try { obj = JSON.parse(text); } catch { throw new Error('Invalid JSON'); }
    return coerceAnyToGeometry(obj);
  }

  // CSV lat,lon
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Empty file');
  const header = lines[0].toLowerCase();
  let latIdx = -1, lngIdx = -1;
  const headers = header.split(/[;,]/).map(h => h.trim());
  headers.forEach((h,i) => {
    if (['lat','latitude','y'].includes(h)) latIdx = i;
    if (['lng','lon','long','longitude','x'].includes(h)) lngIdx = i;
  });
  const start = (latIdx>=0 && lngIdx>=0) ? 1 : 0;

  const points = [];
  for (let i=start;i<lines.length;i++){
    const parts = lines[i].split(/[;,]/).map(s=>s.trim());
    let lat, lng;
    if (start===1){
      lat = parseFloat(parts[latIdx]); lng = parseFloat(parts[lngIdx]);
    } else {
      if (parts.length < 2) continue;
      lat = parseFloat(parts[0]); lng = parseFloat(parts[1]);
    }
    if (Number.isFinite(lat) && Number.isFinite(lng)) points.push([lng, lat]);
  }
  if (points.length < 3) throw new Error('Need at least 3 points for a polygon');

  // close ring if needed
  const first = points[0], last = points[points.length-1];
  if (first[0]!==last[0] || first[1]!==last[1]) points.push([...first]);

  return { type:'Polygon', coordinates:[points] };
}

function coerceAnyToGeometry(obj) {
  // FeatureCollection
  if (obj.type === 'FeatureCollection') {
    const f = (obj.features||[]).find(x => x.geometry && /Polygon/i.test(x.geometry.type));
    if (!f) throw new Error('No polygon geometry found');
    return f.geometry;
  }
  // Feature
  if (obj.type === 'Feature' && obj.geometry) {
    if (!/Polygon/i.test(obj.geometry.type)) throw new Error('Geometry must be Polygon or MultiPolygon');
    return obj.geometry;
  }
  // Geometry
  if (obj.type && /Polygon/i.test(obj.type)) return obj;
  throw new Error('Unsupported JSON format; need GeoJSON Polygon/MultiPolygon');
}

/* ---------- Utilities ---------- */

function setBusy(on) {
  if (!_panel) return;
  _panel.classList.toggle('busy', !!on);
}

function okToast(msg){
  tip(msg, 'ok');
}
function errToast(msg){
  tip(msg, 'err');
}
let _toastTimer = null;
function tip(msg, kind='ok'){
  let t = document.getElementById('dm-tip');
  if (!t){
    t = document.createElement('div');
    t.id='dm-tip';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = kind==='ok' ? 'dm-tip ok' : 'dm-tip err';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=> t.className='dm-tip', 2200);
}

function escapeHtml(s=''){ return s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- Styles ---------- */

function injectStyles(){
  if (document.getElementById('dm-styles')) return;
  const css = document.createElement('style');
  css.id = 'dm-styles';
  css.textContent = `
.dm-panel{
  position:fixed; right:16px; top:16px; bottom:16px; width:560px; max-width:95vw;
  background:#fff;border-radius:14px;box-shadow:0 16px 36px rgba(0,0,0,.22);
  transform:translateX(120%); transition:transform .25s ease; z-index:2200;
  display:flex; flex-direction:column; overflow:hidden;
}
.dm-panel.open{ transform:translateX(0); }
.dm-panel.busy::after{
  content:'';
  position:absolute; inset:0; background:rgba(255,255,255,.45);
  backdrop-filter:saturate(120%) blur(2px);
}
.dm-head{ display:flex; justify-content:space-between; align-items:center; padding:.6rem .8rem; border-bottom:1px solid #eee; }
.dm-title{ font-weight:700; display:flex; gap:.5rem; align-items:center; }
.dm-actions{ display:flex; gap:.5rem; align-items:center; }
.dm-head-row{ display:grid; grid-template-columns: 1fr 220px 160px; gap:.5rem; padding:.35rem .8rem; font-weight:600; color:#333; }
.dm-body{ overflow:auto; padding:.35rem .6rem .6rem; }
.dm-row{ display:grid; grid-template-columns: 1fr 220px 160px; gap:.5rem; align-items:center; padding:.35rem .2rem; }
.dm-row:not(:last-child){ border-bottom:1px dashed #eee; }
.dm-col.tools{ display:flex; gap:.35rem; align-items:center; }
.dm-badge{ display:inline-flex; width:26px; height:26px; align-items:center; justify-content:center; border-radius:999px; border:1px solid #ddd; }
.dm-badge.ok{ background:#e9f9ef; color:#11823b; border-color:#bfe7ca; }
.dm-badge.miss{ background:#fff3cd; color:#9a6d00; border-color:#ffe69c; }
.dm-foot{ padding:.5rem .8rem; border-top:1px solid #eee; }
.dm-add{ display:grid; grid-template-columns:1fr 220px auto auto 1fr; gap:.5rem; align-items:center; }
.dm-hint{ font-size:.8rem; }
.dm-empty{ padding:1rem; color:#666; }
.dm-tip{
  position:fixed; left:50%; top:12px; transform:translateX(-50%);
  background:#111827; color:#fff; padding:.4rem .6rem; border-radius:8px;
  box-shadow:0 10px 24px rgba(0,0,0,.25); opacity:0; pointer-events:none; transition:opacity .2s;
}
.dm-tip.ok{ opacity:1; }
.dm-tip.err{ opacity:1; background:#7f1d1d; }
  `;
  document.head.appendChild(css);
}
