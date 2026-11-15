/* Shared map look for the web pages (/ and /app), matching the iPhone app's cream "ink" theme.
   OpenStreetMap vector tiles from OpenFreeMap (free, no key), drawn with MapLibre. */
(function () {
  const C = { char: "#212126", muted: "#5C5761", butter: "#FDD96B", peri: "#9EB0F5", leaf: "#94DBAB", pink: "#F79EB8", blue: "#3052D6", sand: "#E6DCCD" };

  // Same colors per kind of place as the app (NativeData.swift: tint).
  const TINT = { coffee: C.butter, food: C.butter, library: C.peri, campus: C.peri, museum: C.peri, park: C.leaf, gym: C.leaf, parking: C.sand };
  const tint = (kind) => TINT[kind] || C.pink;
  // A MapLibre color expression for the same palette (Oracle kinds and OpenStreetMap POI classes).
  const tintExpr = (prop) => ["match", ["get", prop],
    ["coffee", "food", "cafe", "restaurant", "fast_food", "bar", "beer", "ice_cream", "bakery"], C.butter,
    ["library", "campus", "museum", "college", "school", "university", "art_gallery", "theatre", "cinema", "music"], C.peri,
    ["park", "gym", "garden", "sports", "stadium", "fitness", "swimming", "pitch", "playground"], C.leaf,
    ["parking"], C.sand, C.pink];

  const PATHS = {
    food: '<path d="M7 3v8a2 2 0 002 2v8M9 3v6M11 3v8M17 3c-2 0-3 3-3 6s1 4 3 4v8"/>',
    coffee: '<path d="M5 9h11v5a5 5 0 01-5 5h-1a5 5 0 01-5-5zM16 10h2a2 2 0 010 4h-2M8 3c0 1 1 1 1 2s-1 1-1 2M12 3c0 1 1 1 1 2s-1 1-1 2"/>',
    library: '<path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1zM12 6v14"/>',
    gym: '<path d="M6 8v8M9 6v12M15 6v12M18 8v8M9 12h6M3 10v4M21 10v4"/>',
    events: '<path d="M4 8a2 2 0 002-2h12a2 2 0 002 2v2a2 2 0 000 4v2a2 2 0 00-2 2H6a2 2 0 00-2-2v-2a2 2 0 000-4zM14 6v12"/>',
    park: '<path d="M5 19c0-9 6-14 14-14 0 8-5 14-14 14zM5 19l7-7"/>',
    store: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 016 0v2"/>',
    campus: '<path d="M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5"/>',
    transit: '<path d="M7 4h10a2 2 0 012 2v9a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2zM5 11h14M8 21l2-4M16 21l-2-4"/>',
    museum: '<path d="M3 9l9-5 9 5zM5 9v9M10 9v9M14 9v9M19 9v9M3 20h18"/>',
    parking: '<path d="M8 20V4h5a4 4 0 010 8H8"/>',
    place: '<path d="M12 21s-6-5.3-6-10a6 6 0 0112 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
  };
  const icon = (kind, size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${C.char}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[kind] || PATHS.place}</svg>`;

  const zw = (pairs) => ["interpolate", ["exponential", 1.5], ["zoom"], ...pairs];
  const MAJOR = ["primary", "secondary", "tertiary"], FAST = ["motorway", "trunk"], MINOR = ["minor", "service"];
  const roads = (id, classes, casing, fill, w) => [
    { id: `${id}-case`, type: "line", source: "omt", "source-layer": "transportation", filter: ["in", ["get", "class"], ["literal", classes]],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": casing, "line-width": zw(w.map((v, i) => (i % 2 ? v + Math.min(2.2, v * .5) : v))) } },
    { id, type: "line", source: "omt", "source-layer": "transportation", filter: ["in", ["get", "class"], ["literal", classes]],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": fill, "line-width": zw(w) } },
  ];

  function style() {
    return {
      version: 8,
      glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      sources: { omt: { type: "vector", url: "https://tiles.openfreemap.org/planet" } },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#F7EFE3" } },
        { id: "campus", type: "fill", source: "omt", "source-layer": "landuse", filter: ["in", ["get", "class"], ["literal", ["school", "university", "college", "hospital"]]], paint: { "fill-color": "#F1EAF4" } },
        { id: "green", type: "fill", source: "omt", "source-layer": "landcover", filter: ["in", ["get", "class"], ["literal", ["grass", "wood", "farmland", "wetland"]]], paint: { "fill-color": "#DCEFDC" } },
        { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": "#D3EDD7" } },
        { id: "pitch", type: "fill", source: "omt", "source-layer": "landuse", filter: ["in", ["get", "class"], ["literal", ["pitch", "stadium", "playground"]]], paint: { "fill-color": "#C9E8CF" } },
        { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": "#BFD7F4" } },
        { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", paint: { "line-color": "#BFD7F4", "line-width": zw([10, .5, 18, 4]) } },
        { id: "building-flat", type: "fill", source: "omt", "source-layer": "building", minzoom: 13, maxzoom: 15.5,
          paint: { "fill-color": "#ECE2D5", "fill-outline-color": "#DED0BE" } },
        { id: "paths", type: "line", source: "omt", "source-layer": "transportation", minzoom: 14.5, filter: ["in", ["get", "class"], ["literal", ["path", "track"]]],
          paint: { "line-color": "#FFFFFF", "line-width": zw([14.5, .8, 18, 2.4]), "line-dasharray": [2, 1.4] } },
        ...roads("road-minor", MINOR, "#E6D9C7", "#FFFFFF", [12, .4, 14, 1.6, 18, 9]),
        ...roads("road-major", MAJOR, "#DCCBB4", "#FFFFFF", [10, .8, 14, 4, 18, 15]),
        ...roads("road-fast", FAST, "#DDB95E", "#FFE6A0", [8, 1, 14, 5, 18, 17]),
        { id: "rail", type: "line", source: "omt", "source-layer": "transportation", filter: ["==", ["get", "class"], "rail"],
          paint: { "line-color": "#CDBFAE", "line-width": 1.6, "line-dasharray": [3, 2] } },
        { id: "buildings", type: "fill-extrusion", source: "omt", "source-layer": "building", minzoom: 14.5,
          paint: {
            "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8], 0, "#FFFFFF", 20, "#FBF6EF", 60, "#F1E8DC"],
            "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14.5, 0, 15.6, ["coalesce", ["get", "render_height"], 8]],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
            "fill-extrusion-opacity": .94, "fill-extrusion-vertical-gradient": true,
          } },
        { id: "water-name", type: "symbol", source: "omt", "source-layer": "water_name",
          layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Italic"], "text-size": 12 },
          paint: { "text-color": "#4D71B3", "text-halo-color": "#FFFFFF", "text-halo-width": 1.2 } },
        { id: "road-name", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 14,
          filter: ["!", ["in", ["get", "class"], ["literal", ["path", "track", "rail"]]]],
          layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 14, 10, 18, 13], "text-max-angle": 30, "symbol-spacing": 320 },
          paint: { "text-color": "#77707D", "text-halo-color": "#FFFFFF", "text-halo-width": 1.6 } },
        { id: "area-name", type: "symbol", source: "omt", "source-layer": "place", minzoom: 11, maxzoom: 15.5,
          filter: ["in", ["get", "class"], ["literal", ["suburb", "quarter", "neighbourhood"]]],
          layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-transform": "uppercase", "text-letter-spacing": .12, "text-max-width": 8 },
          paint: { "text-color": "#968E9B", "text-halo-color": "#F7EFE3", "text-halo-width": 1.5 } },
        { id: "city-name", type: "symbol", source: "omt", "source-layer": "place", maxzoom: 13.5,
          filter: ["in", ["get", "class"], ["literal", ["city", "town", "village"]]],
          layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 8, 12, 13, 16] },
          paint: { "text-color": C.char, "text-halo-color": "#FFFFFF", "text-halo-width": 1.8 } },
      ],
    };
  }

  // Soft daylight so 3D buildings get gentle shading instead of flat cream blocks.
  const light = (map) => { try { map.setLight({ anchor: "viewport", position: [1.3, 210, 45], color: "#ffffff", intensity: .28 }); } catch {} };

  // Collapse the "© OpenStreetMap" credit to the small (i) button so it doesn't cover the map.
  const tidyCredit = (map) => map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");

  // Pin labels that would overlap a more important one are hidden until there is room (zoom in or move the map).
  function declutter(map, items) {
    let queued = false, last = 0;
    const run = () => {
      queued = false; last = performance.now();
      const list = items().filter((x) => x.el?.isConnected).sort((a, b) => b.prio - a.prio);
      const taken = list.map((x) => x.el.querySelector(".ipin-dot")?.getBoundingClientRect()).filter(Boolean);
      const hit = (r) => taken.some((t) => r.left < t.right + 2 && r.right > t.left - 2 && r.top < t.bottom + 2 && r.bottom > t.top - 2);
      for (const x of list) {
        const lab = x.el.querySelector(".ipin-lab"); if (!lab) continue;
        const r = lab.getBoundingClientRect();
        const clash = hit(r);
        lab.classList.toggle("hide", clash);
        if (!clash) taken.push(r);
      }
    };
    const soon = () => { if (queued) return; queued = true; const wait = Math.max(0, 140 - (performance.now() - last)); setTimeout(() => requestAnimationFrame(run), wait); };
    map.on("move", soon); map.on("moveend", soon); map.on("resize", soon); map.once("idle", soon);
    return soon;
  }

  window.InkMap = { style, light, tint, tintExpr, icon, declutter, tidyCredit, colors: C };
})();
