# Repository Variances

This document outlines the differences between the current state of the repository and the structure/content documented in [repo-map.md](file:///home/conhacks-user/conhacks-submission/repo-map.md).

## Summary
The [repo-map.md](file:///home/conhacks-user/conhacks-submission/repo-map.md) serves as a canonical snapshot of the project's core logic and documentation. Several utility scripts, temporary debug assets, and newly generated documentation files exist in the workspace but are not currently reflected in the map.

---

## ➕ Files Present in Workspace but Missing from Map
These files exist in the current directory but are not documented in the repository map.

### Core Documentation & Maps
- [repo-map.md](file:///home/conhacks-user/conhacks-submission/repo-map.md) (The map itself)
- [tech-stack-details.md](file:///home/conhacks-user/conhacks-submission/tech-stack-details.md)
- [tech-stack-compressed.md](file:///home/conhacks-user/conhacks-submission/tech-stack-compressed.md)
- [repo-variances.md](file:///home/conhacks-user/conhacks-submission/repo-variances.md) (This file)

### Agent Logs
- [agents/readme-docs-update.md](file:///home/conhacks-user/conhacks-submission/agents/readme-docs-update.md)

### Utility & Debug Scripts
- [demo-app.js](file:///home/conhacks-user/conhacks-submission/demo-app.js)
- [test-https.js](file:///home/conhacks-user/conhacks-submission/test-https.js)
- [test-view.html](file:///home/conhacks-user/conhacks-submission/test-view.html)
- [terrain-test.html](file:///home/conhacks-user/conhacks-submission/terrain-test.html)
- `scripts/test-app-sv.js`
- `scripts/test-fetch.js`
- `scripts/test-logic.mjs`
- `scripts/test-scan.js`
- `scripts/test-sv-free.js`
- `scripts/test-sv.js`
- `scripts/test-waterford.mjs`
- `scripts/test-cesium-pos.js`
- `scripts/test-cesium-provider.js`
- `scripts/test-cesium-size.js`
- `scripts/test-cesium.js`

### Assets & Artifacts
- `sv-debug-after.png`
- `sv-debug-pass1.png`
- `sv-debug.png`
- `sv-free-test.png`
- `sv-proof.png`
- `sv-test.png`
- `cesium-firefox.png`

### Infrastructure & Security
- [cert.pem](file:///home/conhacks-user/conhacks-submission/cert.pem) (Local HTTPS Certificate)
- [key.pem](file:///home/conhacks-user/conhacks-submission/key.pem) (Local HTTPS Key)
- `server.pid` (Active server process ID)

---

## ➖ Files in Map but Missing/Modified in Workspace
- **.playwright-mcp**: This directory was previously tracked but has been removed from the workspace and gitignored to prevent leaking logs and session data.
- **narration.js**: The code is present, but calls to it have been commented out in [app.js](file:///home/conhacks-user/conhacks-submission/app.js) for the demo to avoid quota/latency issues.

---

## 📝 Recent State Changes (Post-Map)
1. **Manual Drive Implementation**: Physics for gas, brake, and coasting were added to `app.js` after the initial map snapshot.
2. **QR Pairing**: The QR code generation logic in `app.js` was refined to support local LAN IPs.
3. **StreetView Look-Ahead**: The orientation logic for StreetView in Pass 3 was updated to project view-angles forward along the route.
