# Handoff

## What Is Built

The repo now has a working browser demo for Road Route Rehearsal:

- `index.html` renders the full-screen demo UI
- `demo-app.js` loads the canned routes and drives playback
- `SCHEMA.md` defines the internal route, pain-point, and rehearsal-run model
- `data/demo-routes/*.json` contains two concrete demo routes
- `data/rehearsal-run.example.json` shows the output of one rehearsal attempt

## Current Behavior

The demo page lets you:

- choose between two canned routes
- switch between `pain_point_only`, `full_route`, and `single_segment`
- play, pause, reset, and step through the rehearsal
- jump directly to the pain point
- see the timeline, current maneuver, coach copy, and phone-controller mock

## Important Constraint

The page loads route JSON with `fetch()`, so it needs to be served over HTTP rather than opened as a raw file.

## How To Run

From `~/conhacks-submission`:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

## What I Chose

- Plain HTML/CSS/JS instead of a framework
- Mocked route data first
- Provider-agnostic schema
- A demo that visibly centers pain-point rehearsal, not full simulation

## Next Build Step

Attach a real app shell around the current demo so route import, phone pairing, and session sync can sit on top of the same schema.

## Notes

- The current demo uses remote Google Fonts.
- There is no build step or bundler yet.
- The route data is currently local and static, which is intentional for the MVP slice.
