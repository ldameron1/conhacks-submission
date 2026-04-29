import { scanRoute } from "./hazard-scanner.js";
import * as cesiumView from "./cesium-view.js";

/* ═══════════════════ CONFIG ═══════════════════ */
const CONFIG = {
  GEMINI_API_KEY: "AIzaSyCAk3KfuN_i_GIWwGEez4Q8Lg-pnrE1sQ8",
  GOOGLE_MAPS_KEY: "",
  CESIUM_ION_TOKEN: "", // Free: sign up at cesium.com/ion/signup — enables 3D buildings
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
};

/* ═══════════════════ HELPERS ═══════════════════ */
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  return {
    coords: route.geometry.coordinates, // [[lng,lat],...]
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
    updateScanStep(statusEl, progressEl, "Scanning for sharp turns and hazards...", 60);
    const result = scanRoute(state.routeCoords, state.routeSteps);
    state.hazards = result.hazards;
    state.hazardSummary = result.summary;
    await sleep(400);

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
        ${h.source === "gemini" ? '<span class="ai-badge">AI</span>' : ""}
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
let currentPracticeMode = "overview";
let alertTimeout = null;

async function startPractice(index = 0) {
  state.practiceIndex = index;
  showScreen("practice");
  renderPracticeInfo();

  if (!cesiumInitialized) {
    try {
      await cesiumView.initView("cesium-container", state.routeCoords, state.hazards, {
        onProgress: updateHUD,
        onHazardApproach: onHazardApproach,
      });
      cesiumInitialized = true;
    } catch (e) {
      console.error("CesiumJS init failed:", e);
      showToast("3D view failed to load. Check your connection.");
      return;
    }
  }

  // Jump to the hazard in the 3D view
  cesiumView.jumpToHazard(index);
  switchMode("overview");
}

function renderPracticeInfo() {
  const h = state.hazards[state.practiceIndex];
  if (!h) return;

  // Counter
  $("practice-counter").textContent = `Hazard ${state.practiceIndex + 1} of ${state.hazards.length}`;
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
  $("btn-next-hazard").disabled = state.practiceIndex >= state.hazards.length - 1;
}

function switchMode(mode) {
  currentPracticeMode = mode;
  cesiumView.setMode(mode);

  // Update toggle buttons
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  // Show/hide HUD
  const hud = $("drive-hud");
  if (mode === "drive" || mode === "pip") {
    hud.classList.remove("hidden");
  } else {
    hud.classList.add("hidden");
  }
}

function updateHUD(data) {
  $("hud-progress").textContent = Math.round(data.progress);
  $("hud-dist").textContent = data.nextHazardDist < 9999 ? data.nextHazardDist : "--";
}

function onHazardApproach(hazard, index, dist) {
  // Show alert banner
  const alert = $("hud-alert");
  alert.textContent = `⚠ ${hazard.label} — ${hazard.tip}`;
  alert.classList.add("visible");
  clearTimeout(alertTimeout);
  alertTimeout = setTimeout(() => alert.classList.remove("visible"), 4000);

  // Update info panel to show this hazard
  state.practiceIndex = index;
  renderPracticeInfo();
}

function nextHazard() {
  if (state.practiceIndex < state.hazards.length - 1) {
    state.practiceIndex++;
    renderPracticeInfo();
    cesiumView.jumpToHazard(state.practiceIndex);
  }
}

function prevHazard() {
  if (state.practiceIndex > 0) {
    state.practiceIndex--;
    renderPracticeInfo();
    cesiumView.jumpToHazard(state.practiceIndex);
  }
}

/* ═══════════════════ TOAST ═══════════════════ */
function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 3000);
}

/* ═══════════════════ EXAMPLE ROUTES ═══════════════════ */
const EXAMPLES = [
  { origin: "CN Tower, Toronto", dest: "Union Station, Toronto" },
  { origin: "Times Square, New York", dest: "Brooklyn Bridge, New York" },
  { origin: "Golden Gate Bridge, San Francisco", dest: "Fisherman's Wharf, San Francisco" },
];

function renderExamples() {
  const container = $("example-routes");
  EXAMPLES.forEach((ex) => {
    const chip = document.createElement("button");
    chip.className = "example-chip";
    chip.textContent = `${ex.origin.split(",")[0]} → ${ex.dest.split(",")[0]}`;
    chip.addEventListener("click", () => {
      $("input-origin").value = ex.origin;
      $("input-dest").value = ex.dest;
    });
    container.appendChild(chip);
  });
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
  $("btn-prev-hazard").addEventListener("click", prevHazard);
  $("btn-next-hazard").addEventListener("click", nextHazard);
  $("btn-new-route").addEventListener("click", () => {
    cesiumView.destroy();
    cesiumInitialized = false;
    showScreen("input");
  });

  // Mode toggle buttons
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (state.screen === "practice" && cesiumInitialized) {
        switchMode(btn.dataset.mode);
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

  // Escape to go back
  document.addEventListener("keydown", (e) => {
    if (state.screen === "practice" && e.key === "Escape") {
      cesiumView.destroy();
      cesiumInitialized = false;
      showScreen("report");
    }
  });
}

/* ═══════════════════ INIT ═══════════════════ */
function init() {
  showScreen("input");
  renderExamples();
  wireEvents();
  $("input-origin").focus();
}

init();
