// modules/volumesApi.js
export async function uploadVolumesCsv(file, { fuzzy = true, minRatio = 0.88, dryRun = false } = {}) {
  const fd = new FormData();
  fd.append('file', file);
  const qs = new URLSearchParams({
    fuzzy: String(fuzzy),
    min_ratio: String(minRatio),
    dry_run: String(dryRun)
  }).toString();

  const r = await fetch(`/api/station_volumes/upload?${qs}`, { method: 'POST', body: fd });
  if (!r.ok) {
    const t = await r.text().catch(()=>'');
    throw new Error(`Upload failed: ${r.status} ${t || r.statusText}`);
  }
  return await r.json();
}

export async function fetchStationSeries(stationId, { start = null, end = null } = {}) {
  const qs = new URLSearchParams();
  if (start) qs.set('start', start);
  if (end) qs.set('end', end);
  const r = await fetch(`/api/station_volumes/${stationId}?` + qs.toString());
  if (!r.ok) throw new Error(`Series failed: ${r.status}`);
  return await r.json();
}

export async function fetchRankings({ period = 'this_month', category = 'rubis', start = null, end = null, region = '', district = '' } = {}) {
  const qs = new URLSearchParams({ period, category });
  if (region) qs.set('region', region);
  if (district) qs.set('district', district);
  if (period === 'custom') {
    if (start) qs.set('start', start);
    if (end) qs.set('end', end);
  }
  const r = await fetch('/api/stations/rankings?' + qs.toString());
  if (!r.ok) throw new Error(`Rankings failed: ${r.status}`);
  return await r.json();
}
