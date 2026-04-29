/**
 * CesiumJS 3D View Module — Photorealistic 3D Tiles Edition
 * 
 * Uses Google Photorealistic 3D Tiles via Cesium ion (free community account)
 * for an immersive Google-Earth-like driving rehearsal experience.
 * 
 * Fallback chain:
 *   1. Google Photorealistic 3D Tiles (needs Cesium ion token)
 *   2. OSM Buildings on satellite globe (needs Cesium ion token)
 *   3. Flat satellite globe (no token needed)
 */

/* ═══════════════ STATE ═══════════════ */
let viewer = null;
let miniViewer = null;
let routeCoords = [];      // [{lng, lat}, ...]
let routeEntity = null;
let hazardMarkers = [];
let hazardData = [];
let currentMode = "overview";
let routeProgress = 0;     // fractional index along routeCoords
let headingOffset = 0;     // degrees, for look left/right
let keysDown = new Set();
let loopId = null;
let callbacks = {};
let positionMarker = null;
let hasPhotorealistic = false; // true if Google 3D Tiles loaded
let leafletMap = null;
let leafletMarker = null;
let leafletRoute = null;

const MOVE_SPEED = 0.12;   // index units per frame
const LOOK_SPEED = 2.5;    // degrees per frame
const DRIVER_HEIGHT = 30;   // meters above ellipsoid (fixed, no terrain sampling)
const HAZARD_ALERT_DIST = 100; // meters
const DEG = Math.PI / 180;
let lastAlertedHazard = -1;

/* ═══════════════ MATH HELPERS ═══════════════ */

function headingBetween(a, b) {
  const dLng = (b.lng - a.lng) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

function haversine(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function interpolatePos(progress) {
  const idx = Math.floor(progress);
  const frac = progress - idx;
  if (idx >= routeCoords.length - 1) return routeCoords[routeCoords.length - 1];
  if (idx < 0) return routeCoords[0];
  const a = routeCoords[idx];
  const b = routeCoords[idx + 1];
  return {
    lng: a.lng + (b.lng - a.lng) * frac,
    lat: a.lat + (b.lat - a.lat) * frac,
  };
}

function getRouteHeading(progress) {
  const idx = Math.floor(progress);
  const a = routeCoords[Math.max(0, idx)];
  const b = routeCoords[Math.min(routeCoords.length - 1, idx + 1)];
  if (a.lat === b.lat && a.lng === b.lng) return 0;
  return headingBetween(a, b);
}

/* ═══════════════ INIT ═══════════════ */

export async function initView(containerId, coords, hazards, cbs) {
  callbacks = cbs || {};
  routeCoords = coords.map(([lng, lat]) => ({ lng, lat }));
  hazardData = hazards;
  routeProgress = 0;
  headingOffset = 0;
  lastAlertedHazard = -1;
  hasPhotorealistic = false;

  // Cleanup any previous viewer
  destroy();

  // Check for Cesium ion token (set from app.js before calling initView)
  const hasIonToken = Cesium.Ion.defaultAccessToken && Cesium.Ion.defaultAccessToken.length > 10;

  try {
    if (hasIonToken) {
      try {
        viewer = await createPhotorealisticViewer(containerId);
        hasPhotorealistic = true;
        console.log("[CesiumView] Loaded Google Photorealistic 3D Tiles");
      } catch (err) {
        console.warn("[CesiumView] Google 3D Tiles failed, falling back to satellite:", err.message);
        viewer = await createSatelliteViewer(containerId);
      }
    } else {
      console.log("[CesiumView] No Cesium ion token. Using satellite fallback.");
      viewer = await createSatelliteViewer(containerId);
    }
  } catch (e) {
    console.error("CesiumJS viewer creation failed:", e);
    throw new Error("WebGL not available — 3D view requires a GPU-enabled browser.");
  }

  // Dark sky background
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#0a0e1a");
  if (viewer.scene.globe) {
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#1a1e2e");
  }

  // Build route polyline with fixed height above ellipsoid
  const positions = routeCoords.map((c) => {
    return Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 20);
  });
  routeEntity = viewer.entities.add({
    polyline: {
      positions: positions,
      width: hasPhotorealistic ? 8 : 6,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.3,
        color: Cesium.Color.fromCssColorString("#00d4aa"),
      }),
      clampToGround: false,
    },
  });

  // Start / End markers
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(routeCoords[0].lng, routeCoords[0].lat, 25),
    point: { pixelSize: 14, color: Cesium.Color.fromCssColorString("#00d4aa"), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
    label: { text: "START", font: "bold 14px sans-serif", fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
             outlineWidth: 3, outlineColor: Cesium.Color.BLACK, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -18) },
  });

  const last = routeCoords[routeCoords.length - 1];
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(last.lng, last.lat, 25),
    point: { pixelSize: 14, color: Cesium.Color.fromCssColorString("#0088ff"), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
    label: { text: "END", font: "bold 14px sans-serif", fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
             outlineWidth: 3, outlineColor: Cesium.Color.BLACK, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -18) },
  });

  // Hazard markers — each at fixed height
  hazardMarkers = [];
  hazardData.forEach((h, i) => {
    const color = h.severity === "high" ? "#ff4466" : h.severity === "medium" ? "#ffaa00" : "#66bbff";
    const entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(h.lng, h.lat, 35),
      point: {
        pixelSize: 14,
        color: Cesium.Color.fromCssColorString(color),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      },
      label: {
        text: `⚠ ${h.label}`,
        font: "bold 14px sans-serif",
        fillColor: Cesium.Color.fromCssColorString(color),
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 3,
        outlineColor: Cesium.Color.BLACK,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -22),
        showBackground: true,
        backgroundColor: new Cesium.Color(0.05, 0.05, 0.12, 0.85),
        backgroundPadding: new Cesium.Cartesian2(10, 6),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000),
      },
    });
    hazardMarkers.push(entity);
  });

  // Driver position marker (visible in overview mode)
  positionMarker = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(routeCoords[0].lng, routeCoords[0].lat, DRIVER_HEIGHT + 5),
    point: { pixelSize: 18, color: Cesium.Color.YELLOW, outlineColor: Cesium.Color.BLACK, outlineWidth: 3 },
    label: {
      text: "▶ YOU",
      font: "bold 12px sans-serif",
      fillColor: Cesium.Color.YELLOW,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      outlineWidth: 2,
      outlineColor: Cesium.Color.BLACK,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -20),
    },
  });

  // Wire keyboard events
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  setMode("overview");
}

