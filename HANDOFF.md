# Route Rehearsal — Handoff Document (Resumable)

**Last Updated**: 2026-04-29T08:40:00Z
**Agent**: Gemini 3 Flash (picking up from Claude Opus 4.6)
**Conversation**: 7ec50569-eb76-4225-9441-eb57dbdd1932

---

## 🚀 Current State & Built Features

All handoff tasks from the previous session are **complete**. The app now has both real-world hazard data and a phone-as-controller feature.

### Core Features (Completed)
- **3D Engine (CesiumJS)**: Tiered loading (Google Photorealistic 3D Tiles → OSM Buildings → Flat Satellite).
- **Auto-Drive System**: Car advances automatically; user focuses on awareness. Brake (B key) pauses.
- **ElevenLabs Narration**: Instructor voice guides users through hazards (pre-generated).
- **Distraction Simulation**: Optional "Intense" difficulty with screaming kids, bickering spouse, and radio chatter.
- **Recap Screen**: Post-run confidence score, hazard breakdown (reviewed vs. missed), and stats.
- **Accident Data Integration**: `accident-scanner.js` queries Overpass API for traffic signals, stop signs, pedestrian crossings, traffic calming, poor surfaces, railway crossings, and OSM hazard tags. Results are merged into the hazard list and shown with source "overpass".
- **Phone Companion Controller**: Full WebSocket-based phone-as-steering-wheel.
    - `server.js`: Node.js HTTP + WebSocket server (replaces `python3 -m http.server`).
    - `controller.html`: Mobile-optimized page with gyro steering (gamma tilt), brake/gas pedals, and turn-signal toggles.
    - `phone-bridge.js`: WebSocket client module used by `app.js`.
    - Laptop generates a 4-letter room code; phone joins via `/controller.html`.
    - Phone steering maps to `headingOffset` in drive mode; brake pauses auto-drive; gas resumes.
- **GPU Fix**: Hardware acceleration forced via `LIBGL_ALWAYS_SOFTWARE=0`.

---

## 🛠 Active Tasks (Next Steps)

No pending tasks from the previous session remain. Potential next improvements:

1. **NHTSA / Municipal Crash Data**: Overpass gives static OSM hazards. For live crash hotspots, integrate a city open-data API (Socrata) or NHTSA FARS.
2. **ngrok Public Tunnel**: For demoing the phone controller outside the local network, run `ngrok http 8080` and update the QR code / URL shown on the laptop.
3. **Signal UI in 3D View**: Turn-signal toggles from the phone currently only send data — no visual indicator in the Cesium view yet.
4. **Wiper / Headlight Controls**: Could add more tactile controls to the phone page for realism.
5. **Auto-Drive Speed Control**: Phone gas pedal could modulate auto-drive speed instead of just on/off.

---

## 📦 Technical Environment
- **Local Server**: `npm install && npm start` (runs `server.js` on port 8080 with HTTP + WebSocket)
- **Old command retired**: `python3 -m http.server 8080` is no longer sufficient — WebSocket relay requires Node.
- **GPU Overrides**: `LIBGL_ALWAYS_SOFTWARE=0 GALLIUM_DRIVER=""` (Essential for 3D performance).
- **IP Address**: `10.144.148.140` (Internal).
- **API Keys**: All stored in `CONFIG` block at top of `app.js`.

---

## 📂 Key Files
- `app.js`: Main state, Auto-Drive/Recap logic, phone-bridge wiring, accident-scanner integration.
- `cesium-view.js`: 3D rendering, camera control, and external steering/brake/gas setters.
- `narration.js`: ElevenLabs TTS handler for hazards.
- `distractions.js`: ElevenLabs TTS handler for cognitive load.
- `hazard-scanner.js`: Geometry-based hazard detection.
- `accident-scanner.js`: **NEW** — Overpass API query for real-world traffic hazards.
- `phone-bridge.js`: **NEW** — WebSocket client for host/controller communication.
- `server.js`: **NEW** — Node.js unified HTTP + WebSocket server.
- `controller.html`: **NEW** — Mobile phone controller page.
- `package.json`: **NEW** — Dependency manifest (`ws` package).

---

## 🚀 Quick Start

```bash
npm install
npm start
# Open http://localhost:8080/ on laptop
# Open http://<laptop-ip>:8080/controller.html on phone
# Click "📱 Pair" in the practice screen, enter the 4-letter code on your phone
```

**Note to Next Agent**: Everything from the previous handoff is implemented and tested. Pick up from any of the "Potential next improvements" above, or move on to demo hardening.

---

## 📝 Addendum: Driving Awareness & UI Upgrade
**Updated**: 2026-04-29T13:15:00Z  
**Agent**: Antigravity

### Changes Implemented:
1.  **Multi-Viewport Mirror System**:
    *   Integrated three secondary Cesium viewer instances as Rearview, Left Side, and Right Side mirrors.
    *   Mirrors automatically track the vehicle's position with appropriate heading offsets (180° for rear, -90° for left, +90° for right).
2.  **HUD MiniMap Overlay**:
    *   Added a lightweight Leaflet-based circular minimap to the bottom-center of the HUD.
    *   Features real-time position tracking and a rotating directional marker synced with vehicle heading.
3.  **StreetView Reference Overlay**:
    *   Implemented a toggleable StreetView window that calculates current lat/lng and orientation.
    *   Supports interactive Google StreetView embed (with API key) or a deep-link fallback to Google Maps.
4.  **Narration System Robustness**:
    *   Added a **Native Speech Fallback** (Web Speech API) to `narration.js`.
    *   If ElevenLabs credits are exhausted (402 Payment Required) or the API key is missing, the instructor voice will automatically switch to the browser's local voice.
5.  **Critical GPU Fix**:
    *   Identified that `unset GALLIUM_DRIVER` was defaulting to software `llvmpipe` rendering.
    *   Explicitly set `GALLIUM_DRIVER=radeonsi` in `.bashrc` to force hardware acceleration on the user's AMD GPU.
    *   Recommended Chrome launch flags: `--ignore-gpu-blocklist --enable-gpu-rasterization`.

### Current State:
The rehearsal platform is now a "full cockpit" experience with mirrors and spatial orientation tools. The system is stable even with high API usage due to the new voice fallbacks.

**Next Agent**: The 3D views are heavy. If performance drops, consider downgrading the side mirrors to static satellite captures or reducing the mirror refresh rate in `cesium-view.js`.

