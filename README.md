Note: This project was created using vibe-coding techniques, including this very readme aside from this sentence and like one edit. It may be out of date.

# RRR — Road Route Rehearsal

**Practice any driving route from home before you brave it for real.**

RRR is a driver-confusion detection and rehearsal tool. It scans a route for pain points — ambiguous exits, lane splits, rapid merges, hidden entrances, confusing signage — then lets the driver practice those moments in a 3D/StreetView environment with a phone-as-steering-wheel controller, narrated by a driving-instructor voice.

## Architecture Overview

Road Route Rehearsal is a lightweight, zero-build-step vanilla web application built on native HTML5, CSS3, and ES Modules. It orchestrates a sophisticated, single-page driver rehearsal experience by combining Leaflet’s performant 2D mapping and ArcGIS satellite imagery with CesiumJS’s immersive Google Photorealistic 3D Tiles. The frontend relies heavily on modern CSS Grid and Flexbox for responsive layouts and utilizes the Device Orientation API to seamlessly transform the user's mobile phone into a responsive, tilt-to-steer driving controller.

On the backend, a minimal Node.js server paired with the `ws` library and an `ngrok` HTTPS tunnel maintains real-time, low-latency WebSocket communication between the laptop simulation and the phone controller. The platform’s robust hazard detection pipeline fuses precise geometric turn data from OSRM, real-world infrastructure constraints from the Overpass API, and intelligent "soft-hazard" coaching insights from Google Gemini 2.0 Flash. Finally, ElevenLabs TTS dynamically pre-generates hyper-realistic driving instructor voice narration and background distractions, resulting in a cohesive, fully browser-native AI driving simulator.

---

## Tech Stack

