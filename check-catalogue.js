const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\Nashin\\AppData\\Roaming\\blueprint-pc\\data\\catalogue.db');
try {
  db.exec('ALTER TABLE parts ADD COLUMN model_url TEXT');
  console.log('Added model_url column');
} catch (e) {
  console.log('Column may already exist:', e.message);
}
console.log('Total:', db.prepare('SELECT COUNT(*) as n FROM parts').get().n);
console.log('Has model:', db.prepare('SELECT COUNT(*) as n FROM parts WHERE model_url IS NOT NULL').get().n);
console.log('No model:', db.prepare('SELECT COUNT(*) as n FROM parts WHERE model_url IS NULL').get().n);
console.log('CAD no model:', db.prepare("SELECT COUNT(*) as n FROM parts WHERE model_url IS NULL AND LOWER(category) IN ('microcontroller','sensor','actuator','power','display','connector','structure')").get().n);
db.close();
