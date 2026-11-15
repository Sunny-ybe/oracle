// Explicit, worldwide place search. Never called for autocomplete or on map movement.
// Nominatim public-instance policy: one request/second, identified client, cached results.
const cache = new Map(), pending = new Map();
let queue = Promise.resolve(), requestQueue = Promise.resolve(), nextRequestAt = 0;
export function fetchNominatim(url) {
  const request = requestQueue.then(async () => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, nextRequestAt - Date.now())));
    nextRequestAt = Date.now() + 1100;
    return fetch(url, { headers: { 'User-Agent': 'Oracle/1.0 (https://oracle.tryalethea.com; place search)', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(10000) });
  });
  requestQueue = request.catch(() => {});
  return request;
}
const kinds = { cafe: 'coffee', restaurant: 'food', fast_food: 'food', library: 'library', park: 'park', supermarket: 'store', pharmacy: 'store', hotel: 'place' };
export async function searchPlaces(raw) {
  const query = String(raw || '').trim();
  if (query.length < 3 || query.length > 200) throw new Error('Enter a place or address between 3 and 200 characters.');
  const key = query.toLocaleLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 600000) return hit.results;
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 8) throw new Error('Place search is busy. Please try again in a moment.');
  const task = queue.then(async () => {
    const endpoint = process.env.PLACE_SEARCH_URL || 'https://nominatim.openstreetmap.org/search';
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '6', addressdetails: '1' });
    const response = await fetchNominatim(url);
    if (!response.ok) throw new Error('Worldwide search is temporarily unavailable. Try again shortly.');
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Place search returned an unexpected response.');
    const results = data.filter(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon))).map(p => ({
      name: p.name || p.display_name?.split(',')[0] || query, address: p.display_name || '', lat: Number(p.lat), lng: Number(p.lon),
      kind: kinds[p.type] || 'place', area: ['city', 'town', 'village', 'administrative', 'state', 'country'].includes(p.type) || p.category === 'boundary',
      source: 'OpenStreetMap',
    }));
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), results });
    return results;
  });
  pending.set(key, task); queue = task.catch(() => {});
  try { return await task; } finally { pending.delete(key); }
}
