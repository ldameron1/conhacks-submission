# ngrok Early Exit Fix

- **Timestamp**: 2026-04-29T19:18:00Z
- **Agents Involved**: Codex 5.3, Human User
- **Task**: Fix startup behavior where public mode returned to shell immediately after "Starting ngrok tunnel..."

## Transcript

**[Human User]:** Shared terminal output showing option 2 started ngrok text but then returned immediately to shell prompt.

**[Codex 5.3]:** Diagnosed failure mode: strict shell (`set -e`) plus early ngrok API polling could exit on initial curl failure before ngrok API is ready.

**[Codex 5.3]:** Implemented fixes:
- in `scripts/start-public.sh`, made ngrok API polling curl resilient (`|| true`) during warm-up
- in `startup.sh`, wrapped public-mode invocation with graceful error handling and a clear auth-token hint
