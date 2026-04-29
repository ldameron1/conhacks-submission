# Next Button Freeze Fix

**Date:** 2026-04-29  
**Agent:** Antigravity (Claude Opus 4.6)  
**Issue:** UI freeze when clicking "Next Phase" button

## Root Cause Analysis

The freeze was caused by a **re-entrancy loop** in the phase transition logic:

1. When the user reaches the last hazard of a pass, the "Next →" button changes to "Next Phase →"
2. Clicking "Next Phase →" calls `showSettingsOverlay()` which shows a difficulty picker
3. Clicking "Continue to Pass 2 →" calls `continueFromSettings()` → `switchPass(2)`
4. **BUG:** `state.practiceIndex` was never reset to 0 after the phase transition
5. Because the index was still on the last hazard, `renderPracticeInfo()` was never called after the pass switch, so the button **stayed as "Next Phase →"** and remained enabled
6. Clicking it again immediately re-triggered `showSettingsOverlay()`, creating an overlay→continue→overlay loop
7. Each cycle created new Leaflet maps and Google Maps iframes without cleanup, consuming memory and blocking the UI thread

## Changes Made (app.js)

### 1. Navigation guard (`isNavigating` flag)
- Added `let isNavigating = false` guard variable
- `nextHazard()` now checks `isNavigating` and returns early if a transition is already in progress
- `continueFromSettings()` sets `isNavigating = true` on entry, releases it after 300ms

### 2. Practice index reset on phase advance
- `continueFromSettings()` now resets `state.practiceIndex = 0` before calling `switchPass()`
- Calls `renderPracticeInfo()` after switching to update button text and state

### 3. Button disable on "Next Phase" click
- `nextHazard()` now immediately disables `btn-next-hazard` when entering the settings overlay flow
- Prevents double-click from firing multiple overlay opens

### 4. Dynamic settings overlay button text
- `showSettingsOverlay()` now dynamically sets the continue button text based on `currentPracticePass + 1`
- Shows "Continue to Pass 2 →" or "Continue to Pass 3 →" as appropriate

### 5. Error recovery
- `nextHazard()` catch block now resets `isNavigating` and re-enables the button on error

## Testing

Verified end-to-end with browser testing:
- ✅ Pass 1 → settings overlay → Pass 2 transition: no freeze
- ✅ Pass 2 → settings overlay → Pass 3 transition: no freeze
- ✅ Hazard counter resets to "Hazard 1 of N" after phase change
- ✅ "Next →" button works normally within each pass
- ✅ Dynamic button text shows correct pass number
- ✅ No console errors during transitions
