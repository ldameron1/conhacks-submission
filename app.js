import { scanRoute } from "./hazard-scanner.js";
import * as cesiumView from "./cesium-view.js";
// import * as narration from "./narration.js"; // Disabled for demo
import * as distractions from "./distractions.js";
import * as accidentScanner from "./accident-scanner.js";
import * as phoneBridge from "./phone-bridge.js?v=3";

/* ═══════════════════ CONFIG ═══════════════════ */
const RUNTIME_CONFIG = window.__ROUTE_REHEARSAL_CONFIG__ || {};
const CONFIG = {
  GEMINI_API_KEY: RUNTIME_CONFIG.GEMINI_API_KEY || "",
  OPENROUTER_API_KEY: RUNTIME_CONFIG.OPENROUTER_API_KEY || "",
  OPENROUTER_MODEL: RUNTIME_CONFIG.OPENROUTER_MODEL || "google/gemma-4-26b-a4b-it:free",
  GOOGLE_MAPS_KEY: RUNTIME_CONFIG.GOOGLE_MAPS_KEY || "",
  ELEVENLABS_API_KEY: RUNTIME_CONFIG.ELEVENLABS_API_KEY || "",
  OSRM_URL: "https://router.project-osrm.org/route/v1/driving",
  NOMINATIM_URL: "https://nominatim.openstreetmap.org/search",
  DARK_TILES: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  SAT_TILES: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
};

/* ═══════════════════ STATE ═══════════════════ */
const state = {
  screen: "input",
  origin: null,       // { lat, lng, label }
  destination: null,
  routeCoords: [],    // [[lng,lat],...]
  routeSteps: [],
  routeDistance: 0,
  routeDuration: 0,
  hazards: [],
  hazardSummary: {},
  practiceIndex: 0,
  reportMap: null,
  practiceMap: null,
  routeLayer: null,
  geminiInsights: null,
  hotspotsOnly: false,
  // Rehearsal tracking
  rehearsal: {
    startTime: 0,
    hazardReviewed: [],   // boolean per hazard
    hazardEntryTime: [],  // timestamp when entered hazard zone
    hazardPauseTime: [],  // ms spent near each hazard
    routeCompletion: 0,
  },
  controllerSignals: {
    left: false,
    right: false,
  },
};

/* ═══════════════════ HELPERS ═══════════════════ */
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/**
 * Project every hazard onto the route polyline, compute its distance from start,
 * filter out off-route hazards, and return them strictly A→B ordered.
 */
function sortHazardsByRouteProgress(routeCoords, hazards, maxOffRouteM = 60) {
  if (!routeCoords || routeCoords.length < 2 || !hazards || !hazards.length) {
    return hazards || [];
  }

  // Build cumulative distances along the route
  const cumDist = [0];
  for (let i = 1; i < routeCoords.length; i++) {
    const d = haversineDistance(routeCoords[i - 1][1], routeCoords[i - 1][0], routeCoords[i][1], routeCoords[i][0]);
    cumDist.push(cumDist[i - 1] + d);
  }
  const totalDist = cumDist[cumDist.length - 1];

  // For each hazard, find closest point on any segment
  const projected = hazards.map((h) => {
    let bestDist = Infinity;
    let bestProgress = 0;
    let bestOffRoute = Infinity;
    let bestIsParallelRoad = false;
    let bestSegLen = 0;

    for (let i = 0; i < routeCoords.length - 1; i++) {
      const [lng1, lat1] = routeCoords[i];
      const [lng2, lat2] = routeCoords[i + 1];
      const segLen = haversineDistance(lat1, lng1, lat2, lng2);
      if (segLen === 0) continue;

      // Project h onto segment i→i+1 (treat as 2D, good enough for <1km segments)
      const segDx = lng2 - lng1;
      const segDy = lat2 - lat1;
      const t = ((h.lng - lng1) * segDx + (h.lat - lat1) * segDy) /
                (segDx ** 2 + segDy ** 2);
      const clampedT = Math.max(0, Math.min(1, t));
      const projLng = lng1 + clampedT * segDx;
      const projLat = lat1 + clampedT * segDy;
      const offRoute = haversineDistance(h.lat, h.lng, projLat, projLng);
      const progress = cumDist[i] + clampedT * segLen;

      // Detect parallel roads in grid-style areas:
      // If the off-route displacement is nearly parallel to the segment,
      // the hazard is likely on a parallel street running alongside.
      const offDx = h.lng - projLng;
      const offDy = h.lat - projLat;
      const offLen = Math.sqrt(offDx * offDx + offDy * offDy) || 1;
      const segLenCart = Math.sqrt(segDx * segDx + segDy * segDy) || 1;
      // sin(angle) between segment and off-route vector: 0 = parallel, 1 = perpendicular
      const sinAngle = Math.abs((segDx * offDy - segDy * offDx) / (segLenCart * offLen));
      // On long segments (>20m), if off-route > 15m and displacement is nearly parallel
      // to the road (sinAngle < 0.5 => angle < 30°), it's likely a parallel road
      const isParallelRoad = segLen > 20 && offRoute > 15 && sinAngle < 0.5;

      if (offRoute < bestOffRoute) {
        bestOffRoute = offRoute;
        bestProgress = progress;
        bestIsParallelRoad = isParallelRoad;
        bestSegLen = segLen;
      }
    }

    return { h, progress: bestProgress, offRoute: bestOffRoute, isParallelRoad: bestIsParallelRoad, segLen: bestSegLen };
  });

  // Filter and sort A→B
  const filtered = projected
    .filter((p) => {
      if (p.offRoute > maxOffRouteM) return false;
      if (p.progress < 0 || p.progress > totalDist + 50) return false;
      // Reject hazards that sit on parallel roads in grid-style street networks
      if (p.isParallelRoad) return false;
      return true;
    })
    .sort((a, b) => a.progress - b.progress)
    .map((p) => p.h);

  return filtered;
}

