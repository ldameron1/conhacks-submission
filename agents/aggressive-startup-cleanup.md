# Aggressive Startup Cleanup

- **Timestamp**: 2026-04-29T19:20:00Z
- **Agents Involved**: Codex 5.3, Human User
- **Task**: Add aggressive cleanup behavior for stuck `EADDRINUSE` processes in startup menu.

## Transcript

**[Human User]:** Requested aggressive patching for startup cleanup.

**[Codex 5.3]:** Updated option 4 in `startup.sh`:
- performs normal listener PID kill first
- if port still occupied, runs aggressive cleanup with:
  - `pkill -f "node server.js"`
  - `pkill -f "npm start"`
- re-checks port and gives explicit `jobs/fg/Ctrl+C` fallback instructions if still occupied.
