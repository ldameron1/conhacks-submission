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

/* ═══════════════════ GEMINI AI ═══════════════════ */
async function analyzeWithGemini(steps, geometryHazards) {
  if (!CONFIG.GEMINI_API_KEY) return null;
  const stepsText = steps
    .slice(0, 30)
    .map((s, i) => `${i + 1}. ${s.maneuver?.instruction || s.name || "continue"} (${s.maneuver?.type || ""} ${s.maneuver?.modifier || ""})`)
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
    const color = h.severity === "high" ? "#ff4466" : h.severity === "medium" ? "#ffaa00" : "#66bbff";
    L.circleMarker([h.lat, h.lng], {
      radius: 10, fillColor: color, fillOpacity: 0.9, color: "#fff", weight: 2,
    }).addTo(state.reportMap)
      .bindPopup(`<b>${h.label}</b><br>${h.description}`)
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
      const marker = L.circleMarker([hz.lat, hz.lng], {
        radius: isActive ? 12 : 6,
        fillColor: isActive ? "#ff4466" : "#ffaa00",
        fillOpacity: 0.9,
        color: "#fff",
        weight: 2
      }).addTo(state.practiceMap).bindPopup(`<b>${hz.label}</b>`);
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

    const marker = L.circleMarker([h.lat, h.lng], {
      radius: 12, fillColor: "#ff4466", fillOpacity: 0.9, color: "#fff", weight: 2
    }).addTo(state.splitMap);
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
  // Speed is set by auto-drive; update completion tracking
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

  // Play narration
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
    L.circleMarker([hz.lat, hz.lng], {
      radius: isActive ? 12 : 6,
      fillColor: isActive ? "#ff4466" : "#ffaa00",
      fillOpacity: 0.9,
      color: "#fff",
      weight: 2
    }).addTo(state.practiceMap).bindPopup(`<b>${hz.label}</b>`);
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
        });
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
          L.circleMarker([h.lat, h.lng], { radius: 12, fillColor: "#ff4466", fillOpacity: 0.9, color: "#fff", weight: 2 }).addTo(map);
        }
      }
    }

    if (cesiumInitialized) {
      cesiumView.setMode("drive");
      cesiumView.jumpToHazard(state.practiceIndex);
    }

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

function updateTriPaneStreetViewFromProgress(progress) {
  const now = Date.now();
  if (now - lastStreetViewUpdate < 1200) return; // throttle to ~0.8 Hz to avoid iframe flicker
  lastStreetViewUpdate = now;

  const maxProgress = state.routeCoords.length - 1;
  const idx = Math.floor(Math.max(0, Math.min(progress, maxProgress)));
  const frac = Math.max(0, Math.min(progress, maxProgress)) - idx;
  const c1 = state.routeCoords[idx] || state.routeCoords[maxProgress];
  const c2 = state.routeCoords[idx + 1] || c1;
  const lat = c1[1] + (c2[1] - c1[1]) * frac;
  const lng = c1[0] + (c2[0] - c1[0]) * frac;

  const content = $("tri-streetview-content");
  if (!content) return;

  const dLng = c2[0] - c1[0];
  const dLat = c2[1] - c1[1];
  const heading = (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;

  const iframe = content.querySelector("iframe");
  const src = `https://www.google.com/maps?layer=c&cbll=${lat},${lng}&cbp=0,${Math.round(heading)},0,0,0&output=svembed`;
  if (iframe) {
    iframe.src = src;
  } else {
    content.innerHTML = `<iframe class="streetview-frame" allowfullscreen loading="lazy" src="${src}" style="border:0; width:100%; height:100%;"></iframe>`;
  }
}

function updateTriPaneMap() {
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
    } else {
      state.triMap.invalidateSize();
      // Use setTimeout to defer flyTo and prevent blocking
      setTimeout(() => {
        try {
          if (state.triMap) {
            state.triMap.flyTo([h.lat, h.lng], 18);
          }
        } catch (e) {
          console.warn("flyTo failed:", e);
        }
      }, 0);
    }

    if (state.triMapMarkers) state.triMapMarkers.forEach(m => m.remove());
    state.triMapMarkers = [];

    const marker = L.circleMarker([h.lat, h.lng], {
      radius: 12, fillColor: "#ff4466", fillOpacity: 0.9, color: "#fff", weight: 2
    }).addTo(state.triMap);
    state.triMapMarkers.push(marker);
  } catch (e) {
    console.warn("Map render failed in Tri-pane:", e);
  }
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

