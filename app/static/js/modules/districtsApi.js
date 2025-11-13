// modules/districtsApi.js
// Thin wrapper around the districts REST endpoints.

// modules/districtsApi.js
export async function fetchDistrictsFC() {
  const r = await fetch('/api/districts/');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  if (Array.isArray(data)) {
    return {
      type: 'FeatureCollection',
      features: data.map(d => ({
        type: 'Feature',
        geometry: d.geojson || null,
        properties: { id: d.id, name: d.name, region: d.region }
      }))
    };
  }
  return data;
}


export async function createDistrict({ name, region, geojson=null }) {
  const r = await fetch('/api/districts/', {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ name, region, geojson })
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

export async function updateDistrict(id, { name, region, geojson }) {
  const r = await fetch(`/api/districts/${id}`, {
    method:'PUT',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ name, region, geojson })
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

export async function deleteDistrictById(id) {
  const r = await fetch(`/api/districts/${id}`, { method:'DELETE' });
  if (!r.ok) throw new Error(await r.text());
  return true;
}
