// modules/addStationModal.js
import { createStation, updateStation } from './stationsApi.js';
import { getCompetitors } from './competitorsApi.js';

let mapRef;
let pickMarker = null;
let picking = false;

let lastFormData = null;
let wasEditing = false;

let formEl, modalEl, catSelect, compWrap, compSelect,
  latInput, lngInput, pickBtn, alertBox, pinShapeSelect, pinColorInput;
let coordModeGroup, geoLocateBtn, coordHelp;
let pickBannerEl = null;

// Region/District selects
let regionEl, districtEl;

// Districts cache: [{ name, region }]
let _districts = null;

export function initAddStationModal(map) {
  mapRef = map;

  modalEl   = document.getElementById('addStationModal');
  formEl    = document.getElementById('add-station-form');
  catSelect = document.getElementById('station-category');
  compWrap  = document.getElementById('competitor-select-wrap');
  compSelect= document.getElementById('competitor-select');
  latInput  = document.getElementById('lat-input');
  lngInput  = document.getElementById('lng-input');
  pickBtn   = document.getElementById('pick-location-btn');
  alertBox  = document.getElementById('add-station-alert');
  pinShapeSelect = document.getElementById('pin-shape');
  pinColorInput  = document.getElementById('pin-color');
  coordModeGroup = document.getElementById('coord-mode-group');
  geoLocateBtn   = document.getElementById('geo-location-btn');
  coordHelp      = document.getElementById('coord-help');

  // NEW: selects
  regionEl   = document.getElementById('station-region');
  districtEl = document.getElementById('station-district');

  if (!modalEl) {
    console.warn('Add Station modal not found.');
    return;
  }

  if (catSelect) catSelect.addEventListener('change', toggleCompetitorField);
  if (pickBtn)   pickBtn.addEventListener('click', startPicking);
  map.on('click', mapClick);

  if (coordModeGroup) coordModeGroup.addEventListener('change', onCoordModeChange);
  if (geoLocateBtn)   geoLocateBtn.addEventListener('click', useGeolocation);

  // region/district listeners
  if (regionEl)   regionEl.addEventListener('change', onRegionChange);
  if (districtEl) districtEl.addEventListener('change', onDistrictChange);

  if (formEl) {
    formEl.addEventListener('submit', submitForm);
    modalEl.addEventListener('hidden.bs.modal', () => {
      formEl.dataset.editId = '';
      resetModalTitle();
      if (!picking) {
        removePickBanner();
        mapRef.getContainer().style.cursor = '';
      }
    });
  }

  document.addEventListener('keydown', escCancelPick);

  onCoordModeChange();
  // preload districts (not blocking)
  ensureDistrictsLoaded().then(() => {
    ensureRegionOptions();
    applyRegionToDistricts(regionEl?.value || '');
  });
}

