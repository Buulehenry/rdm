// modules/competitorManager.js
import { loadCompetitors, getCompetitors, createCompetitor } from './competitorsApi.js';
import { rebuildCompetitorFilters } from './filtersControl.js';
import { jsonFetch, escapeHtml, debounce } from './utils.js';

let panelEl, listEl, addFormEl, nameInputEl, colorInputEl, closeBtnEl;
let isOpen = false;
let onChangeCallback = null; // optional external hook

export function initCompetitorManager(options = {}) {
  onChangeCallback = options.onChange || null;
  injectPanel();
  wireAddForm();
  document.addEventListener('keydown', e => {
    if (isOpen && e.key === 'Escape') toggleCompetitorPanel(false);
  });
}

export function toggleCompetitorPanel(force) {
  if (typeof force === 'boolean') isOpen = force;
  else isOpen = !isOpen;
  panelEl.classList.toggle('open', isOpen);
  if (isOpen) {
    refreshList();
  }
}

async function refreshList() {
  await loadCompetitors(true);
  rebuildCompetitorFilters();
  const comps = getCompetitors();
  listEl.innerHTML = '';
  if (!comps.length) {
    listEl.innerHTML = '<div class="text-muted small py-2">No competitors yet.</div>';
    return;
  }
  comps.forEach(c => listEl.appendChild(renderRow(c)));
  if (onChangeCallback) onChangeCallback(); // triggers station refresh if needed
}

function renderRow(comp) {
  const row = document.createElement('div');
  row.className = 'comp-row';
  row.dataset.id = comp.id;

  row.innerHTML = `
    <input type="color" class="comp-color" value="${comp.pin_color}">
    <input type="text" class="form-control form-control-sm comp-name" value="${escapeHtml(comp.name)}" maxlength="128">
    <div class="comp-meta">
      ${comp.station_count !== undefined ? `<span class="badge bg-light text-dark">${comp.station_count}</span>` : ''}
    </div>
    <div class="comp-actions">
      <button class="btn btn-sm btn-outline-success save-btn d-none" title="Save"><i class="fa fa-check"></i></button>
      <button class="btn btn-sm btn-outline-danger del-btn" title="Delete"><i class="fa fa-trash"></i></button>
    </div>
  `;

  const colorEl = row.querySelector('.comp-color');
  const nameEl  = row.querySelector('.comp-name');
  const saveBtn = row.querySelector('.save-btn');
  const delBtn  = row.querySelector('.del-btn');

  let dirty = false;
  function markDirty() {
    if (!dirty) {
      dirty = true;
      saveBtn.classList.remove('d-none');
    }
  }

  colorEl.addEventListener('input', markDirty);
  nameEl.addEventListener('input', debounce(markDirty, 150));

  saveBtn.addEventListener('click', async () => {
    await updateCompetitor(comp.id, {
      name: nameEl.value.trim(),
      pin_color: colorEl.value
    });
    dirty = false;
    saveBtn.classList.add('d-none');
    refreshList();
  });

  delBtn.addEventListener('click', async () => {
    if (!confirm(`Delete competitor "${comp.name}"?`)) return;
    await deleteCompetitor(comp.id);
    refreshList();
  });

  return row;
}

function injectPanel() {
  panelEl = document.createElement('div');
  panelEl.id = 'competitor-panel';
  panelEl.innerHTML = `
    <div class="cp-header">
      <span><i class="fa fa-users-gear me-1"></i> Competitors</span>
      <button type="button" class="btn-close btn-close-white cp-close"></button>
    </div>
    <div class="cp-body">
      <form id="comp-add-form" class="comp-add mb-2">
        <div class="input-group input-group-sm">
          <input required class="form-control" id="comp-add-name" placeholder="Name">
          <input type="color" id="comp-add-color" class="form-control form-control-color p-0"
                 value="#ff4d4d" title="Color" style="max-width:46px;">
          <button class="btn btn-primary" type="submit"><i class="fa fa-plus"></i></button>
        </div>
        <div class="invalid-feedback d-block d-none" id="comp-add-error"></div>
      </form>
      <div id="comp-list"></div>
    </div>
  `;
  document.body.appendChild(panelEl);

  listEl = panelEl.querySelector('#comp-list');
  addFormEl = panelEl.querySelector('#comp-add-form');
  nameInputEl = panelEl.querySelector('#comp-add-name');
  colorInputEl = panelEl.querySelector('#comp-add-color');
  closeBtnEl = panelEl.querySelector('.cp-close');
  closeBtnEl.addEventListener('click', () => toggleCompetitorPanel(false));
}

function wireAddForm() {
  const errBox = document.getElementById('comp-add-error');
  addFormEl.addEventListener('submit', async e => {
    e.preventDefault();
    errBox.classList.add('d-none');
    const name = nameInputEl.value.trim();
    const pin_color = colorInputEl.value;
    if (!name) {
      errBox.textContent = 'Name required.';
      errBox.classList.remove('d-none');
      return;
    }
    try {
      await createCompetitor({ name, pin_color });
      nameInputEl.value = '';
      await refreshList();
      nameInputEl.focus();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('d-none');
    }
  });
}

/* ---------- API helpers ---------- */

async function updateCompetitor(id, payload) {
  return jsonFetch(`/api/competitors/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
  });
}

async function deleteCompetitor(id) {
  return jsonFetch(`/api/competitors/${id}`, { method: 'DELETE' });
}
