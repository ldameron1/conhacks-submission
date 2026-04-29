# ngrok Autostart Discussion

- **Timestamp**: 2026-04-29T19:06:00Z
- **Agents Involved**: Codex 5.3, Human User
- **Task**: Diagnose `EADDRINUSE` startup failure and add an automatic public startup workflow with ngrok.

## Transcript

**[Human User]:** `npm start` shows `localhost:8080`; asked whether ngrok or laptop IP should be used, and requested automatic ngrok startup if appropriate.

**[Codex 5.3]:** Investigated terminal output and confirmed `EADDRINUSE` happened because a previous `npm start` process was suspended with `Ctrl+Z` and continued holding port `8080`.

**[Codex 5.3]:** Implemented `scripts/start-public.sh` and `npm run start:public`:
- detects whether port `8080` is already in use
- starts `node server.js` only if needed
- otherwise reuses existing app server
- launches ngrok tunnel for the same port

**[Codex 5.3]:** Updated `README.md`:
- restored clean `npm start` block
- documented `npm run start:public`
- added `Ctrl+Z`/`jobs`/`fg` guidance for avoiding `EADDRINUSE`.
