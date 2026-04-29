# ConHacks Submission

Working repository for the ConHacks project.

## Current Pick

**Route Rehearsal**: a phone-as-steering-wheel route preview tool that turns a real route into a lightweight driving rehearsal. The laptop shows the route, lane/turn beats, and simulated dashboard; the phone controls steering with gyro/touch input.

The demo should focus on making an unfamiliar route feel less stressful before driving it: rehearse tricky turns, lane changes, merges, tolls, construction notes, parking entrances, and timing.

## Proposal

The full proposal and execution plan live in [PROPOSAL.md](/home/conhacks-user/conhacks-submission/PROPOSAL.md). It expands the concept into:

- product framing and target users
- MVP and non-goals
- system architecture
- agile sprint plan
- backlog and acceptance criteria
- risks, mitigations, and demo narrative

## Why This One

- It is useful without needing to be a pure game or a pure AI wrapper.
- Gemini can be used naturally for route summarization, landmark extraction, and hazard-style narration.
- ElevenLabs can add a strong polish layer with a driving-instructor voice.
- DigitalOcean can host the live app and phone/laptop session sync.
- Snowflake can be used for route/session analytics if sponsor fit matters.
- Solana is optional and should not be forced unless the team wants a stretch feature.

## MVP

1. Enter an origin and destination.
2. Generate a route rehearsal timeline: upcoming turns, lane guidance, landmarks, speed changes, and confusing intersections.
3. Open a phone controller that pairs to the laptop session.
4. Drive through the route timeline with gyro or touch steering.
5. Narrate upcoming route events in an instructor voice.
6. Show a post-drive recap of missed turns, hesitation points, and route confidence.

## Agile Delivery Plan

We will use a short-cycle agile approach built around working demo slices instead of isolated technical tasks.

1. Sprint 0: lock scope, define the route event schema, and get phone/laptop pairing working with mocked route data.
2. Sprint 1: build the core rehearsal loop with route prompts, playback, steering input, and recap logging.
3. Sprint 2: add Gemini route enrichment and ElevenLabs narration where they improve the demo.
4. Sprint 3: harden the judge path with canned routes, reconnect handling, and fallback modes.

The main rule is that the app must stay demoable after every sprint. Live APIs are enhancements, not dependencies.

## Stretch

- Street View inspired static scene cards or map tiles at key intersections.
- "Chaos commute" party mode with fictional route events for demo energy.
- Snowflake-backed aggregate analytics: most confusing route events, retries, and completion confidence.
- Solana-based proof-of-practice badge, only if it can be added cleanly.
