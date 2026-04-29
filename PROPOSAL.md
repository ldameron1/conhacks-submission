# Route Rehearsal Proposal

## Executive Summary

Route Rehearsal is a web app that helps a driver practice an unfamiliar trip before they get in the car. A laptop or tablet shows the route as a sequence of driving decisions, while a phone acts as the steering controller. The system turns a route into a guided rehearsal with narration, timing cues, lane-change warnings, and a final confidence recap.

The product pitch is simple: reduce stress before a difficult drive by letting the user mentally and physically rehearse key moments such as merges, exits, confusing intersections, toll booths, and parking entrances.

For a hackathon, the strongest version is not a full simulator. It is a lightweight, believable rehearsal flow that feels useful in under two minutes.

## Problem

Navigation apps are good at turn-by-turn guidance while driving, but they are weak at preparing someone before the trip starts. That gap matters when the route includes:

- downtown one-way turns
- multi-lane merges
- hard-to-see exits
- construction detours
- campus or airport drop-off paths
- unfamiliar parking entrances

Drivers often want a quick preview of where the confusing parts are before they begin. Route Rehearsal is built for that moment.

## Target Users

- Student drivers practicing new routes
- People driving in a new city
- Anxious drivers who want rehearsal before departure
- Parents helping a teen practice a route
- Anyone preparing for a commute with known trouble spots

## Core Value Proposition

- Converts a route into a rehearsal, not just directions
- Gives the user a lower-stress way to prepare before driving
- Creates a memorable phone-and-laptop demo for judges
- Uses AI to improve context and narration instead of making AI the whole product

## Product Experience

### User Flow

1. User enters origin and destination or selects a demo route.
2. System generates a route rehearsal timeline.
3. User pairs phone to the laptop with a short room code.
4. Laptop displays upcoming route beats and simulated driving context.
5. Phone acts as the steering input using gyro or touch.
6. System narrates key route moments and tracks hesitation or missed actions.
7. User receives a short recap with confidence and trouble spots.

### What the User Sees

- A route timeline with upcoming turns, merges, and landmarks
- A simple dashboard view with speed, lane prompts, and warnings
- Key intersection or scene cards for difficult moments
- Instructor-style narration
- A post-run recap with missed turns and retry suggestions

## MVP Scope

The MVP should prove one clear idea: a route can be turned into a useful rehearsal session.

### In Scope

- Enter a route or load a canned demo route
- Convert route steps into rehearsal beats
- Pair phone and laptop in one session
- Control progression with gyro or touch steering
- Show upcoming turn and lane prompts
- Play narration for major route events
- Produce a simple recap at the end

### Out of Scope for MVP

- Full 3D driving simulation
- Precise road physics
- Live traffic integration
- Complete map rendering fidelity
- Highly accurate lane geometry for every road
- Solana integration unless everything else is already solid

## Technical Shape

### Frontend

- Laptop display: main route rehearsal screen
- Phone display: controller UI with gyro or touch steering
- Shared session state synced in real time

### Backend

- Session management and room pairing
- WebSocket channel for low-latency phone input
- Route processing pipeline
- Event logging for recap and analytics

### AI + Sponsor Integration

- Gemini API:
  - summarize route segments into rehearsal beats
  - identify likely confusion points
  - produce recap language and confidence feedback
- ElevenLabs:
  - instructor-style voice narration
- DigitalOcean:
  - deploy app and real-time session server
- Snowflake:
  - optional route/session analytics for sponsor alignment

## System Architecture

1. Route input layer
   - origin/destination form or canned route selection
2. Route parser
   - normalizes steps into internal event objects
3. Rehearsal generator
   - enriches raw steps into human-friendly prompts
4. Real-time session server
   - pairs phone and laptop and relays control events
5. Rehearsal client
   - renders timeline, prompts, and dashboard state
6. Recap engine
   - aggregates misses, hesitation, and completion status

## Agile Development Plan

This project fits agile best if the team uses short, hackathon-sized sprints with a working demo at the end of each one.

### Agile Principles for This Build

- Keep the product shippable at all times
- Prefer working end-to-end slices over isolated components
- Reprioritize after each sprint based on demo risk
- Treat external APIs as optional enrichments, not foundations
- Keep one reliable offline demo path in the backlog from the start

### Team Roles

- Product/UX owner:
  - owns scope, flow, acceptance criteria, and demo script
- Frontend owner:
  - owns laptop view, phone controller, and interaction polish
