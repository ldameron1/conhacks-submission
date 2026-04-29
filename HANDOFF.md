# Route Rehearsal — Handoff Document

**Last Updated**: 2026-04-29T04:49:00Z (EST: 00:49)  
**Agent**: Antigravity (Google DeepMind)  
**Conversation**: 7ec50569-eb76-4225-9441-eb57dbdd1932

---

## Current State

The app is a working route rehearsal tool that:
1. Takes any origin/destination address
2. Scans for hazards (sharp turns, lane positioning, confusing signage, merges, decision clusters) using geometry analysis + Gemini AI
3. Shows a report with an interactive dark map and hazard list
4. Offers a CesiumJS 3D practice mode with three views: Overview, Drive (WASD), Drive+Map (PiP)

### Running
```bash
cd ~/conhacks-submission
python3 -m http.server 8080
# Open http://localhost:8080/
```

## Architecture

```
index.html       — UI (all CSS inline, 4 screens: input, scanning, report, practice)
app.js           — Main logic: geocoding, routing, scanning, Gemini AI, screen management
hazard-scanner.js — Route analysis: sharp turns, lane strategy, confusing signage, clusters
cesium-view.js   — CesiumJS 3D: overview/drive/pip modes, keyboard controls, hazard alerts
```

### APIs Used (ALL FREE, $0)
| API | Purpose |
|-----|---------|
| Nominatim | Address → lat/lng |
| OSRM | Route geometry + steps |
| Gemini | AI hazard analysis |
| CartoDB | Dark map tiles |
| Esri | Satellite imagery |
| CesiumJS | 3D globe rendering |

### Optional Upgrades (free signup, no CC)
- **Cesium ion token** → Enables 3D OSM Buildings. Sign up at cesium.com/ion/signup
- Add token to `CONFIG.CESIUM_ION_TOKEN` in `app.js`

## What Works
- ✅ Route input with example chips
- ✅ Geocoding + OSRM routing
- ✅ Hazard scanning (geometry + OSRM steps + AI)
- ✅ Lane positioning detection ("get in right lane early")
- ✅ Confusing signage detection
- ✅ Report screen with Leaflet dark map + hazard markers
- ✅ CesiumJS 3D practice mode with Overview/Drive/PiP modes
- ✅ WASD/arrow keyboard controls for driving
- ✅ Hazard proximity alerts in drive mode
- ✅ HUD overlay (progress, distance to next hazard)
- ✅ Mode toggle buttons in practice top bar

## What Needs Testing (on your real browser)
- CesiumJS requires WebGL/GPU — test in Chrome/Firefox with hardware acceleration
- The automated test browser lacked GPU, so I couldn't visually verify the 3D globe renders, but the code and UI structure are confirmed working

## Future Feature Ideas (Not Built)
1. **ElevenLabs distraction sim** — Phone calls and passenger chatter during practice
2. **Virtual traffic** — Animated cars for tiered difficulty levels
3. **Phone gyro controls** — Phone-as-steering-wheel via WebSocket
4. **Auto-drive playback** — Auto-advance with pause at hazards
5. **3D OSM Buildings** — Needs free Cesium ion account

## Key Files to Know
- `app.js:5-11` — API keys and config
- `hazard-scanner.js:58-87` — Sharp turn detection thresholds
- `hazard-scanner.js:167-279` — Lane strategy + confusing signage detection
- `cesium-view.js:22-27` — Movement speed and hazard alert distance constants
- `app.js:95-117` — Gemini AI prompt (the prompt engineering drives hazard quality)
