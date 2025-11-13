import { jsonFetch } from './utils.js';

export async function fetchStations() {
  return jsonFetch('/api/stations/');
}

export async function bulkUploadStationsCsv(file, opts = {}) {
  const fd = new FormData();
  fd.append('file', file);
  if (opts.update_existing) fd.append('update_existing', '1');
  if (opts.atomic) fd.append('atomic', '1');
  if (opts.dry_run) fd.append('dry_run', '1');
  if (opts.auto_create_competitor) fd.append('auto_create_competitor', '1');

  const r = await fetch('/api/stations/bulk_upload', { method:'POST', body: fd });
  const data = await r.json().catch(()=> ({}));
  if (!r.ok) throw new Error(data?.error || data?.message || `HTTP ${r.status}`);
  return data;
}


export async function createStation(payload) {
  return jsonFetch('/api/stations/', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function updateStation(id, payload) {
  return jsonFetch(`/api/stations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function deleteStation(id) {
  return jsonFetch(`/api/stations/${id}`, { method: 'DELETE' });
}
