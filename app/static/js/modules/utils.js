export function escapeHtml(str='') {
  return str.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export async function jsonFetch(url, opts={}) {
  const r = await fetch(url, opts);
  let data;
  try { data = await r.json(); } catch { data = null; }
  if (!r.ok) {
    const msg = data?.error || data?.message || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

export function debounce(fn, ms=200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(()=>fn(...a), ms); };
}
