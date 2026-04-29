/**
 * Hazard Scanner Module
 * Analyzes route geometry and OSRM steps to detect driving hazards.
 */

const DEG = Math.PI / 180;

function toRad(d) { return d * DEG; }
function toDeg(r) { return r / DEG; }

/** Bearing from point A to point B in degrees [0, 360). */
function bearing(lat1, lng1, lat2, lng2) {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Shortest angular difference between two bearings. */
function bearingDiff(b1, b2) {
  let d = Math.abs(b1 - b2);
  return d > 180 ? 360 - d : d;
}

/** Haversine distance in meters. */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Label for a bearing change. */
function turnLabel(angleDeg) {
  if (angleDeg >= 120) return "U-turn";
  if (angleDeg >= 70) return "Sharp turn";
  if (angleDeg >= 40) return "Moderate turn";
  return "Slight turn";
}

function severityFromAngle(angle) {
  if (angle >= 120) return "high";
  if (angle >= 70) return "high";
  if (angle >= 45) return "medium";
  return "low";
}

/* ───────────────── Sharp Turn Detection ───────────────── */

/**
 * Detect sharp turns by computing bearing changes along the coordinate array.
 * @param {Array<[number,number]>} coords  GeoJSON coordinates [lng, lat]
 * @param {number} thresholdDeg  Minimum bearing change to flag (default 40).
 */
export function detectSharpTurns(coords, thresholdDeg = 40) {
  const hazards = [];
  if (coords.length < 3) return hazards;

  for (let i = 1; i < coords.length - 1; i++) {
    const [lng0, lat0] = coords[i - 1];
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];

    const b1 = bearing(lat0, lng0, lat1, lng1);
    const b2 = bearing(lat1, lng1, lat2, lng2);
    const diff = bearingDiff(b1, b2);

    if (diff >= thresholdDeg) {
      hazards.push({
        type: "sharp_turn",
        label: turnLabel(diff),
        severity: severityFromAngle(diff),
        angleDeg: Math.round(diff),
        lat: lat1,
        lng: lng1,
        coordIndex: i,
        heading: Math.round(b2),
        description: `${turnLabel(diff)} of ${Math.round(diff)}° — requires attention and reduced speed.`,
        tip: `Slow down before this turn and stay in the correct lane.`,
      });
    }
  }
  return hazards;
}

/* ───────────────── OSRM Step Analysis ───────────────── */

const HAZARDOUS_MANEUVERS = new Set([
  "merge", "fork", "off ramp", "on ramp", "roundabout",
  "rotary", "roundabout turn",
]);

const SHARP_MODIFIERS = new Set(["sharp right", "sharp left", "uturn"]);

/**
 * Analyze OSRM steps for hazardous maneuvers.
 * @param {Array} steps  OSRM route leg steps.
 */
export function analyzeSteps(steps) {
  const hazards = [];
  if (!steps || !steps.length) return hazards;

  steps.forEach((step, idx) => {
    const m = step.maneuver || {};
    const type = (m.type || "").toLowerCase();
    const modifier = (m.modifier || "").toLowerCase();
    const loc = m.location || [0, 0]; // [lng, lat]

    // Sharp modifier on any turn
    if (SHARP_MODIFIERS.has(modifier)) {
      hazards.push({
        type: "sharp_maneuver",
        label: `Sharp ${modifier.replace("sharp ", "")} turn`,
        severity: modifier === "uturn" ? "high" : "high",
        lat: loc[1],
        lng: loc[0],
        stepIndex: idx,
        heading: Math.round(m.bearing_after || 0),
        description: `Navigation requires a ${modifier} — easy to miss or execute late.`,
        tip: `Prepare early. Signal and reduce speed well before this maneuver.`,
        road: step.name || "unnamed road",
        instruction: step.maneuver?.instruction || step.name || "",
      });
    }

    // Hazardous maneuver types
    if (HAZARDOUS_MANEUVERS.has(type)) {
      let desc, tip, sev;
      if (type === "merge") {
        desc = `Merge onto ${step.name || "road"} — check speed and blind spots.`;
        tip = `Match traffic speed and find your gap early.`;
        sev = "medium";
      } else if (type === "fork") {
        desc = `Road forks — choose the correct branch for your destination.`;
        tip = `Read signs early and commit to your lane before the fork.`;
        sev = "medium";
      } else if (type === "off ramp" || type === "on ramp") {
        desc = `Highway ${type.replace("_", " ")} — lane change under speed.`;
        tip = `Signal early and adjust speed for the ramp.`;
        sev = "medium";
      } else {
        desc = `Roundabout or rotary — multiple exits, easy to pick the wrong one.`;
        tip = `Know your exit number before entering.`;
        sev = "medium";
      }

      hazards.push({
        type: type.replace(" ", "_"),
        label: type.charAt(0).toUpperCase() + type.slice(1),
        severity: sev,
        lat: loc[1],
        lng: loc[0],
        stepIndex: idx,
        heading: Math.round(m.bearing_after || 0),
        description: desc,
        tip: tip,
        road: step.name || "",
        instruction: step.maneuver?.instruction || "",
      });
    }
  });

  return hazards;
}

