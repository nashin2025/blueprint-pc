import Database from 'better-sqlite3'
import { join } from 'node:path'
import { dataDir } from '../paths'

/**
 * The local parts catalogue.
 *
 * A mirror of a public catalogue, kept on this machine so that looking up a part
 * never waits on someone else's server. It is a cache with a memory: rows are
 * added on a schedule, and anything the source stops serving stays put until it
 * is explicitly pruned.
 *
 * In practice the source exposes no per-part change dates, so a sync imports
 * parts we do not yet hold and leaves existing rows untouched rather than
 * re-fetching them. Re-fetching a part would need an explicit refresh path.
 *
 * SQLite rather than JSON because the point of having 6,000 parts is to search
 * them, and a flat file makes every search a full scan of a 10 MB document.
 */

export interface PartPin {
  type: string | null
  label: string
  voltage: string | null
  function: string | null
  required: boolean
  connectsTo: string | null
}

export interface PartRecord {
  slug: string
  name: string
  brand: string | null
  partNumber: string | null
  description: string | null
  category: string | null
  priceText: string | null
  priceValue: number | null
  priceCurrency: string | null
  url: string | null
  image: string | null
  pinout: PartPin[]
  lastmod: string | null
  fetchedAt: number
  /** Direct URL to a 3D model file (.stl, .obj, .gltf, .glb), discovered from
   *  SnapEDA or pasted by the user. */
  modelUrl: string | null
  /** Local filesystem path to a downloaded copy of the model file, if the app
   *  has downloaded it. Three.js loads from this path (file://) when present. */
  modelFilePath: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS parts (
  slug           TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  brand          TEXT,
  part_number    TEXT,
  description    TEXT,
  category       TEXT,
  price_text     TEXT,
  price_value    REAL,
  price_currency TEXT,
  url            TEXT,
  image          TEXT,
  model_url      TEXT,
  model_file_path TEXT,
  lastmod        TEXT,
  fetched_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parts_name     ON parts(name);
CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category);
CREATE INDEX IF NOT EXISTS idx_parts_brand    ON parts(brand);

CREATE TABLE IF NOT EXISTS pins (
  part_slug TEXT    NOT NULL REFERENCES parts(slug) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  type      TEXT,
  label     TEXT,
  voltage   TEXT,
  function  TEXT,
  required  INTEGER,
  connects_to TEXT,
  PRIMARY KEY (part_slug, position)
);

CREATE TABLE IF NOT EXISTS part_groups (
  part_slug TEXT NOT NULL REFERENCES parts(slug) ON DELETE CASCADE,
  group_slug TEXT NOT NULL,
  PRIMARY KEY (part_slug, group_slug)
);

CREATE INDEX IF NOT EXISTS idx_groups_group ON part_groups(group_slug);

CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`

let db: Database.Database | null = null

/** The one connection, opened on first use. */
export function database(): Database.Database {
  if (db) return db

  db = new Database(join(dataDir(), 'catalogue.db'))
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)
  migrate(db)
  return db
}

/** One-time migration: add model_url and model_file_path columns. */
function migrate(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(parts)").all() as { name: string }[]
  if (!cols.some((c) => c.name === 'model_url')) {
    db.exec('ALTER TABLE parts ADD COLUMN model_url TEXT')
  }
  if (!cols.some((c) => c.name === 'model_file_path')) {
    db.exec('ALTER TABLE parts ADD COLUMN model_file_path TEXT')
  }
}

export function getState(key: string): string | null {
  const row = database().prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setState(key: string, value: string): void {
  database()
    .prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

/** Writes one part and its pins in a single transaction. */
export function savePart(part: PartRecord): void {
  const conn = database()
  const run = conn.transaction((p: PartRecord) => {
    conn
      .prepare(
        `INSERT INTO parts
           (slug, name, brand, part_number, description, category, price_text,
            price_value, price_currency, url, image, model_url, model_file_path, lastmod, fetched_at)
          VALUES
            (@slug, @name, @brand, @partNumber, @description, @category, @priceText,
             @priceValue, @priceCurrency, @url, @image, @modelUrl, @modelFilePath, @lastmod, @fetchedAt)
          ON CONFLICT(slug) DO UPDATE SET
            name = excluded.name,
            brand = excluded.brand,
            part_number = excluded.part_number,
            description = excluded.description,
            category = excluded.category,
            price_text = excluded.price_text,
            price_value = excluded.price_value,
            price_currency = excluded.price_currency,
            url = excluded.url,
            image = excluded.image,
            model_url = excluded.model_url,
            model_file_path = excluded.model_file_path,
            lastmod = excluded.lastmod,
            fetched_at = excluded.fetched_at`
      )
      .run({
        slug: p.slug,
        name: p.name,
        brand: p.brand,
        partNumber: p.partNumber,
        description: p.description,
        category: p.category,
        priceText: p.priceText,
        priceValue: p.priceValue,
        priceCurrency: p.priceCurrency,
        url: p.url,
        image: p.image,
        modelUrl: p.modelUrl,
        modelFilePath: p.modelFilePath,
        lastmod: p.lastmod,
        fetchedAt: p.fetchedAt
      })

    conn.prepare('DELETE FROM pins WHERE part_slug = ?').run(p.slug)
    const insertPin = conn.prepare(
      `INSERT INTO pins (part_slug, position, type, label, voltage, function, required, connects_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    p.pinout.forEach((pin, i) => {
      insertPin.run(p.slug, i, pin.type, pin.label, pin.voltage, pin.function, pin.required ? 1 : 0, pin.connectsTo)
    })
  })
  run(part)
}

