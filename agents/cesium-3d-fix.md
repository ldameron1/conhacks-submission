# Cesium 3D Rendering Fix

**Date:** 2026-04-29
**Agent:** Cascade (Coder Agent)
**Task:** Fix CesiumJS 3D rendering that was falling back to 2D satellite mode with `IZ` error

## Root Cause

Cesium 1.119 loaded from CDN ships with a **built-in expired demo Ion token** (`id: 259`). When `Cesium.Viewer` initialized, it validated this token for default imagery/terrain, threw `IZ` (Invalid Token), and killed the entire viewer creation — even though the app intended to use non-Ion ESRI satellite imagery.

Additionally, the code used `baseLayer: new Cesium.ImageryLayer(...)` which is **not a valid `Viewer` constructor option** in Cesium 1.119, so the default Ion/Bing imagery was still loaded.

## Changes Made

### 1. `cesium-view.js` — Switch to `Cesium.CesiumWidget`
- Replaced `Cesium.Viewer` with `Cesium.CesiumWidget` to eliminate UI chrome (geocoder, home button, layer picker, etc.) that triggers hidden Ion dependencies
- Set `imageryProvider: esriProvider` directly in the constructor instead of the invalid `baseLayer` property
- Added `Cesium.Ion.defaultAccessToken = ""` before widget creation to **wipe the built-in expired demo token**
- Replaced `viewer.flyTo(routeEntity)` with `viewer.camera.flyTo({ destination: computedRectangle })` since `CesiumWidget` does not have `flyTo`

### 2. `app.js` — Remove Ion token assignment
- Removed `Cesium.Ion.defaultAccessToken = CONFIG.CESIUM_ION_TOKEN` block before `initView()` call

## Files Modified

- `/home/conhacks-user/conhacks-submission/cesium-view.js`
- `/home/conhacks-user/conhacks-submission/app.js`

## Testing Notes for External Agent

1. Hard-reload the page (`Ctrl+Shift+R` or `?v=timestamp`)
2. Select any example route and click **Scan Route**
3. Click **Start Practice**
4. Expected: Cesium 3D satellite globe renders with route polyline, start/end markers, and hazard points
5. Expected fallback notice is **NOT** shown
6. Switch to **Drive** mode — camera should animate to driver POV