export function openAddStationModal() {
  resetForm();
  resetModalTitle();
  populateCompetitors();
  // ensure districts ready & district select filtered
  ensureDistrictsLoaded().then(() => {
    ensureRegionOptions();
    applyRegionToDistricts(regionEl?.value || '');
  });
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

export function openEditStationModal(props, marker) {
  resetForm();
  populateCompetitors(async () => {
    formEl.dataset.editId = props.id;
    setModalToEdit();

    formEl.name.value = props.name || '';
    catSelect.value   = props.category || 'rubis';
    toggleCompetitorField();

    if (props.category === 'competitor' && props.competitor_id) {
      compSelect.value = props.competitor_id;
    }

    pinShapeSelect.value = props.pin_shape || 'marker';
    pinColorInput.value  = props.pin_color || '#2E7D32';

    if (marker?.getLatLng) {
      latInput.value = marker.getLatLng().lat.toFixed(6);
      lngInput.value = marker.getLatLng().lng.toFixed(6);
    } else {
      latInput.value = (props.latitude ?? props.lat ?? '').toString();
      lngInput.value = (props.longitude ?? props.lng ?? '').toString();
    }

    // Region/District
    await ensureDistrictsLoaded();
    ensureRegionOptions();
    if (regionEl) regionEl.value = props.region || '';
    applyRegionToDistricts(regionEl?.value || '');
    if (districtEl) districtEl.value = props.district || '';

    const manualRadio = document.getElementById('coord_mode_manual');
    if (manualRadio) manualRadio.checked = true;
    onCoordModeChange();

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  });
}

/* ---------- Districts data ---------- */
async function ensureDistrictsLoaded() {
  if (_districts) return _districts;
  try {
    const r = await fetch('/api/districts/');
    if (!r.ok) throw new Error('districts load failed');
    const gj = await r.json(); // FeatureCollection
    _districts = (gj.features || [])
      .map(f => ({
        name: String(f?.properties?.name || '').trim(),
        region: String(f?.properties?.region || '').trim()
      }))
      .filter(d => d.name);
  } catch {
    _districts = []; // fail gracefully
  }
  return _districts;
}

function ensureRegionOptions() {
  if (!regionEl || !_districts) return;
  // If options are already present (beyond a placeholder), don’t overwrite
  if (regionEl.options && regionEl.options.length > 1) return;

  const regions = Array.from(new Set(_districts.map(d => d.region).filter(Boolean))).sort();
  regionEl.innerHTML = '<option value="">— Select region —</option>' +
    regions.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
}

function onRegionChange() {
  const region = regionEl?.value || '';
  applyRegionToDistricts(region);
  // clear district selection to avoid mismatch
  if (districtEl) districtEl.value = '';
}

function onDistrictChange() {
  // If region empty or mismatched, fix region based on chosen district
  const dName = districtEl?.value || '';
  if (!dName || !_districts || !regionEl) return;
  const rec = _districts.find(d => d.name === dName);
  if (rec && (!regionEl.value || regionEl.value !== rec.region)) {
    regionEl.value = rec.region;
    applyRegionToDistricts(rec.region);
    districtEl.value = rec.name; // keep the chosen district
  }
}

function applyRegionToDistricts(region) {
  if (!districtEl) return;
  const was = districtEl.value;
  districtEl.innerHTML = '<option value="">— Select district —</option>';

  if (!region) {
    districtEl.disabled = true;
    return;
  }

  const items = (_districts || []).filter(d => d.region === region);
  items.sort((a,b) => a.name.localeCompare(b.name));
  for (const d of items) {
    const opt = document.createElement('option');
    opt.value = d.name;
    opt.textContent = d.name;
    districtEl.appendChild(opt);
  }
  districtEl.disabled = false;

  if (items.some(d => d.name === was)) {
    districtEl.value = was;
  } else {
    districtEl.value = '';
  }
}

/* ---------- Coordinate modes ---------- */
function getCoordMode() {
  return document.querySelector('input[name="coord_mode"]:checked')?.value || 'map';
}
function onCoordModeChange() {
  const mode = getCoordMode();
  if (mode === 'map') enableMapMode();
  else if (mode === 'manual') enableManualMode();
  else if (mode === 'geo') enableGeoMode();
}
function enableMapMode() {
  picking = false;
  mapRef.getContainer().style.cursor = '';
  latInput.readOnly = true;
  lngInput.readOnly = true;
  pickBtn.classList.remove('d-none');
  geoLocateBtn.classList.add('d-none');
  pickBtn.textContent = 'Pick on map';
  coordHelp.innerHTML = 'Press <strong>Pick on map</strong>: the form hides, then click the desired location.';
}
function enableManualMode() {
  picking = false;
  mapRef.getContainer().style.cursor = '';
  if (pickMarker) { mapRef.removeLayer(pickMarker); pickMarker = null; }
  latInput.readOnly = false;
  lngInput.readOnly = false;
  pickBtn.classList.add('d-none');
  geoLocateBtn.classList.add('d-none');
  coordHelp.textContent = 'Type latitude and longitude manually (decimal degrees).';
}
function enableGeoMode() {
  picking = false;
  mapRef.getContainer().style.cursor = '';
  latInput.readOnly = true;
  lngInput.readOnly = true;
  pickBtn.classList.add('d-none');
  geoLocateBtn.classList.remove('d-none');
  coordHelp.textContent = 'Click Locate to use your current device position.';
}

/* ---------- Geolocation ---------- */
function useGeolocation() {
  if (!navigator.geolocation) return showError('Geolocation not supported.');
  geoLocateBtn.disabled = true;
  geoLocateBtn.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      latInput.value = latitude.toFixed(6);
      lngInput.value = longitude.toFixed(6);
      placeOrMoveMarker([latitude, longitude]);
      mapRef.setView([latitude, longitude], Math.max(mapRef.getZoom(), 12));
      geoLocateBtn.disabled = false;
      geoLocateBtn.textContent = 'Locate';
    },
    err => {
      showError('Geolocation failed: ' + err.message);
      geoLocateBtn.disabled = false;
      geoLocateBtn.textContent = 'Locate';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/* ---------- Map picking ---------- */
function startPicking() {
  if (getCoordMode() !== 'map' || !formEl) return;
  lastFormData = new FormData(formEl);
  wasEditing   = !!formEl.dataset.editId;
  picking = true;
  mapRef.getContainer().style.cursor = 'crosshair';
  const inst = bootstrap.Modal.getInstance(modalEl);
  if (inst) inst.hide();
  showPickBanner('Click on the map to set station location. Press Esc to cancel.');
  setTimeout(()=> {
    document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
  }, 60);
}
function escCancelPick(ev) {
  if (ev.key === 'Escape' && picking) {
    picking = false;
    mapRef.getContainer().style.cursor = '';
    removePickBanner();
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }
}
function mapClick(e) {
  if (!picking) return;
  const { lat, lng } = e.latlng;
  latInput.value = lat.toFixed(6);
  lngInput.value = lng.toFixed(6);
  placeOrMoveMarker([lat, lng]);
  picking = false;
  mapRef.getContainer().style.cursor = '';
  removePickBanner();
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
  if (lastFormData) {
    for (const [k, v] of lastFormData.entries()) {
      if (k === 'latitude' || k === 'longitude') continue;
      const field = formEl.elements[k];
      if (field) field.value = v;
    }
    if (wasEditing) setModalToEdit();
  }
  lastFormData = null;
  wasEditing = false;
}

/* ---------- Marker handling ---------- */
function placeOrMoveMarker(latlng) {
  if (pickMarker) {
    pickMarker.setLatLng(latlng);
  } else {
    pickMarker = L.marker(latlng, { draggable:true }).addTo(mapRef);
    pickMarker.on('dragend', ev => {
      const ll = ev.target.getLatLng();
      latInput.value = ll.lat.toFixed(6);
      lngInput.value = ll.lng.toFixed(6);
    });
  }
}

/* ---------- Competitors & modal state ---------- */
function populateCompetitors(cb) {
  if (!compSelect) return cb && cb();
  compSelect.innerHTML = '';
  getCompetitors().forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    compSelect.appendChild(opt);
  });
  if (cb) cb();
}
function toggleCompetitorField() {
  if (!compWrap) return;
  if (catSelect.value === 'competitor') compWrap.classList.remove('d-none');
  else compWrap.classList.add('d-none');
}
function setModalToEdit() {
  const title = document.getElementById('addStationModalLabel');
  if (title) title.textContent = 'Edit Station';
  const btn = formEl.querySelector('button[type="submit"]');
  if (btn) btn.innerHTML = '<i class="fa fa-save me-1"></i>Update';
}
function resetModalTitle() {
  const title = document.getElementById('addStationModalLabel');
  if (title) title.textContent = 'Add Station';
  const btn = formEl?.querySelector('button[type="submit"]');
  if (btn) btn.innerHTML = '<i class="fa fa-save me-1"></i>Save';
}