/**
 * Creates a satellite globe viewer (no Cesium ion needed).
 * Used as fallback when photorealistic tiles aren't available.
 */
async function createSatelliteViewer(containerId) {
  const esriProvider = new Cesium.UrlTemplateImageryProvider({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 19,
    credit: "Esri",
  });

  // Wipe the built-in demo token so Cesium doesn't try to validate it
  Cesium.Ion.defaultAccessToken = "";

  // Use CesiumWidget instead of Viewer — no UI chrome, no hidden Ion dependencies
  const v = new Cesium.CesiumWidget(containerId, {
    imageryProvider: esriProvider,
    contextOptions: {
      webgl: { 
        preserveDrawingBuffer: true,
        allowIfMajorPerformanceCaveat: true
      },
    },
  });

  v.scene.globe.show = true;
  v.scene.globe.depthTestAgainstTerrain = true;
  return v;
}

/**
 * Creates a photorealistic 3D tiles viewer using Google Earth data via Cesium ion.
 */
async function createPhotorealisticViewer(containerId) {
  const v = new Cesium.CesiumWidget(containerId, {
    contextOptions: {
      webgl: { 
        preserveDrawingBuffer: true,
        allowIfMajorPerformanceCaveat: true
      },
    },
  });

  try {
    const tileset = await Cesium.createGooglePhotorealistic3DTileset();
    v.scene.primitives.add(tileset);
  } catch (e) {
    v.destroy();
    throw e;
  }

  // Hide the globe since the 3D tiles cover it
  v.scene.globe.show = false;
  return v;
}

/* ═══════════════ MODE SWITCHING ═══════════════ */

export function setMode(mode) {
  currentMode = mode;
  stopLoop();

  if (mode === "overview") {
    if (positionMarker) positionMarker.show = true;
    viewer.scene.screenSpaceCameraController.enableInputs = true;
    flyToOverview();
    startLoop();
  } else if (mode === "drive") {
    if (positionMarker) positionMarker.show = false;
    viewer.scene.screenSpaceCameraController.enableInputs = false;
    updateDriveCamera();
    startLoop();
  } else if (mode === "pip") {
    if (positionMarker) positionMarker.show = false;
    viewer.scene.screenSpaceCameraController.enableInputs = false;
    startLoop();
    initMiniMap();
  }

  if (mode !== "pip" && mode !== "drive") {
    destroyMiniMap();
  }
}

