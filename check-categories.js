const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\Nashin\\AppData\\Roaming\\blueprint-pc\\data\\catalogue.db');
const rows = db.prepare('SELECT LOWER(category) as cat, COUNT(*) as n FROM parts GROUP BY LOWER(category) ORDER BY n DESC').all();
for (const r of rows) {
  console.log(r.cat, '=>', r.n);
}
db.close();
