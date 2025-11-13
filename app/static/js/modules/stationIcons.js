// modules/stationIcons.js
// Organized, brand-aware marker builder with safe fallbacks.
//
// Usage (both supported):
//   buildStationMarker(latlng, props, { onClick })
//   buildStationMarker(props, latlng, { onClick })
//
// props expected keys (from /api/stations):
//   { id, name, category: 'rubis'|'competitor'|'target', pin_shape, pin_color,
//     competitor_name, competitor_id, region, district }

import { escapeHtml } from './utils.js';

/* ────────────────────────────────────────────────────────────────────────────
   Config
   ────────────────────────────────────────────────────────────────────────── */

const LOGOS = {
  rubis: '/static/images/logo.png',          // navbar already uses logo.png
  shell: '/static/images/shell_logo.png',
  total: '/static/images/total_logo.png',
};

// Detect competitor brand by name → specific pin shape
// (extend freely: vivo, mogas, ola, etc.)
const BRAND_SHAPE_MAP = [
  { test: /shell/i, shape: 'shell_pin' },
  { test: /total/i, shape: 'total_pin' },
];

// Visual defaults per category
const DEFAULTS = {
  rubis:  { shape: 'rubis_pin', color: '#2E7D32' },
  target: { shape: 'circle',    color: '#ff9900' },
  competitor: { shape: 'marker', color: '#cc3333' },
};

/* ────────────────────────────────────────────────────────────────────────────
   Public API
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Build a Leaflet marker for a station feature.
 * Supports argument order (latlng, props, opts) OR (props, latlng, opts).
 */
export function buildStationMarker(a, b, c = {}) {
  // Normalize args
  let latlng, p, opts;
  if (isLatLngLike(a)) { latlng = a; p = b || {}; opts = c; }
  else { p = a || {}; latlng = b; opts = c; }

  const category = (p.category || 'rubis').toLowerCase();
  const pane =
    category === 'competitor' ? 'competitorsPane' :
    (category === 'target' ? 'targetsPane' : 'oursPane');

  // Resolve shape/color
  const color = normalizeColor(p.pin_color, DEFAULTS[category]?.color);
  const shape = resolveShape(p, category);

  // Build
  const marker = createMarkerForShape(shape, latlng, pane, color, p);

  // Optional: pass back props and click
  marker.featureProps = p;
  if (typeof opts.onClick === 'function') {
    marker.on('click', (ev) => opts.onClick(p, marker, ev));
  }

  return marker;
}

/* ────────────────────────────────────────────────────────────────────────────
   Shape resolution & builders
   ────────────────────────────────────────────────────────────────────────── */

function resolveShape(p, category) {
  let s = (p.pin_shape || '').toLowerCase();

  // Auto-brand competitors if no explicit shape
  if (!s || s === 'auto') {
    if (category === 'competitor') {
      const name = (p.competitor_name || '').toLowerCase();
      const hit = BRAND_SHAPE_MAP.find(x => x.test.test(name));
      if (hit) return hit.shape;
    }
    // Category defaults
    return DEFAULTS[category]?.shape || 'marker';
  }
  return s;
}

/** Factory for known shapes, with sensible fallbacks. */
function createMarkerForShape(shape, latlng, pane, color, p) {
  // Brand logo pins
  if (shape === 'rubis_pin')  return logoPin(latlng, pane, LOGOS.rubis, color);
  if (shape === 'shell_pin')  return logoPin(latlng, pane, LOGOS.shell, color);
  if (shape === 'total_pin')  return logoPin(latlng, pane, LOGOS.total, color);

  // Simple vector shapes
  if (shape === 'circle')   return circleMarker(latlng, pane, color);
  if (shape === 'square')   return divMarker(latlng, pane, squareHTML(color));
  if (shape === 'triangle') return divMarker(latlng, pane, triangleHTML(color));

  // Default “drop” marker
  return divMarker(latlng, pane, dropHTML(color));
}

/* ── Shape implementations ────────────────────────────────────────────────── */

function logoPin(latlng, pane, url, color) {
  // Circular logo + pointed tail. If the image 404s, the white disc still renders.
  return L.marker(latlng, {
    pane,
    icon: L.divIcon({
      className: 'custom-marker',
      html: `<div style="position: relative; width: 24px; height: 30px;">
        <div style="width:24px;height:24px;border-radius:50%;overflow:hidden;box-shadow:0 0 4px rgba(0,0,0,0.3);border:2px solid #fff;background:#fff;">
          <img src="${url}" style="width:100%; height:100%; object-fit:cover;" />
        </div>
        <div style="position:absolute;bottom:0;left:50%;margin-left:-6px;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:6px solid ${color};"></div>
      </div>`,
      iconSize: [24, 30],
      iconAnchor: [12, 30]
    })
  });
}

function circleMarker(latlng, pane, color) {
  return L.circleMarker(latlng, {
    pane,
    radius: 7,
    color,
    fillColor: color,
    fillOpacity: 0.85,
    weight: 2
  });
}

function divMarker(latlng, pane, html) {
  return L.marker(latlng, {
    pane,
    icon: L.divIcon({
      className: 'custom-marker',
      html,
      iconSize: [24, 24],
      iconAnchor: [12, 24]
    })
  });
}

/* ── HTML snippets ────────────────────────────────────────────────────────── */

function squareHTML(color) {
  return `<div style="
    width:18px;height:18px;background:${color};
    border:2px solid #fff;border-radius:3px;
    box-shadow:0 0 2px rgba(0,0,0,.35);"></div>`;
}

function triangleHTML(color) {
  return `<div style="
    width:0;height:0;
    border-left:10px solid transparent;
    border-right:10px solid transparent;
    border-bottom:20px solid ${color};
    margin-top:2px;
    filter:drop-shadow(0 0 2px rgba(0,0,0,.4));"></div>`;
}

function dropHTML(color) {
  return `<div style="
    width:18px;height:18px;
    background:${color};
    border-radius:50% 50% 50% 0;
    transform:rotate(-45deg);
    margin:2px 0 0 3px;
    border:2px solid #fff;
    box-shadow:0 0 2px rgba(0,0,0,.4);"></div>`;
}

/* ────────────────────────────────────────────────────────────────────────────
   Utils
   ────────────────────────────────────────────────────────────────────────── */

function isLatLngLike(x) {
  return Array.isArray(x) || (x && typeof x.lat === 'number' && typeof x.lng === 'number');
}

function normalizeColor(c, fallback) {
  const s = (c || '').trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s;
  return fallback || '#444';
}

/* ────────────────────────────────────────────────────────────────────────────
   Optional: quick popup builder (export if you want to reuse)
   ────────────────────────────────────────────────────────────────────────── */

export function popupHtml(p) {
  return `
    <div style="min-width:160px">
      <strong>${escapeHtml(p.name || 'Station')}</strong><br>
      ${p.category ? `Category: ${escapeHtml(p.category)}<br>` : ''}
      ${p.competitor_name ? `Competitor: ${escapeHtml(p.competitor_name)}<br>` : ''}
      <span style="display:inline-block;width:14px;height:14px;background:${normalizeColor(p.pin_color)};
        border:1px solid #222;margin-right:4px;vertical-align:middle;"></span>
      <small>${escapeHtml(p.pin_shape || '')}</small>
    </div>
  `;
}
