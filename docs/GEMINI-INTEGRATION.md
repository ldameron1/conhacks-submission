# Gemini AI Integration

## Purpose
Gemini 2.0 Flash analyzes routes to detect "soft hazards" — the things GPS apps get wrong. GPS tells you WHERE to turn but not HOW to prepare.

## When It Runs
During route scanning, after geometry-based and OSM hazard detection (at ~80% progress).

## What It Detects

### 1. Lane Positioning
Which lane to be in EARLY. Example: "3 highway lanes all go the same direction, but the leftmost lane is actually best because it feeds into the correct lane for your next turn."

### 2. Confusing Signage
Multiple similar signs close together, exit splits (148A vs 148B), roads with similar names.

### 3. Hidden or Tricky Turns
Easy-to-miss turns (obscured, poorly marked, right after another maneuver), right-turn-from-left-lane situations.

### 4. Merge/Exit Timing
Quick lane changes after highway entry, crossing 3+ lanes in short distance, rapid merge-then-exit sequences.

### 5. Road Layout Surprises
One-way streets, sudden lane reductions (2→1), intersections where "straight" actually curves.

## Input
- First 30 turn-by-turn steps from OSRM (with lane data)
- First 10 geometry-detected hazards for context

## Output
Up to 6 AI-detected hazards per route, each with:
- **Title**: Short specific description
- **Reason**: Why this confuses drivers (1-2 sentences)
- **Tip**: Exactly what to do (which lane, when to move, what to look for)
- **Severity**: low | medium | high
- **Step Index**: Which turn-by-turn step this relates to

## API Details
- **Primary Model**: `gemini-2.0-flash`
- **Primary Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
- **Primary Key**: `GEMINI_API_KEY` environment variable
- **Fallback**: OpenRouter (if Gemini quota exhausted or fails)
  - **Fallback Model**: Configurable via `OPENROUTER_MODEL` (default: `google/gemini-2.0-flash-exp:free`)
  - **Fallback Key**: `OPENROUTER_API_KEY` environment variable
- **Response Format**: JSON array of hazard objects

## Graceful Degradation
1. If no `GEMINI_API_KEY` is set, this step is skipped
2. If Gemini returns 429 (quota exhausted), falls back to OpenRouter
3. If Gemini fails for any reason and `OPENROUTER_API_KEY` is set, falls back to OpenRouter
4. If both fail, the app still works with geometry + OSM hazards only

**Note**: OpenRouter fallback is disclosed to users and used only when Gemini quota is exhausted. Gemini is always attempted first to prioritize the primary API for competition submission.

## Display
AI-detected hazards appear on the report map with a "gemini" source badge and are included in the practice mode hazard list.

## Limitations
- Currently limited to 6 hazards per route (to stay within token limits and response time)
- Only analyzes first 30 steps (long routes may have issues beyond this)
- Requires internet connection during scan phase
