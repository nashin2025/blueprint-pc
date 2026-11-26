const fs = require('node:fs');
const t = fs.readFileSync('src/shared/types.ts','utf8');
const i = t.indexOf('export interface Component');
console.log(t.slice(i, i + 1200));
