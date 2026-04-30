import { scanRoute } from "./hazard-scanner.js";
import * as cesiumView from "./cesium-view.js";
import * as narration from "./narration.js";
import * as distractions from "./distractions.js";
import * as accidentScanner from "./accident-scanner.js";
import * as phoneBridge from "./phone-bridge.js";

/* ═══════════════════ CONFIG ═══════════════════ */
const RUNTIME_CONFIG = window.__ROUTE_REHEARSAL_CONFIG__ || {};
const CONFIG = {
  GEMINI_API_KEY: RUNTIME_CONFIG.GEMINI_API_KEY || "",
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

    for (let i = 0; i < routeCoords.length - 1; i++) {
      const [lng1, lat1] = routeCoords[i];
      const [lng2, lat2] = routeCoords[i + 1];
      const segLen = haversineDistance(lat1, lng1, lat2, lng2);
      if (segLen === 0) continue;

      // Project h onto segment i→i+1 (treat as 2D, good enough for <1km segments)
      const t = ((h.lng - lng1) * (lng2 - lng1) + (h.lat - lat1) * (lat2 - lat1)) /
                ((lng2 - lng1) ** 2 + (lat2 - lat1) ** 2);
      const clampedT = Math.max(0, Math.min(1, t));
      const projLng = lng1 + clampedT * (lng2 - lng1);
      const projLat = lat1 + clampedT * (lat2 - lat1);
      const offRoute = haversineDistance(h.lat, h.lng, projLat, projLng);
      const progress = cumDist[i] + clampedT * segLen;

      if (offRoute < bestOffRoute) {
        bestOffRoute = offRoute;
        bestProgress = progress;
      }
    }

    return { h, progress: bestProgress, offRoute: bestOffRoute };
  });

  // Filter and sort A→B
  const filtered = projected
    .filter((p) => p.offRoute <= maxOffRouteM && p.progress >= 0 && p.progress <= totalDist + 50)
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
    if ((name === "report" || name === "practice") && !phoneBridge.isControllerConnected()) {
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
    case "lane_positioning": return "🛣️";
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
  const emoji = getHazardEmoji(h);
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
  const stepsText = steps
    .slice(0, 30)
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

For each issue you find (max 6), respond as a JSON array. Be specific and practical — give advice a driving instructor would give:
[{"title":"Short specific title","reason":"Why this confuses drivers (1-2 sentences)","tip":"Exactly what to do — which lane, when to move, what to look for","severity":"low|medium|high","stepIndex":N}]

If the route is straightforward with no issues, respond []. Only output valid JSON.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    // Extract JSON from response (may be wrapped in markdown code block)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn("Gemini analysis failed:", e);
  }
  return null;
}

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
    state.hazards = sortHazardsByRouteProgress(state.routeCoords, state.hazards, 60);
    state.hazardSummary.total = state.hazards.length;
    await sleep(200);

    // Done
    updateScanStep(statusEl, progressEl, `Found ${state.hazards.length} hazard${state.hazards.length !== 1 ? "s" : ""}. Loading report...`, 100);

    // Initialize narration and pre-generate audio in background
    narration.init(CONFIG.ELEVENLABS_API_KEY);
    narration.pregenerate(state.hazards);

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
        ${h.source === "gemini" ? '<span class="ai-badge">AI</span>' : h.source === "overpass" ? '<span class="osm-badge">OSM</span>' : h.source === "geometry" ? '<span class="geo-badge">GEO</span>' : ""}
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
  } else {
    $("btn-next-hazard").disabled = isLastHazard;
    $("btn-next-hazard").textContent = "Next →";
    $("btn-next-hazard").classList.remove("next-phase");
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
    const heading = h.heading || 0;
    const src = `https://www.google.com/maps?layer=c&cbll=${lat},${lng}&cbp=0,${heading},0,0,0&output=svembed`;
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
  }
  // Update completion tracking
  if (data.progress > 0) {
    state.rehearsal.routeCompletion = Math.round(data.progress);
  }
}

