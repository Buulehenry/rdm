import { jsonFetch } from './utils.js';

export async function fetchTargets() {
  return jsonFetch('/api/targets/');
}
