# Route Rehearsal — Handoff Document (Resumable)

**Last Updated**: 2026-04-29T12:15:00Z  
**Agent**: Claude Opus 4.6 (Handing off to Gemini 3 Flash)  
**Conversation**: 7ec50569-eb76-4225-9441-eb57dbdd1932

---

## 🚀 Current State & Built Features

The application is a high-fidelity 3D driving rehearsal tool. All core rehearsal logic is functional.

### Core Features (Completed)
- **3D Engine (CesiumJS)**: Tiered loading (Google Photorealistic 3D Tiles → OSM Buildings → Flat Satellite).
- **Auto-Drive System**: Car advances automatically; user focuses on awareness. Brake (B key) pauses.
- **ElevenLabs Narration**: Instructor voice guides users through hazards (pre-generated).
- **Distraction Simulation**: Optional "Intense" difficulty with screaming kids, bickering spouse, and radio chatter to test cognitive load.
- **Recap Screen**: Post-run confidence score, hazard breakdown (reviewed vs. missed), and stats.
- **GPU Fix**: Hardware acceleration forced via `LIBGL_ALWAYS_SOFTWARE=0`.

### Last Successful Steps
- Verified Cesium ion token works for Google Earth-quality cities.
- Successfully wired the 3-tier difficulty system (Calm, Moderate, Intense).
- Implemented `narration.js` and `distractions.js` as independent modules.

---

## 🛠 Active Tasks (Next Steps)

The following tasks were requested by the user immediately before this handoff:

### 1. Accident Data Integration
- **Goal**: Pull real-world crash/accident data to identify "danger zones" along the route.
- **Research Results**: 
    - **Overpass API (OSM)**: Can query `hazard=*` or `danger=*` within `(around:distance)` of the route.
    - **NHTSA/FARS**: Federal fatality data available via API (needs key/setup).
    - **Socrata/Open Data**: Many cities (NYC, etc.) have geocoded crash APIs.
- **Action**: Modify `hazard-scanner.js` or create `accident-scanner.js` to fetch and overlay this data.

### 2. Phone Companion App (Controller)
- **Goal**: Use the phone as a steering wheel (gyro) and touch interface (brake, gas, signals, wipers).
- **Status**: 
    - Samsung Galaxy is connected via USB (`lsusb` sees it as Samsung Galaxy series).
    - `adb devices` did not list it yet (check Developer Options/USB Debugging).
    - User suggested using **ngrok** for the tunnel.
- **Action**: 
    - Set up a small Socket.io or WebRTC bridge.
    - Create a `/controller` mobile-friendly page.
    - Map phone gyro `beta`/`gamma` to `headingOffset` in `cesium-view.js`.

---

## 📦 Technical Environment
- **Local Server**: `python3 -m http.server 8080`
- **GPU Overrides**: `LIBGL_ALWAYS_SOFTWARE=0 GALLIUM_DRIVER=""` (Essential for 3D performance).
- **IP Address**: `10.144.148.140` (Internal).
- **API Keys**: All stored in `CONFIG` block at top of `app.js`.

---

## 📂 Key Files
- `app.js`: Main state and Auto-Drive/Recap logic.
- `cesium-view.js`: 3D rendering and camera control.
- `narration.js`: ElevenLabs TTS handler for hazards.
- `distractions.js`: ElevenLabs TTS handler for cognitive load.
- `hazard-scanner.js`: Geometry-based hazard detection.

**Note to Next Agent**: Start by troubleshooting the `adb` connection to the Samsung device to begin the Phone Controller task, or implement the Overpass API query for accident data.
