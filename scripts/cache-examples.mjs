import fs from "fs/promises";
import { scanRoute } from "../hazard-scanner.js";
import { scanAccidents } from "../accident-scanner.js";

const originalFetch = global.fetch;
global.fetch = function (url, options = {}) {
  options.headers = { "User-Agent": "RouteRehearsal/1.0", ...options.headers };
  return originalFetch(url, options);
};

const CONFIG = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  OSRM_URL: "https://router.project-osrm.org/route/v1/driving",
  NOMINATIM_URL: "https://nominatim.openstreetmap.org/search",
};

const EXAMPLES = [
  { origin: "CN Tower, Toronto", dest: "Union Station, Toronto" },
  { origin: "Times Square, New York", dest: "Brooklyn Bridge, New York" },
  { origin: "Golden Gate Bridge, San Francisco", dest: "Fisherman's Wharf, San Francisco" },
];

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocode(address) {
  const url = `${CONFIG.NOMINATIM_URL}?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.length) throw new Error(`Address not found: "${address}"`);
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    label: data[0].display_name.split(",").slice(0, 3).join(","),
  };
}

async function fetchRoute(origin, dest) {
  const url = `${CONFIG.OSRM_URL}/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson&steps=true&annotations=true`;
  const res = await fetch(url);
  const data = await res.json();
  const route = data.routes[0];
  
  const coords = route.geometry.coordinates;
  if (coords.length > 0) {
    if (coords[0][0] !== origin.lng || coords[0][1] !== origin.lat) {
      coords.unshift([origin.lng, origin.lat]);
    }
    const last = coords[coords.length - 1];
    if (last[0] !== dest.lng || last[1] !== dest.lat) {
      coords.push([dest.lng, dest.lat]);
    }
  }

  return { coords: coords, steps: route.legs[0].steps, distance: route.distance, duration: route.duration };
}

async function analyzeWithGemini(steps, geometryHazards) {
  if (!CONFIG.GEMINI_API_KEY) return null;
  const stepsText = steps.slice(0, 30).map((s, i) => `${i + 1}. ${s.maneuver?.instruction || s.name || "continue"} (${s.maneuver?.type || ""} ${s.maneuver?.modifier || ""})`).join("\n");
  const hazardText = geometryHazards.slice(0, 10).map((h) => `- ${h.label} at [${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}]: ${h.description}`).join("\n");

  const prompt = `You are an expert driving coach analyzing a route for someone who has NEVER driven it before. Focus on the things GPS apps get wrong — they tell you WHERE to turn but not HOW to prepare.

Turn-by-turn directions:
${stepsText}

Already detected hazards from geometry analysis:
${hazardText || "None detected from geometry."}

Look for these specific issues that confuse real drivers:

1. LANE POSITIONING: Where do you need to be in a specific lane EARLY? Example: "3 highway lanes all go the same direction, but the leftmost lane is actually best because it feeds into the correct lane for your next turn." GPS never tells you this.

2. CONFUSING SIGNAGE: Places where road signs might show names/numbers for roads you're NOT taking, or where multiple similar signs appear close together. Exit splits like "148A vs 148B" are classic confusion points.

3. HIDDEN OR TRICKY TURNS: Turns that are easy to miss because they're obscured, poorly marked, or come right after another maneuver. Also right-turn-from-left-lane type situations.

4. MERGE/EXIT TIMING: Highway situations where you need to merge or exit quickly after another maneuver. Getting across 3 lanes in 200m is stressful.

5. ROAD LAYOUT SURPRISES: One-way streets, roads that suddenly change from 2 lanes to 1, or intersections where the "straight" path actually curves.

For each issue you find (max 6), respond as a JSON array. Be specific and practical — give advice a driving instructor would give:
[{"title":"Short specific title","reason":"Why this confuses drivers (1-2 sentences)","tip":"Exactly what to do — which lane, when to move, what to look for","severity":"low|medium|high","stepIndex":N}]

If the route is straightforward with no issues, respond []. Only output valid JSON.`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  return null;
}

async function run() {
  for (let i = 0; i < EXAMPLES.length; i++) {
    const ex = EXAMPLES[i];
    console.log(`Processing ${ex.origin} -> ${ex.dest}`);
    const origin = await geocode(ex.origin);
    await new Promise(r => setTimeout(r, 1000));
    const dest = await geocode(ex.dest);
    await new Promise(r => setTimeout(r, 1000));
    const route = await fetchRoute(origin, dest);
    
    const result = scanRoute(route.coords, route.steps);
    const hazards = result.hazards;
    const hazardSummary = result.summary;
    
    const { hazards: osmHazards, excluded } = await scanAccidents(route.coords);
    if (osmHazards.length) {
      const deduped = osmHazards.filter((ah) => !hazards.some((h) => haversineDistance(h.lat, h.lng, ah.lat, ah.lng) < 40));
      hazards.push(...deduped);
    }
    
    const geminiResults = await analyzeWithGemini(route.steps, hazards);
    if (geminiResults && geminiResults.length) {
      geminiResults.forEach((g, idx) => {
        const step = route.steps[g.stepIndex] || route.steps[0];
        const loc = step?.maneuver?.location || route.coords[0];
        hazards.push({
          id: `ai_hazard_${idx}`,
          type: "ai_detected",
          label: g.title,
          severity: g.severity || "medium",
          lat: loc[1],
          lng: loc[0],
          heading: Math.round(step?.maneuver?.bearing_after || 0),
          description: g.reason,
          tip: g.tip,
          source: "gemini",
        });
      });
    }
    
    hazards.sort((a, b) => {
      let aIdx = 0, aDist = Infinity;
      route.coords.forEach((c, idx) => {
        let d = haversineDistance(a.lat, a.lng, c[1], c[0]);
        if (d < aDist) { aDist = d; aIdx = idx; }
      });
      let bIdx = 0, bDist = Infinity;
      route.coords.forEach((c, idx) => {
        let d = haversineDistance(b.lat, b.lng, c[1], c[0]);
        if (d < bDist) { bDist = d; bIdx = idx; }
      });
      return aIdx - bIdx;
    });

    const cacheData = {
      isCachedState: true,
      title: `${ex.origin.split(',')[0]} to ${ex.dest.split(',')[0]}`,
      origin,
      destination: dest,
      routeCoords: route.coords,
      routeSteps: route.steps,
      routeDistance: route.distance,
      routeDuration: route.duration,
      hazards,
      hazardSummary,
      geminiInsights: geminiResults
    };
    
    const filename = `cached-example-${i}.json`;
    await fs.writeFile(`data/demo-routes/${filename}`, JSON.stringify(cacheData, null, 2));
    console.log(`Saved ${filename}`);
  }
}

run().catch(console.error);