export function getMode() {
  return currentMode;
}

/* ═══════════════ OVERVIEW CAMERA ═══════════════ */

function flyToOverview() {
  if (!routeCoords.length || !viewer) return;
  // Compute bounding rectangle from route coordinates
  let west = 180, east = -180, south = 90, north = -90;
  for (const c of routeCoords) {
    west = Math.min(west, c.lng);
    east = Math.max(east, c.lng);
    south = Math.min(south, c.lat);
    north = Math.max(north, c.lat);
  }
  const rect = Cesium.Rectangle.fromDegrees(west, south, east, north);
  viewer.camera.flyTo({
    destination: rect,
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(0),
      Cesium.Math.toRadians(-45),
      0
    ),
  });
}

/* ═══════════════ DRIVE CAMERA ═══════════════ */

function updateDriveCamera() {
  if (!viewer) return;
  const pos = interpolatePos(routeProgress);
  const heading = getRouteHeading(routeProgress) + headingOffset;

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, DRIVER_HEIGHT),
    orientation: {
      heading: Cesium.Math.toRadians(heading),
      pitch: Cesium.Math.toRadians(-5),  // Slight downward look
      roll: 0,
    },
  });

  // Update position marker
  if (positionMarker) {
    positionMarker.position = Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, DRIVER_HEIGHT + 5);
  }

  // In photorealistic mode, request scene re-render
  if (hasPhotorealistic && viewer.scene) {
    viewer.scene.requestRender();
  }
}

/* ═══════════════ MINI-MAP (PiP) ═══════════════ */

