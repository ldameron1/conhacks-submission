/**
 * CesiumJS 3D View Module
 * Provides Overview, Drive, and PiP modes for route practice.
 * Uses free CesiumJS + OSM Buildings (Cesium ion community account).
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
let positionMarker = null; // shows your position on the mini-map

const MOVE_SPEED = 0.12;   // index units per frame
const LOOK_SPEED = 2.5;    // degrees per frame
const DRIVER_HEIGHT = 5;   // meters above ground
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

  // Cleanup any previous viewer
  destroy();

  // Create viewer — suppress default error dialogs
  try {
    viewer = new Cesium.Viewer(containerId, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      scene3DOnly: true,
      showRenderLoopErrors: false,
      contextOptions: {
        webgl: { preserveDrawingBuffer: true },
      },
    });
  } catch (e) {
    console.error("CesiumJS viewer creation failed:", e);
    throw new Error("WebGL not available — 3D view requires a GPU-enabled browser.");
  }

  // Dark atmosphere
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#0a0e1a");
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#1a1e2e");

  // Try to add OSM Buildings (needs Cesium ion token)
  try {
    const buildings = await Cesium.createOsmBuildingsAsync();
    viewer.scene.primitives.add(buildings);
  } catch (e) {
    console.warn("OSM Buildings unavailable (need Cesium ion token):", e.message);
  }

  // Draw route polyline
  const positions = routeCoords.map(c =>
    Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 3)
  );
  routeEntity = viewer.entities.add({
    polyline: {
      positions: positions,
      width: 6,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.25,
        color: Cesium.Color.fromCssColorString("#00d4aa"),
      }),
      clampToGround: true,
    },
  });

  // Start / End markers
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(routeCoords[0].lng, routeCoords[0].lat, 5),
    point: { pixelSize: 14, color: Cesium.Color.fromCssColorString("#00d4aa"), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
    label: { text: "START", font: "12px sans-serif", fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
             outlineWidth: 2, outlineColor: Cesium.Color.BLACK, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -18) },
  });

  const last = routeCoords[routeCoords.length - 1];
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(last.lng, last.lat, 5),
    point: { pixelSize: 14, color: Cesium.Color.fromCssColorString("#0088ff"), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
    label: { text: "END", font: "12px sans-serif", fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
             outlineWidth: 2, outlineColor: Cesium.Color.BLACK, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -18) },
  });

  // Hazard markers
  hazardMarkers = [];
  hazardData.forEach((h, i) => {
    const color = h.severity === "high" ? "#ff4466" : h.severity === "medium" ? "#ffaa00" : "#66bbff";
    const entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(h.lng, h.lat, 15),
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString(color),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      },
      label: {
        text: `⚠ ${h.label}`,
        font: "bold 13px sans-serif",
        fillColor: Cesium.Color.fromCssColorString(color),
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: 2,
        outlineColor: Cesium.Color.BLACK,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        showBackground: true,
        backgroundColor: new Cesium.Color(0.05, 0.05, 0.12, 0.8),
        backgroundPadding: new Cesium.Cartesian2(8, 5),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000),
      },
    });
    hazardMarkers.push(entity);
  });

  // Driver position marker (visible in overview mode)
  positionMarker = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(routeCoords[0].lng, routeCoords[0].lat, 8),
    point: { pixelSize: 16, color: Cesium.Color.YELLOW, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
    label: {
      text: "▶ YOU",
      font: "bold 11px sans-serif",
      fillColor: Cesium.Color.YELLOW,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      outlineWidth: 2,
      outlineColor: Cesium.Color.BLACK,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -18),
    },
  });

  // Wire keyboard events
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  setMode("overview");
}

/* ═══════════════ MODE SWITCHING ═══════════════ */

export function setMode(mode) {
  currentMode = mode;
  stopLoop();

  if (mode === "overview") {
    // Show position marker in overview
    if (positionMarker) positionMarker.show = true;
    viewer.scene.screenSpaceCameraController.enableInputs = true;
    flyToOverview();
    // Start a slow update loop for the position marker
    startLoop();
  } else if (mode === "drive") {
    // Hide position marker in first-person
    if (positionMarker) positionMarker.show = false;
    viewer.scene.screenSpaceCameraController.enableInputs = false;
    updateDriveCamera();
    startLoop();
  } else if (mode === "pip") {
    if (positionMarker) positionMarker.show = false;
    viewer.scene.screenSpaceCameraController.enableInputs = false;
    updateDriveCamera();
    startLoop();
    initMiniMap();
  }

  if (mode !== "pip") {
    destroyMiniMap();
  }
}

export function getMode() {
  return currentMode;
}

/* ═══════════════ OVERVIEW CAMERA ═══════════════ */

function flyToOverview() {
  if (!routeEntity || !viewer) return;
  viewer.flyTo(routeEntity, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(0),
      Cesium.Math.toRadians(-45),
      0 // auto-calculate range
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
      pitch: Cesium.Math.toRadians(-8),
      roll: 0,
    },
  });

  // Update position marker
  if (positionMarker) {
    positionMarker.position = Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, 8);
  }
}

/* ═══════════════ MINI-MAP (PiP) ═══════════════ */

function initMiniMap() {
  const container = document.getElementById("cesium-minimap");
  if (!container || miniViewer) return;
  container.style.display = "block";

  miniViewer = new Cesium.Viewer("cesium-minimap-inner", {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    scene3DOnly: true,
  });

  miniViewer.scene.screenSpaceCameraController.enableInputs = false;

  // Draw route on mini-map
  const positions = routeCoords.map(c => Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 3));
  miniViewer.entities.add({
    polyline: {
      positions, width: 4,
      material: Cesium.Color.fromCssColorString("#00d4aa"),
      clampToGround: true,
    },
  });

  updateMiniMapCamera();
}

function updateMiniMapCamera() {
  if (!miniViewer) return;
  const pos = interpolatePos(routeProgress);
  miniViewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, 800),
    orientation: {
      heading: Cesium.Math.toRadians(getRouteHeading(routeProgress)),
      pitch: Cesium.Math.toRadians(-60),
      roll: 0,
    },
  });
}

function destroyMiniMap() {
  if (miniViewer) {
    miniViewer.destroy();
    miniViewer = null;
  }
  const container = document.getElementById("cesium-minimap");
  if (container) container.style.display = "none";
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
    // In overview, just update position marker based on routeProgress
    if (positionMarker) {
      const pos = interpolatePos(routeProgress);
      positionMarker.position = Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, 8);
    }
    // Allow keyboard to advance position in overview too (for preview)
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

    // Find nearest upcoming hazard
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
  // Find closest route point to this hazard
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
}

export function getProgress() {
  return routeProgress;
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
}
