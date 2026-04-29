# Feature Request: Hotspots-Only Mode + Break Planning — Scope Creep Evaluation

**Date:** 2026-04-29
**Agents Involved:** Coder Agent
**Topic:** User request to add "hotspots only" testing mode and auto-break planning for long routes.

---

## Request Summary

The user wants the app to:

1. Offer a **"hotspots only"** testing mode alongside the existing full-route practice mode.
2. For **long routes (3+ hours)**, gently nudge (but not force) the user toward hotspots-only mode.
3. For **straight-shot routes (5+ hours)**, gently nudge (but not force) the user to incorporate breaks into their route plan.
4. **Auto-amend routes** with break stops for very long straight drives.

---

## Scope Creep Analysis

### Does this align with core goals in `PROPOSAL.md`?

- **Partially.** The app’s core value is "reduce stress before a difficult drive by rehearsing key moments" (PROPOSAL.md line 7). Hotspots-only mode is aligned. Break planning is adjacent — useful, but not part of the MVP.

- However, the MVP explicitly states: "For a hackathon, the strongest version is not a full simulator. It is a lightweight, believable rehearsal flow that feels useful in under two minutes" (PROPOSAL.md line 9).

### Complexity assessment

| Feature | Complexity | Impact on MVP |
|---|---|---|
| Hotspots-only mode | **Medium** | New UI toggle, new practice flow state, changes to `cesium-view.js` progress handling, new `app.js` screen logic, hazard clustering/filtering |
| Route duration detection | **Low** | OSRM already returns duration; add a threshold check |
| Gentle nudge UI (3h+ routes) | **Low-Medium** | New prompt/modal on report screen before practice starts |
| Break planning / auto-amend routes | **High** | Requires POI lookup along route (Nominatim/Overpass), inserting waypoints, re-routing through OSRM, handling new route segments, practice flow changes for multi-leg trips |

### Assessment

- **Hotspots-only mode** is the most aligned with MVP and is moderately complex. It would require:
  - A toggle on the report/practice screen
  - Filtering the practice index to only hazard-adjacent route segments
  - Cesium camera jumps between hazard clusters instead of continuous drive
  - Info panel updates for disjoint practice sessions

- **Break planning** is a significant deviation. The MVP Out of Scope explicitly lists "Live traffic integration" and "Complete map rendering fidelity." Break planning requires:
  - Finding rest stops / gas stations along the route (Nominatim or Overpass queries)
  - Re-routing through OSRM with new waypoints
  - Managing multi-leg rehearsal state
  - New UI for "break rehearsal" (e.g., "practice your exit at mile 127")

**Verdict:** This is **feature creep**. The break planning component in particular is a new product surface (trip planning, not road route rehearsal). Even hotspots-only mode is a new practice mode that adds significant state complexity.

---

## Recommendation

1. **Hotspots-only mode** — Acceptable as a post-MVP enhancement. Estimated 1–2 hours of focused implementation. Requires confirmation.
2. **Break planning / auto-amend** — **Reject as out of scope for MVP.** This is a different product feature (trip logistics, not rehearsal). Should be moved to a stretch/backlog item.
3. **Route duration nudges** — Can be added trivially (just a banner on the report screen). ~15 min. Low risk.

---

## Decision Log

**[Coder Agent]:** Flagging this as feature creep per AGENTS.md. Asking human user for confirmation before proceeding with any implementation.

