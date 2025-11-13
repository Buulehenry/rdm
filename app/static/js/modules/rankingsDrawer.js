// modules/rankingsDrawer.js
import { fetchRankings } from './volumesApi.js';

let _host = null;
let _cssEl = null;

/**
 * Mount the rankings drawer. Pass a custom width if you want it wider.
 * Example: mountRankingsDrawer({ width: 560 })
 */
export function mountRankingsDrawer(opts = {}) {
  const { width = 520 } = opts; // << default wider than before (was 380)

  if (_host) {
    setWidth(width);
    return;
  }

  _host = document.createElement('div');
  _host.className = 'rankings-drawer';
  _host.innerHTML = `
    <div class="rk-head">
      <strong>Top Stations — <span id="rk-period-label">This Month</span></strong>
      <div class="rk-actions">
        <select id="rk-period" class="form-select form-select-sm">
          <option value="this_month" selected>This Month</option>
          <option value="last_month">Last Month</option>
        </select>
        <button id="rk-refresh" class="btn btn-sm btn-outline-secondary">Refresh</button>
        <button id="rk-toggle" class="btn btn-sm btn-secondary">Hide</button>
      </div>
    </div>
    <div class="rk-body">
      <div id="rk-list" class="rk-list"></div>
    </div>
  `;
  document.body.appendChild(_host);

  // interactions
  const periodSel = _host.querySelector('#rk-period');
  const periodLbl = _host.querySelector('#rk-period-label');

  _host.querySelector('#rk-toggle').onclick = () => _host.classList.toggle('closed');
  _host.querySelector('#rk-refresh').onclick = () => refreshRankings();
  periodSel.onchange = () => {
    periodLbl.textContent = (periodSel.value === 'this_month') ? 'This Month' : 'Last Month';
    refreshRankings();
  };

  // keep map from panning when using the drawer
  L.DomEvent.disableClickPropagation(_host);
  L.DomEvent.disableScrollPropagation(_host);

  // CSS (with width knob)
  injectCssOnce(width);

  refreshRankings();
}

export async function refreshRankings(){
  const list = document.getElementById('rk-list');
  const period = document.getElementById('rk-period')?.value || 'this_month';
  list.innerHTML = '<div class="p-2 small text-muted">Loading…</div>';
  try{
    const rows = await fetchRankings({ period, category:'rubis' });
    if(!rows.length){ list.innerHTML = '<div class="p-2 small text-muted">No data</div>'; return; }
    list.innerHTML = rows.slice(0, 50).map((r,i)=> `
      <div class="rk-item" title="${escapeHtml(r.station_name)}">
        <div class="rk-name">${i+1}. ${escapeHtml(r.station_name)}</div>
        <div class="rk-vol">${Number(r.total_volume||0).toLocaleString()} L</div>
      </div>
    `).join('');
  }catch(e){
    list.innerHTML = `<div class="p-2 small text-danger">${e.message}</div>`;
  }
}

/* ---------- CSS helpers ---------- */
function injectCssOnce(widthPx){
  if (_cssEl) { setWidth(widthPx); return; }
  _cssEl = document.createElement('style');
  _cssEl.id = 'rk-css';
  _cssEl.textContent = cssTemplate(widthPx);
  document.head.appendChild(_cssEl);
}
function setWidth(widthPx){
  if (_cssEl) _cssEl.textContent = cssTemplate(widthPx);
}
function cssTemplate(widthPx){
  return `
:root { --rk-width: ${Math.max(320, Number(widthPx)||520)}px; }

.rankings-drawer{
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
  width: var(--rk-width);
  max-width: min(95vw, var(--rk-width));
  background:#fff; border-radius:12px; box-shadow:0 10px 24px rgba(0,0,0,.2);
  z-index:1200; overflow:hidden;
}
.rankings-drawer.closed{ height:42px; }

.rk-head{
  display:flex; align-items:center; justify-content:space-between;
  padding:.5rem .75rem; border-bottom:1px solid #eee; gap:.5rem;
}
.rk-actions{ display:flex; gap:.4rem; align-items:center; }

.rk-body{ max-height:280px; overflow:auto; }
.rk-item{
  display:flex; justify-content:space-between; gap:.75rem;
  padding:.35rem .75rem; border-bottom:1px dashed #eee;
}
.rk-name{ font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rk-vol{ font-variant-numeric: tabular-nums; }

@media (max-width: 640px){
  :root { --rk-width: 95vw; }
}
`;
}


/* ---------- local escape ---------- */
function escapeHtml(s=''){ return s.replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
