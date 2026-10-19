let configuration;
export async function journeyConfig() {
  if (!configuration) configuration = await journeyApi('/config');
  return configuration;
}
export async function journeyApi(path, method='GET', data, signal) {
  const headers = {'Accept':'application/json'};
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-RDM-CSRF'] = (await journeyConfig()).csrf_token;
  }
  const response = await fetch('/api/journeys' + path, {
    method, headers, body:data === undefined ? undefined : JSON.stringify(data), signal
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed. Please retry.');
  return result;
}
