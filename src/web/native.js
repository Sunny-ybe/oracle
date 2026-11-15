import { findPlace } from '../config.js';
import { placeDetail, placesForApp } from '../core.js';
import { searchIntent } from '../ai/gemini.js';
export function coordinates(lat, lng) {
  if (lat == null || lng == null || typeof lat === 'boolean' || typeof lng === 'boolean' || String(lat).trim() === '' || String(lng).trim() === '') throw new Error('Choose a location.');
  lat = Number(lat); lng = Number(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Invalid location.');
  return { lat, lng };
}
export function distance(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export async function nearby(query) {
  const center = coordinates(query.lat, query.lng);
  const radius = Number(query.radiusM ?? 3000);
  if (!Number.isFinite(radius) || radius < 1 || radius > 50000) throw new Error('Radius must be between 1 and 50000 metres.');
  return (await placesForApp()).map(p => ({ ...p, distanceM: Math.round(distance(center, p)) })).filter(p => p.distanceM <= radius).sort((a, b) => a.distanceM - b.distanceM).slice(0, 100);
}
export async function discover(body) {
  const query = String(body.query || '').trim().slice(0, 250);
  if (!query) throw new Error('Enter a city or venue.');
  return { query: await searchIntent(query) };
}
export async function venueMedia(body) {
  const point = coordinates(body.lat, body.lng);
  const name = String(body.name || '').trim().slice(0, 100);
  const known = findPlace(body.placeId);
  if (known) {
    const detail = await placeDetail(known.id);
    if (detail.photo) return { url: detail.photo, attribution: 'Oracle contributor · faces, badges, screens and plates blurred', source: 'oracle', capturedAt: detail.photoAt || null };
  }
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!name) return { url: null, attribution: null, source: null, configured: Boolean(key) };
  if (!key) return (await wikimediaPhoto(name, point)) || { url: null, attribution: null, source: null, configured: false };
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.location,places.photos' },
    body: JSON.stringify({ textQuery: name, pageSize: 3, locationBias: { circle: { center: { latitude: point.lat, longitude: point.lng }, radius: 150 } } }), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Venue photos are temporarily unavailable.');
  const data = await response.json();
  const match = data.places?.find(p => p.location && distance(point, { lat: p.location.latitude, lng: p.location.longitude }) < 200);
  const photo = match?.photos?.[0];
  if (!photo) return { url: null, attribution: null, source: null, googlePlaceId: match?.id || null };
  const image = await fetch(`https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=900&skipHttpRedirect=true&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10000) });
  if (!image.ok) throw new Error('Venue photo unavailable.');
  const media = await image.json();
  const authors = (photo.authorAttributions || []).map(a => ({ name: a.displayName, uri: a.uri || null }));
  return {
    url: media.photoUri, source: 'google', googlePlaceId: match.id || null, authors,
    attribution: ['Google Maps', ...authors.map(a => a.name)].filter(Boolean).join(' · '),
  };
}

// ---- Free venue photos: Wikipedia / Wikimedia Commons (no key). Used when there's no Oracle photo and no Google key.
// Only a photo whose title shares a distinctive word with the venue's name is used: the nearest geotagged photo is
// often of something else entirely (people at an event, a different building).
const GENERIC = new Set(['the', 'and', 'of', 'at', 'on', 'for', 'cafe', 'coffee', 'restaurant', 'grill', 'kitchen', 'bar', 'store', 'shop',
  'arizona', 'state', 'university', 'asu', 'tempe', 'campus', 'center', 'centre', 'building', 'main', 'north', 'south', 'east', 'west',
  'company', 'student', 'students', 'dining', 'sun', 'devil', 'devils', 'hall']);
const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
const distinctive = (name) => words(name).filter((w) => w.length >= 4 && !GENERIC.has(w));
const plain = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const WIKI_HEADERS = { 'User-Agent': 'Oracle/1.0 (venue photos)' };
const photoCache = new Map(); // key -> { at, value }

async function wiki(url) {
  const r = await fetch(url, { headers: WIKI_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`wikimedia ${r.status}`);
  return r.json();
}

async function wikimediaPhoto(name, point) {
  const keys = distinctive(name);
  if (!keys.length) return null;
  const cacheKey = `${name}|${point.lat.toFixed(4)}|${point.lng.toFixed(4)}`;
  const hit = photoCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 24 * 3600e3) return hit.value;
  const matches = (title) => { const t = words(title); return keys.some((k) => t.includes(k)); };
  let value = null;
  try {
    // 1) A Wikipedia article about the building nearby, using its lead image.
    const near = await wiki(`https://en.wikipedia.org/w/api.php?action=query&format=json&list=geosearch&gscoord=${point.lat}%7C${point.lng}&gsradius=350&gslimit=25`);
    const article = (near.query?.geosearch || []).find((a) => matches(a.title));
    if (article) {
      const img = await wiki(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=thumbnail%7Cname&pithumbsize=900&pageids=${article.pageid}`);
      const page = img.query?.pages?.[article.pageid];
      if (page?.thumbnail?.source) {
        const file = page.pageimage ? await commonsInfo(`File:${page.pageimage}`) : null;
        value = { url: page.thumbnail.source, source: 'wikimedia', ...(file || {}), pageUrl: file?.pageUrl || `https://en.wikipedia.org/?curid=${article.pageid}` };
      }
    }
    // 2) A Commons photo taken nearby whose title names the place.
    if (!value) {
      const files = await wiki(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=geosearch&ggscoord=${point.lat}%7C${point.lng}&ggsradius=200&ggslimit=50&ggsnamespace=6&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=900`);
      const page = Object.values(files.query?.pages || {}).find((p) => matches(p.title) && /\.(jpe?g|png|webp)$/i.test(p.title));
      if (page) value = { url: page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url, source: 'wikimedia', ...describe(page) };
    }
  } catch (e) {
    console.error('Wikimedia photo lookup failed:', e.message);
    return null; // don't cache failures
  }
  if (value) value.attribution = ['Wikimedia Commons', value.author, value.license].filter(Boolean).join(' · ');
  photoCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function commonsInfo(title) {
  const r = await wiki(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url%7Cextmetadata&titles=${encodeURIComponent(title)}`);
  const page = Object.values(r.query?.pages || {})[0];
  return page?.imageinfo ? describe(page) : null;
}

function describe(page) {
  const info = page.imageinfo?.[0] || {}, m = info.extmetadata || {};
  return { author: plain(m.Artist?.value).slice(0, 80) || null, license: plain(m.LicenseShortName?.value) || null, pageUrl: info.descriptionurl || null };
}
