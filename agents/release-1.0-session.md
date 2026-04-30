# Release 1.0 Session Log

**Date:** 2026-04-30
**Agents:** Cascade (Coder Agent)
**Task:** Final bug fixes, UI polish, and v1.0 release packaging

---

## Completed Tasks

### Bug Fixes
1. **Phone Pairing Room Code Generation** (`phone-bridge.js`, `server.js`)
   - Root cause: WebSocket reconnect race conditions caused stale connections to close immediately after opening, preventing `host_join` from ever reaching the server.
   - Fix: Added `intentionalClose` flag, client-side room code generation with server fallback, and auto-restart logic.

2. **ngrok ERR_NGROK_8012 / ERR_NGROK_3200** (`server.js`, `scripts/start-public.sh`)
   - Root cause: Server bound to `0.0.0.0` but ngrok expected `127.0.0.1`.
   - Fix: Explicit `127.0.0.1` bind, improved startup script with process cleanup and health check.

3. **StreetView Static During Manual Drive** (`app.js`)
   - Root cause: 5-second refresh throttle and stale tracking variables prevented updates.
   - Fix: Reduced throttle to 1.5s, reset tracking on drive start, added 4s fallback overlay timer.

4. **3D Buildings Not Loading** (`app.js`, `cesium-view.js`)
   - Root cause: Missing Cesium Ion access token.
   - Fix: Added token injection via `config.js` and `Cesium.Ion.defaultAccessToken`.

5. **Hazard 10 Tunnel Mislabel** (`data/demo-routes/`)
   - Root cause: Cached demo had stale type string.
   - Fix: Patched cached demo data.

### UI Polish
- HUD repositioned: speed left (2%), hazard center-left (31%), progress center-right (28%)
- Sound/difficulty controls moved from drive HUD to input screen
- Car position marker changed from circle to rotating triangle billboard
- Camera height lowered from 85m to 76m (~3m above street level)
- Black fade overlay on Next button click between hazards

### Infrastructure
- Cache-busting query params on JS module imports
- Extensive console logging in phone-bridge for diagnostics
- Server improved to accept client-provided room codes

---

## Release Checklist
- [x] All critical bugs resolved
- [x] ngrok tunnel verified end-to-end
- [x] Phone pairing WebSocket relay verified host→controller
- [x] StreetView refresh verified during manual drive
- [x] CHANGELOG.md created
- [x] Agent session log created
- [ ] Git commit + tag v1.0.0 + push (pending)
