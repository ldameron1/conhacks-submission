# Idea Decision

## Shortlist

### 1. Route Rehearsal

Phone-as-steering-wheel route rehearsal for unfamiliar drives. Laptop shows route beats and dashboard; phone controls steering.

**Best sponsor fit:** Gemini, ElevenLabs, DigitalOcean, Snowflake.

**Why it wins:** It is a practical tool with a memorable demo. AI improves it but does not fully define it. It also avoids reusing old tabletop RPG work.

**Main risk:** Real map data can become a time sink. Keep the MVP route timeline abstract and only use rich map/street visuals for key moments.

### 2. AI Jackbox / Procedural Party Game

Party game where prompts, minigames, voices, and rounds are generated dynamically.

**Best sponsor fit:** Gemini, ElevenLabs, DigitalOcean.

**Why it is strong:** Best live demo energy. Easy for judges to understand. Good fallback if route APIs become painful.

**Main risk:** It can read as "AI wrapper" unless the interaction design is genuinely good.

### 3. Visual 3D Controller / Cheap SpaceMouse

Use phone and laptop cameras to track a hand-held object as a 3D input device for sculpting or precision mini-games.

**Best sponsor fit:** Gemini if using vision, DigitalOcean for demo hosting.

**Why it is interesting:** Technically impressive and unusual.

**Main risk:** High computer vision risk for a hackathon. The demo could fail under bad lighting or camera alignment.

### 4. Calvinball / Ultimate Uno

Rules mutate as people play, with procedural rule cards and a party-game flow.

**Best sponsor fit:** Gemini, ElevenLabs.

**Why it is fun:** Compact, easy to prototype, and has strong party potential.

**Main risk:** Hard to distinguish from generic generated-card games unless the rules engine is tight.

## Recommendation

Build **Route Rehearsal** unless the team needs the safest possible live demo. If safety is the priority, build **AI Jackbox / Procedural Party Game**.

Route Rehearsal has the best blend of novelty, usefulness, and sponsor coverage. It can still include a playful mode for demo appeal, but the core pitch stays practical.

## Sponsor Strategy

| Prize | Fit | Use |
| --- | --- | --- |
| Gemini API | Strong | Convert route steps into rehearsal beats, landmarks, warnings, and recap feedback. |
| ElevenLabs | Strong | Driving instructor narration and party-mode event voiceover. |
| DigitalOcean | Strong | Host the app and session pairing server. |
| Snowflake API | Medium | Store anonymized route/session events and generate insights. |
| Solana | Weak | Optional proof-of-practice badge or route challenge completion token. Avoid unless time remains. |

## Build Shape

- Web app with a laptop driver display and phone controller.
- Pair devices with a short room code.
- Use WebSockets for low-latency phone input.
- Start with mocked route data, then add API-based route ingestion.
- Keep the app runnable offline with demo routes in case sponsor APIs fail.

