// modules/heatmapLayer.js
// Leaflet heatmap management for station density/traffic visualization.

let _heat = null;
let _enabled = false;
let _lastPoints = []; // keep last computed points so toggling back on restores data

/**
 * Toggle the heatmap layer on/off.
 * @param {L.Map} map
 * @param {boolean} [on]  Optional explicit state; if omitted, toggles.
 * @returns {boolean} The new enabled state.
 */
export function toggleHeatmap(map, on) {
  _enabled = on ?? !_enabled;

  if (!_enabled) {
    if (_heat) {
      map.removeLayer(_heat);
      _heat = null;
    }
    return _enabled;
  }

  if (!_heat) {
    _heat = L.heatLayer(_lastPoints || [], {
      radius: 22,
      blur: 16,
      maxZoom: 12,
      minOpacity: 0.25
    });
  }
  _heat.addTo(map);
  return _enabled;
}

/**
 * Returns whether the heatmap is currently enabled.
 */
export function isHeatmapEnabled() {
  return _enabled;
}

/**
 * Update heatmap points from a stations FeatureCollection
 * (the response of /api/stations after filtering).
 * Safe to call whether the layer is enabled or not.
 * @param {GeoJSON.FeatureCollection} fc
 */
export function updateHeatFromStations(fc) {
  if (!fc?.features) {
    _lastPoints = [];
    if (_heat) _heat.setLatLngs(_lastPoints);
    return;
  }

  const pts = [];
  for (const f of fc.features) {
    const g = f.geometry;
    const p = f.properties || {};
    if (!g || g.type !== 'Point') continue;

    const [lng, lat] = g.coordinates || [];
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    // Simple category weights (tune as needed)
    let w = 1.0;
    if (p.category === 'rubis') w = 1.2;
    else if (p.category === 'competitor') w = 1.0;
    else if (p.category === 'target') w = 0.8;

    pts.push([lat, lng, w]);
  }

  _lastPoints = pts;
  if (_heat) _heat.setLatLngs(pts);
}
