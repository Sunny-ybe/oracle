// Look up any place by name or address (OpenStreetMap Nominatim, free, no key).
// Results near GEO_BIAS are preferred, so "Trader Joe's on Mill Ave" finds the one in Tempe.
import { env } from "../config.js";

const KIND = {
  cafe: "coffee", coffee_shop: "coffee", restaurant: "food", fast_food: "food", food_court: "food", bar: "food", pub: "food",
  library: "library", fitness_centre: "gym", sports_centre: "gym", supermarket: "store", convenience: "store", mall: "store",
  department_store: "store", pharmacy: "store", parking: "parking", park: "park", stadium: "events", theatre: "events", cinema: "events",
};

export async function geocode(query) {
  const [lat, lng] = env.geoBias;
  const d = 0.3; // about 20 miles each way
  const base = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  for (const url of [`${base}&viewbox=${lng - d},${lat + d},${lng + d},${lat - d}&bounded=1`, base]) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "Oracle/1.0 (SunHacks 2026 demo)", "Accept-Language": "en" },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const [hit] = await r.json();
      if (hit) {
        return {
          lat: Number(hit.lat), lng: Number(hit.lon),
          name: hit.name || hit.display_name.split(",")[0],
          address: hit.display_name.split(",").slice(0, 3).join(",").trim(),
          kind: KIND[hit.type] || KIND[hit.category] || "place",
        };
      }
    } catch {}
  }
  return null;
}