- Realtime/backend owner:
  - owns session pairing, WebSockets, and event state
- AI/integration owner:
  - owns route enrichment, narration, and fallback mock data

One person can cover multiple roles if the team is small, but ownership should still be explicit.

### Sprint Plan

#### Sprint 0: Scope Lock and Skeleton

Goal: establish the thin vertical slice.

- confirm MVP and fallback scope
- define route event schema
- scaffold laptop screen and phone controller
- set up session pairing with mocked data
- choose deployment path

Done when:

- two devices can join the same session
- mock route events can progress on the laptop
- phone input reaches the main screen

#### Sprint 1: Rehearsal Core

Goal: make the app feel like a real route rehearsal.

- build route timeline UI
- add steering or touch progression
- implement route event playback
- show lane prompts, turn warnings, and landmarks
- log misses and hesitation events

Done when:

- a user can complete a full rehearsal using canned route data
- recap shows meaningful result data

#### Sprint 2: AI and Voice Layer

Goal: add sponsor-backed intelligence and polish.

- integrate Gemini for route beat summaries
- flag confusing intersections and warning moments
- generate recap language
- integrate ElevenLabs narration for major events

Done when:

- AI-enhanced route copy is visible in the experience
- narration works on at least one stable demo route

#### Sprint 3: Demo Hardening

Goal: reduce failure risk before judging.

- add offline demo routes
- polish pairing and reconnect flows
- improve loading, empty, and failure states
- tune pacing of narration and prompts
- prepare one concise judge demo path

Done when:

- the team can run the demo reliably without depending on a live third-party API call

## Backlog

### Epic 1: Route Ingestion

- As a user, I can enter an origin and destination
- As a user, I can choose a canned demo route if live routing fails
- As a system, route steps are normalized into rehearsal events

### Epic 2: Real-Time Session Pairing

- As a user, I can pair my phone to the laptop with a room code
- As a user, my controller input updates the shared session immediately
- As a user, I can recover from a controller disconnect

### Epic 3: Rehearsal Playback

- As a user, I see the next critical route decision before it happens
- As a user, I receive lane and merge guidance during playback
- As a user, I can tell when I missed a prompt or reacted late

### Epic 4: AI Guidance

- As a user, I receive plain-language summaries of difficult route sections
- As a user, I hear narration for important route moments
- As a user, I receive recap feedback based on my performance

### Epic 5: Demo and Reliability

- As a judge, I can understand the product in under 30 seconds
- As a team, we can run the full demo offline with canned data
- As a presenter, we can reset the app quickly between demos

## Acceptance Criteria for MVP

- Route Rehearsal can be explained and demonstrated in under two minutes
- Two devices can pair and share one session
- One route can be rehearsed end to end
- The system shows at least three kinds of route prompts:
  - turn
  - lane or merge
  - landmark or hazard
- The user receives spoken or text guidance during playback
- The app produces a recap at the end
- A canned demo route works without external API dependence

## Risks and Mitigations

### Risk: Real map APIs take too long

Mitigation:
- start with canned route data and a normalized route event schema
- plug live APIs into the same schema later

### Risk: Phone controls are unstable

Mitigation:
- support both gyro and touch steering
- keep a keyboard fallback on the laptop for demos

### Risk: AI output is vague or slow

Mitigation:
- precompute AI output for demo routes
- keep deterministic fallback copy in the app

### Risk: Voice integration fails live

Mitigation:
- cache or pre-generate narration
- allow silent text-only guidance mode

### Risk: The product feels like a toy

Mitigation:
- emphasize stressful real-world driving situations
- keep the language focused on preparation, confidence, and safety

## Demo Narrative

The best demo should show one believable use case:

"I have never driven to this downtown parking garage before. The route has a merge, a confusing left turn, and a hidden entrance. I want to rehearse it before I leave."

Demo beats:

1. Enter or load the route.
2. Pair the phone in a few seconds.
3. Start the rehearsal.
4. Hit one merge and one confusing intersection.
5. Hear narration warn about the upcoming choice.
6. Finish with a recap that identifies the trouble spot.

## Stretch Features

- scene cards for difficult intersections
- party or chaos mode for crowd energy
- Snowflake-backed analytics dashboard
- route comparison across retries
- proof-of-practice badge only if it can be added cleanly

## Success Criteria

The project is successful if judges immediately understand three things:

- what problem it solves
- why the phone+laptop interaction is memorable
- how AI meaningfully improves the experience without being the whole idea