/* ───────────────── Decision Cluster Detection ───────────────── */

/**
 * Find areas where many turns occur within a short distance.
 */
export function detectClusters(coords, steps, radiusM = 200) {
  const hazards = [];
  if (!steps || steps.length < 3) return hazards;

  for (let i = 0; i < steps.length; i++) {
    const locA = steps[i].maneuver?.location;
    if (!locA) continue;
    let count = 0;
    for (let j = i + 1; j < steps.length; j++) {
      const locB = steps[j].maneuver?.location;
      if (!locB) continue;
      if (haversine(locA[1], locA[0], locB[1], locB[0]) <= radiusM) {
        count++;
      } else {
        break;
      }
    }
    if (count >= 3) {
      hazards.push({
        type: "decision_cluster",
        label: "Complex intersection area",
        severity: "high",
        lat: locA[1],
        lng: locA[0],
        stepIndex: i,
        heading: Math.round(steps[i].maneuver?.bearing_after || 0),
        description: `${count + 1} maneuvers within ${radiusM}m — high cognitive load zone.`,
        tip: `Drive slowly and read all signs carefully in this area.`,
      });
      i += count; // skip ahead past cluster
    }
  }
  return hazards;
}

/* ───────────────── Deduplication ───────────────── */

function dedup(hazards, minDistM = 60) {
  const kept = [];
  for (const h of hazards) {
    const dominated = kept.some(k =>
      haversine(k.lat, k.lng, h.lat, h.lng) < minDistM &&
      severityRank(k.severity) >= severityRank(h.severity)
    );
    if (!dominated) kept.push(h);
  }
  return kept;
}

function severityRank(s) {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

/* ───────────────── Main Entry Point ───────────────── */

/**
 * Scan a route for hazards.
 * @param {Array<[number,number]>} coords  GeoJSON coordinates [lng, lat].
 * @param {Array} steps  OSRM route leg steps.
 * @returns {{ hazards: Array, summary: object }}
 */
export function scanRoute(coords, steps) {
  const sharpTurns = detectSharpTurns(coords, 40);
  const stepHazards = analyzeSteps(steps);
  const clusters = detectClusters(coords, steps);

  let all = [...sharpTurns, ...stepHazards, ...clusters];
  all = dedup(all);

  // Sort by position along route (coordIndex or stepIndex)
  all.sort((a, b) => (a.coordIndex || a.stepIndex || 0) - (b.coordIndex || b.stepIndex || 0));

  // Assign IDs
  all.forEach((h, i) => { h.id = `hazard_${i}`; });

  const summary = {
    total: all.length,
    high: all.filter(h => h.severity === "high").length,
    medium: all.filter(h => h.severity === "medium").length,
    low: all.filter(h => h.severity === "low").length,
  };

  return { hazards: all, summary };
}
