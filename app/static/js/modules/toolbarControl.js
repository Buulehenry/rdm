// modules/toolbarControl.js
import { setEditMode, setDeleteMode, isEditMode, isDeleteMode } from './modes.js';
import { openAddStationModal, openEditStationModal } from './addStationModal.js';
import { deleteStation } from './stationsApi.js';
import { toggleCompetitorPanel } from './competitorManager.js';
import { uploadVolumesCsv } from './volumesApi.js';
import { bulkUploadStationsCsv } from './stationsApi.js';
import { exportCurrentMap, exportWithScope, exportDistrictBatch } from './exportControl.js';
import { toggleHeatmap, isHeatmapEnabled } from './heatmapLayer.js';
import { toggleDistrictPanel } from './districtManager.js';


/**
 * Adds vertical toolbar: icons only, with floating tooltips outside the toolbar.
 */
export function addToolbar(map, refreshStations) {
  const Toolbar = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const c = L.DomUtil.create('div', 'leaflet-control map-toolbar');

      // --- one-time CSS (scrollable toolbar + dialogs + floating tooltip) ---
      injectOnce('toolbar-css', `
        .leaflet-control.map-toolbar{
          display:flex; flex-direction:column; gap:.4rem;
          padding:.35rem; background:#fff; border-radius:12px;
          box-shadow:0 10px 24px rgba(0,0,0,.2);
          max-height: calc(100vh - 150px); /* keep within viewport */
                          /* scroll when tall */
          scrollbar-gutter: stable both-edges;
          z-index: 1500;
        }
        .leaflet-left .leaflet-control.map-toolbar { margin-top: 8px; margin-left: 8px; }

        .map-toolbar-btn{
          width:36px; height:36px; border:0; border-radius:10px; background:#fff;
          box-shadow:0 4px 12px rgba(0,0,0,.15);
          display:flex; align-items:center; justify-content:center;
          cursor:pointer;
        }
        .map-toolbar-btn i{ font-size:16px; }
        .map-toolbar-btn.active{ outline:2px solid #4e9cff22; }

        /* Floating tooltip rendered in <body>, never clipped by toolbar */
        .map-floating-tip{
          position: fixed;
          padding: .25rem .5rem;
          background:#111; color:#fff; border-radius:6px; font-size:12px;
          white-space: nowrap; pointer-events: none;
          z-index: 4000; box-shadow:0 6px 16px rgba(0,0,0,.25);
          transform: translate(8px, -50%); /* nudge right & vertically center */
        }

        /* Simple modal */
        .csv-dlg{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2500;display:flex;align-items:center;justify-content:center;}
        .csv-box{background:#fff;border-radius:12px;box-shadow:0 10px 24px rgba(0,0,0,.2);min-width:320px;max-width:90vw;}
        .csv-head{padding:.6rem .8rem;border-bottom:1px solid #eee;}
        .csv-body{padding:.8rem;}
        .csv-actions{padding:.6rem .8rem;border-top:1px solid #eee;display:flex;gap:.5rem;justify-content:flex-end;}

        /* Blur helper for focus toggle */
        .leaflet-pane.blurred canvas,
        .leaflet-pane.blurred img,
        .leaflet-pane.blurred svg { filter: blur(2px) opacity(.6); }

        /* Export scope menu (opens on click) */
        .map-toolbar-export { position: relative; }
        .map-toolbar-export .scope-menu{
          position:absolute; left:44px; top:0;  /* to the right of 36px button */
          background:#fff; border-radius:10px; box-shadow:0 10px 24px rgba(0,0,0,.2);
          padding:.35rem; display:none; min-width:220px; z-index:3000;
        }
        .map-toolbar-export.open .scope-menu{ display:block; }
        .scope-menu button{
          display:block; width:100%; text-align:left; background:transparent; border:0; padding:.35rem .5rem; font-size:.9rem;
        }
        .scope-menu .sep{ height:1px; background:#eee; margin:.25rem 0; }
      `);

      // --- Add Station
      c.appendChild(btn({
        id:'tb-add-station', icon:'fa-plus', tip:'Add Station',
        click: () => {
          setEditMode(false, map);
          setDeleteMode(false, map);
          openAddStationModal();
        }
      }));

      // --- Export scopes (menu opens on click)
      const wrap = document.createElement('div');
      wrap.className = 'map-toolbar-export';
      wrap.innerHTML = `
        <div class="dropup">
          <button id="tb-export-scope" class="map-toolbar-btn" data-tip="Export Map">
            <i class="fa fa-download"></i>
          </button>
          <div class="scope-menu">
            <button data-scope="current">Current View</button>
            <button data-scope="country">Country</button>
            <button data-scope="region">Region (from filter)</button>
            <button data-scope="district">District (from filter)</button>
            <div class="sep"></div>
            <button data-scope="ours">Our Stations</button>
            <button data-scope="competitors">Competitors</button>
          </div>
        </div>
      `;
      c.appendChild(wrap);

      const exportBtn = wrap.querySelector('#tb-export-scope');
      const scopeMenu = wrap.querySelector('.scope-menu');

      // Tooltips for icons (including export)
      attachFloatingTip(exportBtn);

      exportBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        wrap.classList.toggle('open');
      });
      document.addEventListener('click', () => wrap.classList.remove('open'));
      scopeMenu.addEventListener('click', (e)=> e.stopPropagation());
      c.addEventListener('scroll', ()=> wrap.classList.remove('open'));

      wrap.querySelectorAll('.scope-menu button').forEach(b => {
        attachFloatingTip(b); // optional tips if you add data-tip later
        b.addEventListener('click', async () => {
          const scope = b.getAttribute('data-scope');
          await exportWithScope(map, map._rendererRef, { scope, fileBase:'Uganda' });
          wrap.classList.remove('open');
        });
      });

      // --- Batch Export (ZIP)
      c.appendChild(btn({
        id:'tb-batch', icon:'fa-file-zipper', tip:'Batch Export Districts (ZIP)',
        click: () => showBatchDialog()
      }));

      // --- Competitor Manager
      c.appendChild(btn({
        id:'tb-manage-competitors', icon:'fa-users-gear', tip:'Manage Competitors',
        click: () => toggleCompetitorPanel()
      }));

      if (window.currentUserRole !== 'viewer') {
        c.appendChild(btn({
          id: 'tb-districts',
          icon: 'fa-table-cells-large',   // unique icon
          tip: 'Manage Districts',
          click: () => toggleDistrictPanel()
        }));
      }


      // --- Edit Mode
      c.appendChild(btn({
        id:'tb-edit', icon:'fa-pen', tip:'Edit Mode', toggle:true,
        click: (b) => {
          const newState = !isEditMode();
          setEditMode(newState, map);
          setDeleteMode(false, map);
          b.classList.toggle('active', newState);
          sync('#tb-delete', false);
        }
      }));

      // --- Delete Mode
      c.appendChild(btn({
        id:'tb-delete', icon:'fa-trash-can', tip:'Delete Mode', toggle:true, extra:'danger',
        click: (b) => {
          const newState = !isDeleteMode();
          setDeleteMode(newState, map);
          setEditMode(false, map);
          b.classList.toggle('active', newState);
          sync('#tb-edit', false);
        }
      }));

      // --- Fullscreen
      c.appendChild(btn({
        id:'tb-full', icon:'fa-up-right-and-down-left-from-center', tip:'Fullscreen', toggle:true,
        click: (b) => toggleFullscreen(map, b)
      }));

      // --- Quick Export (Current View)
      c.appendChild(btn({
        id:'tb-export', icon:'fa-download', tip:'Export Map (JPG)',
        click: async () => { await exportCurrentMap(map, { scope:'current', fileBase:'Uganda' }); }
      }));

      // --- Focus (All / Our / Competitors)
      let focusMode = 'all';
      c.appendChild(btn({
        id:'tb-focus', icon:'fa-layer-group', tip:'Focus (All / Our / Competitors)',
        click: () => {
          focusMode = (focusMode === 'all') ? 'our' : (focusMode === 'our' ? 'competitors' : 'all');
          applyFocus(focusMode);
          document.getElementById('tb-focus')?.setAttribute(
            'data-tip',
            focusMode === 'all' ? 'Focus: All' : (focusMode === 'our' ? 'Focus: Our Stations' : 'Focus: Competitors')
          );
        }
      }));

      // --- Heatmap Toggle
      const heatBtn = btn({
        id:'tb-heat', icon:'fa-fire', tip:'Heatmap (Traffic/Density)', toggle:true,
        click: (b) => {
          const enabled = toggleHeatmap(map);
          b.classList.toggle('active', enabled);
          b.setAttribute('data-tip', enabled ? 'Heatmap: ON' : 'Heatmap: OFF');
          try { map._rendererRef?.refreshAll(); } catch {}
        }
      });
      c.appendChild(heatBtn);
      if (isHeatmapEnabled?.()) {
        heatBtn.classList.add('active');
        heatBtn.setAttribute('data-tip', 'Heatmap: ON');
      }

      // --- CSV Uploads (RBAC: admin/analyst)
      if (window.currentUserRole !== 'viewer') {
        c.appendChild(btn({
          id:'tb-upload', icon:'fa-file-arrow-up', tip:'Upload Daily Volumes CSV',
          click: () => showCsvUploadDialog()
        }));
        c.appendChild(btn({
          id:'tb-bulk-stations', icon:'fa-table', tip:'Bulk Upload Stations (CSV)',
          click: () => showBulkStationsDialog()
        }));
      }

      // Prevent map panning/zoom while using toolbar
      L.DomEvent.disableClickPropagation(c);
      L.DomEvent.disableScrollPropagation(c);

      // ----- dialog helpers -----
      function showCsvUploadDialog(){
        const dlg = document.createElement('div');
        dlg.className = 'csv-dlg';
        dlg.innerHTML = `
          <div class="csv-box" style="min-width:480px;">
            <div class="csv-head"><strong>Upload Daily Volumes CSV</strong></div>
            <div class="csv-body">
              <div class="small text-muted mb-2">
                Headers: <code>station_id,date,volume</code> or <code>station_name,date,volume</code> (YYYY-MM-DD)
              </div>
              <input type="file" id="csv-file" accept=".csv" class="form-control form-control-sm mb-3">

              <div class="row g-2 mb-2">
                <div class="col-4">
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="csv-dryrun" checked>
                    <label class="form-check-label" for="csv-dryrun">Dry run (preview)</label>
                  </div>
                </div>
                <div class="col-4">
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="csv-fuzzy" checked>
                    <label class="form-check-label" for="csv-fuzzy">Fuzzy match names</label>
                  </div>
                </div>
                <div class="col-4">
                  <label class="form-label mb-0 small">Min similarity</label>
                  <input id="csv-minratio" type="number" step="0.01" min="0.5" max="1" value="0.88"
                        class="form-control form-control-sm">
                </div>
              </div>

              <div id="csv-msg" class="small"></div>

              <div id="csv-details" class="mt-2" style="display:none;">
                <div class="small text-muted mb-1">Unmatched station names (first 20):</div>
                <pre id="csv-unmatched" style="max-height:140px;overflow:auto;background:#f8f9fa;border:1px solid #eee;padding:.5rem;border-radius:6px;"></pre>
                <div class="small text-muted mb-1 mt-2">Errors (first 20):</div>
                <pre id="csv-errors" style="max-height:140px;overflow:auto;background:#f8f9fa;border:1px solid #eee;padding:.5rem;border-radius:6px;"></pre>
              </div>
            </div>
            <div class="csv-actions">
              <button class="btn btn-sm btn-secondary" id="csv-cancel">Cancel</button>
              <button class="btn btn-sm btn-primary" id="csv-upload">Upload</button>
            </div>
          </div>
        `;
        document.body.appendChild(dlg);

        dlg.querySelector('#csv-cancel').onclick = ()=> dlg.remove();
        dlg.querySelector('#csv-upload').onclick = async ()=>{
          const f = dlg.querySelector('#csv-file').files[0];
          const msg = dlg.querySelector('#csv-msg');
          const details = dlg.querySelector('#csv-details');
          const preUn = dlg.querySelector('#csv-unmatched');
          const preEr = dlg.querySelector('#csv-errors');

          const opts = {
            dryRun: dlg.querySelector('#csv-dryrun').checked,
            fuzzy: dlg.querySelector('#csv-fuzzy').checked,
            minRatio: parseFloat(dlg.querySelector('#csv-minratio').value || '0.9')
          };

          if (!f){ msg.textContent = 'Choose a CSV file.'; msg.className='small text-danger'; return; }
          msg.textContent = 'Uploading...'; msg.className='small text-muted';
          details.style.display = 'none';

          try{
            const res = await uploadVolumesCsv(f, opts);
            const summary = `Rows: ${res.rows}, Inserted: ${res.inserted}, Updated: ${res.updated}`
              + (res.dry_run ? ' (dry run)' : '');
            msg.textContent = summary;
            msg.className = (res.inserted || res.updated) ? 'small text-success' : 'small text-warning';

            // Show diagnostics
            preUn.textContent = (res.unmatched && res.unmatched.length)
              ? res.unmatched.slice(0,20).join('\n') : '—';
            preEr.textContent = (res.errors && res.errors.length)
              ? res.errors.slice(0,20).join('\n') : '—';
            details.style.display = 'block';

            // If dry run and looks good, hint to run for real
            if (opts.dryRun && (res.inserted || res.updated)){
              msg.textContent += '  Looks good — uncheck “Dry run” to apply.';
            }

            // If we actually wrote data, refresh charts/layers
            if (!opts.dryRun && (res.inserted || res.updated)) {
              setTimeout(()=> {
                dlg.remove();
                try { window.map?._rendererRef?.refreshAll?.(); null; } catch {}
              }, 900);
            }
          }catch(err){
            msg.textContent = `Upload failed: ${err.message}`;
            msg.className='small text-danger';
          }
        };
      }


      function showBatchDialog(){
        const dlg = document.createElement('div');
        dlg.className = 'csv-dlg';
        dlg.innerHTML = `
          <div class="csv-box">
            <div class="csv-head"><strong>Batch Export Districts</strong></div>
            <div class="csv-body">
              <div class="form-check mb-2">
                <input class="form-check-input" type="radio" name="be_scope" id="be_all" value="all" checked>
                <label class="form-check-label" for="be_all">All Uganda</label>
              </div>
              <div class="form-check mb-2">
                <input class="form-check-input" type="radio" name="be_scope" id="be_region" value="region">
                <label class="form-check-label" for="be_region">By Region</label>
              </div>
              <select id="be_region_sel" class="form-select form-select-sm" disabled>
                <option value="">Select region…</option>
                <option>Kampala Central</option>
                <option>Kampala Western</option>
                <option>Northern</option>
                <option>Western</option>
                <option>Eastern</option>
                <option>South Western</option>
              </select>
              <div class="small text-muted mt-2">We’ll auto-zoom each district, snapshot JPG, and zip them.</div>
              <div id="be_msg" class="small mt-2"></div>
            </div>
            <div class="csv-actions">
              <button class="btn btn-sm btn-secondary" id="be_cancel">Cancel</button>
              <button class="btn btn-sm btn-primary" id="be_go">Start</button>
            </div>
          </div>
        `;
        document.body.appendChild(dlg);
        const sel = dlg.querySelector('#be_region_sel');
        dlg.querySelector('#be_region').onchange = () => sel.disabled = false;
        dlg.querySelector('#be_all').onchange = () => { sel.disabled = true; sel.value=''; };
        dlg.querySelector('#be_cancel').onclick = () => dlg.remove();
        dlg.querySelector('#be_go').onclick = async () => {
          const msg = dlg.querySelector('#be_msg');
          const byRegion = dlg.querySelector('#be_region').checked;
          const region = byRegion ? (sel.value || '').trim() : null;
          msg.textContent = 'Working…'; msg.className='small text-muted';
          try {
            await exportDistrictBatch(map, map._rendererRef, { region, fileBase:'Uganda_Districts' });
            msg.textContent = 'Done (check your Downloads).'; msg.className='small text-success';
            setTimeout(()=> dlg.remove(), 900);
          } catch(e) {
            msg.textContent = e.message; msg.className='small text-danger';
          }
        };
      }

      function showBulkStationsDialog(){
        const dlg = document.createElement('div');
        dlg.className = 'csv-dlg';
        dlg.innerHTML = `
          <div class="csv-box" style="min-width:360px;">
            <div class="csv-head d-flex justify-content-between align-items-center">
              <strong>Bulk Upload Stations</strong>
              <a class="btn btn-sm btn-outline-secondary" href="/api/stations/template.csv">Template</a>
            </div>
            <div class="csv-body">
              <div class="small text-muted mb-2">
                CSV headers: <code>id(optional), name, latitude, longitude, category, pin_shape, pin_color, competitor_id, competitor_name, region, district</code>
              </div>
              <input type="file" id="bs-file" accept=".csv" class="form-control form-control-sm mb-2">

              <div class="row g-2">
                <div class="col-6">
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="bs-update" checked>
                    <label class="form-check-label" for="bs-update">Update existing by id</label>
                  </div>
                </div>
                <div class="col-6">
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="bs-atomic">
                    <label class="form-check-label" for="bs-atomic">Atomic (all-or-nothing)</label>
                  </div>
                </div>
                <div class="col-6">
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="bs-dryrun">
                    <label class="form-check-label" for="bs-dryrun">Dry run (validate only)</label>
                  </div>
                </div>
                <div class="col-6">
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="bs-autocomp">
                    <label class="form-check-label" for="bs-autocomp">Auto-create competitor</label>
                  </div>
                </div>
              </div>

              <div id="bs-msg" class="small mt-2"></div>
            </div>
            <div class="csv-actions">
              <button class="btn btn-sm btn-secondary" id="bs-cancel">Cancel</button>
              <button class="btn btn-sm btn-primary" id="bs-upload">Upload</button>
            </div>
          </div>
        `;
        document.body.appendChild(dlg);
        dlg.querySelector('#bs-cancel').onclick = ()=> dlg.remove();
        dlg.querySelector('#bs-upload').onclick = async ()=>{
          const f = dlg.querySelector('#bs-file').files[0];
          const msg = dlg.querySelector('#bs-msg');
          const opts = {
            update_existing: dlg.querySelector('#bs-update').checked,
            atomic: dlg.querySelector('#bs-atomic').checked,
            dry_run: dlg.querySelector('#bs-dryrun').checked,
            auto_create_competitor: dlg.querySelector('#bs-autocomp').checked
          };
          if(!f){ msg.textContent = 'Choose a CSV file.'; msg.className='small text-danger'; return; }
          msg.textContent = 'Uploading…'; msg.className='small text-muted';
          try {
            const res = await bulkUploadStationsCsv(f, opts);
            msg.innerHTML = `Inserted: <b>${res.inserted}</b>, Updated: <b>${res.updated}</b>${res.errors?.length ? ', Errors: '+res.errors.length : ''}`;
            msg.className='small text-success';
            setTimeout(()=> {
              dlg.remove();
              if (map && map._rendererRef) map._rendererRef.reloadAll();
            }, 900);
          } catch (e) {
            msg.textContent = e.message;
            msg.className='small text-danger';
          }
        };
      }

      return c;
    }
  });

  map.addControl(new Toolbar());

  // Marker interaction hooks used by mapCore
  map._stationInteraction = {
    edit: (props, marker) => openEditStationModal(props, marker),
    delete: async (props) => {
      if (!confirm(`Delete "${props.name}"?`)) return;
      await deleteStation(props.id);
      refreshStations();
    }
  };

  window.addEventListener('resize', () => {
    if (document.getElementById('map')?.classList.contains('map-fullscreen')) {
      map.invalidateSize();
    }
  });
}

