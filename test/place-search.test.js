import test from 'node:test';
import assert from 'node:assert/strict';
import { searchPlaces, fetchNominatim } from '../src/web/place-search.js';

test('worldwide search validates, caches, deduplicates and throttles provider requests', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async url => {
    calls.push({ at:Date.now(), url:String(url) });
    if (String(url).includes('unavailable-test')) return { ok:false };
    return { ok:true, json:async()=>[{name:'Eiffel Tower',display_name:'Eiffel Tower, Paris, France',lat:'48.8583',lon:'2.2945',type:'attraction'}] };
  };
  try {
    await assert.rejects(searchPlaces('a'), /3 and 200/);
    const [first, duplicate] = await Promise.all([searchPlaces('Paris test'),searchPlaces('Paris test')]);
    assert.equal(calls.length,1); assert.deepEqual(first,duplicate);
    assert.equal(first[0].lat,48.8583); assert.equal(first[0].source,'OpenStreetMap');
    await searchPlaces('PARIS TEST'); assert.equal(calls.length,1);
    assert.match(calls[0].url,/q=Paris\+test/);
    await fetchNominatim('https://example.test/lookup');
    assert.ok(calls[1].at-calls[0].at>=1000,'search and existing geocoding share the request limiter');
    await assert.rejects(searchPlaces('unavailable-test'),/temporarily unavailable/);
  } finally { globalThis.fetch = original; }
});
