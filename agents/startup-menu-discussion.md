# Startup Menu Discussion

- **Timestamp**: 2026-04-29T19:10:00Z
- **Agents Involved**: Codex 5.3, Human User
- **Task**: Provide a simple numbered startup mode selector to avoid repeated startup/port confusion.

## Transcript

**[Human User]:** Requested a simple startup shell script with numbered options to pick startup mode.

**[Codex 5.3]:** Implemented `startup.sh` with an interactive menu:
- local mode
- public mode with ngrok
- server status
- stop process using port 8080
- exit

**[Codex 5.3]:** Added `npm run startup` alias and updated `README.md` so the default instructions now use the menu-based flow.
