const fs = require('node:fs');
const p = 'src/renderer/src/pages/tabs/PartsTab.tsx';
let s = fs.readFileSync(p, 'utf8');

// Delete the local NativePrice + OffersTable: from their doc comment to just before ChevronIcon.
const start = s.indexOf('/**\n * The cheapest offer for a part, in the store\'s own currency.');
const end = s.indexOf('function ChevronIcon(');
if (start < 0 || end < 0 || end <= start) { console.log('markers not found', start, end); process.exit(1); }
s = s.slice(0, start) + s.slice(end);

// Import the shared components.
s = s.replace(
  "import PartThumb from '../../components/PartThumb'",
  "import PartThumb from '../../components/PartThumb'\nimport { BestPrice, OffersTable } from '../../components/OffersTable'"
);

// NativePrice is now BestPrice.
s = s.replace('<NativePrice offer={best} />', '<BestPrice offer={best} />');

fs.writeFileSync(p, s, 'utf8');
console.log('PartsTab now ' + s.length + ' chars');
