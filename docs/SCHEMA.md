# Road Route Rehearsal Data Schema

This document defines the first-pass data model for the Road Route Rehearsal MVP.

The goal is to support three immediate needs:

1. represent a route as a sequence of rehearsal events
2. mark confusion or pain points on specific route segments
3. record a rehearsal run and compare it to known trouble spots

## Design Rules

- Keep the schema app-first, not provider-first.
- Do not bake Google, OSM, or any routing API response shape directly into the main model.
- Support mocked demo routes first.
- Allow live route providers to map into the same internal shape later.

## Core Objects

### Route

A `route` is the top-level container for a drive the user wants to inspect or rehearse.

```json
{
  "id": "route_dt_parking_001",
  "title": "Downtown Garage Demo",
  "origin": {
    "label": "Campus Parking Lot",
    "lat": 43.6532,
    "lng": -79.3832
  },
  "destination": {
    "label": "King Street Garage",
    "lat": 43.6498,
    "lng": -79.3763
  },
  "mode": "drive",
  "estimatedDurationSec": 780,
  "estimatedDistanceM": 6200,
  "provider": {
    "source": "mock",
    "externalRouteId": null
  },
  "segments": [],
  "painPoints": [],
  "sceneCards": []
}
```

### Segment

A `segment` is a single route chunk that can be narrated, rendered, or evaluated.

```json
{
  "id": "seg_005_exit_split",
  "sequence": 5,
  "kind": "decision",
  "instruction": "Keep right for Exit 148B toward Downtown East",
  "distanceM": 450,
  "durationSec": 32,
  "geometry": {
    "start": { "lat": 43.6511, "lng": -79.3794 },
    "end": { "lat": 43.6499, "lng": -79.3771 }
  },
  "roadContext": {
    "roadName": "Expressway East",
    "laneCount": 4,
    "recommendedLane": "right-center",
    "speedLimitKph": 70
  },
  "signage": {
    "primaryText": "Exit 148B Downtown East",
    "secondaryText": "148A Airport / 148B Downtown",
    "signageConfidence": "medium"
  },
  "landmarks": [
    "green overpass sign",
    "split ramp barrier"
  ],
  "hazards": [
    "short decision window",
    "closely spaced exit pair"
  ]
}
```

### Pain Point

A `painPoint` is a place where the driver is likely to make a mistake or already did.

```json
{
  "id": "pp_exit_148_split",
  "segmentId": "seg_005_exit_split",
  "type": "wrong_exit",
  "severity": "high",
  "confidence": 0.92,
  "source": "manual_report",
  "title": "Exit 148A vs 148B split",
  "description": "Map presentation and overhead signage are easy to misread under time pressure.",
  "rehearsalFocus": "Choose 148B while staying right-center before the split.",
  "tags": [
    "signage_mismatch",
    "exit_split",
    "short_reaction_window"
  ],
  "detectionSignals": {
    "rerouteObserved": true,
    "hesitationObserved": true,
    "userReported": true
  }
}
```

### Scene Card

A `sceneCard` is optional media or structured visual context for a segment.

```json
{
  "id": "scene_exit_148",
  "segmentId": "seg_005_exit_split",
  "type": "mock_3d",
  "title": "Exit Split Preview",
  "assetKey": "exit-148-split",
  "cameraHint": "driver-seat",
  "notes": "Highlight the right branch and dim the wrong ramp."
}
```

### Rehearsal Run

A `rehearsalRun` records one practice attempt.

```json
{
  "id": "run_2026_04_28_demo_001",
  "routeId": "route_dt_parking_001",
  "startedAt": "2026-04-28T23:00:00Z",
  "endedAt": "2026-04-28T23:08:40Z",
  "mode": "pain_point_only",
  "selectedPainPointIds": [
    "pp_exit_148_split"
  ],
  "events": [],
  "summary": {
    "completed": true,
    "mistakes": 1,
    "hesitations": 2,
    "confidenceScore": 0.68
  }
}
```

### Run Event

A `runEvent` is a timestamped action or evaluation during a rehearsal.

```json
{
  "id": "evt_017",
  "segmentId": "seg_005_exit_split",
  "timestampMs": 186000,
  "eventType": "decision_result",
  "result": "miss",
  "inputMode": "gyro",
  "details": {
    "expectedChoice": "148B",
    "actualChoice": "148A",
    "reactionMs": 2100
  }
}
```

### Real-World Confusion Event

This object is for later, when the app supports live route deviation or post-drive reports.

```json
{
  "id": "conf_2026_04_28_148b",
  "routeId": "route_dt_parking_001",
  "segmentId": "seg_005_exit_split",
  "type": "wrong_exit",
  "timestamp": "2026-04-28T17:42:31Z",
  "source": "manual_report",
  "rerouteTriggered": true,
  "note": "Took 148A instead of 148B because the sign read differently than expected."
}
```

## Enums

### Segment Kinds

- `straight`
- `prepare`
- `decision`
- `merge`
- `exit`
- `arrival`
- `parking`

### Pain Point Types

- `wrong_exit`
- `late_merge`
- `wrong_lane`
- `missed_turn`
- `hidden_entrance`
- `signage_mismatch`
- `parking_confusion`

### Pain Point Sources

- `manual_report`
- `predicted`
- `reroute_detection`
- `aggregate_analytics`

### Rehearsal Modes

- `full_route`
- `pain_point_only`
- `single_segment`

## MVP Requirements

The MVP app only needs these fields to be present:

- `route.id`
- `route.title`
- `route.origin`
- `route.destination`
- `segments[].id`
- `segments[].sequence`
- `segments[].kind`
- `segments[].instruction`
- `painPoints[].id`
- `painPoints[].segmentId`
- `painPoints[].type`
- `painPoints[].title`
- `painPoints[].rehearsalFocus`

Everything else can be treated as optional enrichment.

## Mapping Notes

- Google, OSM, GraphHopper, or OSRM route steps should all map into `segments`.
- Signage, lane hints, and AI-generated warnings should enrich the same `segment` and `painPoint` objects.
- Snowflake analytics should be built from `rehearsalRun` and real-world confusion events, not from provider-native route payloads.
