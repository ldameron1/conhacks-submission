import { scanRoute } from '../hazard-scanner.js';
import { scanAccidents } from '../accident-scanner.js';

try {
  console.log('Testing scanRoute...');
  const result = scanRoute([[0,0], [0,1]], [{ maneuver: { location: [0,0] } }]);
  console.log('scanRoute success:', result.summary);

  console.log('Testing scanAccidents...');
  const acc = await scanAccidents([[0,0], [0,1]]);
  console.log('scanAccidents success:', acc.hazards.length);
} catch (err) {
  console.error('ERROR:', err);
}
