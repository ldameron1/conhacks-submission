import { scanRoute } from '../hazard-scanner.js';
import { scanAccidents } from '../accident-scanner.js';

async function test() {
  const origin = { lat: 42.6669, lng: -83.3986 }; // Waterford
  const dest = { lat: 42.6875, lng: -83.2341 }; // Auburn Hills
  const route = await fetch('https://router.project-osrm.org/route/v1/driving/-83.3986,42.6669;-83.2341,42.6875?overview=full&geometries=geojson&steps=true&annotations=true').then(r=>r.json());
  
  const steps = route.routes[0].legs[0].steps;
  const coords = route.routes[0].geometry.coordinates;
  
  const result = scanRoute(coords, steps);
  console.log('Geometry hazards:', result.summary);
  
  const { hazards: osmHazards } = await scanAccidents(coords);
  console.log('OSM hazards count:', osmHazards.length);
  
  const types = osmHazards.map(h => h.type).reduce((acc, val) => { acc[val] = (acc[val] || 0) + 1; return acc; }, {});
  console.log('OSM types:', types);
}
test().catch(console.error);
