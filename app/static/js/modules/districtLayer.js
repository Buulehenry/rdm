// modules/districtLayer.js
let _layer = null;

export async function addDistrictLayer(map){
  if (_layer) { map.removeLayer(_layer); _layer = null; }
  let fc = null;

  // Try API first, fallback to static file if you prefer
  try {
    const r = await fetch('/api/districts/');
    if (r.ok) fc = await r.json();
  } catch {}
  if (!fc) return null; // no geometry available yet

  _layer = L.geoJSON(fc, {
    style: f => ({
      color: '#4e79a7',
      weight: 1,
      fillColor: '#4e79a7',
      fillOpacity: 0.06
    }),
    onEachFeature: (f, layer) => {
      const name = f.properties?.name || 'District';
      layer.bindTooltip(name, {sticky: true});
    }
  });
  _layer.addTo(map);
  return _layer;
}

export function fitToDistrict(map, name){
  if(!_layer) return false;
  let b = null;
  _layer.eachLayer(l => {
    if (l.feature?.properties?.name?.toLowerCase() === (name||'').toLowerCase()){
      b = l.getBounds();
    }
  });
  if (b){ map.fitBounds(b, {padding:[20,20]}); return true; }
  return false;
}

export function fitToUganda(map){
  const mapEl = document.getElementById('map');
  map.fitBounds(map.getBounds(), {padding:[20,20]});
}
