import { generateLandPattern } from '../src/main/footprint-generator.ts';

console.log('Testing generateLandPattern directly:');
const fp = generateLandPattern('sop', { pinCount: 8, pitch: 1.27, bodyWidth: 4.4, bodyHeight: 6.0, padWidth: 0.6, padLength: 1.2 });
console.log('name:', JSON.stringify(fp.name));
console.log('pads.length:', fp.pads.length);
if (fp.pads.length > 0) {
  console.log('first pad:', fp.pads[0]);
}