// static/js/modules/mapConfig.js
export const UG_CENTER = [1.3733, 32.2903];
export const UG_BOUNDS = L.latLngBounds([-1.53, 29.57], [4.27, 35.05]);

export function createMap() {
  const map = L.map('map', {
    center: UG_CENTER,
    zoom: 8,
    minZoom: 6,
    maxZoom: 19,
    maxBounds: UG_BOUNDS.pad(0.08),
    maxBoundsViscosity: 1.0,
    zoomControl: false,
    preferCanvas: true
  });

  // Panes for focus/blur control
  const oursPane = map.createPane('oursPane');
  oursPane.style.zIndex = 610;
  oursPane.classList.add('oursPane'); // make CSS selector simple

  const compsPane = map.createPane('competitorsPane');
  compsPane.style.zIndex = 600;
  compsPane.classList.add('competitorsPane');

  const targetsPane = map.createPane('targetsPane');
  targetsPane.style.zIndex = 590;
  targetsPane.classList.add('targetsPane');

  // Zoom UI
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Basemap (ensure CORS-friendly tiles for export snapshots)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OSM | &copy; BHENS | &copy; RUBiS Energy Uganda',
    maxZoom: 19,
    crossOrigin: true
  }).addTo(map);

  return map;
}
