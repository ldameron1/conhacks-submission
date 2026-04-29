# Startup Menu Reindex

- **Timestamp**: 2026-04-29T19:43:00Z
- **Agents Involved**: Codex 5.3, Human User
- **Task**: Reindex startup menu options so previous option 1 is shown as 0 and not selectable.

## Transcript

**[Human User]:** Requested menu reindexing: keep current option 1 technically present, relabel it as 0, make it non-selectable, and shift remaining options down by one.

**[Codex 5.3]:** Updated `startup.sh` menu:
- `0)` local mode is displayed as disabled
- selectable options are now:
  - `1)` public mode
  - `2)` status
  - `3)` aggressive stop
  - `4)` exit
- prompt and validation now enforce `[1-4]`.
