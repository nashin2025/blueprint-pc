const fs = require('node:fs');
const s = JSON.parse(fs.readFileSync('C:/Users/Nashin/AppData/Roaming/blueprint-pc/data/settings.json','utf8'));
const redact = (o) => Object.fromEntries(Object.entries(o).map(([k,v]) => [k, /key|token|secret/i.test(k) ? (v ? '<set>' : '<empty>') : v]));
console.log(JSON.stringify(redact(s), null, 1));
