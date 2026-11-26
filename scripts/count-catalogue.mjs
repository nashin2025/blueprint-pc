// Counts parts in each catalogue database so we can see sync progress.
// Run: node scripts/count-catalogue.mjs

import Database from 'better-sqlite3'
import path from 'node:path'

const targets = [
  ['DEV (blueprint-pc)', path.join(process.env.APPDATA, 'blueprint-pc', 'data', 'catalogue.db')],
  ['PACKAGED (Blueprint PC)', path.join(process.env.APPDATA, 'Blueprint PC', 'data', 'catalogue.db')]
]

for (const [label, file] of targets) {
  try {
    const db = new Database(file, { readonly: true })
    const parts = db.prepare('SELECT COUNT(*) n FROM parts').get().n
    const pins = db.prepare('SELECT COUNT(*) n FROM pins').get().n
    const synced = db.prepare("SELECT value FROM sync_state WHERE key = 'last_sync_at'").get()
    db.close()
    const when = synced ? ', last sync ' + new Date(Number(synced.value)).toLocaleString() : ''
    console.log(`${label}: ${parts} parts, ${pins} pin rows${when}`)
  } catch (e) {
    console.log(`${label}: (no database yet)`)
  }
}