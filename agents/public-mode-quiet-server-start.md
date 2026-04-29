# Public Mode Quiet Server Start

- **Timestamp**: 2026-04-29T19:24:00Z
- **Agents Involved**: Codex 5.3, Human User
- **Task**: Make startup option 2 feel like only mode 2 by suppressing local server banner output.

## Transcript

**[Human User]:** Asked why option 2 appears to run both 1 and 2.

**[Codex 5.3]:** Clarified that option 2 must run the local app server first as a prerequisite for ngrok tunneling.

**[Codex 5.3]:** Updated `scripts/start-public.sh` so when mode 2 starts server itself:
- server runs in background with output redirected to `/tmp/route-rehearsal-server.log`
- terminal now shows only public-mode progress/messages and URLs
