// modules/filtersControl.js
import { getCompetitors, loadCompetitors } from './competitorsApi.js';

/* ─── Private state ────────────────────────────────────────────────────────── */
var _onChange = null;
var _containerEl = null;
var _compListEl = null;
var _regionEl = null;
var _districtEl = null;

/* Debounce without modern syntax */
function debounce(fn, ms) {
    var t;
    return function() {
        var args = arguments;
        clearTimeout(t);
        t = setTimeout(function() { fn.apply(null, args); }, ms);
    };
}

/* ─── Public: Title control ────────────────────────────────────────────────── */
export function addTitleControl(map) {
    var titleCtrl = L.control({ position: 'topleft' });
    titleCtrl.onAdd = function() {
        var div = L.DomUtil.create('div', 'leaflet-control custom-title');
        div.textContent = 'RUBiS Energy Uganda';
        return div;
    };
    titleCtrl.addTo(map);
}

/* ─── Public: Filters control ──────────────────────────────────────────────── */
export async function addFiltersControl(map, onChange) {
    _onChange = onChange;

    var filterCtrl = L.control({ position: 'topright' });
    filterCtrl.onAdd = function() {
        _containerEl = L.DomUtil.create('div', 'leaflet-control custom-filters');
        _containerEl.innerHTML = createFiltersMarkup();

        // Cache elements
        _compListEl = _containerEl.querySelector('#comp-filters');
        _regionEl = _containerEl.querySelector('#filter_region');
        _districtEl = _containerEl.querySelector('#filter_district');

        // Bubble up changes from checkboxes & selects
        _containerEl.addEventListener('change', function(ev) {
            if (ev.target && (ev.target.matches('input[type="checkbox"]') || ev.target.matches('select'))) {
                if (typeof _onChange === 'function') _onChange();
            }
        });

        // React to district typing (debounced)
        if (_districtEl) {
            _districtEl.addEventListener('input', debounce(function() {
                if (typeof _onChange === 'function') _onChange();
            }, 250));
        }

        return _containerEl;
    };

    filterCtrl.addTo(map);

    // Prevent map interactions when using the control
    if (_containerEl) {
        L.DomEvent.disableClickPropagation(_containerEl);
        if (L.DomEvent.disableScrollPropagation) {
            L.DomEvent.disableScrollPropagation(_containerEl);
        }
        ['mousewheel', 'wheel', 'touchmove', 'pointerdown'].forEach(function(evt) {
            L.DomEvent.on(_containerEl, evt, L.DomEvent.stopPropagation);
        });
    }

    // Ensure competitors are loaded once, then render list
    if (!getCompetitors().length) {
        try { await loadCompetitors(); } catch (e) { console.warn('Load competitors failed', e); }
    }

    buildCompetitorCheckboxes();
    if (typeof _onChange === 'function') _onChange();
}

/* ─── Public: Rebuild only competitor filters ─────────────────────────────── */
export function rebuildCompetitorFilters() {
    buildCompetitorCheckboxes();
    if (typeof _onChange === 'function') _onChange();
}

/* ─── Public: Read current filter state ────────────────────────────────────── */
export function getActiveFilterState() {
    var ownEl = document.getElementById('filter_own');
    var targetsEl = document.getElementById('filter_targets');
    var regionEl = document.getElementById('filter_region');
    var districtEl = document.getElementById('filter_district');

    var own = ownEl ? ownEl.checked : true;
    var targets = targetsEl ? targetsEl.checked : true;
    var region = regionEl ? regionEl.value : '';
    var district = districtEl ? String(districtEl.value || '').trim() : '';

    var competitorIds = [];
    if (_compListEl) {
        var inputs = _compListEl.querySelectorAll('input[type="checkbox"]');
        inputs.forEach(function(inp) {
            if (inp.checked) {
                var id = Number(inp.getAttribute('data-id'));
                if (!Number.isNaN(id)) competitorIds.push(id);
            }
        });
    }

    return { own: own, targets: targets, competitorIds: competitorIds, region: region, district: district };
}

/* ─── Internal helpers ─────────────────────────────────────────────────────── */
function createFiltersMarkup() {
    return '\
    <div class="form-check mb-1">\
      <input class="form-check-input" type="checkbox" id="filter_own" checked>\
      <label class="form-check-label" for="filter_own">Own</label>\
    </div>\
    <div class="form-divider"><hr class="my-1"></div>\
    <div class="mb-1">\
      <label class="form-label mb-0" style="font-size:.7rem;">Region</label>\
      <select class="form-select form-select-sm" id="filter_region">\
        <option value="">All</option>\
        <option>Kampala Central</option>\
        <option>Kampala Western</option>\
        <option>Northern</option>\
        <option>Western</option>\
        <option>Eastern</option>\
        <option>South Western</option>\
      </select>\
    </div>\
    <div class="mb-1">\
      <label class="form-label mb-0" style="font-size:.7rem;">District</label>\
      <input class="form-control form-control-sm" id="filter_district" placeholder="Type district name…">\
    </div>\
    <div class="form-divider"><hr class="my-1"></div>\
    <div><strong style="font-size:.75rem;letter-spacing:.5px;">Competitors</strong></div>\
    <div id="comp-filters" class="mb-1"></div>\
    <div class="form-divider"><hr class="my-1"></div>\
    <div class="form-check mb-0">\
      <input class="form-check-input" type="checkbox" id="filter_targets" checked>\
      <label class="form-check-label" for="filter_targets">Targets</label>\
    </div>';
}

function buildCompetitorCheckboxes() {
    if (!_compListEl) return;

    _compListEl.innerHTML = '';
    var comps = getCompetitors();

    if (!comps.length) {
        _compListEl.innerHTML = '<div class="text-muted" style="font-size:.7rem;">(none)</div>';
        return;
    }

    comps.forEach(function(c) {
        var div = document.createElement('div');
        div.className = 'form-check mb-0';
        var safeColor = String(c.pin_color || '');
        div.innerHTML =
            '<input class="form-check-input" type="checkbox" data-id="' + c.id + '" id="comp_' + c.id + '" checked>' +
            '<label class="form-check-label" for="comp_' + c.id + '" style="color:' + safeColor + '">' + c.name + '</label>';
        _compListEl.appendChild(div);
    });
}

/* ─── Optional debug exposure ──────────────────────────────────────────────── */
if (!window._filtersDebug) {
    window._filtersDebug = { getActiveFilterState: getActiveFilterState };
}