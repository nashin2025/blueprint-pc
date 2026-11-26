const fs = require('node:fs');
const t = fs.readFileSync('src/shared/types.ts','utf8');
const i = t.indexOf('InfoRequest');
console.log(t.slice(i - 100, i + 400));
