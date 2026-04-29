# ConHacks Submission

Working repository for the ConHacks project.

## Current Pick

**Route Rehearsal**: a driver-confusion detection and rehearsal tool. It identifies route pain points such as ambiguous exits, lane splits, missed merges, hidden entrances, and signage mismatches, then lets the driver practice those moments before driving again.

The demo should focus on one concrete failure mode: the user takes the wrong branch at a confusing exit, the app records or predicts that pain point, and then the user rehearses that specific decision in a focused practice mode.

## Proposal

The canonical proposal and execution plan live in [docs/PROPOSAL.md](/home/conhacks-user/conhacks-submission/docs/PROPOSAL.md). It expands the concept into:

- product framing and target users
- MVP and non-goals
- system architecture
- map and 3D strategy
- agile sprint plan
- backlog and acceptance criteria
- risks, mitigations, and demo narrative

## Working Assets

The repo now includes concrete MVP data assets and canonical docs:

- [docs/SCHEMA.md](/home/conhacks-user/conhacks-submission/docs/SCHEMA.md): internal route, pain-point, and rehearsal-run schema
- [docs/HANDOFF.md](/home/conhacks-user/conhacks-submission/docs/HANDOFF.md): browser demo handoff and run instructions
- [docs/IDEA_DECISION.md](/home/conhacks-user/conhacks-submission/docs/IDEA_DECISION.md): shortlist and sponsor decision
- [data/demo-routes/downtown-garage.json](/home/conhacks-user/conhacks-submission/data/demo-routes/downtown-garage.json): wrong-exit and hidden-garage demo route
- [data/demo-routes/airport-merge.json](/home/conhacks-user/conhacks-submission/data/demo-routes/airport-merge.json): merge-heavy airport demo route
- [data/rehearsal-run.example.json](/home/conhacks-user/conhacks-submission/data/rehearsal-run.example.json): example rehearsal result payload

## Why This One

- It is useful without needing to be a pure game or a pure AI wrapper.
- Gemini can be used naturally for route summarization, pain-point detection, landmark extraction, and hazard-style narration.
- ElevenLabs can add a strong polish layer with a driving-instructor voice.
- DigitalOcean can host the live app and phone/laptop session sync.
- Snowflake can support route pain-point analytics: where drivers miss exits, get rerouted, hesitate, or report confusing signage.
- Solana is optional and should not be forced unless the team wants a stretch feature.

## MVP

1. Enter an origin and destination.
2. Generate route pain points: ambiguous exits, lane guidance, landmarks, hidden entrances, and confusing intersections.
3. Let the user manually tag a confusion point or load a canned real-world example.
4. Open a phone controller that pairs to the laptop session.
5. Rehearse the full route or only the confusing segment with gyro or touch steering.
6. Narrate upcoming route events in an instructor voice.
7. Show a post-drive recap of missed turns, hesitation points, route confidence, and pain-point outcomes.

## Map and 3D Strategy

Use an OpenStreetMap-based stack for the core product so we can control route overlays, pain-point scoring, and analytics. The likely stack is MapLibre for rendering, OSRM or GraphHopper for routing, and hosted OSM-derived tiles/geocoding rather than public OSM infrastructure.

Rich 3D practice is important for demo impact, but open data will not match Google-quality global 3D coverage. Treat 3D as a separate practice layer:

1. MVP: stylized 2.5D map with route overlays, lane prompts, and scene cards.
2. Strong demo path: custom 3D scenes for one or two confusing intersections.
3. Optional Google-backed mode: isolated rich 3D practice if Google APIs are needed for realism.

Do not mix Google route/map content into an OSM-rendered core map.

## Agile Delivery Plan

We will use a short-cycle agile approach built around working demo slices instead of isolated technical tasks.

1. Sprint 0: lock scope, define route and pain-point schemas, and get phone/laptop pairing working with mocked route data.
2. Sprint 1: build the core pain-point rehearsal loop with prompts, playback, steering input, and recap logging.
3. Sprint 2: add Gemini route enrichment, Snowflake-ready analytics events, and ElevenLabs narration where they improve the demo.
4. Sprint 3: harden the judge path with canned routes, reconnect handling, and fallback modes.

The main rule is that the app must stay demoable after every sprint. Live APIs are enhancements, not dependencies.

## Stretch

- Custom or Google-backed 3D practice scenes for key intersections.
- "Chaos commute" party mode with fictional route events for demo energy.
- Snowflake-backed aggregate analytics: most confusing exits, reroutes, retries, hesitation points, and completion confidence.
- Solana-based proof-of-practice badge, only if it can be added cleanly.