/* ---------- Submit ---------- */
async function submitForm(e) {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(formEl).entries());

  payload.name = (payload.name || '').trim();
  if (!payload.name) return showError('Name is required.');
  if (!payload.latitude || !payload.longitude) return showError('Coordinates required.');

  payload.latitude = parseFloat(payload.latitude);
  payload.longitude = parseFloat(payload.longitude);

  if (isNaN(payload.latitude) || isNaN(payload.longitude) ||
      payload.latitude < -90 || payload.latitude > 90 ||
      payload.longitude < -180 || payload.longitude > 180) {
    return showError('Please enter valid coordinate values.');
  }

  // Clean region/district (optional)
  payload.region   = (payload.region   || '').trim() || null;
  payload.district = (payload.district || '').trim() || null;

  // If competitor selected and color still default, adopt competitor color
  if (payload.category === 'competitor' && payload.competitor_id) {
    const comp = getCompetitors().find(c => c.id == payload.competitor_id);
    if (comp && (payload.pin_color === '#2E7D32' || !payload.pin_color)) {
      payload.pin_color = comp.pin_color;
    }
  } else {
    delete payload.competitor_id;
  }

  try {
    if (formEl.dataset.editId) {
      await updateStation(formEl.dataset.editId, payload);
    } else {
      await createStation(payload);
    }
    bootstrap.Modal.getInstance(modalEl).hide();
    formEl.dataset.editId = '';
    formEl.dispatchEvent(new CustomEvent('station:changed', { bubbles:true }));
  } catch (err) {
    showError(err.message || 'Save failed.');
  }
}

/* ---------- UI helpers ---------- */
function showError(msg) {
  if (!alertBox) return;
  alertBox.textContent = msg;
  alertBox.classList.remove('d-none');
}
function showPickBanner(text) {
  if (pickBannerEl) return;
  pickBannerEl = document.createElement('div');
  pickBannerEl.className = 'pick-banner';
  pickBannerEl.textContent = text;
  Object.assign(pickBannerEl.style, {
    position:'fixed', left:'50%', top:'12px', transform:'translateX(-50%)',
    background:'#1f2937', color:'#fff', padding:'.4rem .6rem',
    borderRadius:'8px', zIndex:'2500', boxShadow:'0 8px 20px rgba(0,0,0,.25)',
    fontSize:'.9rem'
  });
  document.body.appendChild(pickBannerEl);
}
function removePickBanner() {
  if (pickBannerEl) { pickBannerEl.remove(); pickBannerEl = null; }
}
function resetForm() {
  if (!formEl) return;
  formEl.reset();
  formEl.dataset.editId = '';
  alertBox?.classList.add('d-none');
  if (pickMarker) { mapRef.removeLayer(pickMarker); pickMarker = null; }
  picking = false;
  mapRef.getContainer().style.cursor = '';
  if (pickBtn) pickBtn.textContent = 'Pick on map';
  const mapRadio = document.getElementById('coord_mode_map');
  if (mapRadio) mapRadio.checked = true;
  onCoordModeChange();

  // reset selects
  if (regionEl)   regionEl.value = '';
  if (districtEl) {
    districtEl.innerHTML = '<option value="">— Select district —</option>';
    districtEl.disabled = true;
  }
}

/* small util */
function escapeHtml(str='') {
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
