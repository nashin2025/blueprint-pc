const { app } = require('electron');
app.whenReady().then(() => {
  try {
    const D = require('better-sqlite3');
    const db = new D(':memory:');
    db.exec('CREATE TABLE t(a)');
    console.log('ELECTRON LOAD OK, sqlite', db.prepare('select sqlite_version() v').get().v);
  } catch (e) {
    console.log('ELECTRON LOAD FAILED:', e.message.split('\n')[0]);
  }
  app.quit();
});