function initMiniMap() {
  const container = document.getElementById("minimap-container");
  if (!container || leafletMap) return;

  // Use Leaflet for the HUD minimap instead of Cesium (much lighter)
  leafletMap = L.map("minimap-container", {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false
  }).setView([routeCoords[0].lat, routeCoords[0].lng], 16);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png").addTo(leafletMap);

  // Draw route
  const latLngs = routeCoords.map(c => [c.lat, c.lng]);
  leafletRoute = L.polyline(latLngs, { color: "#00d4aa", weight: 3, opacity: 0.6 }).addTo(leafletMap);

  // You marker
  leafletMarker = L.divIcon({
    className: "minimap-marker",
    html: `<div style="width:12px; height:12px; background:#00d4aa; border:2px solid #fff; border-radius:50%; box-shadow:0 0 10px #00d4aa; transform: rotate(0deg);"><div style="width:2px; height:8px; background:#fff; position:absolute; top:-6px; left:5px;"></div></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
  leafletMarker = L.marker([routeCoords[0].lat, routeCoords[0].lng], { icon: leafletMarker }).addTo(leafletMap);
}

function updateMiniMapCamera() {
  if (!leafletMap) return;
  const pos = interpolatePos(routeProgress);
  const heading = getRouteHeading(routeProgress);

  leafletMap.panTo([pos.lat, pos.lng], { animate: false });
  if (leafletMarker) {
    leafletMarker.setLatLng([pos.lat, pos.lng]);
    const iconEl = leafletMarker.getElement()?.firstChild;
    if (iconEl) {
      iconEl.style.transform = `rotate(${heading}deg)`;
    }
  }
}

function destroyMiniMap() {
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
    leafletMarker = null;
    leafletRoute = null;
  }
}

/* ═══════════════ KEYBOARD INPUT ═══════════════ */

function onKeyDown(e) {
  if (currentMode === "overview" && !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"].includes(e.key)) return;
  keysDown.add(e.key.toLowerCase());
  if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
}

function onKeyUp(e) {
  keysDown.delete(e.key.toLowerCase());
}

/* ═══════════════ ANIMATION LOOP ═══════════════ */

function startLoop() {
  if (loopId) return;
  function frame() {
    update();
    loopId = requestAnimationFrame(frame);
  }
  loopId = requestAnimationFrame(frame);
}

function stopLoop() {
  if (loopId) {
    cancelAnimationFrame(loopId);
    loopId = null;
  }
}

function update() {
  if (currentMode === "overview") {
    if (positionMarker) {
      const pos = interpolatePos(routeProgress);
      positionMarker.position = Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, 25);
    }
    handleMovementKeys();
    return;
  }

  handleMovementKeys();
  updateDriveCamera();

  if (currentMode === "pip") {
    updateMiniMapCamera();
  }

  checkHazardProximity();
  emitProgress();
}

function handleMovementKeys() {
  const inDriveMode = currentMode === "drive" || currentMode === "pip";
  // Forward / backward
  if (keysDown.has("arrowup") || keysDown.has("w")) {
    routeProgress = Math.min(routeProgress + MOVE_SPEED, routeCoords.length - 1);
  }
  if (keysDown.has("arrowdown") || keysDown.has("s")) {
    routeProgress = Math.max(routeProgress - MOVE_SPEED, 0);
  }
  // Look left / right (only in drive modes)
  if (inDriveMode) {
    if (keysDown.has("arrowleft") || keysDown.has("a")) {
      headingOffset -= LOOK_SPEED;
    }
    if (keysDown.has("arrowright") || keysDown.has("d")) {
      headingOffset += LOOK_SPEED;
    }
    // Center look (Space)
    if (keysDown.has(" ")) {
      headingOffset *= 0.85; // smooth reset
    }
  }
}

/* ═══════════════ HAZARD PROXIMITY ═══════════════ */

function checkHazardProximity() {
  const pos = interpolatePos(routeProgress);
  for (let i = 0; i < hazardData.length; i++) {
    const h = hazardData[i];
    const dist = haversine(pos, { lat: h.lat, lng: h.lng });
    if (dist < HAZARD_ALERT_DIST && i !== lastAlertedHazard) {
      lastAlertedHazard = i;
      if (callbacks.onHazardApproach) {
        callbacks.onHazardApproach(h, i, dist);
      }
    }
  }
}

function emitProgress() {
  if (callbacks.onProgress) {
    const pos = interpolatePos(routeProgress);
    const pct = (routeProgress / (routeCoords.length - 1)) * 100;

    let nextHazard = null;
    let nextHazardDist = Infinity;
    for (const h of hazardData) {
      const dist = haversine(pos, { lat: h.lat, lng: h.lng });
      if (dist < nextHazardDist) {
        nextHazardDist = dist;
        nextHazard = h;
      }
    }

    callbacks.onProgress({
      progress: pct,
      position: pos,
      nextHazard,
      nextHazardDist: Math.round(nextHazardDist),
    });
  }
}

/* ═══════════════ PUBLIC API ═══════════════ */

export function jumpToHazard(index) {
  if (index < 0 || index >= hazardData.length) return;
  const h = hazardData[index];
  let closestIdx = 0;
  let closestDist = Infinity;
  routeCoords.forEach((c, i) => {
    const d = haversine(c, { lat: h.lat, lng: h.lng });
    if (d < closestDist) { closestDist = d; closestIdx = i; }
  });
  // Back up a bit so the hazard is ahead of you
  routeProgress = Math.max(0, closestIdx - 5);
  headingOffset = 0;
  lastAlertedHazard = -1;
  if (currentMode !== "overview") {
    updateDriveCamera();
  }
}

export function setProgress(progress) {
  routeProgress = Math.max(0, Math.min(progress, routeCoords.length - 1));
  // Update camera and check hazards when progress is set externally (auto-drive)
  if (currentMode === "drive" || currentMode === "pip") {
    updateDriveCamera();
    checkHazardProximity();
    emitProgress();
    if (currentMode === "pip") updateMiniMapCamera();
  }
}

export function getProgress() {
  return routeProgress;
}

export function setHeadingOffset(val) {
  headingOffset = val;
}

export function getHeadingOffset() {
  return headingOffset;
}

export function setBrake(active) {
  const key = "s";
  if (active) keysDown.add(key);
  else keysDown.delete(key);
}

export function setGas(active) {
  const key = "w";
  if (active) keysDown.add(key);
  else keysDown.delete(key);
}

export function destroy() {
  stopLoop();
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  destroyMiniMap();
  if (viewer) {
    viewer.destroy();
    viewer = null;
  }
  routeEntity = null;
  hazardMarkers = [];
  positionMarker = null;
  keysDown.clear();
  hasPhotorealistic = false;
}
