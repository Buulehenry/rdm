// modules/competitorModal.js
import { createCompetitor, loadCompetitors } from './competitorsApi.js';
import { rebuildCompetitorFilters } from './filtersControl.js';

let formEl, modalEl, nameInput, colorInput, alertBox;

export function initCompetitorModal() {
  modalEl     = document.getElementById('addCompetitorModal');
  formEl      = document.getElementById('add-competitor-form');
  nameInput   = document.getElementById('competitor-name');
  colorInput  = document.getElementById('competitor-color');
  alertBox    = document.getElementById('add-competitor-alert');

  if (!modalEl || !formEl) {
    console.warn('Competitor modal elements not found.');
    return;
  }

  formEl.addEventListener('submit', onSubmit);
  modalEl.addEventListener('shown.bs.modal', () => nameInput?.focus());
  modalEl.addEventListener('hidden.bs.modal', resetForm);
}

export function openCompetitorModal() {
  resetForm();
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

async function onSubmit(e) {
  e.preventDefault();
  const name = (nameInput.value || '').trim();
  let pin_color = colorInput.value || '';

  if (!name) return showError('Name required.');
  if (!pin_color.startsWith('#')) pin_color = '#' + pin_color;

  try {
    await createCompetitor({ name, pin_color });
    await loadCompetitors(true);            // refresh cache
    rebuildCompetitorFilters();             // rebuild UI filters
    bootstrap.Modal.getInstance(modalEl).hide();
    document.dispatchEvent(new CustomEvent('competitor:created', { detail:{ name }}));
  } catch (err) {
    showError(err.message);
  }
}

function showError(msg) {
  if (!alertBox) return;
  alertBox.textContent = msg;
  alertBox.classList.remove('d-none');
}

function resetForm() {
  formEl?.reset();
  alertBox?.classList.add('d-none');
}