function onHazardApproach(hazard, index, dist) {
  // Show alert banner
  const alert = $("hud-alert");
  alert.textContent = `⚠ ${hazard.label} — ${hazard.tip}`;
  alert.classList.add("visible");
  clearTimeout(alertTimeout);
  alertTimeout = setTimeout(() => alert.classList.remove("visible"), 4000);

  // Stop any stale narrations so we don't lag behind the car position, then play
  narration.stop();
  narration.playHazard(hazard, index, state.hazards.length);

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

function nextHazard() {
  console.log("[nextHazard] Called, practiceIndex:", state.practiceIndex, "hazards:", state.hazards.length, "pass:", currentPracticePass);
  // Guard against re-entrancy during navigation transitions
  if (isNavigating) {
    console.log("[nextHazard] Blocked — navigation already in progress");
    return;
  }
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
      console.log("[nextHazard] At end of hazards, no next action");
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

function updateTriPaneStreetViewFromProgress(progress) {
  const now = Date.now();
  const maxProgress = state.routeCoords.length - 1;
  const idx = Math.floor(Math.max(0, Math.min(progress, maxProgress)));
  const frac = Math.max(0, Math.min(progress, maxProgress)) - idx;
  const c1 = state.routeCoords[idx] || state.routeCoords[maxProgress];
  const c2 = state.routeCoords[idx + 1] || c1;
  const lat = c1[1] + (c2[1] - c1[1]) * frac;
  const lng = c1[0] + (c2[0] - c1[0]) * frac;

  const { nearAny, nearSlow } = isNearHazard(lat, lng, progress);

  // Smart refresh: 5s normally, 10s near ramps/roundabouts (same view persists longer),
  // immediate when first entering a hazard zone
  const baseThrottle = nearSlow ? 10000 : 5000;
  const sinceLast = now - lastStreetViewUpdate;

  // If we just entered a hazard zone and haven't refreshed recently, force immediate refresh
  const shouldForce = nearAny && sinceLast > 3000;
  if (!shouldForce && sinceLast < baseThrottle) return;

  lastStreetViewUpdate = now;

  const content = $("tri-streetview-content");
  if (!content) return;

  const dLng = c2[0] - c1[0];
  const dLat = c2[1] - c1[1];
  const heading = (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;

  const src = `https://www.google.com/maps?layer=c&cbll=${lat},${lng}&cbp=0,${Math.round(heading)},0,0,0&output=svembed`;

  // Add blur overlay to prevent epileptic flash during iframe swap
  const blurOverlay = document.createElement("div");
  blurOverlay.style.cssText = "position:absolute;inset:0;backdrop-filter:blur(8px);background:rgba(0,0,0,0.35);z-index:10;transition:opacity 0.3s;pointer-events:none;";
  content.appendChild(blurOverlay);

  const iframe = content.querySelector("iframe");
  const onLoad = () => {
    blurOverlay.style.opacity = "0";
    setTimeout(() => blurOverlay.remove(), 350);
  };

  if (iframe) {
    iframe.onload = onLoad;
    iframe.src = src;
  } else {
    content.innerHTML = `<iframe class="streetview-frame" allowfullscreen loading="lazy" src="${src}" style="border:0; width:100%; height:100%;"></iframe>`;
    content.querySelector("iframe").onload = onLoad;
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
  const host = window.location.hostname || "";
  return host.includes("ngrok");
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
      updateTriPaneStreetViewFromProgress(progress);
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
      updateTriPaneStreetViewFromProgress(fallbackProgress);
      updateTriPaneMapFromProgress(fallbackProgress);
    }

    // Update speed display (approx km/h)
    const speedKmh = Math.round(manualDriveSpeed * 400 * 60);
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
  narration.stop();
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
  narration.playText(`Rehearsal complete. Your confidence score is ${confidence} percent. You reviewed ${reviewed} out of ${total} hazards.`);
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
  narration.destroy();
  distractions.destroy();
  resetSignalHUD();
}

/* ═══════════════════ MUTE TOGGLE ═══════════════════ */
function toggleMute() {
  const muted = !narration.isMuted();
  narration.setMuted(muted);
  const btn = $("btn-mute");
  btn.textContent = muted ? "🔇" : "🔊";
  btn.classList.toggle("muted", muted);
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
  
  const btn = $("btn-difficulty");
  btn.textContent = DIFFICULTY_LABELS[next];
  
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
  const btn = $("btn-difficulty");
  if (btn) btn.textContent = DIFFICULTY_LABELS[difficulty];
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
const EXAMPLES = [
  { origin: "CN Tower, Toronto", dest: "Union Station, Toronto" },
  { origin: "Times Square, New York", dest: "Brooklyn Bridge, New York" },
  { origin: "Golden Gate Bridge, San Francisco", dest: "Fisherman's Wharf, San Francisco" },
];

function renderExamples() {
  const container = $("example-routes");
  EXAMPLES.forEach((ex, idx) => {
    const chip = document.createElement("button");
    chip.className = "example-chip";
    chip.textContent = `${ex.origin.split(",")[0]} → ${ex.dest.split(",")[0]}`;
    chip.addEventListener("click", () => {
      loadDemoRoute(`data/demo-routes/cached-example-${idx}.json`);
    });
    container.appendChild(chip);
  });
}

/* ═══════════════════ DEMO ROUTES (offline, no API) ═══════════════════ */
const DEMO_ROUTES = [
  { file: "data/demo-routes/downtown-garage.json", label: "Downtown Garage" },
  { file: "data/demo-routes/airport-merge.json", label: "Airport Merge" },
];

function renderDemoRoutes() {
  const container = $("demo-routes");
  DEMO_ROUTES.forEach((demo) => {
    const chip = document.createElement("button");
    chip.className = "example-chip";
    chip.textContent = demo.label;
    chip.addEventListener("click", () => loadDemoRoute(demo.file));
    container.appendChild(chip);
  });
}

async function loadDemoRoute(file) {
  try {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

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

      narration.init(CONFIG.ELEVENLABS_API_KEY);
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
  return `${window.location.origin}/controller.html`;
}

function initPhoneBridge() {
  phoneBridge.onStatus((status, data) => {
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
        break;
      case "controller_connected":
        badge.textContent = "Phone connected";
        badge.className = "phone-badge connected";
        showToast("Phone controller paired!");
        break;
      case "controller_disconnected":
        badge.textContent = "Phone disconnected";
        badge.className = "phone-badge disconnected";
        gasHeld = false;
        brakeHeld = false;
        state.controllerSignals.left = false;
        state.controllerSignals.right = false;
        updateSignalHUD();
        break;
      case "error":
        badge.textContent = data || "Pairing failed";
        badge.className = "phone-badge error";
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

  phoneBridge.onInput((input) => {
    // Map phone steering (-1..1) to heading offset degrees
    if (typeof input.steering === "number" && cesiumInitialized) {
      const maxSteer = 45; // degrees
      cesiumView.setHeadingOffset(input.steering * maxSteer);
    }
    brakeHeld = !!input.brake;
    gasHeld = !!input.gas;
    state.controllerSignals.left = !!input.signalLeft;
    state.controllerSignals.right = !!input.signalRight;
    updateSignalHUD();

    // Forward gas/brake directly to cesium-view key simulation for manual drive
    if (cesiumInitialized) {
      cesiumView.setGas(gasHeld);
      cesiumView.setBrake(brakeHeld);
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

  // Auto-drive controls
  $("btn-mute").addEventListener("click", toggleMute);
  $("btn-difficulty").addEventListener("click", cycleDifficulty);

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
      narration.stop();
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
