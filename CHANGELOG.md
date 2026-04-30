# Changelog

## [1.0.0] - 2026-04-30

### Added
- Phone-as-controller WebSocket pairing with auto-generated 4-letter room codes
- ngrok public tunnel mode with automatic HTTPS WebSocket upgrade (`wss://`)
- Black fade transition overlay on "Next" button during hazard navigation
- Input-screen settings: Sound toggle and Difficulty selector on first screen
- Settings overlay between Pass 1 and Pass 2 for difficulty selection
- Cesium Ion token integration for 3D photorealistic tiles (Google 3D Tiles)
- OSM Buildings fallback when Ion token is unavailable
- Driving instructor narration via ElevenLabs TTS (Flash v2.5)
- Distraction simulation with 3 difficulty tiers (Calm / Moderate / Intense)
- Tri-pane layout: Leaflet map + Cesium 3D + StreetView side-by-side
- Auto-drive mode with gas/brake/signal controls
- Phone controller with steering (tilt), gas, brake, and turn signals
- Manual drive mode with keyboard controls (A/D look left/right, Space center, B brake)
- Post-drive recap with confidence score and hazard-by-hazard results
- Hotspots-only practice mode for long routes
- 5 offline demo routes for hackathon demo without API keys

### Fixed
- ngrok ERR_NGROK_8012 / ERR_NGROK_3200 connection refused errors
  - Server now binds explicitly to `127.0.0.1` for ngrok compatibility
  - Improved startup script with health check and process cleanup
- Phone pairing room code generation failure
  - Client-side room code generation with server fallback
  - Fixed reconnect race conditions in `phone-bridge.js`
  - Added `intentionalClose` flag to prevent duplicate connections
- Hazard 10 incorrectly reading as "tunnel" in offline demo 1 (patched cached demo)
- 3D buildings not loading in drive sim (Cesium Ion token now set in `app.js`)
- StreetView refresh rate during manual drive — was static, now updates every 1.5s
- Black fade overlay now properly hides iframe white-flash during StreetView reload
- Camera height lowered from 85m to 76m (~3m above Toronto street level)
- Car position marker changed from circle to rotating triangle
- HUD repositioned: speed left, hazard center-left, progress center-right

### Changed
- Removed sound/difficulty buttons from drive HUD (moved to input screen)
- Server startup script (`scripts/start-public.sh`) now kills old processes and verifies health
- Phone pairing box visible on all screens until connected
- Cache-busting query params on JS imports to prevent stale code