### Frontend
| Layer | Technology | Role |
|---|---|---|
| **Markup & Layout** | Vanilla HTML5 / CSS3 | Single-page app with four screens (input → scan → report → practice → recap) |
| **JavaScript** | ES Modules (no bundler) | All client logic in native `<script type="module">` — zero build step |
| **3D Engine** | [CesiumJS 1.119](https://cesium.com) | Satellite globe renderer with route polyline, hazard markers, driver-POV camera |
| **2D Maps** | [Leaflet 1.9.4](https://leafletjs.com) | Report map, HUD minimap, 2D fallback view |
| **Map Tiles** | CARTO Dark + ArcGIS World Imagery | Dark-themed overview tiles + satellite imagery for practice mode |
| **Typography** | [Inter (Google Fonts)](https://fonts.google.com/specimen/Inter) | UI typeface |

### Backend / Server
| Component | Technology | Role |
|---|---|---|
| **App Server** | Node.js + built-in `http` module | Serves static files and injects runtime `/config.js` with API keys |
| **WebSocket Relay** | [`ws` 8.x](https://github.com/websockets/ws) (only npm dependency) | Real-time phone ↔ laptop pairing via 4-letter room codes |
| **Public Tunneling** | [ngrok](https://ngrok.com) | HTTPS tunnel for phone controller over the internet |

### APIs & Data Services
| API | Module | Purpose |
|---|---|---|
| **OSRM** (Project OSRM public) | `app.js` | Turn-by-turn routing + geometry coordinates |
| **Nominatim** (OSM) | `app.js` | Forward geocoding for origin/destination |
| **Overpass API** (OSM) | `accident-scanner.js` | Real-world hazard data — traffic signals, stop signs, crossings, railway crossings, tunnels, poor surfaces, speed zones, traffic calming |
| **Google Gemini 2.0 Flash** | `app.js` | AI route analysis — lane positioning, confusing signage, hidden turns, merge timing, road layout surprises |
| **ElevenLabs TTS** (Flash v2.5) | `narration.js`, `distractions.js` | Instructor voice narration + multi-character distraction simulation (4 voice personas) |
| **Google Maps Embed** | `app.js` | Optional StreetView overlay for real-world reference |
| **Cesium ion** | `cesium-view.js` | Token auth for Cesium globe (falls back to ArcGIS satellite if unavailable) |

### Hazard Detection Pipeline
| Scanner | Source | What it detects |
|---|---|---|
| `hazard-scanner.js` | Route geometry + OSRM steps | Sharp turns, U-turns, merges, forks, ramps, roundabouts, lane positioning, confusing signage, decision clusters |
| `accident-scanner.js` | Overpass API (OSM) | Traffic signals, stop signs, yield signs, unmarked crossings, traffic calming, railway crossings, tunnels, poor surfaces, speed zones, OSM-tagged hazards |
| Gemini AI | `app.js` → Gemini 2.0 Flash | Lane positioning advice, confusing signage zones, hidden/tricky turns, merge/exit timing, road layout surprises |

### Phone Controller
| Feature | Implementation |
|---|---|
| **Steering** | Device orientation API (`gamma` axis → left/right tilt) |
| **Brake / Gas** | Touch pedals with press-and-hold |
| **Turn Signals** | Tap-to-toggle L/R buttons |
| **Pairing** | WebSocket room code (4 chars) with auto-reconnect |
| **iOS Support** | `DeviceOrientationEvent.requestPermission()` flow |

### Developer Tooling
| Tool | Usage |
|---|---|
| `npm run startup` | Interactive menu — ngrok public mode, status, cleanup, exit |
| `npm run smoke` | Validates config.js injection, ws/wss protocol logic, and key file integrity |
| `scripts/connect-ccsecure.sh` | WPA2-Enterprise Wi-Fi config for hackathon venue (NetworkManager/PEAP) |

### AI Tools Used During Development
Codex (GPT 5.5 / 5.4 / 5.4 Mini / 5.3-Codex), Gemini CLI (3.1 Pro / 3 Flash), Google Antigravity (Sonnet 4.5 / Opus 4.6 / Gemini 3 Flash), Cursor (Auto), Windsurf (Kimi K 2.6 / SWE 1.6), Google AI Studio (Gemini 3.1 Pro), Google AI Overviews

---

## Running the App

```bash
npm install

# API keys — set via environment or .env (leave blank for graceful fallback)
export GEMINI_API_KEY="..."
export GOOGLE_MAPS_KEY="..."
export ELEVENLABS_API_KEY="..."

npm run startup
```

This opens an interactive startup menu:
1. **Public mode** — ngrok HTTPS tunnel for internet pairing
2. **Status** — check if server is running
3. **Stop** — aggressively kill processes on port 8080
4. **Exit** — close the startup menu

Then:
- **Laptop**: open `http://localhost:8080/`
- **Phone**: open `http://<laptop-ip>:8080/controller.html`
- Click **📱 Pair** → enter 4-letter code on phone
- For quick verification: `npm run smoke`

When using ngrok, the app auto-detects the HTTPS host and switches to `wss://` for secure WebSocket. A pairing popup shows laptop URL, phone URL, and QR code.

Public mode re-applies a valid-looking `NGROK_AUTH_TOKEN` from the environment or `.env` on every startup and forwards ngrok to `127.0.0.1:8080` to avoid localhost IPv6 timeout behavior. It validates the public URL with a browser-like request; if ngrok returns its free-domain browser warning instead of the app, the laptop and phone may each need to tap **Visit Site** once before pairing. Set `NGROK_URL` to a paid/custom ngrok domain to remove that interstitial. Startup also prints same-Wi-Fi fallback controller URLs for phone testing when public tunneling is unreliable.

---

## Proposal & Docs

| Document | Contents |
|---|---|
| [PROPOSAL.md](docs/PROPOSAL.md) | Product framing, target users, MVP scope, system architecture, agile sprints, risks, demo narrative |
| [SCHEMA.md](docs/SCHEMA.md) | Route, segment, pain point, scene card, and rehearsal run data models |
| [HANDOFF.md](HANDOFF.md) | Technical handoff — built features, next steps, key files, environment details |

### Demo Data
- `data/demo-routes/downtown-garage.json` — wrong-exit and hidden-garage route
- `data/demo-routes/airport-merge.json` — merge-heavy airport route
- `data/rehearsal-run.example.json` — example rehearsal result payload

---

## MVP Features

1. Enter origin + destination (or load a demo route)
2. Multi-layer hazard scan: geometry → OSM real-world → Gemini AI
3. Interactive report map with color-coded hazard markers + provenance badges (GEO / OSM / AI)
4. 3D practice view (CesiumJS satellite globe) with driver-POV camera
5. Phone-as-steering-wheel via WebSocket pairing
6. Auto-drive with brake/gas/signal controls
7. ElevenLabs instructor narration with native speech fallback
8. Distraction simulation (3 difficulty tiers: calm / moderate / intense)
9. Hotspots-only mode for long routes
10. Post-drive recap with confidence score, hazard-by-hazard results, and stats

---

## Stretch Goals
- NHTSA / municipal crash-data overlay for live danger-zone scoring *(top priority)*
- VR integration + physical steering wheel / brake peripherals
- Higher-order weather-aware hazard evaluation
- Snowflake-backed aggregate analytics
- Solana proof-of-practice badge (only if clean)
