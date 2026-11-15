// Load every named place around campus from OpenStreetMap (Overpass API, free, no key):
// cafés, restaurants, stores, libraries, gyms, campus buildings, parking, parks, venues.
// They become Oracle places, so earners nearby get questions about all of them.
import { env, PLACES } from "../config.js";
import * as mongo from "../db/mongo.js";

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

const KIND = {
  cafe: "coffee", coffee: "coffee", restaurant: "food", fast_food: "food", food_court: "food", ice_cream: "food", bakery: "food", bar: "food", pub: "food",
  library: "library", fitness_centre: "gym", sports_centre: "gym", stadium: "events", theatre: "events", cinema: "events", arts_centre: "events",
  community_centre: "events", museum: "events", supermarket: "store", convenience: "store", books: "store", clothes: "store", electronics: "store",
  mall: "store", department_store: "store", pharmacy: "store", parking: "parking", park: "park", university: "campus", college: "campus",
  dormitory: "campus", school: "campus",
};
const RADIUS = { campus: 120, library: 120, events: 150, gym: 150, park: 200, parking: 150, store: 80, food: 60, coffee: 50, place: 80 };

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "place";
const near = (a, b, m) => {
  const dLat = (a.lat - b.lat) * 110540, dLng = (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng) < m;
};

export async function importPlaces({ radiusM = Number(process.env.PLACES_RADIUS_M || 3000), lat = env.geoBias[0], lng = env.geoBias[1] } = {}) {
  const around = `(around:${radiusM},${lat},${lng})`;
  const q = `[out:json][timeout:90];(
    nwr["amenity"~"^(cafe|restaurant|fast_food|food_court|ice_cream|bar|pub|library|pharmacy|cinema|theatre|arts_centre|community_centre|parking)$"]["name"]${around};
    nwr["shop"~"^(supermarket|convenience|books|clothes|electronics|mall|department_store|coffee|bakery)$"]["name"]${around};
    nwr["leisure"~"^(fitness_centre|sports_centre|stadium|park)$"]["name"]${around};
    nwr["building"~"^(university|college|library|dormitory)$"]["name"]${around};
    nwr["tourism"~"^(museum)$"]["name"]${around};
  );out center tags;`;

  let data = null, lastErr;
  for (const url of ENDPOINTS) {
    try {
      const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: q }), headers: { "User-Agent": "Oracle/1.0 (SunHacks 2026)" }, signal: AbortSignal.timeout(100000) });
      if (!r.ok) { lastErr = new Error(`Overpass ${r.status}`); continue; }
      data = await r.json(); break;
    } catch (e) { lastErr = e; }
  }
  if (!data) throw lastErr || new Error("Couldn't reach OpenStreetMap");

  const added = [];
  for (const el of data.elements || []) {
    const t = el.tags || {}, name = (t.name || "").trim();
    const plat = el.lat ?? el.center?.lat, plng = el.lon ?? el.center?.lon;
    if (!name || plat == null || plng == null) continue;
    const type = t.amenity || t.shop || t.leisure || t.tourism || t.building;
    if (type === "parking" && !/garage|structure|lot|parking/i.test(name)) continue;   // skip unnamed-looking lots
    const kind = KIND[type] || "place";
    const p = { lat: plat, lng: plng };
    // Skip duplicates: same name close by, or anything on top of a place we already have.
    if (PLACES.some((x) => (x.name.toLowerCase() === name.toLowerCase() && near(x, p, 300)) || near(x, p, 15))) continue;
    if (added.some((x) => x.name.toLowerCase() === name.toLowerCase() && near(x, p, 300))) continue;
    const place = {
      id: `${slug(name)}-${String(el.id).slice(-4)}`, name, aliases: [name.toLowerCase()], lat: plat, lng: plng,
      radiusM: RADIUS[kind], kind, tagline: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "), dynamic: true,
    };
    added.push(place);
  }
  for (const p of added) { PLACES.push(p); await mongo.addPlace(p).catch(() => {}); }
  return { added: added.length, total: PLACES.length, places: added };
}