/* ---------- Helper UI bits ---------- */
function btn({ id, icon, tip, click, toggle=false, extra='' }) {
  const el = document.createElement('button');
  el.type = 'button';
  el.id = id;
  el.className = `map-toolbar-btn ${extra}`.trim();
  el.setAttribute('data-tip', tip || '');
  el.innerHTML = `<i class="fa ${icon}"></i>`;
  el.addEventListener('click', e => { e.preventDefault(); click(el); });
  attachFloatingTip(el); // <<— attach floating tooltip to every icon
  return el;
}

function attachFloatingTip(el){
  const text = el.getAttribute('data-tip');
  if (!text) return;

  let tipEl = null;
  const place = () => {
    if (!tipEl) return;
    const r = el.getBoundingClientRect();
    tipEl.style.left = `${r.right}px`;
    tipEl.style.top  = `${r.top + r.height/2}px`;
  };
  const show = () => {
    tipEl = document.createElement('div');
    tipEl.className = 'map-floating-tip';
    tipEl.textContent = text;
    document.body.appendChild(tipEl);
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
  };
  const hide = () => {
    if (!tipEl) return;
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    tipEl.remove();
    tipEl = null;
  };
  el.addEventListener('mouseenter', show);
  el.addEventListener('mouseleave', hide);
  el.addEventListener('blur', hide);
}

