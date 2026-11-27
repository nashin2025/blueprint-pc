const type = 'sop';
const pinCount = 8;
const pitch = 1.27;
const bodyW = 4.4;
const bodyH = 6.0;
const padW = 0.6;
const padL = 1.2;
const clearance = 0;

console.log('type:', JSON.stringify(type));
console.log('type === "sop":', type === 'sop');
console.log('type === "dip":', type === 'dip');
console.log('type === "sop" || type === "dip":', type === 'sop' || type === 'dip');

if (type === 'sop' || type === 'dip') {
  const perSide = pinCount / 2;
  const span = (perSide - 1) * pitch;
  const startY = -span / 2;
  const sideOffset = bodyW / 2 + clearance + padW / 2;
  const pads = [];
  for (let i = 0; i < perSide; i++) {
    const y = startY + i * pitch;
    pads.push({ id: 'p' + (i + 1), x: -sideOffset, y, w: padW, h: padL, shape: 'rect' });
    pads.push({ id: 'p' + (perSide + i + 1), x: sideOffset, y, w: padW, h: padL, shape: 'rect' });
  }
  console.log('pads.length:', pads.length);
}