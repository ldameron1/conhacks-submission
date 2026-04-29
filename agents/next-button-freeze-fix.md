# Next Button Freeze Fix

**Date:** 2026-04-29  
**Agent:** Cascade  
**Issue:** UI freeze when clicking "Next" or "Next Phase" button

## Root Cause

1. **Street View iframe blocking**: The `updateStreetViewOverlay()` function was using `loading="eager"` on Google Maps Street View iframes, which caused the UI thread to block while loading the embed.

2. **Missing error handling**: Map rendering operations (Leaflet `flyTo()`, `invalidateSize()`) and phase switching operations lacked error handling, which could cause uncaught exceptions to freeze the UI.

3. **Async Cesium initialization**: When switching to Pass 3 (tri-pane), the async Cesium initialization wasn't properly awaited or handled, making the UI appear frozen during loading.

## Changes Made

### 1. Street View iframe loading (app.js)
- Changed `loading="eager"` to `loading="lazy"` in:
  - `updateStreetViewOverlay()` (line 567)
  - `updateTriPaneStreetViewFromProgress()` (line 764)
- Added try-catch block in `updateStreetViewOverlay()` with fallback error message

### 2. Map rendering error handling
Added try-catch blocks to prevent map operation errors from freezing the UI:
- `renderReviewPass()` (lines 498-530)
- `renderStreetViewPass()` (lines 537-555)
- `updateTriPaneMap()` (lines 774-794)

### 3. Navigation error handling
Added try-catch blocks to navigation functions:
- `nextHazard()` (lines 669-690)
- `prevHazard()` (lines 694-712)

### 4. Phase switching error handling
Added try-catch blocks and proper async handling:
- `switchPass()` (lines 463-501) - added error handling and proper async handling for showTriPane
- `showSettingsOverlay()` (lines 1105-1119) - added error handling
- `continueFromSettings()` (lines 1136-1149) - added error handling
- `showTriPane()` (lines 724-765) - added outer try-catch and loading indicator

### 5. Loading indicator
Added loading indicator in `showTriPane()` to show "Loading 3D view..." while Cesium initializes, preventing the appearance of a frozen UI.

## Testing

The changes are defensive and minimal:
- Lazy loading prevents UI blocking during iframe loads
- Error handling prevents uncaught exceptions from freezing the UI
- Fallback messages inform users when Street View is unavailable
- Loading indicator provides feedback during async operations
- Proper async/await handling prevents UI blocking during Cesium initialization