function sync(selector, active) {
  const el = document.querySelector(selector);
  if (el) el.classList.toggle('active', active);
}

function toggleFullscreen(map, btn) {
  const mapEl = document.getElementById('map');
  const active = mapEl.classList.toggle('map-fullscreen');
  document.body.classList.toggle('fullscreen-lock', active);
  const icon = btn.querySelector('i');
  if (active) {
    icon.classList.remove('fa-up-right-and-down-left-from-center');
    icon.classList.add('fa-down-left-and-up-right-to-center');
    btn.setAttribute('data-tip','Exit Fullscreen');
  } else {
    icon.classList.remove('fa-down-left-and-up-right-to-center');
    icon.classList.add('fa-up-right-and-down-left-from-center');
    btn.setAttribute('data-tip','Fullscreen');
  }
  setTimeout(()=> map.invalidateSize(), 300);
}

function applyFocus(mode){
  const ours = document.querySelector('.leaflet-pane.oursPane');
  const comps = document.querySelector('.leaflet-pane.competitorsPane');
  const targs = document.querySelector('.leaflet-pane.targetsPane');
  [ours, comps, targs].forEach(p => { if(p) p.classList.remove('blurred'); });

  if (mode === 'our') {
    comps?.classList.add('blurred');
    targs?.classList.add('blurred');
  } else if (mode === 'competitors') {
    ours?.classList.add('blurred');
    targs?.classList.add('blurred');
  }
}

// One-time style inject
function injectOnce(id, cssText) {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = cssText;
  document.head.appendChild(style);
}
