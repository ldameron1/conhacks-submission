# ngrok Timeout Restoration

- **Timestamp**: 2026-04-30T01:28:48-04:00
- **Agents Involved**: Human User, Codex
- **Task**: Restore public ngrok startup after the browser tab stayed in a loading state and earlier changes reintroduced a deprecated ngrok flag.

## Feature Creep Evaluation

This request aligns with the MVP scope in `docs/PROPOSAL.md`: phone-as-controller pairing over the internet is part of the demo-critical public mode. The change is operational and narrowly scoped to startup reliability, not a new feature.

## Transcript

**[Human User]:** Reported that the ngrok page was not showing the warning page and instead stayed on the browser loading spinner. Clarified it was specifically a timeout issue.

**[Codex]:** Inspected `scripts/start-public.sh`, `startup.sh`, `server.js`, current ngrok logs, process state, and the tunnel behavior. Found the script still used deprecated `--scheme=https`, and ngrok was forwarding to `http://localhost:8080` while the app server listens on `127.0.0.1`.

**[Codex]:** Updated `scripts/start-public.sh` to re-assert `NGROK_AUTH_TOKEN` from environment or `.env` every startup, remove the deprecated `--scheme=https` flag, forward ngrok explicitly to `127.0.0.1:$PORT`, support optional `NGROK_URL`, and verify the public URL responds before printing it.

**[Codex]:** Ran `bash -n scripts/start-public.sh startup.sh`, `npm run smoke`, and a bounded `bash scripts/start-public.sh` boot. The boot detected the public URL and the ngrok log showed `addr=http://127.0.0.1:8080`.

**[Human User]:** Reported the ngrok URL still loaded forever in Firefox and asked why it had worked hours earlier.

**[Codex]:** Reproduced the browser-specific failure. Curl received the app HTML, but a Chrome/Firefox User-Agent received ngrok's `ERR_NGROK_6024` free-domain browser warning HTML. In this environment that warning rendered as a blank white page. Also found multiple `ngrok-free.dev` IPv4 edge addresses timing out from the current network.

**[Codex]:** Updated startup to validate the public URL with a browser-like User-Agent and identify when ngrok returns its browser warning instead of the app. Tested Cloudflare quick tunnel and localtunnel alternatives, but they were not suitable in this environment: Cloudflare tunnel transport timed out, and localtunnel returned `503 Tunnel Unavailable`.

**[Human User]:** Clarified that the solution must also let a phone connect to `/controller.html`.

**[Codex]:** Kept ngrok as the primary public-phone path because custom-header browser workarounds would not work on a normal phone browser. Updated startup output to explicitly warn about ngrok's free-domain interstitial and print same-Wi-Fi fallback phone controller URLs.

## Outcome

Public mode now avoids localhost resolution ambiguity, detects ngrok's browser-warning interstitial, keeps a normal phone `/controller.html` URL available, and prints same-Wi-Fi fallback controller URLs for demo resilience.
