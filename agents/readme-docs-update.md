# README and Docs Update

**Timestamp:** 2026-04-30T05:51:00-04:00  
**Agents Involved:** Cascade (Coder Agent)  
**Task:** Update `README.md` and `docs/README.md` to reflect the project's current status. Make no code changes.

## Interaction Summary

- **[Human User]:** "Update the main readme.md to reflect the project's current status (also update docs.) Make no changes to code."
- **[Coder Agent]:** Read root `README.md`, `docs/README.md`, root `HANDOFF.md`, `docs/HANDOFF.md`, `PROPOSAL.md`, `docs/PROPOSAL.md`, `docs/IDEA_DECISION.md`, `SCHEMA.md`, `package.json`, and `agents/project-rebranding.md` to establish current state.
- **[Coder Agent]:** Updated root `README.md` with the following changes:
  - Added a **Status** block at the top: "MVP Goals Achieved & Remote Synchronized — April 29, 2026".
  - Updated **APIs & Data Services** table:
    - Replaced "Google Maps Embed" with **Street View** (free `output=svembed`, no API key required).
    - Updated **Cesium ion** description to mention the Firefox black-screen fix.
    - Updated **Overpass API** description to remove eliminated noise categories (crossings, railway crossings).
  - Updated **Hazard Detection Pipeline** table to match the cleaned Overpass scanner.
  - Updated **Phone Controller** table to remove the **Turn Signals** row (removed from HUD per `HANDOFF.md`).
  - Updated **Running the App** section:
    - Promoted `npm start` to the primary command.
    - Moved `npm run startup` to an optional interactive-menu subsection.
    - Removed `GOOGLE_MAPS_KEY` from the required API keys list.
  - Updated **Proposal & Docs** table:
    - Added `IDEA_DECISION.md` link.
    - Clarified that `HANDOFF.md` in the root is the canonical current handoff.
  - Expanded **Demo Data** list to include all existing cached and canned route files.
  - Updated **MVP Features** list:
    - Added free Street View pass, Firefox fix note.
    - Added automated drive simulation (no manual pause/resume).
    - Added **Active listening** (Intense mode) with browser SpeechRecognition.
- **[Coder Agent]:** Updated `docs/README.md`:
  - Added descriptions for each linked document.
  - Added a note pointing to the root `HANDOFF.md` as the canonical current handoff.
  - Removed the stale `docs/HANDOFF.md` link since it is superseded by the root file.

## Files Modified

- `README.md`
- `docs/README.md`
