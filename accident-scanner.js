/**
 * Accident / Real-World Hazard Scanner — Overpass API Integration
 *
 * Queries OpenStreetMap via the Overpass API for real-world traffic
 * hazards near the computed route: traffic signals, stop signs, pedestrian
 * crossings, traffic calming, poor surfaces, etc.
 *
 * These are merged into the hazard list as a separate data layer so the
 * rehearsal reflects actual road conditions, not just geometry.
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/* ─────────────── Geo helpers ─────────────── */

function toRad(d) { return d * Math.PI / 180; }

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Distance from a point to the nearest route segment (perpendicular or endpoint). */
function distanceToRoute(point, routeCoords) {
  let min = Infinity;
  const px = point.lon, py = point.lat;
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const [lng1, lat1] = routeCoords[i];
    const [lng2, lat2] = routeCoords[i + 1];
    // Project point onto segment (treat lon/lat as 2D Euclidean; fine for <1km segments)
    const dx = lng2 - lng1;
    const dy = lat2 - lat1;
    const segLenSq = dx * dx + dy * dy;
    let t = segLenSq === 0 ? 0 : ((px - lng1) * dx + (py - lat1) * dy) / segLenSq;
    t = Math.max(0, Math.min(1, t));
    const projLng = lng1 + t * dx;
    const projLat = lat1 + t * dy;
    min = Math.min(min, haversine(py, px, projLat, projLng));
  }
  // Also check endpoints in case route is a single point
  if (routeCoords.length === 1) {
    const [lng, lat] = routeCoords[0];
    min = Math.min(min, haversine(py, px, lat, lng));
  }
  return min;
}

function bboxFromRoute(coords, bufferDeg = 0.002) {
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const [lng, lat] of coords) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return `${minLat - bufferDeg},${minLng - bufferDeg},${maxLat + bufferDeg},${maxLng + bufferDeg}`;
}

/* ─────────────── Overpass query builder ─────────────── */

function buildQuery(bbox) {
  return `
    [out:json][timeout:25];
    (
      node["highway"="traffic_signals"](${bbox});
      node["highway"="stop"](${bbox});
      node["highway"="give_way"](${bbox});
      node["traffic_calming"](${bbox});
      node["hazard"](${bbox});
      way["traffic_calming"](${bbox});
      way["surface"~"gravel|unpaved|dirt|mud|sand|compacted"](${bbox});
      way["maxspeed"~"^[1-3][0-9]$"](${bbox});
      way["tunnel"="yes"](${bbox});
    );
    out body center;
  `;
}

/* ─────────────── Element parsers ─────────────── */

function parseElement(el, lat, lon, dist) {
  const tags = el.tags || {};

  if (tags.highway === "traffic_signals") {
    return {
      type: "traffic_signal",
      label: "Traffic Light",
      severity: "low",
      lat,
      lng: lon,
      distance: Math.round(dist),
      description: "Traffic-controlled intersection ahead.",
      tip: "Watch for stale green lights and prepare to stop if yellow.",
      source: "overpass",
    };
  }

  if (tags.highway === "stop") {
    return {
      type: "stop_sign",
      label: "Stop Sign",
      severity: "medium",
      lat,
      lng: lon,
      distance: Math.round(dist),
      description: "Stop sign ahead — full stop required.",
      tip: "Come to a complete stop and check for cross traffic before proceeding.",
      source: "overpass",
    };
  }

  if (tags.highway === "give_way") {
    return {
      type: "yield",
      label: "Yield / Give Way",
      severity: "medium",
      lat,
      lng: lon,
      distance: Math.round(dist),
      description: "Yield sign ahead — give way to cross traffic.",
      tip: "Slow down and be prepared to stop if cross traffic is present.",
      source: "overpass",
    };
  }

  if (tags.traffic_calming) {
    return {
      type: "traffic_calming",
      label: `Traffic Calming (${tags.traffic_calming.replace(/_/g, " ")})`,
      severity: "low",
      lat,
      lng: lon,
      distance: Math.round(dist),
      description: `Traffic calming measure: ${tags.traffic_calming.replace(/_/g, " ")}. Expect speed reduction.`,
      tip: "Reduce speed and watch for pedestrians or cyclists.",
      source: "overpass",
    };
  }

  if (tags.hazard) {
    return {
      type: "osm_hazard",
      label: `Hazard: ${tags.hazard}`,
      severity: "high",
      lat,
      lng: lon,
      distance: Math.round(dist),
      description: `Reported hazard in OpenStreetMap: ${tags.hazard}`,
      tip: "Proceed with extreme caution in this area.",
      source: "overpass",
    };
  }

  if (tags.tunnel === "yes") {
    return {
      type: "tunnel",
      label: "Tunnel",
      severity: "medium",
      lat,
      lng: lon,
      distance: Math.round(dist),
      description: "Tunnel ahead — reduced visibility, possible GPS loss, and changing conditions.",
      tip: "Remove sunglasses, turn on headlights, maintain lane position, and avoid stopping.",
      source: "overpass",
    };
  }

  if (tags.surface && /gravel|unpaved|dirt|mud|sand|compacted/.test(tags.surface)) {
    return {
      type: "poor_surface",
      label: "Poor Road Surface",
      severity: "medium",
      lat,
      lng: lon,
      distance: Math.round(dist),
      description: `Road surface is ${tags.surface}. Traction and visibility may be reduced.`,
      tip: "Reduce speed and increase following distance.",
      source: "overpass",
    };
  }

  if (tags.maxspeed && parseInt(tags.maxspeed) <= 30) {
    return {
      type: "speed_zone",
      label: `Speed Limit ${tags.maxspeed}`,
      severity: "low",
      lat,
      lng: lon,
      distance: Math.round(dist),
      description: `Low speed zone: ${tags.maxspeed}. Often near schools or residential areas.`,
      tip: "Watch for children, cyclists, and parked cars.",
      source: "overpass",
    };
  }

  return null;
}

/* ─────────────── Public API ─────────────── */

/**
 * Scan the route for real-world hazards using the Overpass API.
 * @param {Array<[number,number]>} coords  GeoJSON [lng,lat] route coordinates.
 * @returns {Promise<{hazards:Array, excluded:Array}>}  On-route hazards + nearby excluded features.
 */
export async function scanAccidents(coords) {
  if (!coords || coords.length < 2) return { hazards: [], excluded: [] };

  const bbox = bboxFromRoute(coords);
  const query = buildQuery(bbox);

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!res.ok) {
      throw new Error(`Overpass HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.elements) return { hazards: [], excluded: [] };

    const hazards = [];
    const excluded = []; // features found by Overpass but too far from route
    for (const el of data.elements) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) continue;

      const dist = distanceToRoute({ lat, lon }, coords);
      const h = parseElement(el, lat, lon, dist);
      if (!h) continue;
      h.source = "overpass";

      // Tunnels are large infrastructure and must be directly on the route
      const threshold = h.type === "tunnel" ? 20 : 30;
      if (dist <= threshold) {
        hazards.push(h); // on or immediately adjacent to the route
      } else if (dist <= 120) {
        excluded.push(h); // in query area but likely on parallel road / detour
      }
    }

    // Deduplicate by location (within 25 m)
    const deduped = [];
    for (const h of hazards) {
      const tooClose = deduped.some(
        (d) => haversine(h.lat, h.lng, d.lat, d.lng) < 25
      );
      if (!tooClose) deduped.push(h);
    }

    return { hazards: deduped, excluded };
  } catch (e) {
    console.warn("[AccidentScanner] Overpass query failed:", e.message);
    return { hazards: [], excluded: [] };
  }
}