export function getPart(slug: string): PartRecord | null {
  const conn = database()
  const row = conn.prepare('SELECT * FROM parts WHERE slug = ?').get(slug) as
    | Record<string, unknown>
    | undefined
  if (!row) return null

  const pins = conn
    .prepare('SELECT type, label, voltage, function, required, connects_to FROM pins WHERE part_slug = ? ORDER BY position')
    .all(slug) as {
    type: string | null
    label: string
    voltage: string | null
    function: string | null
    required: number
    connects_to: string | null
  }[]

  return {
    slug: String(row.slug),
    name: String(row.name),
    brand: (row.brand as string) ?? null,
    partNumber: (row.part_number as string) ?? null,
    description: (row.description as string) ?? null,
    category: (row.category as string) ?? null,
    priceText: (row.price_text as string) ?? null,
    priceValue: (row.price_value as number) ?? null,
    priceCurrency: (row.price_currency as string) ?? null,
    url: (row.url as string) ?? null,
    image: (row.image as string) ?? null,
    modelUrl: (row.model_url as string) ?? null,
    modelFilePath: (row.model_file_path as string) ?? null,
    lastmod: (row.lastmod as string) ?? null,
    fetchedAt: Number(row.fetched_at),
    pinout: pins.map((p) => ({
      type: p.type,
      label: p.label,
      voltage: p.voltage,
      function: p.function,
      required: p.required === 1,
      connectsTo: p.connects_to
    }))
  }
}

export interface PartSummary {
  slug: string
  name: string
  brand: string | null
  category: string | null
  priceText: string | null
  hasDescription: boolean
  pinCount: number
}

/** Free-text search over name, brand and part number, best-effort ranked. */
export function searchParts(query: string, limit = 20): PartSummary[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 6)
  if (words.length === 0) return []

  const conn = database()
  const clauses: string[] = []
  const params: unknown[] = []
  for (const word of words) {
    clauses.push('(LOWER(name) LIKE ? OR LOWER(COALESCE(brand,\'\')) LIKE ? OR LOWER(COALESCE(part_number,\'\')) LIKE ?)')
    const like = `%${word}%`
    params.push(like, like, like)
  }

  const rows = conn
    .prepare(
      `SELECT p.slug, p.name, p.brand, p.category, p.price_text,
              (p.description IS NOT NULL) AS has_description,
              (SELECT COUNT(*) FROM pins WHERE part_slug = p.slug) AS pin_count,
              p.fetched_at
       FROM parts p
       WHERE ${clauses.join(' AND ')}
       ORDER BY
         CASE WHEN LOWER(p.name) = ? THEN 0 ELSE 1 END,
         LENGTH(p.name)
       LIMIT ?`
    )
    .all(...params, words[0], limit) as {
    slug: string
    name: string
    brand: string | null
    category: string | null
    price_text: string | null
    has_description: number
    pin_count: number
    fetched_at: number
  }[]

  // SQLite returns snake_case column names; map them to the camelCase shape
  // the renderer expects. A cast alone would silently leave these undefined.
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    brand: r.brand,
    category: r.category,
    priceText: r.price_text,
    hasDescription: r.has_description === 1,
    pinCount: r.pin_count,
    fetchedAt: r.fetched_at
  }))
}

export function countParts(): number {
  const row = database().prepare('SELECT COUNT(*) AS n FROM parts').get() as { n: number }
  return row.n
}

/** Every slug the local mirror already knows, for diffing against the source. */
export function knownSlugs(): Set<string> {
  const rows = database().prepare('SELECT slug FROM parts').all() as { slug: string }[]
  return new Set(rows.map((r) => r.slug))
}

