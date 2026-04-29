# Road Route Rehearsal Redesign Discussion

**Timestamp:** 2026-04-28T23:55 EDT  
**Participants:** Human User, Antigravity Agent  

## Task

The user expressed dissatisfaction with the current codebase direction and requested a fundamental redesign focused on:

1. Route input (type in a real route)
2. Automatic hazard scanning (sharp corners, confusing signs, etc.)
3. Street View / 3D practice navigation at trouble spots

## Discussion

**[Human User]:** "I strongly dislike the current direction/state of the codebase, it doesn't match how I was envisioning it at all. What needs to happen is it needs to have you put in a route, then for it to scan for any sharp corners, confusing signs, etc. Then it should open either a streetview type deal or ideally a 3d view, to allow for one to practice navigating."

**[Antigravity Agent]:** Reviewed the full codebase including PROPOSAL.md, SCHEMA.md, IDEA_DECISION.md, index.html, demo-app.js, and all data files. The current implementation is a mock-data demo with canned route JSON and a timeline stepper — no real route input, no automatic scanning, no street-level imagery.

Researched available APIs:
- OSRM (free routing with polyline geometry)
- Nominatim (free geocoding)
- Google Street View JS API (interactive practice, $200/mo free tier)
- Mapillary (free but less polished)
- Gemini API (already have key, for AI hazard analysis)

Created implementation plan for a complete rebuild.

## Feature Creep Evaluation

This redesign aligns directly with the core goals in PROPOSAL.md:
- "User enters origin and destination" ✓
- "System generates route pain points" ✓  
- "Rehearse the full route or confusing segments" ✓

The request is **not feature creep** — it's a course correction to match the original vision. The current mock demo deviated from what the user envisioned.

## Status

Implementation plan created, awaiting user approval on open questions (Google Maps key, Gemini usage, scope).