function formatDuration(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}
function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/* ═══════════════════ SCREENS ═══════════════════ */
function showScreen(name) {
  state.screen = name;
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === `screen-${name}`);
  });

  const pairBox = $("persistent-pair-box");
  if (pairBox) {
    // Show pair box on all screens except when phone is already connected
    if (!phoneBridge.isControllerConnected()) {
      pairBox.classList.remove("hidden");
    } else {
      pairBox.classList.add("hidden");
    }
  }
}
/* ═══════════════════ GEOCODING ═══════════════════ */
async function geocode(address) {
  const url = `${CONFIG.NOMINATIM_URL}?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "RouteRehearsal/1.0" },
  });
  const data = await res.json();
  if (!data.length) throw new Error(`Address not found: "${address}"`);
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    label: data[0].display_name.split(",").slice(0, 3).join(","),
  };
}

/* ═══════════════════ ROUTING ═══════════════════ */
async function fetchRoute(origin, dest) {
  const url = `${CONFIG.OSRM_URL}/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson&steps=true&annotations=true`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes.length)
    throw new Error("Could not compute route");
  const route = data.routes[0];
  
  // Ensure the route strictly follows from exact point A to point B
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

  return {
    coords: coords, // [[lng,lat],...]
    steps: route.legs[0].steps,
    distance: route.distance,
    duration: route.duration,
  };
}

/* ═══════════════════ HAZARD ICONS ═══════════════════ */
function getHazardEmoji(h) {
  const type = (h.type || "").toLowerCase();
  switch (type) {
    case "traffic_signal": return "🚦";
    case "stop_sign": return "🛑";
    case "yield_sign": return "⚠️";
    case "lane_positioning": return "↔️";
    case "sharp_turn": return "↩️";
    case "tunnel": return "🚇";
    case "merge": return "🔀";
    case "fork": return "🔀";
    case "off_ramp": return "⬇️";
    case "on_ramp": return "⬆️";
    case "roundabout": return "🔄";
    case "confusing_signage": return "🪧";
    case "hidden_turn": return "👁️";
    case "railway_crossing": return "🚂";
    case "pedestrian_crossing": return "🚶";
    case "unmarked_crossing": return "⚠️";
    case "traffic_calming": return "🐢";
    case "poor_surface": return "🕳️";
    case "speed_zone": return "📛";
    case "sharp_maneuver": return "↪️";
    default: return "⚠️";
  }
}

function makeHazardIcon(h, active = false) {
  const emoji = h.source === "gemini" ? "♊" : getHazardEmoji(h);
  const size = active ? 32 : 22;
  const color = h.severity === "high" ? "#ff4466" : h.severity === "medium" ? "#ffaa00" : "#66bbff";
  return L.divIcon({
    className: "hazard-marker",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${color};box-shadow:0 2px 8px rgba(0,0,0,0.5);border:2px solid #fff;font-size:${active ? 20 : 14}px;line-height:1;">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/* ═══════════════════ GEMINI AI ═══════════════════ */
async function analyzeWithGemini(steps, geometryHazards) {
  if (!CONFIG.GEMINI_API_KEY) return null;
  
  // For long routes, analyze more steps and return more hazards
  const isLongRoute = steps.length > 50;
  const stepsToAnalyze = isLongRoute ? 100 : 30;
  const maxHazards = isLongRoute ? 20 : 6;
  
  const stepsText = steps
    .slice(0, stepsToAnalyze)
    .map((s, i) => {
      const lanes = s.intersections?.[0]?.lanes;
      const laneInfo = lanes && lanes.length
        ? ` [lanes: ${lanes.map(l => `${l.indications?.join("/") || "?"}${l.valid ? "" : " (invalid)"}`).join(", ")}]`
        : "";
      return `${i + 1}. ${s.maneuver?.instruction || s.name || "continue"} (${s.maneuver?.type || ""} ${s.maneuver?.modifier || ""})${laneInfo}`;
    })
    .join("\n");
  const hazardText = geometryHazards
    .slice(0, 10)
    .map((h) => `- ${h.label} at [${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}]: ${h.description}`)
    .join("\n");

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

For each issue you find (max ${maxHazards}), respond as a JSON array. Be specific and practical — give advice a driving instructor would give:
[{"title":"Short specific title","reason":"Why this confuses drivers (1-2 sentences)","tip":"Exactly what to do — which lane, when to move, what to look for","severity":"low|medium|high","stepIndex":N}]

If the route is straightforward with no issues, respond []. Only output valid JSON.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );
    const data = await res.json();
    
    // Check for quota exhaustion
    if (data.error && data.error.code === 429) {
      console.warn("Gemini quota exhausted, trying OpenRouter fallback...");
      return await analyzeWithOpenRouter(prompt);
    }
    
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    // Extract JSON from response (may be wrapped in markdown code block)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn("Gemini analysis failed:", e);
    // Try OpenRouter fallback
    if (CONFIG.OPENROUTER_API_KEY) {
      console.log("Attempting OpenRouter fallback...");
      return await analyzeWithOpenRouter(prompt);
    }
  }
  return null;
}

async function analyzeWithOpenRouter(prompt) {
  if (!CONFIG.OPENROUTER_API_KEY) return null;
  
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CONFIG.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": window.location.origin,
        "X-Title": "Road Route Rehearsal"
      },
      body: JSON.stringify({
        model: CONFIG.OPENROUTER_MODEL || "google/gemma-4-26b-a4b-it:free",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn("OpenRouter fallback failed:", e);
  }
  return null;
}

/* ═══════════════════ ROUTE SAVE/LOAD (COMMENTED OUT) ═══════════════════
function saveRoute() {
  const routeData = {
    isCachedState: true,
    title: `${state.origin.label} to ${state.destination.label}`,
    origin: state.origin,
    destination: state.destination,
    routeCoords: state.routeCoords,
    routeSteps: state.routeSteps,
    routeDistance: state.routeDistance,
    routeDuration: state.routeDuration,
    hazards: state.hazards,
    hazardSummary: state.hazardSummary,
    geminiInsights: state.geminiInsights
  };

  const blob = new Blob([JSON.stringify(routeData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `route-${state.origin.label.replace(/[^a-z0-9]/gi, '-')}-to-${state.destination.label.replace(/[^a-z0-9]/gi, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Route saved!');
}

function loadRouteFromFile() {
  const input = $("file-load-route");
  input.click();
}
*/

/* ═══════════════════ SCANNING FLOW ═══════════════════ */
async function startScan() {
  const originText = $("input-origin").value.trim();
  const destText = $("input-dest").value.trim();
  if (!originText || !destText) {
    showToast("Please enter both origin and destination.");
    return;
  }

  showScreen("scanning");
  const statusEl = $("scan-status");
  const progressEl = $("scan-progress-fill");

  try {
    // Step 1: Geocode origin
    updateScanStep(statusEl, progressEl, "Geocoding origin address...", 10);
    state.origin = await geocode(originText);
    await sleep(300);

    // Step 2: Geocode destination
    updateScanStep(statusEl, progressEl, "Geocoding destination...", 25);
    state.destination = await geocode(destText);
    await sleep(300);

    // Step 3: Route
    updateScanStep(statusEl, progressEl, "Computing route...", 40);
    const route = await fetchRoute(state.origin, state.destination);
    state.routeCoords = route.coords;
    state.routeSteps = route.steps;
    state.routeDistance = route.distance;
    state.routeDuration = route.duration;
    await sleep(300);

    // Step 4: Geometry scan
    updateScanStep(statusEl, progressEl, "Scanning for sharp turns and hazards...", 55);
    const result = scanRoute(state.routeCoords, state.routeSteps);
    state.hazards = result.hazards;
    state.hazardSummary = result.summary;
    await sleep(300);

    // Step 4b: Real-world hazard data from OSM / Overpass
    updateScanStep(statusEl, progressEl, "Checking real-world traffic hazards...", 65);
    try {
      const { hazards: osmHazards, excluded } = await accidentScanner.scanAccidents(state.routeCoords);
      if (osmHazards.length) {
        // Merge, avoiding duplicates close to existing hazards
        const deduped = osmHazards.filter((ah) => {
          const tooClose = state.hazards.some(
            (h) => haversineDistance(h.lat, h.lng, ah.lat, ah.lng) < 40
          );
          return !tooClose;
        });
        state.hazards.push(...deduped);
        state.hazardSummary.total = state.hazards.length;
      }
      state.excludedHazards = excluded || [];
    } catch (e) {
      console.warn("Accident scan failed (non-critical):", e.message);
    }
    await sleep(300);

    // Step 5: AI analysis
    updateScanStep(statusEl, progressEl, "AI analyzing route confusion points...", 80);
    const geminiResults = await analyzeWithGemini(state.routeSteps, state.hazards);
    if (geminiResults && geminiResults.length) {
      state.geminiInsights = geminiResults;
      // Merge AI hazards
      geminiResults.forEach((g, i) => {
        const step = state.routeSteps[g.stepIndex] || state.routeSteps[0];
        const loc = step?.maneuver?.location || state.routeCoords[0];
        state.hazards.push({
          id: `ai_hazard_${i}`,
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
      state.hazardSummary.total = state.hazards.length;
    }
    await sleep(300);

    // Step 6: Strictly order hazards A→B along route, drop off-route ones
    updateScanStep(statusEl, progressEl, "Ordering hazards along route...", 90);
    state.hazards = sortHazardsByRouteProgress(state.routeCoords, state.hazards, 30);
    state.hazardSummary.total = state.hazards.length;
    await sleep(200);

    // Done
    updateScanStep(statusEl, progressEl, `Found ${state.hazards.length} hazard${state.hazards.length !== 1 ? "s" : ""}. Loading report...`, 100);

    // Initialize narration and pre-generate audio in background
    // narration.init(CONFIG.ELEVENLABS_API_KEY);
    // narration.pregenerate(state.hazards);

    // Initialize distractions and pre-generate clips in background
    distractions.init(CONFIG.ELEVENLABS_API_KEY);
    distractions.pregenerate();

    await sleep(600);
    showReport();
  } catch (err) {
    console.error(err);
    updateScanStep(statusEl, progressEl, `Error: ${err.message}`, 0);
    setTimeout(() => showScreen("input"), 3000);
  }
}

function updateScanStep(statusEl, progressEl, text, pct) {
  statusEl.textContent = text;
  progressEl.style.width = `${pct}%`;
}

/* ═══════════════════ REPORT SCREEN ═══════════════════ */
function showReport() {
  showScreen("report");

  // Stats
  $("report-title").textContent = `${state.origin.label} → ${state.destination.label}`;
  $("stat-distance").textContent = formatDistance(state.routeDistance);
  $("stat-duration").textContent = formatDuration(state.routeDuration);
  $("stat-hazards").textContent = String(state.hazards.length);
  $("stat-high").textContent = String(state.hazards.filter((h) => h.severity === "high").length);

  // Route nudge for long routes (>3h)
  const nudgeEl = $("route-nudge");
  if (nudgeEl) {
    const hours = state.routeDuration / 3600;
    if (hours >= 5) {
      nudgeEl.style.display = "block";
      nudgeEl.innerHTML = `<strong>Long straight drive detected (${formatDuration(state.routeDuration)}).</strong> Consider adding rest stops to your plan. <a href="#" id="nudge-add-breaks" style="color:var(--accent);text-decoration:underline;">Plan breaks</a>`;
    } else if (hours >= 3) {
      nudgeEl.style.display = "block";
      nudgeEl.innerHTML = `<strong>Long route detected (${formatDuration(state.routeDuration)}).</strong> 🔥 <a href="#" id="nudge-hotspots" style="color:var(--accent);text-decoration:underline;">Try Hotspots Only</a> to rehearse just the tricky parts.`;
    } else {
      nudgeEl.style.display = "none";
      nudgeEl.innerHTML = "";
    }
  }

  // Map
  initReportMap();

  // Hazard list
  renderHazardList();
}

function initReportMap() {
  if (state.reportMap) state.reportMap.remove();
  state.reportMap = L.map("report-map", { zoomControl: false }).setView([0, 0], 13);
  L.tileLayer(CONFIG.DARK_TILES, {
    attribution: '&copy; <a href="https://carto.com">CARTO</a>',
    maxZoom: 19,
  }).addTo(state.reportMap);

  // Draw route
  const latLngs = state.routeCoords.map(([lng, lat]) => [lat, lng]);
  const routeLine = L.polyline(latLngs, {
    color: "#00d4aa",
    weight: 4,
    opacity: 0.85,
  }).addTo(state.reportMap);

  // Origin / Dest markers
  L.circleMarker([state.origin.lat, state.origin.lng], {
    radius: 8, fillColor: "#00d4aa", fillOpacity: 1, color: "#fff", weight: 2,
  }).addTo(state.reportMap).bindPopup("Start");
  L.circleMarker([state.destination.lat, state.destination.lng], {
    radius: 8, fillColor: "#0088ff", fillOpacity: 1, color: "#fff", weight: 2,
  }).addTo(state.reportMap).bindPopup("Destination");

  // Hazard markers
  state.hazards.forEach((h, i) => {
    L.marker([h.lat, h.lng], { icon: makeHazardIcon(h) })
      .addTo(state.reportMap)
      .bindPopup(`<b>${getHazardEmoji(h)} ${h.label}</b><br>${h.description}`)
      .on("click", () => scrollToHazard(i));
  });

  // Excluded (off-route) markers in red for transparency
  if (state.excludedHazards?.length) {
    state.excludedHazards.forEach((h) => {
      L.circleMarker([h.lat, h.lng], {
        radius: 6, fillColor: "#ff0000", fillOpacity: 0.4, color: "#ff0000", weight: 1,
      }).addTo(state.reportMap)
        .bindPopup(`<b>Excluded: ${h.label}</b><br>Not on your route (${Math.round(h.dist || 0)}m away)`);
    });
  }

  state.reportMap.fitBounds(routeLine.getBounds().pad(0.1));
}

function renderHazardList() {
  const list = $("hazard-list");
  list.innerHTML = "";

  if (!state.hazards.length) {
    list.innerHTML = `<div class="no-hazards">
      <div class="no-hazards-icon">✓</div>
      <h3>Route looks clear!</h3>
      <p>No significant hazards detected on this route.</p>
    </div>`;
    return;
  }

  state.hazards.forEach((h, i) => {
    const card = document.createElement("div");
    card.className = "hazard-card";
    card.id = `hazard-card-${i}`;
    card.innerHTML = `
      <div class="hazard-header">
        <span class="hazard-badge ${h.severity}">${h.severity}</span>
        <span class="hazard-type">${h.type.replace(/_/g, " ")}</span>
        ${h.source === "gemini" ? '<span class="ai-badge">♊ Gemini</span>' : h.source === "overpass" ? '<span class="osm-badge">OSM</span>' : h.source === "geometry" ? '<span class="geo-badge">GEO</span>' : ""}
      </div>
      <h3 class="hazard-title">${h.label}</h3>
      <p class="hazard-desc">${h.description}</p>
      <p class="hazard-tip">💡 ${h.tip}</p>
      <button class="btn-practice" data-index="${i}">Practice this spot →</button>
    `;
    card.querySelector(".btn-practice").addEventListener("click", () => {
      startPractice(i);
    });
    list.appendChild(card);
  });
}

function scrollToHazard(i) {
  const card = $(`hazard-card-${i}`);
  if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ═══════════════════ PRACTICE MODE ═══════════════════ */
let cesiumInitialized = false;
let currentPracticePass = 1;
let alertTimeout = null;
let lastStreetViewUpdate = 0;
let isNavigating = false;

async function startPractice(index = 0) {
  state.practiceIndex = index;
  resetRehearsal();
  showScreen("practice");
  renderPracticeInfo();

  // Always start on Pass 1 (Review) — Cesium is only initialised on-demand in Pass 3
  switchPass(1);
}

function renderPracticeInfo() {
  const h = state.hazards[state.practiceIndex];
  if (!h) return;

  // Counter
  const label = state.hotspotsOnly ? "Hotspot" : "Hazard";
  $("practice-counter").textContent = `${label} ${state.practiceIndex + 1} of ${state.hazards.length}`;
  $("practice-progress-fill").style.width = `${((state.practiceIndex + 1) / state.hazards.length) * 100}%`;

  // Info panel
  $("practice-label").textContent = h.label;
  $("practice-severity").textContent = h.severity;
  $("practice-severity").className = `practice-severity ${h.severity}`;
  $("practice-desc").textContent = h.description;
  $("practice-tip").textContent = h.tip;
  $("practice-road").textContent = h.road || "";

  // Buttons
  $("btn-prev-hazard").disabled = state.practiceIndex === 0;
  const isLastHazard = state.practiceIndex >= state.hazards.length - 1;
  const hasNextPhase = currentPracticePass < 3;
  if (isLastHazard && hasNextPhase) {
    $("btn-next-hazard").disabled = false;
    $("btn-next-hazard").textContent = "Next Phase →";
    $("btn-next-hazard").classList.add("next-phase");
  } else if (isLastHazard && !hasNextPhase) {
    $("btn-next-hazard").disabled = false;
    $("btn-next-hazard").textContent = "Finish ✓";
    $("btn-next-hazard").classList.add("finish-btn");
  } else {
    $("btn-next-hazard").disabled = isLastHazard;
    $("btn-next-hazard").textContent = "Next →";
    $("btn-next-hazard").classList.remove("next-phase", "finish-btn");
  }
}

function switchPass(pass) {
  try {
    currentPracticePass = pass;

    // Update toggle buttons
    document.querySelectorAll(".mode-btn").forEach(btn => {
      btn.classList.toggle("active", parseInt(btn.dataset.pass) === pass);
    });

    // Hide all containers initially
    $("review-map-container").style.display = "none";
    $("split-view-container").style.display = "none";
    $("cesium-container").style.display = "none";
    $("drive-hud").classList.add("hidden");
    const triPane = $("tri-pane-container");
    if (triPane) triPane.style.display = "none";
    const triCesium = $("tri-cesium-container");
    if (triCesium) triCesium.style.display = "none";

    if (pass === 1) {
      // Pass 1: Review (2D Map only)
      $("review-map-container").style.display = "block";
      renderReviewPass();
    } else if (pass === 2) {
      // Pass 2: StreetView Split View
      $("split-view-container").style.display = "flex";
      renderStreetViewPass();
    } else if (pass === 3) {
      // Pass 3: Tri-pane — Map left, 3D middle, StreetView right
      showTriPane().catch(e => {
        console.error("Error showing tri-pane:", e);
        showToast("Error loading 3D view");
      });
    }
  } catch (e) {
    console.error("Error switching pass:", e);
    showToast("Error switching view mode");
  }
}

function renderReviewPass() {
  const h = state.hazards[state.practiceIndex];
  if (!h) return;
  try {
    if (!state.practiceMap) {
      state.practiceMap = L.map("review-map-container").setView([h.lat, h.lng], 18);
      L.tileLayer(CONFIG.SAT_TILES, { maxZoom: 19, attribution: "Esri" }).addTo(state.practiceMap);

      // Draw route
      const latLngs = state.routeCoords.map(([lng, lat]) => [lat, lng]);
      L.polyline(latLngs, { color: "#00d4aa", weight: 5, opacity: 0.8 }).addTo(state.practiceMap);
    } else {
      // Use setTimeout to defer flyTo and prevent blocking
      setTimeout(() => {
        try {
          if (state.practiceMap) {
            state.practiceMap.flyTo([h.lat, h.lng], 18);
          }
        } catch (e) {
          console.warn("flyTo failed:", e);
        }
      }, 0);
    }

    // Clear previous markers
    if (state.practiceMapMarkers) {
      state.practiceMapMarkers.forEach(m => m.remove());
    }
    state.practiceMapMarkers = [];

    // Draw all hazard markers
    state.hazards.forEach((hz, idx) => {
      const isActive = idx === state.practiceIndex;
      const marker = L.marker([hz.lat, hz.lng], { icon: makeHazardIcon(hz, isActive) })
        .addTo(state.practiceMap).bindPopup(`<b>${getHazardEmoji(hz)} ${hz.label}</b>`);
      state.practiceMapMarkers.push(marker);
    });
  } catch (e) {
    console.warn("Map render failed in Review pass:", e);
  }
}

function renderStreetViewPass() {
  const h = state.hazards[state.practiceIndex];
  if (!h) return;

  try {
    // Handle Map side
    if (!state.splitMap) {
      state.splitMap = L.map("minimap-container").setView([h.lat, h.lng], 18);
      L.tileLayer(CONFIG.SAT_TILES, { maxZoom: 19, attribution: "Esri" }).addTo(state.splitMap);
      const latLngs = state.routeCoords.map(([lng, lat]) => [lat, lng]);
      L.polyline(latLngs, { color: "#00d4aa", weight: 5, opacity: 0.8 }).addTo(state.splitMap);
    } else {
      state.splitMap.invalidateSize();
      // Use setTimeout to defer flyTo and prevent blocking
      setTimeout(() => {
        try {
          if (state.splitMap) {
            state.splitMap.flyTo([h.lat, h.lng], 18);
          }
        } catch (e) {
          console.warn("flyTo failed:", e);
        }
      }, 0);
    }

    // Clear markers
    if (state.splitMapMarkers) state.splitMapMarkers.forEach(m => m.remove());
    state.splitMapMarkers = [];

    const marker = L.marker([h.lat, h.lng], { icon: makeHazardIcon(h, true) })
      .addTo(state.splitMap).bindPopup(`<b>${getHazardEmoji(h)} ${h.label}</b>`);
    state.splitMapMarkers.push(marker);
  } catch (e) {
    console.warn("Map render failed in Street View pass:", e);
  }

  // Update Street View iframe (with error handling inside)
  // Defer to prevent blocking
  setTimeout(() => updateStreetViewOverlay(), 0);
}

function updateStreetViewOverlay(containerId = "streetview-content") {
  const h = state.hazards[state.practiceIndex];
  if (!h) return;
  const content = $(containerId);
  if (!content) return;
  const lat = h.lat;
  const lng = h.lng;

  try {
    // Compute heading from the direction you approach the hazard along the route
    // (looks back along the route so the driver sees what's ahead of them)
    let heading = h.heading || 0;
    const routeIdx = state.hazards[state.practiceIndex]?.coordIndex ?? 0;
    if (state.routeCoords && routeIdx > 0 && routeIdx < state.routeCoords.length) {
      const prev = state.routeCoords[routeIdx - 1] || state.routeCoords[0];
      const curr = state.routeCoords[routeIdx] || prev;
      const dLng = curr[0] - prev[0];
      const dLat = curr[1] - prev[1];
      if (dLng !== 0 || dLat !== 0) {
        heading = (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
      }
    }
    const src = `https://www.google.com/maps?layer=c&cbll=${lat},${lng}&cbp=0,${Math.round(heading)},0,0,0&output=svembed`;
    content.innerHTML = `<iframe class="streetview-frame" allowfullscreen loading="lazy"
      src="${src}"
      style="border:0; width:100%; height:100%;"></iframe>`;
  } catch (e) {
    console.warn("Street View iframe update failed:", e);
    content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;">Street View unavailable</div>`;
  }
}

function updateHUD(data) {
  $("hud-progress").textContent = Math.round(data.progress);
  $("hud-dist").textContent = data.nextHazardDist < 9999 ? data.nextHazardDist : "--";
  if (typeof data.speed === "number") {
    $("hud-speed").textContent = data.speed;
    
    // Send speed to phone controller
    if (phoneBridge.isControllerConnected && phoneBridge.isControllerConnected()) {
      phoneBridge.sendToController({ type: "host_data", speed: data.speed });
    }
  }
  // Update completion tracking
  if (data.progress > 0) {
    state.rehearsal.routeCompletion = Math.round(data.progress);
  }
}

function onHazardApproach(hazard, index, dist) {
  // Show alert banner (DISABLED - annoying)
  // const alert = $("hud-alert");
  // alert.textContent = `⚠ ${hazard.label} — ${hazard.tip}`;
  // alert.classList.add("visible");
  // clearTimeout(alertTimeout);
  // alertTimeout = setTimeout(() => alert.classList.remove("visible"), 4000);

  // Stop any stale narrations so we don't lag behind the car position, then play
  // narration.stop();
  // narration.playHazard(hazard, index, state.hazards.length);

  // Track rehearsal: mark hazard as reviewed
  state.rehearsal.hazardReviewed[index] = true;
  state.rehearsal.hazardEntryTime[index] = Date.now();

  // Update info panel to show this hazard
  state.practiceIndex = index;
  renderPracticeInfo();
}

/* ═══════════════════ 2D FALLBACK ═══════════════════ */
let fallbackProgress = 0; // 0..routeCoords.length-1
let fallbackVehicle = null;

function render2DFallback() {
  cesiumInitialized = false;
  $("cesium-container").classList.add("hidden");
  $("drive-hud").classList.add("hidden");

  let container = $("practice-2d-fallback");
  if (!container) {
    container = document.createElement("div");
    container.id = "practice-2d-fallback";
    container.className = "practice-2d-fallback";
    document.querySelector(".practice-view-panel").appendChild(container);
  }
  container.classList.remove("hidden");
  container.innerHTML = `<div id="fallback-map" style="width:100%; height:100%;"></div>`;

  const h = state.hazards[state.practiceIndex];
  if (state.practiceMap) { state.practiceMap.remove(); }

  state.practiceMap = L.map("fallback-map").setView([h.lat, h.lng], 18);
  L.tileLayer(CONFIG.SAT_TILES, { maxZoom: 19, attribution: "Esri" }).addTo(state.practiceMap);

  // Draw route
  const latLngs = state.routeCoords.map(([lng, lat]) => [lat, lng]);
  L.polyline(latLngs, { color: "#00d4aa", weight: 5, opacity: 0.8 }).addTo(state.practiceMap);

  // Markers
  state.hazards.forEach((hz, idx) => {
    const isActive = idx === state.practiceIndex;
    L.marker([hz.lat, hz.lng], { icon: makeHazardIcon(hz, isActive) })
      .addTo(state.practiceMap).bindPopup(`<b>${getHazardEmoji(hz)} ${hz.label}</b>`);
  });

  // Vehicle marker
  fallbackProgress = 0;
  const startPos = latLngs[0] || [h.lat, h.lng];
  fallbackVehicle = L.circleMarker(startPos, {
    radius: 10,
    fillColor: "#00d4aa",
    fillOpacity: 1,
    color: "#fff",
    weight: 3,
  }).addTo(state.practiceMap);
}

function triggerTransitionOverlay() {
  const overlay = $("transition-overlay");
  if (!overlay) return;
  overlay.classList.add("active");
  requestAnimationFrame(() => {
    setTimeout(() => overlay.classList.remove("active"), 80);
  });
}

function nextHazard() {
  console.log("[nextHazard] Called, practiceIndex:", state.practiceIndex, "hazards:", state.hazards.length, "pass:", currentPracticePass);
  // Guard against re-entrancy during navigation transitions
  if (isNavigating) {
    console.log("[nextHazard] Blocked — navigation already in progress");
    return;
  }
  triggerTransitionOverlay();
  try {
    if (state.practiceIndex < state.hazards.length - 1) {
      console.log("[nextHazard] Advancing to next hazard");
      state.practiceIndex++;
      renderPracticeInfo();

      if (currentPracticePass === 1) {
        console.log("[nextHazard] Rendering pass 1");
        renderReviewPass();
      } else if (currentPracticePass === 2) {
        console.log("[nextHazard] Rendering pass 2");
        renderStreetViewPass();
      } else if (currentPracticePass === 3) {
        console.log("[nextHazard] Rendering pass 3, cesiumInitialized:", cesiumInitialized);
        if (cesiumInitialized) cesiumView.jumpToHazard(state.practiceIndex);
        updateStreetViewOverlay("tri-streetview-content");
        updateTriPaneMap();
      }
    } else if (currentPracticePass < 3) {
      console.log("[nextHazard] Transitioning directly to next pass");
      // Disable button briefly to prevent double-clicks
      $("btn-next-hazard").disabled = true;
      
      // Advance to next pass
      state.practiceIndex = 0;
      const nextPass = currentPracticePass + 1;
      switchPass(nextPass);
      renderPracticeInfo();
      
      // Re-enable button
      setTimeout(() => { $("btn-next-hazard").disabled = false; }, 300);
    } else {
      console.log("[nextHazard] At end of all hazards and phases - finishing practice");
      finishRehearsal();
    }
    console.log("[nextHazard] Completed successfully");
  } catch (e) {
    console.error("Error in nextHazard:", e);
    isNavigating = false;
    $("btn-next-hazard").disabled = false;
    showToast("Error advancing to next hazard");
  }
}

function prevHazard() {
  try {
    if (state.practiceIndex > 0) {
      state.practiceIndex--;
      renderPracticeInfo();

      if (currentPracticePass === 1) {
        renderReviewPass();
      } else if (currentPracticePass === 2) {
        renderStreetViewPass();
      } else if (currentPracticePass === 3) {
        if (cesiumInitialized) cesiumView.jumpToHazard(state.practiceIndex);
        updateStreetViewOverlay("tri-streetview-content");
        updateTriPaneMap();
      }
    }
  } catch (e) {
    console.error("Error in prevHazard:", e);
    showToast("Error going to previous hazard");
  }
}

/* ═══════════════════ TRI-PANE (Pass 3) ═══════════════════ */
async function showTriPane() {
  try {
    const triPane = $("tri-pane-container");
    if (!triPane) return;
    triPane.style.display = "flex";
    $("tri-cesium-container").style.display = "block";
    $("drive-hud").classList.remove("hidden");

    // Initialise Cesium on-demand if needed
    if (!cesiumInitialized) {
      // Show loading indicator
      const cesiumContainer = $("tri-cesium-container");
      if (cesiumContainer) {
        cesiumContainer.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#00d4aa;">Loading 3D view...</div>`;
      }

      try {
        await sleep(50); // Force layout reflow so container has >0 size
        // Set Cesium ion token so 3D photorealistic tiles can authenticate
        Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIxY2RkMzlmZi1lMGI4LTRmNzUtOGU2MS01ZDMxZWM2ODYwOGIiLCJpZCI6NDI1MzE3LCJpYXQiOjE3Nzc0NjM1MjR9.W0oxtmgNcJJMRxnsOA0KzkW4ed3eTXvM4GE4ZCffcQo";
        await cesiumView.initView("tri-cesium-container", state.routeCoords, state.hazards, {
          onProgress: updateHUD,
          onHazardApproach: onHazardApproach,
        }, { googleMapsKey: CONFIG.GOOGLE_MAPS_KEY });
        cesiumInitialized = true;
      } catch (e) {
        console.warn("CesiumJS init failed in tri-pane:", e.message);
        // Render a 2D map directly inside the middle pane so the layout still works
        const h = state.hazards[state.practiceIndex];
        $("tri-cesium-container").innerHTML = `<div id="tri-fallback-map" style="width:100%; height:100%;"></div>`;
        if (h) {
          const map = L.map("tri-fallback-map").setView([h.lat, h.lng], 18);
          L.tileLayer(CONFIG.SAT_TILES, { maxZoom: 19, attribution: "Esri" }).addTo(map);
          const latLngs = state.routeCoords.map(([lng, lat]) => [lat, lng]);
          L.polyline(latLngs, { color: "#00d4aa", weight: 5, opacity: 0.8 }).addTo(map);
          L.marker([h.lat, h.lng], { icon: makeHazardIcon(h, true) })
            .addTo(map).bindPopup(`<b>${getHazardEmoji(h)} ${h.label}</b>`);
        }
      }
    }

    if (cesiumInitialized) {
      cesiumView.setMode("drive");
      cesiumView.jumpToHazard(state.practiceIndex);
    }

    // Start manual drive loop so gas/brake control the car immediately
    if (!manualDriving) startManualDrive();

    // Defer map and Street View updates to prevent blocking
    setTimeout(() => {
      updateTriPaneMap();
      updateStreetViewOverlay("tri-streetview-content");
    }, 0);
  } catch (e) {
    console.error("Error in showTriPane:", e);
    throw e; // Re-throw to be caught by switchPass
  }
}

function isNearHazard(lat, lng, progress) {
  const HAZARD_BUFFER_M = 120;
  const SLOW_TYPES = new Set(["roundabout", "merge", "fork", "off_ramp", "on_ramp", "sharp_turn", "lane_positioning"]);
  let nearAny = false;
  let nearSlow = false;
  for (const h of state.hazards) {
    const d = haversineDistance(lat, lng, h.lat, h.lng);
    if (d <= HAZARD_BUFFER_M) {
      nearAny = true;
      if (SLOW_TYPES.has(h.type)) nearSlow = true;
    }
  }
  return { nearAny, nearSlow };
}

function segmentHeading(fromIdx, toIdx) {
  const a = state.routeCoords[fromIdx] || state.routeCoords[0];
  const b = state.routeCoords[toIdx] || a;
  const dLng = b[0] - a[0];
  const dLat = b[1] - a[1];
  return (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;
}

/**
 * Compute a heading that looks toward the upcoming maneuver so drivers see
 * what's coming, not just what's behind them.
 */
function computeLookAheadHeading(progress) {
  const maxIdx = state.routeCoords.length - 1;
  const idx = Math.floor(Math.max(0, Math.min(progress, maxIdx)));
  const frac = progress - idx;

  // Current segment heading
  const currentH = segmentHeading(idx, Math.min(maxIdx, idx + 1));

  // Look ahead for next hazard/turn within 300m and blend toward its heading
  const LOOKAHEAD_M = 300;
  const coords = state.routeCoords;
  let lookaheadH = currentH;
  let lookaheadDist = 0;
  for (let i = idx + 1; i < maxIdx && lookaheadDist < LOOKAHEAD_M; i++) {
    lookaheadDist += haversineDistance(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    if (lookaheadDist >= 50) { // at least a bit ahead
      lookaheadH = segmentHeading(i, Math.min(maxIdx, i + 1));
      break;
    }
  }

  // Blend: more weight to lookahead as we get closer to the turn
  const blend = Math.min(1, Math.max(0, 1 - lookaheadDist / LOOKAHEAD_M));
  // Shortest-path interpolation for angles
  let diff = ((lookaheadH - currentH + 540) % 360) - 180;
  return (currentH + diff * blend + 360) % 360;
}

let lastStreetViewLat = 0, lastStreetViewLng = 0, lastStreetViewHeading = 0;

function updateTriPaneStreetViewFromProgress(progress, speedKmh = 0) {
  const now = Date.now();
  const maxProgress = state.routeCoords.length - 1;
  const idx = Math.floor(Math.max(0, Math.min(progress, maxProgress)));
  const frac = Math.max(0, Math.min(progress, maxProgress)) - idx;
  const c1 = state.routeCoords[idx] || state.routeCoords[maxProgress];
  const c2 = state.routeCoords[idx + 1] || c1;
  const lat = c1[1] + (c2[1] - c1[1]) * frac;
  const lng = c1[0] + (c2[0] - c1[0]) * frac;

  const { nearAny, nearSlow } = isNearHazard(lat, lng, progress);
  const heading = computeLookAheadHeading(progress);

  // Skip refresh entirely when stopped — no point reloading the same view
  const isStopped = speedKmh < 3;
  if (isStopped) return;

  // Frequent refresh for better immersion (1 second)
  const baseThrottle = 1000; // Update every 1 second
  const sinceLast = now - lastStreetViewUpdate;

  // If we just entered a hazard zone and haven't refreshed recently, force immediate refresh
  const shouldForce = nearAny && sinceLast > 800;
  if (!shouldForce && sinceLast < baseThrottle) return;

  // Lower threshold for movement detection (refresh more often)
  const dLat = lat - lastStreetViewLat;
  const dLng = lng - lastStreetViewLng;
  const dH = Math.abs(((heading - lastStreetViewHeading + 540) % 360) - 180);
  const movedEnough = Math.sqrt(dLat * dLat + dLng * dLng) > 0.00001 || dH > 2;
  if (!movedEnough && !shouldForce) return;
  console.log("[SV] Refreshing Street View at", lat.toFixed(6), lng.toFixed(6), "heading", Math.round(heading), "speed", speedKmh);

  lastStreetViewUpdate = now;
  lastStreetViewLat = lat;
  lastStreetViewLng = lng;
  lastStreetViewHeading = heading;

  const content = $("tri-streetview-content");
  if (!content) return;

  const src = `https://www.google.com/maps?layer=c&cbll=${lat},${lng}&cbp=0,${Math.round(heading)},0,0,0&output=svembed`;

  // Solid black overlay to completely hide the iframe white-flash during reload
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:absolute;inset:0;background:#000;z-index:10;opacity:1;transition:opacity 0.5s ease-out;pointer-events:none;";
  content.appendChild(overlay);

  const iframe = content.querySelector("iframe");
  const onLoad = () => {
    requestAnimationFrame(() => {
      overlay.style.opacity = "0";
      setTimeout(() => overlay.remove(), 550);
    });
  };

  // Fallback: always fade overlay after 4s even if iframe onload never fires
  const fallbackTimer = setTimeout(() => {
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 550);
  }, 4000);

  const wrappedOnLoad = () => {
    clearTimeout(fallbackTimer);
    // Fade out the transition overlay
    const overlay = content.querySelector('.sv-transition-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    }
    onLoad();
  };

  // Add transition overlay
  if (!content.querySelector('.sv-transition-overlay')) {
    const overlay = document.createElement('div');
    overlay.className = 'sv-transition-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;background:linear-gradient(135deg,rgba(0,212,170,0.3),rgba(0,136,255,0.3));backdrop-filter:blur(8px);transition:opacity 0.3s;z-index:10;pointer-events:none;';
    content.appendChild(overlay);
  } else {
    // Reset opacity if overlay already exists
    content.querySelector('.sv-transition-overlay').style.opacity = '1';
  }

  if (iframe) {
    iframe.onload = wrappedOnLoad;
    iframe.src = src;
  } else {
    content.innerHTML = `<iframe class="streetview-frame" allowfullscreen loading="lazy" src="${src}" style="border:0; width:100%; height:100%;"></iframe>`;
    content.querySelector("iframe").onload = wrappedOnLoad;
  }
}

function updateTriPaneMap() {
  // Initialize the tri-pane map once (shows full route + hazards)
  const h = state.hazards[state.practiceIndex];
  if (!h) return;
  const container = $("tri-map-container");
  if (!container) return;

  try {
    if (!state.triMap) {
      state.triMap = L.map(container).setView([h.lat, h.lng], 18);
      L.tileLayer(CONFIG.SAT_TILES, { maxZoom: 19, attribution: "Esri" }).addTo(state.triMap);
      const latLngs = state.routeCoords.map(([lng, lat]) => [lat, lng]);
      L.polyline(latLngs, { color: "#00d4aa", weight: 5, opacity: 0.8 }).addTo(state.triMap);

      // Add car position marker
      state.triCarMarker = L.circleMarker([h.lat, h.lng], {
        radius: 8, fillColor: "#00d4aa", fillOpacity: 1, color: "#fff", weight: 2
      }).addTo(state.triMap);
    } else {
      state.triMap.invalidateSize();
    }

    if (state.triMapMarkers) state.triMapMarkers.forEach(m => m.remove());
    state.triMapMarkers = [];

    const marker = L.marker([h.lat, h.lng], { icon: makeHazardIcon(h, true) })
      .addTo(state.triMap).bindPopup(`<b>${getHazardEmoji(h)} ${h.label}</b>`);
    state.triMapMarkers.push(marker);
  } catch (e) {
    console.warn("Map render failed in Tri-pane:", e);
  }
}

function updateTriPaneMapFromProgress(progress) {
  if (!state.triMap || !state.triCarMarker) return;
  const maxProgress = state.routeCoords.length - 1;
  const idx = Math.floor(Math.max(0, Math.min(progress, maxProgress)));
  const frac = Math.max(0, Math.min(progress, maxProgress)) - idx;
  const c1 = state.routeCoords[idx] || state.routeCoords[maxProgress];
  const c2 = state.routeCoords[idx + 1] || c1;
  const lat = c1[1] + (c2[1] - c1[1]) * frac;
  const lng = c1[0] + (c2[0] - c1[0]) * frac;
  state.triCarMarker.setLatLng([lat, lng]);
  state.triMap.panTo([lat, lng], { animate: true, duration: 0.4 });
}

/* ═══════════════════ TOAST ═══════════════════ */
function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 3000);
}

function isNgrokHost() {
  return false; // Disabled - using hotspot instead
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast("Copied to clipboard");
  } catch {
    showToast("Could not copy. Please copy manually.");
  }
}

function initNgrokModal() {
  const modal = $("ngrok-modal");
  if (!modal || !isNgrokHost()) return;

  const laptopUrl = `${window.location.origin}/`;
  const phoneUrl = `${window.location.origin}/controller.html`;

  $("ngrok-laptop-url").textContent = laptopUrl;
  $("ngrok-phone-url").textContent = phoneUrl;
  $("btn-copy-laptop-url").addEventListener("click", () => copyText(laptopUrl));
  $("btn-copy-phone-url").addEventListener("click", () => copyText(phoneUrl));
  $("btn-close-ngrok-modal").addEventListener("click", () => modal.classList.add("hidden"));

  const qr = $("ngrok-phone-qr");
  if (qr) {
    qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(phoneUrl)}`;
  }

  modal.classList.remove("hidden");
}

/* ═══════════════════ MANUAL DRIVE ═══════════════════ */
let manualDriving = false;
let manualDriveInterval = null;
const MANUAL_DRIVE_MAX_SPEED = 0.18;
const MANUAL_DRIVE_ACCEL = 0.004;
const MANUAL_DRIVE_BRAKE_DECAY = 0.008;
const MANUAL_DRIVE_COAST_DECAY = 0.002;
let manualDriveSpeed = 0; // index units per frame
let gasHeld = false;
let brakeHeld = false;

function startManualDrive() {
  if (manualDriving) return;
  manualDriving = true;
  state.rehearsal.startTime = state.rehearsal.startTime || Date.now();

  // Reset Street View tracking so first update happens immediately
  lastStreetViewUpdate = 0;
  lastStreetViewLat = 0;
  lastStreetViewLng = 0;
  lastStreetViewHeading = 0;

  // Start distraction audio
  distractions.start();

  // Drive loop: speed controlled by gas/brake, no forced minimum speed
  manualDriveInterval = setInterval(() => {
    if (gasHeld) {
      manualDriveSpeed = Math.min(MANUAL_DRIVE_MAX_SPEED, manualDriveSpeed + MANUAL_DRIVE_ACCEL);
    } else if (brakeHeld) {
      manualDriveSpeed = Math.max(0, manualDriveSpeed - MANUAL_DRIVE_BRAKE_DECAY);
    } else {
      // Coast to stop
      manualDriveSpeed = Math.max(0, manualDriveSpeed - MANUAL_DRIVE_COAST_DECAY);
    }

    const maxProgress = state.routeCoords.length - 1;
    
    // Get actual speed from cesium-view
    const actualSpeed = cesiumInitialized ? cesiumView.getSpeed() : manualDriveSpeed;
    const speedKmh = Math.round(actualSpeed * 400 * 60);

    if (cesiumInitialized) {
      const progress = cesiumView.getProgress();

      if (progress >= maxProgress - 1) {
        stopManualDrive();
        finishRehearsal();
        return;
      }

      // Let cesium-view handle its own physics; we just sync progress for external updates
      cesiumView.setProgress(progress + manualDriveSpeed);
      state.rehearsal.routeCompletion = Math.round((progress / maxProgress) * 100);
      updateTriPaneStreetViewFromProgress(progress, speedKmh);
      updateTriPaneMapFromProgress(progress);
    } else if (state.practiceMap && fallbackVehicle) {
      // 2D fallback: interpolate along routeCoords
      if (fallbackProgress >= maxProgress - 1) {
        stopManualDrive();
        finishRehearsal();
        return;
      }

      fallbackProgress += manualDriveSpeed;
      const idx = Math.floor(fallbackProgress);
      const frac = fallbackProgress - idx;
      const c1 = state.routeCoords[idx] || state.routeCoords[maxProgress];
      const c2 = state.routeCoords[idx + 1] || c1;
      const lat = c1[1] + (c2[1] - c1[1]) * frac;
      const lng = c1[0] + (c2[0] - c1[0]) * frac;

      fallbackVehicle.setLatLng([lat, lng]);
      state.practiceMap.panTo([lat, lng]);

      state.rehearsal.routeCompletion = Math.round((fallbackProgress / maxProgress) * 100);
      updateTriPaneStreetViewFromProgress(fallbackProgress, speedKmh);
      updateTriPaneMapFromProgress(fallbackProgress);
    }

    // Update speed display (approx km/h)
    const speedEl = $("hud-speed");
    if (speedEl) speedEl.textContent = speedKmh;

    // Relay speed to phone controller HUD
    if (phoneBridge.isControllerConnected && phoneBridge.isControllerConnected()) {
      phoneBridge.sendToController({ type: "host_data", speed: speedKmh });
    }
  }, 1000 / 30); // 30 fps
}
function stopManualDrive() {
  manualDriving = false;
  clearInterval(manualDriveInterval);
  manualDriveInterval = null;
  manualDriveSpeed = 0;
  lastStreetViewUpdate = 0;

  // Pause distractions too
  distractions.stop();
}
// Backward-compat alias
const startAutoDrive = startManualDrive;
const stopAutoDrive = stopManualDrive;
function resetSignalHUD() {
  const leftEl = $("hud-signal-left");
  const rightEl = $("hud-signal-right");
  if (leftEl) {
    leftEl.classList.remove("signal-active-left");
    leftEl.textContent = "⬅ Signal";
  }
  if (rightEl) {
    rightEl.classList.remove("signal-active-right");
    rightEl.textContent = "Signal ➡";
  }
}

function updateSignalHUD() {
  const leftEl = $("hud-signal-left");
  const rightEl = $("hud-signal-right");
  if (leftEl) {
    leftEl.classList.toggle("signal-active-left", state.controllerSignals.left);
    leftEl.textContent = state.controllerSignals.left ? "⬅ Signal On" : "⬅ Signal";
  }
  if (rightEl) {
    rightEl.classList.toggle("signal-active-right", state.controllerSignals.right);
    rightEl.textContent = state.controllerSignals.right ? "Signal On ➡" : "Signal ➡";
  }
}

/* ═══════════════════ RECAP SCREEN ═══════════════════ */
function finishRehearsal() {
  stopAutoDrive();
  // narration.stop();
  distractions.stop();
  cesiumView.destroy();
  cesiumInitialized = false;

  const elapsed = Date.now() - (state.rehearsal.startTime || Date.now());
  const reviewed = state.rehearsal.hazardReviewed.filter(Boolean).length;
  const total = state.hazards.length;
  const missed = total - reviewed;
  const completion = state.rehearsal.routeCompletion || 0;

  // Confidence score: weighted combination
  const hazardScore = total > 0 ? (reviewed / total) * 60 : 60; // 60% weight
  const completionScore = (completion / 100) * 30; // 30% weight
  const timeBonus = elapsed > 30000 ? 10 : (elapsed / 30000) * 10; // 10% for spending enough time
  const confidence = Math.min(100, Math.round(hazardScore + completionScore + timeBonus));

  // Render
  showScreen("recap");
  $("recap-route").textContent = `${state.origin.label} → ${state.destination.label}`;
  $("recap-score").textContent = confidence;
  $("recap-reviewed").textContent = reviewed;
  $("recap-missed").textContent = missed;
  $("recap-completion").textContent = `${completion}%`;

  // Time
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);
  $("recap-time").textContent = `${mins}:${secs.toString().padStart(2, "0")}`;

  // Score circle color
  const circle = $("recap-score-circle");
  circle.className = "score-circle " + (confidence >= 70 ? "good" : confidence >= 40 ? "ok" : "low");

  // Hazard breakdown
  const list = $("recap-hazard-list");
  list.innerHTML = "";
  state.hazards.forEach((h, i) => {
    const wasReviewed = state.rehearsal.hazardReviewed[i];
    const item = document.createElement("div");
    item.className = "recap-hazard-item";
    item.innerHTML = `
      <span class="status">${wasReviewed ? "✅" : "❌"}</span>
      <span class="name">${h.label}</span>
      <span class="verdict ${wasReviewed ? "reviewed" : "missed"}">${wasReviewed ? "Reviewed" : "Missed"}</span>
    `;
    list.appendChild(item);
  });

  // Narrate recap
  // narration.playText(`Rehearsal complete. Your confidence score is ${confidence} percent. You reviewed ${reviewed} out of ${total} hazards.`);
}

function resetRehearsal() {
  state.rehearsal = {
    startTime: 0,
    hazardReviewed: [],
    hazardEntryTime: [],
    hazardPauseTime: [],
    routeCompletion: 0,
  };
}

function resetAppState() {
  resetRehearsal();
  state.origin = null;
  state.destination = null;
  state.routeCoords = [];
  state.routeSteps = [];
  state.routeDistance = 0;
  state.routeDuration = 0;
  state.hazards = [];
  state.hazardSummary = {};
  state.practiceIndex = 0;
  state.geminiInsights = null;
  state.excludedHazards = [];
  state.hotspotsOnly = false;
  state.controllerSignals.left = false;
  state.controllerSignals.right = false;
  if (state.reportMap) { state.reportMap.remove(); state.reportMap = null; }
  if (state.practiceMap) { state.practiceMap.remove(); state.practiceMap = null; }
  fallbackProgress = 0;
  fallbackVehicle = null;
  gasHeld = false;
  brakeHeld = false;
  manualDriveSpeed = 0;
  cesiumView.destroy();
  cesiumInitialized = false;
  $("input-origin").value = "";
  $("input-dest").value = "";
  // narration.destroy();
  distractions.destroy();
  resetSignalHUD();
}

/* ═══════════════════ MUTE TOGGLE ═══════════════════ */
function toggleMute() {
  const muted = !narration.isMuted();
  // narration.setMuted(muted);
  const btnMute = $("btn-mute");
  if (btnMute) {
    btnMute.textContent = muted ? "🔇" : "🔊";
    btnMute.classList.toggle("muted", muted);
  }
  const btnInputMute = $("btn-input-mute");
  if (btnInputMute) {
    btnInputMute.textContent = muted ? "🔇 Sound Off" : "🔊 Sound On";
    btnInputMute.classList.toggle("muted", muted);
  }
}

/* ═══════════════════ DIFFICULTY ═══════════════════ */
const DIFFICULTY_CYCLE = ["calm", "moderate", "intense"];
const DIFFICULTY_LABELS = {
  calm: "🟢 Calm",
  moderate: "🟡 Moderate",
  intense: "🔴 Intense",
};

function cycleDifficulty() {
  const current = distractions.getDifficulty();
  const idx = DIFFICULTY_CYCLE.indexOf(current);
  const next = DIFFICULTY_CYCLE[(idx + 1) % DIFFICULTY_CYCLE.length];
  distractions.setDifficulty(next);
  
  const btnDiff = $("btn-difficulty");
  if (btnDiff) btnDiff.textContent = DIFFICULTY_LABELS[next];
  const btnInputDiff = $("btn-input-difficulty");
  if (btnInputDiff) btnInputDiff.textContent = DIFFICULTY_LABELS[next];
  
  showToast(`Difficulty: ${DIFFICULTY_LABELS[next]}`);
}

/* ═══════════════════ SETTINGS OVERLAY ═══════════════════ */
function showSettingsOverlay() {
  try {
    const overlay = $("settings-overlay");
    if (!overlay) return;
    // Sync buttons with current difficulty
    const current = distractions.getDifficulty();
    document.querySelectorAll(".settings-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.difficulty === current);
    });
    // Update button text to reflect the next pass
    const continueBtn = $("btn-settings-continue");
    if (continueBtn) {
      const nextPass = currentPracticePass + 1;
      continueBtn.textContent = `Continue to Pass ${nextPass} →`;
    }
    overlay.classList.remove("hidden");
  } catch (e) {
    console.error("Error showing settings overlay:", e);
    showToast("Error showing settings");
  }
}

function hideSettingsOverlay() {
  const overlay = $("settings-overlay");
  if (overlay) overlay.classList.add("hidden");
}

function selectSettingsDifficulty(difficulty) {
  if (!difficulty) return;
  distractions.setDifficulty(difficulty);
  document.querySelectorAll(".settings-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.difficulty === difficulty);
  });
  const btnDiff = $("btn-difficulty");
  if (btnDiff) btnDiff.textContent = DIFFICULTY_LABELS[difficulty];
  const btnInputDiff = $("btn-input-difficulty");
  if (btnInputDiff) btnInputDiff.textContent = DIFFICULTY_LABELS[difficulty];
}

function continueFromSettings() {
  console.log("[continueFromSettings] Called, current pass:", currentPracticePass);
  // Guard against double-clicks
  if (isNavigating) {
    console.log("[continueFromSettings] Blocked — navigation already in progress");
    return;
  }
  isNavigating = true;
  try {
    hideSettingsOverlay();
    // Reset to first hazard for the new pass
    state.practiceIndex = 0;
    // Advance from Phase 1 to Phase 2
    if (currentPracticePass === 1) {
      console.log("[continueFromSettings] Switching to pass 2");
      switchPass(2);
    } else if (currentPracticePass === 2) {
      console.log("[continueFromSettings] Switching to pass 3");
      switchPass(3);
    }
    // Update info panel and button state after switching pass
    renderPracticeInfo();
  } catch (e) {
    console.error("Error continuing from settings:", e);
    showToast("Error advancing to next phase");
  } finally {
    // Release guard after a short delay to let rendering settle
    setTimeout(() => { isNavigating = false; }, 300);
  }
}

/* ═══════════════════ EXAMPLE ROUTES ═══════════════════ */
const EXAMPLES = [];

function renderExamples() {
  // No live examples - user will type their own routes
}

/* ═══════════════════ DEMO ROUTES (offline, no API) ═══════════════════ */
const DEMO_ROUTES = [];

function renderDemoRoutes() {
  // Demo routes removed
}

async function loadDemoRoute(file, dataOverride = null) {
  try {
    const data = dataOverride || await (await fetch(file)).json();

    if (data.isCachedState) {
      state.origin = data.origin;
      state.destination = data.destination;
      state.routeCoords = data.routeCoords;
      state.routeSteps = data.routeSteps;
      state.routeDistance = data.routeDistance;
      state.routeDuration = data.routeDuration;
      state.hazards = data.hazards;
      state.hazardSummary = data.hazardSummary;
      state.geminiInsights = data.geminiInsights;
      state.excludedHazards = [];

      // narration.init(CONFIG.ELEVENLABS_API_KEY);
      distractions.init(CONFIG.ELEVENLABS_API_KEY);

      showReport();
      showToast(`Loaded demo route: ${data.title}`);
      return;
    }

    // Build continuous routeCoords from segment geometry
    const coords = [];
    data.segments.forEach((seg) => {
      const s = seg.geometry.start;
      const e = seg.geometry.end;
      // Add start if not duplicate of previous end
      if (coords.length === 0 ||
          coords[coords.length - 1][0] !== s.lng ||
          coords[coords.length - 1][1] !== s.lat) {
        coords.push([s.lng, s.lat]);
      }
      coords.push([e.lng, e.lat]);
    });

    // Build routeSteps from segments (OSRM-like format for downstream compat)
    const steps = data.segments.map((seg) => ({
      maneuver: {
        instruction: seg.instruction,
        type: seg.kind,
        location: [seg.geometry.start.lng, seg.geometry.start.lat],
      },
      name: seg.roadContext?.roadName || "",
      distance: seg.distanceM,
      duration: seg.durationSec,
    }));

    // Build hazards from painPoints (use segment end as location)
    const hazards = (data.painPoints || []).map((pp) => {
      const seg = data.segments.find((s) => s.id === pp.segmentId) || data.segments[0];
      const loc = seg ? seg.geometry.end : data.segments[0]?.geometry.end;
      return {
        lat: loc?.lat ?? 0,
        lng: loc?.lng ?? 0,
        label: pp.title,
        description: pp.description,
        tip: pp.rehearsalFocus || "Watch this area carefully.",
        severity: pp.severity,
        type: pp.type,
        source: "demo",
        tags: pp.tags || [],
      };
    });

    // Populate state
    state.origin = { lat: data.origin.lat, lng: data.origin.lng, label: data.origin.label };
    state.destination = { lat: data.destination.lat, lng: data.destination.lng, label: data.destination.label };
    state.routeCoords = coords;
    state.routeSteps = steps;
    state.routeDistance = data.estimatedDistanceM;
    state.routeDuration = data.estimatedDurationSec;
    state.hazards = hazards;
    state.hazardSummary = {
      total: hazards.length,
      high: hazards.filter((h) => h.severity === "high").length,
      medium: hazards.filter((h) => h.severity === "medium").length,
      low: hazards.filter((h) => h.severity === "low").length,
    };
    state.geminiInsights = null;
    state.excludedHazards = [];

    showReport();
    showToast(`Loaded demo route: ${data.title}`);
  } catch (err) {
    console.error("Demo load failed:", err);
    showToast("Failed to load demo route.");
  }
}

/* ═══════════════════ PHONE CONTROLLER ═══════════════════ */
function getControllerUrl() {
  // Try to get LAN IP from server info, fallback to localhost
  const lanIp = window.SERVER_LAN_IP || window.location.hostname;
  const port = window.location.port || '8080';
  return `https://${lanIp}:${port}/controller.html`;
}

function initPhoneBridge() {
  phoneBridge.onStatus((status, data) => {
    console.log("[initPhoneBridge] status:", status, "data:", data);
    const badge = $("phone-status-badge");
    const codeEl = $("phone-room-code");
    if (!badge) return;
    switch (status) {
      case "room_created":
        badge.textContent = "Waiting for phone...";
        badge.className = "phone-badge waiting";
        if (codeEl) {
          codeEl.textContent = data;
          codeEl.title = `Open ${getControllerUrl()} and enter room code ${data}`;
        }
        // Update URL hint and QR code
        const hintEl = $("phone-url-hint");
        const qrEl = $("phone-qr-code");
        const controllerUrl = getControllerUrl();
        if (hintEl) hintEl.textContent = `Phone URL: ${controllerUrl}  Code: ${data}`;
        if (qrEl) {
          qrEl.innerHTML = "";
          // Generate QR code using qrcode.js library (inline)
          const canvas = document.createElement("canvas");
          canvas.width = 150;
          canvas.height = 150;
          canvas.style.cssText = "border: 4px solid #fff; border-radius: 8px; background: #fff;";
          qrEl.appendChild(canvas);
          
          // Simple QR code using Google Charts API as fallback
          const qrImg = document.createElement("img");
          qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(controllerUrl)}`;
          qrImg.alt = "Scan to open controller";
          qrImg.style.cssText = "border: 4px solid #fff; border-radius: 8px; background: #fff; display: inline-block;";
          qrImg.onerror = () => {
            qrEl.innerHTML = `<div style="font-size:11px;color:#94a3b8;padding:8px;">QR code unavailable. Use URL above.</div>`;
          };
          const spacer = document.createElement("div");
          spacer.style.cssText = "width: 120px; height: 1px; display: inline-block; visibility: hidden;";
          qrEl.innerHTML = "";
          qrEl.appendChild(qrImg);
          qrEl.appendChild(spacer);
        }
        break;
      case "controller_connected":
        badge.textContent = "Phone connected";
        badge.className = "phone-badge connected";
        showToast("Phone controller paired!");
        const hintEl2 = $("phone-url-hint");
        const qrEl2 = $("phone-qr-code");
        if (hintEl2) hintEl2.style.display = "none";
        if (qrEl2) qrEl2.style.display = "none";
        break;
      case "controller_disconnected":
        badge.textContent = "Phone disconnected";
        badge.className = "phone-badge disconnected";
        gasHeld = false;
        brakeHeld = false;
        state.controllerSignals.left = false;
        state.controllerSignals.right = false;
        const hintEl3 = $("phone-url-hint");
        const qrEl3 = $("phone-qr-code");
        if (hintEl3) hintEl3.style.display = "block";
        if (qrEl3) qrEl3.style.display = "block";
        updateSignalHUD();
        break;
      case "error":
        badge.textContent = data || "Pairing failed";
        badge.className = "phone-badge error";
        // Fallback: generate a local code even if WebSocket fails
        if (!phoneBridge.getRoomCode()) {
          const fallbackCode = Math.random().toString(36).substring(2, 6).toUpperCase();
          badge.textContent = `Retrying... (${fallbackCode})`;
          setTimeout(() => phoneBridge.startHostRoom(), 3000);
        }
        break;
      case "disconnected":
        badge.textContent = "Not paired";
        badge.className = "phone-badge";
        if (codeEl) codeEl.textContent = "----";
        gasHeld = false;
        brakeHeld = false;
        state.controllerSignals.left = false;
        state.controllerSignals.right = false;
        updateSignalHUD();
        break;
    }
  });

  // Auto-start a host room immediately so a code is ready
  console.log("[initPhoneBridge] Auto-starting host room...");
  phoneBridge.startHostRoom();

  phoneBridge.onInput((input) => {
    // Phone steering is handled via setSteering (smooth damping in cesium-view)
    // Don't directly set headingOffset to avoid snap turns
    brakeHeld = !!input.brake;
    gasHeld = !!input.gas;
    state.controllerSignals.left = !!input.signalLeft;
    state.controllerSignals.right = !!input.signalRight;
    updateSignalHUD();

    // Forward gas/brake directly to cesium-view key simulation for manual drive
    if (cesiumInitialized) {
      cesiumView.setGas(gasHeld);
      cesiumView.setBrake(brakeHeld);
      // Send steering input for smooth handling
      if (typeof input.steering === "number") {
        cesiumView.setSteering(input.steering);
      }
    }
  });
}

function togglePairPhone() {
  if (phoneBridge.getRoomCode()) {
    phoneBridge.closeRoom();
    $("phone-status-badge").textContent = "Not paired";
    $("phone-status-badge").className = "phone-badge";
    $("phone-room-code").textContent = "----";
    resetSignalHUD();
  } else {
    phoneBridge.startHostRoom();
    showToast(`Phone controller URL: ${getControllerUrl()}`);
  }
}

/* ═══════════════════ EVENT WIRING ═══════════════════ */
function wireEvents() {
  $("btn-scan").addEventListener("click", startScan);
  $("btn-back-input").addEventListener("click", () => showScreen("input"));
  $("btn-back-report").addEventListener("click", () => {
    cesiumView.destroy();
    cesiumInitialized = false;
    showScreen("report");
  });
  $("btn-start-practice").addEventListener("click", () => startPractice(0));

  // Hotspots-only toggle
  const hotspotsToggle = $("hotspots-only");
  if (hotspotsToggle) {
    hotspotsToggle.addEventListener("change", (e) => {
      state.hotspotsOnly = e.target.checked;
      // Also update nudge link if clicked
      const nudgeLink = $("nudge-hotspots");
      if (nudgeLink && state.hotspotsOnly) {
        hotspotsToggle.checked = true;
      }
    });
  }

  // Route nudge click handlers (event delegation)
  document.addEventListener("click", (e) => {
    if (e.target.id === "nudge-hotspots") {
      e.preventDefault();
      state.hotspotsOnly = true;
      if (hotspotsToggle) hotspotsToggle.checked = true;
      startPractice(0);
    }
    if (e.target.id === "nudge-add-breaks") {
      e.preventDefault();
      alert("Break planning coming soon — for now, plan your stops manually!");
    }
  });
  $("btn-prev-hazard").addEventListener("click", prevHazard);
  $("btn-next-hazard").addEventListener("click", nextHazard);
  $("btn-new-route").addEventListener("click", () => {
    resetAppState();
    showScreen("input");
  });
  /* Save/Load feature commented out
  $("btn-save-route").addEventListener("click", saveRoute);
  $("btn-load-route").addEventListener("click", loadRouteFromFile);
  
  // Handle file input for loading routes
  $("file-load-route").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await loadDemoRoute(null, data);
      e.target.value = ''; // Reset input
    } catch (err) {
      showToast('Failed to load route: ' + err.message);
    }
  });
  */

  // Mode toggle buttons
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (state.screen === "practice") {
        switchPass(parseInt(btn.dataset.pass));
      }
    });
  });

  // Enter key on inputs
  $("input-origin").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("input-dest").focus();
  });
  $("input-dest").addEventListener("keydown", (e) => {
    if (e.key === "Enter") startScan();
  });

  // Auto-drive controls (legacy HUD buttons — may not exist if removed)
  const btnMute = $("btn-mute");
  if (btnMute) btnMute.addEventListener("click", toggleMute);
  const btnDifficulty = $("btn-difficulty");
  if (btnDifficulty) btnDifficulty.addEventListener("click", cycleDifficulty);

  // Input-screen settings
  const btnInputMute = $("btn-input-mute");
  if (btnInputMute) btnInputMute.addEventListener("click", toggleMute);
  const btnInputDifficulty = $("btn-input-difficulty");
  if (btnInputDifficulty) btnInputDifficulty.addEventListener("click", cycleDifficulty);

  // Phone controller
  const btnPair = $("btn-pair-phone");
  if (btnPair) btnPair.addEventListener("click", togglePairPhone);

  // Distraction failure tracking
  distractions.onUserSpoke((transcript) => {
    if (manualDriving && currentPracticePass === 3) {
      console.log("[Distractions] User spoke:", transcript);
      showToast("❌ Speech detected! Keep your eyes on the road!");
      const alertEl = $("hud-alert");
      alertEl.textContent = `❌ DISTRACTION DETECTED: You spoke!`;
      alertEl.classList.add("visible");
      setTimeout(() => alertEl.classList.remove("visible"), 4000);
    }
  });

  // Settings overlay
  const btnSettingsContinue = $("btn-settings-continue");
  if (btnSettingsContinue) btnSettingsContinue.addEventListener("click", continueFromSettings);
  document.querySelectorAll(".settings-btn").forEach(btn => {
    btn.addEventListener("click", () => selectSettingsDifficulty(btn.dataset.difficulty));
  });

  // Recap buttons
  $("btn-retry").addEventListener("click", () => {
    resetRehearsal();
    startPractice(0);
  });
  $("btn-recap-new").addEventListener("click", () => {
    resetAppState();
    showScreen("input");
  });


  // Escape to go back
  document.addEventListener("keydown", (e) => {
    if (state.screen === "practice" && e.key === "Escape") {
      stopManualDrive();
      // narration.stop();
      if (cesiumInitialized && currentPracticePass === 3) {
        // Keep it loaded, just pause
      }
      showScreen("report");
    }
    // Brake key stops manual drive
    if (state.screen === "practice" && (e.key === "b" || e.key === "B") && manualDriving) {
      stopManualDrive();
    }
  });
}

/* ═══════════════════ INIT ═══════════════════ */
function init() {
  showScreen("input");
  renderExamples();
  renderDemoRoutes();
  wireEvents();
  initPhoneBridge();
  if (!CONFIG.GEMINI_API_KEY || !CONFIG.ELEVENLABS_API_KEY || !CONFIG.GOOGLE_MAPS_KEY) {
    console.warn("One or more API keys are missing. Set environment variables before starting the server.");
  }
  resetSignalHUD();
  initNgrokModal();
  $("input-origin").focus();
}

init();