/** Source change dates for parts we hold, so a sync can skip the unchanged. */
export function lastmods(): Map<string, string | null> {
  const rows = database().prepare('SELECT slug, lastmod FROM parts').all() as {
    slug: string
    lastmod: string | null
  }[]
  return new Map(rows.map((r) => [r.slug, r.lastmod]))
}

/** Parts whose cached data is older than `maxAgeDays`, for staleness UI. */
export function staleParts(maxAgeDays: number): Array<{ slug: string; name: string; fetchedAt: number }> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  const rows = database()
    .prepare('SELECT slug, name, fetched_at FROM parts WHERE fetched_at < ? ORDER BY fetched_at ASC')
    .all(cutoff) as { slug: string; name: string; fetched_at: number }[]
  return rows.map((r) => ({ slug: r.slug, name: r.name, fetchedAt: r.fetched_at }))
}

export function recordGroups(mapping: { slug: string; group: string }[]): number {
  const conn = database()
  const insert = conn.prepare(
    'INSERT OR REPLACE INTO part_groups (part_slug, group_slug) VALUES (?, ?)'
  )
  let n = 0
  const run = conn.transaction((rows: { slug: string; group: string }[]) => {
    for (const row of rows) {
      insert.run(row.slug, row.group)
      n++
    }
  })
  run(mapping)
  return n
}

/** Save just the discovered model URL for a part (does not touch other fields). */
export function saveModelUrl(slug: string, modelUrl: string): void {
  database()
    .prepare('UPDATE parts SET model_url = ? WHERE slug = ?')
    .run(modelUrl, slug)
}

/** Look up a saved model URL and local file path by part name or part number,
 *  for populating project components from the catalogue after a sync + CAD
 *  discovery run. Returns the first match (exact name first, then part number,
 *  then fuzzy name contains). */
export interface ModelLookup {
  modelUrl: string | null
  modelFilePath: string | null
}

export function lookupModel(name: string, partNumber?: string): ModelLookup {
  const conn = database()
  const trimmed = name.trim()
  const empty: ModelLookup = { modelUrl: null, modelFilePath: null }
  if (!trimmed) return empty

  // 1. Exact name match
  const exact = conn
    .prepare(
      `SELECT model_url, model_file_path FROM parts WHERE LOWER(name) = LOWER(?) AND model_url IS NOT NULL LIMIT 1`
    )
    .get(trimmed) as { model_url: string; model_file_path: string | null } | undefined
  if (exact) return { modelUrl: exact.model_url, modelFilePath: exact.model_file_path ?? null }

  // 2. Exact part number match
  if (partNumber) {
    const byPn = conn
      .prepare(
        `SELECT model_url, model_file_path FROM parts WHERE LOWER(part_number) = LOWER(?) AND model_url IS NOT NULL LIMIT 1`
      )
      .get(partNumber) as { model_url: string; model_file_path: string | null } | undefined
    if (byPn) return { modelUrl: byPn.model_url, modelFilePath: byPn.model_file_path ?? null }
  }

  // 3. Name contains (fuzzy) match
  const contains = conn
    .prepare(
      `SELECT model_url, model_file_path FROM parts WHERE LOWER(name) LIKE LOWER(?) AND model_url IS NOT NULL LIMIT 1`
    )
    .get(`%${trimmed}%`) as { model_url: string; model_file_path: string | null } | undefined
  if (contains)
    return { modelUrl: contains.model_url, modelFilePath: contains.model_file_path ?? null }

  return empty
}

/** Slugs of CAD-worthy parts that still have no model URL, for bulk discovery. */
export function partsWithoutModelUrl(category?: string): string[] {
  const conn = database()
  if (category) {
    const rows = conn
      .prepare(
        `SELECT slug FROM parts WHERE model_url IS NULL AND LOWER(category) = LOWER(?) ORDER BY name`
      )
      .all(category) as { slug: string }[]
    return rows.map((r) => r.slug)
  }
  const rows = conn
    .prepare('SELECT slug FROM parts WHERE model_url IS NULL ORDER BY name')
    .all() as { slug: string }[]
  return rows.map((r) => r.slug)
}

/** Save the local file path for a downloaded model. */
export function saveModelFilePath(slug: string, modelFilePath: string): void {
  database()
    .prepare('UPDATE parts SET model_file_path = ? WHERE slug = ?')
    .run(modelFilePath, slug)
}

/** Save the local file path keyed by model URL (used when we don't have a slug). */
export function saveModelFilePathByUrl(modelUrl: string, modelFilePath: string): void {
  database()
    .prepare('UPDATE parts SET model_file_path = ? WHERE model_url = ?')
    .run(modelFilePath, modelUrl)
}