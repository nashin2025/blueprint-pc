const fs = require('node:fs');
const t = fs.readFileSync('src/renderer/src/lib/partArt.ts','utf8');
const i = t.indexOf('ALL_CATEGORIES');
console.log(t.slice(i - 200, i + 900));