/* ═══════════════════ AUTO-DRIVE ═══════════════════ */
let autoDriving = false;
let autoDriveInterval = null;
const AUTO_DRIVE_SPEED_MIN = 0.03;
const AUTO_DRIVE_SPEED_MAX = 0.16;
const AUTO_DRIVE_ACCEL = 0.003;
const AUTO_DRIVE_BRAKE_DECAY = 0.005;
let autoDriveSpeed = AUTO_DRIVE_SPEED_MIN;
let gasHeld = false;
let brakeHeld = false;

function startAutoDrive() {
  autoDriving = true;
  state.rehearsal.startTime = state.rehearsal.startTime || Date.now();

  // Start distraction audio
  distractions.start();

  // Auto-advance is handled by cesium-view's animation loop via keyboard simulation
  // We'll use setInterval to feed progress updates
  autoDriveInterval = setInterval(() => {
    if (gasHeld) {
      autoDriveSpeed = Math.min(AUTO_DRIVE_SPEED_MAX, autoDriveSpeed + AUTO_DRIVE_ACCEL);
    } else {
      autoDriveSpeed = Math.max(AUTO_DRIVE_SPEED_MIN, autoDriveSpeed - AUTO_DRIVE_ACCEL * 0.5);
    }
    if (brakeHeld) {
      autoDriveSpeed = Math.max(0, autoDriveSpeed - AUTO_DRIVE_BRAKE_DECAY);
    }

    const maxProgress = state.routeCoords.length - 1;

    if (cesiumInitialized) {
      const progress = cesiumView.getProgress();

      if (progress >= maxProgress - 1) {
        stopAutoDrive();
        finishRehearsal();
        return;
      }

      cesiumView.setProgress(progress + autoDriveSpeed);
      state.rehearsal.routeCompletion = Math.round((progress / maxProgress) * 100);
      updateTriPaneStreetViewFromProgress(progress);
    } else if (state.practiceMap && fallbackVehicle) {
      // 2D fallback: interpolate along routeCoords
      if (fallbackProgress >= maxProgress - 1) {
        stopAutoDrive();
        finishRehearsal();
        return;
      }

      fallbackProgress += autoDriveSpeed;
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
    }

    // Update speed display
    const speedKmh = Math.round(autoDriveSpeed * 400); // approximate
    const speedEl = $("hud-speed");
    if (speedEl) speedEl.textContent = speedKmh;
  }, 1000 / 30); // 30 fps
}
function stopAutoDrive() {
  autoDriving = false;
  clearInterval(autoDriveInterval);
  autoDriveInterval = null;
  lastStreetViewUpdate = 0;

  // Pause distractions too
  distractions.stop();
}
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
  autoDriveSpeed = AUTO_DRIVE_SPEED_MIN;
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

    if (input.brake) {
      if (autoDriving) stopAutoDrive();
      cesiumView.setBrake(true);
    } else {
      cesiumView.setBrake(false);
    }
    if (input.gas && !autoDriving) {
      autoDriveSpeed = Math.max(autoDriveSpeed, AUTO_DRIVE_SPEED_MIN);
      startAutoDrive();
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
      stopAutoDrive();
      narration.stop();
      if (cesiumInitialized && currentPracticePass === 3) {
        // Keep it loaded, just pause
      }
      showScreen("report");
    }
    // Brake key
    if (state.screen === "practice" && (e.key === "b" || e.key === "B") && autoDriving) {
      stopAutoDrive();
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
