const fs = require('node:fs');
const p = 'src/main/offers-parse.ts';
let s = fs.readFileSync(p, 'utf8');
const before = s.length;

// Remove the parseWalmart block: from its doc comment to the closing brace before the next doc comment.
const start = s.indexOf('/**\n * Walmart renders');
const marker = '/** Words too generic to prove a match';
const end = s.indexOf(marker);
if (start < 0 || end < 0 || end <= start) { console.log('markers not found', start, end); process.exit(1); }
s = s.slice(0, start) + s.slice(end);

// Remove the now-unused price regex.
s = s.replace(/const PRICE_RE = [^\\n]*\n\n/, '');

fs.writeFileSync(p, s, 'utf8');
console.log('removed ' + (before - s.length) + ' chars');
