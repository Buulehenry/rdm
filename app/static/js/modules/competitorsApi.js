import { jsonFetch } from './utils.js';

let competitorsCache = [];

export async function loadCompetitors() {
  const data = await jsonFetch('/api/competitors/');
  competitorsCache = Array.isArray(data) ? data : (data.items || []);
  return competitorsCache;
}

export function getCompetitors() {
  return competitorsCache;
}

export async function createCompetitor(payload) {
  return jsonFetch('/api/competitors/', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
  });
}