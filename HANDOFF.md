# Route Rehearsal — Handoff Document

**Last Updated**: 2026-04-29T12:02:00Z  
**Agent**: Antigravity (Claude Opus 4.6)  
**Previous Agent**: Antigravity (Gemini 3.1-Pro)  
**Conversation**: 7ec50569-eb76-4225-9441-eb57dbdd1932

---

## Current State

The app is a fully working route rehearsal tool with:
1. Route input with example chips, geocoding, OSRM routing
2. Hazard scanning (geometry + OSRM steps + Gemini AI analysis)
3. Report screen with dark map + hazard markers
4. **CesiumJS 3D practice mode** with Google Photorealistic 3D Tiles
5. **ElevenLabs voice narration** — instructor-style TTS for each hazard
6. **Auto-drive mode** — car advances automatically, user focuses on awareness
7. **Post-run recap** — confidence score, hazard-by-hazard breakdown, retry

### Running
```bash
cd ~/conhacks-submission
LIBGL_ALWAYS_SOFTWARE=0 GALLIUM_DRIVER="" python3 -m http.server 8080
# Open http://localhost:8080/ in Firefox (launched with same env vars)
```

### GPU Note
This system has an **AMD Radeon Vega GPU** but the display manager sets `LIBGL_ALWAYS_SOFTWARE=1`.
Firefox must be launched with: `LIBGL_ALWAYS_SOFTWARE=0 GALLIUM_DRIVER="" firefox`

---

## Architecture

```
index.html         — UI (CSS inline, 5 screens: input, scanning, report, practice, recap)
app.js             — Main logic: geocoding, routing, scanning, auto-drive, recap
hazard-scanner.js  — Route analysis: turns, lanes, signage, clusters
cesium-view.js     — CesiumJS 3D engine with tiered tileset loading
narration.js       — ElevenLabs TTS: pre-generation, queue playback, mute
```

### 3D Tile Loading Cascade (cesium-view.js)
```
Has Cesium Ion Token?
  ├─ YES → Google Photorealistic 3D Tiles (Google Earth look)
  │        ├─ Success → Full immersive 3D cities ✅
  │        └─ Fail → OSM Buildings → Flat satellite
  └─ NO  → Flat satellite (Esri World Imagery)
```

### APIs Used (ALL FREE, $0)
| API | Purpose | Token |
|-----|---------|-------|
| CesiumJS | 3D engine | CDN |
| Cesium ion | Google 3D Tiles streaming | Free account |
| ElevenLabs | Voice narration | Free tier key |
| OSRM | Route computation | No |
| Nominatim | Geocoding | No |
| CartoDB | Dark map tiles | No |
| Esri | Satellite imagery | No |
| Gemini | AI hazard analysis | Free tier key |

---

## Feature Summary

### Working ✅
- Route input + example chips
- Geocoding + OSRM routing
- Hazard scanning (geometry + AI)
- Lane positioning + confusing signage detection
- Report screen with Leaflet dark map
- CesiumJS 3D practice (Overview/Drive/PiP modes)
- Google Photorealistic 3D Tiles
- WASD/arrow look controls
- **Auto-drive**: car advances at constant speed, "▶ Start Driving" button
- **Brake**: B key to pause auto-drive
- **ElevenLabs narration**: instructor voice on hazard approach, pre-generated
- **Mute toggle** in HUD
- **HUD**: speed, progress, hazard distance, alert banner
- **Recap screen**: confidence score (0-100), hazard breakdown (reviewed/missed), time, route completion %, retry button
- 2D Leaflet fallback if WebGL fails
- GPU rendering fix (AMD Radeon, env var override)

### Planned (Not Built)
1. **Phone controller** — gyro steering (left/right tilt), touch controls for brake/gas/turn signal/wipers
2. **Speed limit from OSRM** — auto-drive at actual posted speed
3. **ElevenLabs distraction sim** — phone calls, passenger chatter
4. **Virtual traffic** — animated entities for difficulty tiers
5. **Night mode toggle** — change CesiumJS clock
6. **Retry comparison** — side-by-side Run 1 vs Run 2

## Key Files
- `app.js:6-14` — API keys (Cesium, ElevenLabs, Gemini)
- `cesium-view.js:89-136` — Tiered 3D tile loading
- `narration.js` — Full ElevenLabs TTS module
- `app.js:512-578` — Auto-drive system
- `app.js:580-647` — Recap scoring + rendering
- `hazard-scanner.js:167-279` — Lane/signage detection

## Changes This Session (Claude Opus 4.6)
1. Google Photorealistic 3D Tiles via Cesium ion
2. ElevenLabs voice narration module
3. Auto-drive mode with brake key
4. Post-run recap with confidence scoring
5. HUD: speed display, mute toggle, auto-drive controls
6. GPU fix (LIBGL_ALWAYS_SOFTWARE override)
7. 2D satellite fallback
8. Esri imagery fix for globe
