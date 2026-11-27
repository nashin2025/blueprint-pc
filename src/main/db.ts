import Database from 'better-sqlite3'
import { join } from 'node:path'
import { dataDir } from './paths'
import type { Project, DesignSpec, Component, Connection, AssemblyStep, ChatMessage, DesignVersion } from '@shared/types'

/**
 * Project database.
 *
 * Replaces the flat projects.json file with a normalized SQLite database so
 * that projects, components, pins, connections and versions can be queried
 * individually without loading every project into memory.
 *
 * The store.ts interface is unchanged so IPC handlers and renderer code
 * continue to work. Data is decomposed into tables on write and reconstructed
 * into Project objects on read.
 */

const FILE_NAME = 'projects.db'

function filePath(): string {
  return join(dataDir(), FILE_NAME)
}

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_specs (
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  summary        TEXT NOT NULL,
  difficulty     TEXT NOT NULL,
  estimated_time TEXT,
  estimated_cost REAL,
  image_file     TEXT,
  info_summary   TEXT,
  PRIMARY KEY (project_id)
);

CREATE TABLE IF NOT EXISTS project_components (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  part_name        TEXT,
  category         TEXT NOT NULL,
  subcategory      TEXT,
  quantity         INTEGER NOT NULL DEFAULT 1,
  unit_price       REAL,
  unit_price_currency TEXT DEFAULT 'USD',
  url              TEXT,
  model_url        TEXT,
  model_file_path  TEXT,
  image_url        TEXT,
  datasheet_url    TEXT,
  designator       TEXT,
  notes            TEXT,
  pins             TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_components_project ON project_components(project_id);
CREATE INDEX IF NOT EXISTS idx_project_components_category ON project_components(category);
CREATE INDEX IF NOT EXISTS idx_project_components_designator ON project_components(designator);

CREATE TABLE IF NOT EXISTS component_pins (
  id             TEXT PRIMARY KEY,
  component_id   TEXT NOT NULL REFERENCES project_components(id) ON DELETE CASCADE,
  pin_number     INTEGER,
  pin_name       TEXT NOT NULL,
  pin_function   TEXT,
  electrical_type TEXT,
  FOREIGN KEY (component_id) REFERENCES project_components(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_component_pins_component ON component_pins(component_id);

CREATE TABLE IF NOT EXISTS connections (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  net_name     TEXT,
  kind         TEXT NOT NULL,
  label        TEXT,
  from_component_id TEXT NOT NULL REFERENCES project_components(id) ON DELETE CASCADE,
  from_pin     TEXT NOT NULL,
  to_component_id  TEXT NOT NULL REFERENCES project_components(id) ON DELETE CASCADE,
  to_pin       TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_connections_project ON connections(project_id);
CREATE INDEX IF NOT EXISTS idx_connections_net ON connections(net_name);

CREATE TABLE IF NOT EXISTS assembly_steps (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_order  INTEGER NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  component_ids TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assembly_steps_project ON assembly_steps(project_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_project ON chat_messages(project_id);

CREATE TABLE IF NOT EXISTS design_versions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  prompt      TEXT,
  spec_snapshot TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_design_versions_project ON design_versions(project_id);

CREATE TABLE IF NOT EXISTS carts (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_carts_project ON carts(project_id);

CREATE TABLE IF NOT EXISTS cart_items (
  id             TEXT PRIMARY KEY,
  cart_id        TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  component_id   TEXT NOT NULL REFERENCES project_components(id) ON DELETE CASCADE,
  quantity       INTEGER NOT NULL DEFAULT 1,
  retailer_url   TEXT,
  lead_time_days INTEGER,
  added_at       INTEGER NOT NULL,
  FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
`

let db: Database.Database | null = null

export function database(): Database.Database {
  if (db) return db

  db = new Database(filePath())
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)
  migrate(db)
  return db
}

function migrate(db: Database.Database): void {
  // Add subcategory column if missing
  const compCols = db.prepare("PRAGMA table_info(project_components)").all() as { name: string }[]
  if (!compCols.some((c) => c.name === 'subcategory')) {
    db.exec('ALTER TABLE project_components ADD COLUMN subcategory TEXT')
  }
  if (!compCols.some((c) => c.name === 'designator')) {
    db.exec('ALTER TABLE project_components ADD COLUMN designator TEXT')
  }
  if (!compCols.some((c) => c.name === 'pins')) {
    db.exec('ALTER TABLE project_components ADD COLUMN pins TEXT NOT NULL DEFAULT \'[]\'')
  }
  if (!compCols.some((c) => c.name === 'unit_price_currency')) {
    db.exec('ALTER TABLE project_components ADD COLUMN unit_price_currency TEXT DEFAULT \'USD\'')
  }
  if (!compCols.some((c) => c.name === 'model_file_path')) {
    db.exec('ALTER TABLE project_components ADD COLUMN model_file_path TEXT')
  }
  if (!compCols.some((c) => c.name === 'datasheet_url')) {
    db.exec('ALTER TABLE project_components ADD COLUMN datasheet_url TEXT')
  }
  if (!compCols.some((c) => c.name === 'image_url')) {
    db.exec('ALTER TABLE project_components ADD COLUMN image_url TEXT')
  }

  // Add pins table columns if missing
  const pinCols = db.prepare("PRAGMA table_info(component_pins)").all() as { name: string }[]
  if (!pinCols.some((c) => c.name === 'pin_number')) {
    db.exec('ALTER TABLE component_pins ADD COLUMN pin_number INTEGER')
  }
  if (!pinCols.some((c) => c.name === 'electrical_type')) {
    db.exec('ALTER TABLE component_pins ADD COLUMN electrical_type TEXT')
  }

  // Add archived column to projects if missing
  const projCols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]
  if (!projCols.some((c) => c.name === 'archived')) {
    db.exec('ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0')
  }

  // Add lead_time_days column to cart_items if missing
  const cartItemCols = db.prepare("PRAGMA table_info(cart_items)").all() as { name: string }[]
  if (!cartItemCols.some((c) => c.name === 'lead_time_days')) {
    db.exec('ALTER TABLE cart_items ADD COLUMN lead_time_days INTEGER')
  }

  // Create cart tables if missing
  const cartCols = db.prepare("PRAGMA table_info(carts)").all() as { name: string }[]
  if (cartCols.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS carts (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_carts_project ON carts(project_id);
      CREATE TABLE IF NOT EXISTS cart_items (
        id             TEXT PRIMARY KEY,
        cart_id        TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
        component_id   TEXT NOT NULL REFERENCES project_components(id) ON DELETE CASCADE,
        quantity       INTEGER NOT NULL DEFAULT 1,
        retailer_url   TEXT,
        added_at       INTEGER NOT NULL,
        FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
    `)
  }
}

/** Decompose a Project into the normalized tables, in a single transaction. */
export function saveProject(project: Project): Project {
  const conn = database()
  const now = Date.now()
  const { spec } = project

  conn.transaction(() => {
    // Upsert project header
    conn.prepare(
      `INSERT INTO projects (id, title, created_at, updated_at, archived)
       VALUES (@id, @title, @createdAt, @updatedAt, @archived)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         updated_at = excluded.updated_at,
         archived = excluded.archived`
    ).run({
      id: project.id,
      title: spec.title,
      createdAt: project.createdAt,
      updatedAt: now,
      archived: project.archived ? 1 : 0
    })

    // Upsert spec
    conn.prepare(
      `INSERT INTO project_specs (project_id, summary, difficulty, estimated_time, estimated_cost, image_file, info_summary)
       VALUES (@projectId, @summary, @difficulty, @estimatedTime, @estimatedCost, @imageFile, @infoSummary)
       ON CONFLICT(project_id) DO UPDATE SET
         summary = excluded.summary,
         difficulty = excluded.difficulty,
         estimated_time = excluded.estimated_time,
         estimated_cost = excluded.estimated_cost,
         image_file = excluded.image_file,
         info_summary = excluded.info_summary`
    ).run({
      projectId: project.id,
      summary: spec.summary,
      difficulty: spec.difficulty,
      estimatedTime: spec.estimatedTime ?? null,
      estimatedCost: spec.estimatedCost ?? null,
      imageFile: spec.imageFile ?? null,
      infoSummary: spec.infoSummary ?? null
    })

    // Replace all components, pins, connections, steps, chat, versions for this project
    conn.prepare('DELETE FROM component_pins WHERE component_id IN (SELECT id FROM project_components WHERE project_id = ?)').run(project.id)
    conn.prepare('DELETE FROM project_components WHERE project_id = ?').run(project.id)
    conn.prepare('DELETE FROM connections WHERE project_id = ?').run(project.id)
    conn.prepare('DELETE FROM assembly_steps WHERE project_id = ?').run(project.id)
    conn.prepare('DELETE FROM chat_messages WHERE project_id = ?').run(project.id)
    conn.prepare('DELETE FROM design_versions WHERE project_id = ?').run(project.id)

    const insertComponent = conn.prepare(
      `INSERT INTO project_components
        (id, project_id, name, part_name, category, subcategory, quantity, unit_price, unit_price_currency,
         url, model_url, model_file_path, image_url, datasheet_url, designator, notes, pins)
       VALUES
        (@id, @projectId, @name, @partName, @category, @subcategory, @quantity, @unitPrice, @unitPriceCurrency,
         @url, @modelUrl, @modelFilePath, @imageUrl, @datasheetUrl, @designator, @notes, @pins)`
    )

    const insertPin = conn.prepare(
      `INSERT INTO component_pins (id, component_id, pin_number, pin_name, pin_function, electrical_type)
       VALUES (@id, @componentId, @pinNumber, @pinName, @pinFunction, @electricalType)`
    )

    const insertConnection = conn.prepare(
      `INSERT INTO connections (id, project_id, net_name, kind, label, from_component_id, from_pin, to_component_id, to_pin)
       VALUES (@id, @projectId, @netName, @kind, @label, @fromComponentId, @fromPin, @toComponentId, @toPin)`
    )

    const insertStep = conn.prepare(
      `INSERT INTO assembly_steps (id, project_id, step_order, title, body, component_ids)
       VALUES (@id, @projectId, @stepOrder, @title, @body, @componentIds)`
    )

    const insertChat = conn.prepare(
      `INSERT INTO chat_messages (id, project_id, role, content, created_at)
       VALUES (@id, @projectId, @role, @content, @createdAt)`
    )

    const insertVersion = conn.prepare(
      `INSERT INTO design_versions (id, project_id, label, created_at, prompt, spec_snapshot)
       VALUES (@id, @projectId, @label, @createdAt, @prompt, @specSnapshot)`
    )

    for (const comp of spec.components) {
      const compId = comp.id
      insertComponent.run({
        id: compId,
        projectId: project.id,
        name: comp.name,
        partName: comp.partName ?? null,
        category: comp.category,
        subcategory: (comp as any).subcategory ?? null,
        quantity: comp.quantity,
        unitPrice: comp.unitPrice ?? null,
        unitPriceCurrency: (comp as any).unitPriceCurrency ?? 'USD',
        url: comp.url ?? null,
        modelUrl: comp.modelUrl ?? null,
        modelFilePath: comp.modelFilePath ?? null,
        imageUrl: comp.image ?? null,
        datasheetUrl: comp.datasheet ?? null,
        designator: (comp as any).designator ?? null,
        notes: comp.notes ?? null,
        pins: JSON.stringify(comp.pins)
      })

      // Store pins as separate rows if they have structure
      comp.pins.forEach((pin, i) => {
        // pins is string[] in current type, but we can store structured data
        insertPin.run({
          id: `${compId}_pin_${i}`,
          componentId: compId,
          pinNumber: null,
          pinName: pin,
          pinFunction: null,
          electricalType: null
        })
      })
    }

    // Build component lookup by id for connection validation
    const compById = new Map(spec.components.map((c) => [c.id, c]))

    for (const conn_ of spec.connections) {
      // Connections already use componentId after normalisation
      const fromComp = compById.get(conn_.from.componentId)
      const toComp = compById.get(conn_.to.componentId)
      if (!fromComp || !toComp) continue

      insertConnection.run({
        id: conn_.id,
        projectId: project.id,
        netName: conn_.net ?? null,
        kind: conn_.kind,
        label: conn_.label ?? null,
        fromComponentId: conn_.from.componentId,
        fromPin: conn_.from.pin,
        toComponentId: conn_.to.componentId,
        toPin: conn_.to.pin
      })
    }

    for (const step of spec.steps) {
      insertStep.run({
        id: step.id,
        projectId: project.id,
        stepOrder: step.order,
        title: step.title,
        body: step.body,
        componentIds: JSON.stringify(step.componentIds)
      })
    }

    for (const msg of project.chat) {
      insertChat.run({
        id: msg.id,
        projectId: project.id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt
      })
    }

    for (const ver of project.versions) {
      insertVersion.run({
        id: ver.id,
        projectId: project.id,
        label: ver.label,
        createdAt: ver.createdAt,
        prompt: ver.prompt ?? null,
        specSnapshot: JSON.stringify(ver.spec)
      })
    }
  })()

  return project
}

/** Load a single project by id, reconstructing from normalized tables. */
export function getProject(id: string): Project | null {
  const conn = database()

  const projRow = conn.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
    | { id: string; title: string; created_at: number; updated_at: number; archived: number }
    | undefined
  if (!projRow) return null

  const specRow = conn.prepare('SELECT * FROM project_specs WHERE project_id = ?').get(id) as
    | { summary: string; difficulty: string; estimated_time: string | null; estimated_cost: number | null; image_file: string | null; info_summary: string | null }
    | undefined
  if (!specRow) return null

  const compRows = conn.prepare('SELECT * FROM project_components WHERE project_id = ? ORDER BY id').all(id) as Array<{
    id: string
    name: string
    part_name: string | null
    category: string
    subcategory: string | null
    quantity: number
    unit_price: number | null
    unit_price_currency: string
    url: string | null
    model_url: string | null
    model_file_path: string | null
    image_url: string | null
    datasheet_url: string | null
    designator: string | null
    notes: string | null
    pins: string
  }>

  const components: Component[] = compRows.map((row) => {
    const comp: any = {
      id: row.id,
      name: row.name,
      category: row.category,
      quantity: row.quantity,
      pins: JSON.parse(row.pins)
    }
    if (row.part_name) comp.partName = row.part_name
    if (row.subcategory) comp.subcategory = row.subcategory
    if (row.unit_price !== null) comp.unitPrice = row.unit_price
    if (row.unit_price_currency) comp.unitPriceCurrency = row.unit_price_currency
    if (row.url) comp.url = row.url
    if (row.model_url) comp.modelUrl = row.model_url
    if (row.model_file_path) comp.modelFilePath = row.model_file_path
    if (row.image_url) comp.image = row.image_url
    if (row.datasheet_url) comp.datasheet = row.datasheet_url
    if (row.designator) comp.designator = row.designator
    if (row.notes) comp.notes = row.notes
    return comp
  })

  // Load structured pins for each component
  for (const comp of components) {
    const pinRows = conn
      .prepare('SELECT pin_name FROM component_pins WHERE component_id = ? ORDER BY pin_number')
      .all(comp.id) as { pin_name: string }[]
    if (pinRows.length > 0) {
      comp.pins = pinRows.map((r) => r.pin_name)
    }
  }

  const connRows = conn.prepare('SELECT * FROM connections WHERE project_id = ?').all(id) as Array<{
    id: string
    net_name: string | null
    kind: string
    label: string | null
    from_component_id: string
    from_pin: string
    to_component_id: string
    to_pin: string
  }>

  // Build component lookup by id
  const compById = new Map(components.map((c) => [c.id, c]))

  const connections: Connection[] = connRows.map((row) => {
    const fromComp = compById.get(row.from_component_id)
    const toComp = compById.get(row.to_component_id)

    return {
      id: row.id,
      from: { componentId: fromComp?.id ?? '', pin: row.from_pin },
      to: { componentId: toComp?.id ?? '', pin: row.to_pin },
      kind: row.kind as 'power' | 'ground' | 'signal' | 'data',
      net: row.net_name ?? undefined,
      label: row.label ?? undefined
    }
  })

  const stepRows = conn.prepare('SELECT * FROM assembly_steps WHERE project_id = ? ORDER BY step_order').all(id) as Array<{
    id: string
    step_order: number
    title: string
    body: string
    component_ids: string
  }>

  const steps: AssemblyStep[] = stepRows.map((row) => ({
    id: row.id,
    order: row.step_order,
    title: row.title,
    body: row.body,
    componentIds: JSON.parse(row.component_ids)
  }))

  const chatRows = conn.prepare('SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at').all(id) as Array<{
    id: string
    role: string
    content: string
    created_at: number
  }>

  const chat: ChatMessage[] = chatRows.map((row) => ({
    id: row.id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    createdAt: row.created_at
  }))

  const verRows = conn.prepare('SELECT * FROM design_versions WHERE project_id = ? ORDER BY created_at').all(id) as Array<{
    id: string
    label: string
    created_at: number
    prompt: string | null
    spec_snapshot: string
  }>

  const versions: DesignVersion[] = verRows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    prompt: row.prompt ?? undefined,
    spec: JSON.parse(row.spec_snapshot) as DesignSpec
  }))

  return {
    id: projRow.id,
    createdAt: projRow.created_at,
    updatedAt: projRow.updated_at,
    archived: projRow.archived === 1,
    spec: {
      title: projRow.title,
      summary: specRow.summary,
      difficulty: specRow.difficulty as 'beginner' | 'intermediate' | 'advanced',
      estimatedTime: specRow.estimated_time ?? undefined,
      estimatedCost: specRow.estimated_cost ?? undefined,
      components,
      connections,
      steps,
      imageFile: specRow.image_file ?? undefined,
      infoSummary: specRow.info_summary ?? undefined
    },
    chat,
    versions
  }
}

/** List all projects, most recently updated first.
 *  Archived projects are excluded unless includeArchived is true. */
export function listProjects(includeArchived = false): Project[] {
  const conn = database()
  const rows = conn
    .prepare(
      includeArchived
        ? 'SELECT id FROM projects ORDER BY updated_at DESC'
        : 'SELECT id FROM projects WHERE archived = 0 ORDER BY updated_at DESC'
    )
    .all() as { id: string }[]

  const projects: Project[] = []
  for (const row of rows) {
    const proj = getProject(row.id)
    if (proj) projects.push(proj)
  }
  return projects
}

/** Delete a project and all its related rows. */
export function deleteProject(id: string): boolean {
  const conn = database()
  const result = conn.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return result.changes > 0
}

/** Archive or unarchive a project (soft delete / restore). */
export function archiveProject(id: string, archived: boolean): boolean {
  const conn = database()
  const result = conn
    .prepare('UPDATE projects SET archived = ? WHERE id = ?')
    .run(archived ? 1 : 0, id)
  return result.changes > 0
}

/** Permanently purge a project and all its related rows (no restore). */
export function purgeProject(id: string): boolean {
  const conn = database()
  const result = conn.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return result.changes > 0
}

/** Save or update a design version for a project. */
export function saveProjectVersion(projectId: string, version: DesignVersion): void {
  const conn = database()
  conn.prepare(
    `INSERT INTO design_versions (id, project_id, label, created_at, prompt, spec_snapshot)
     VALUES (@id, @projectId, @label, @createdAt, @prompt, @specSnapshot)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       created_at = excluded.created_at,
       prompt = excluded.prompt,
       spec_snapshot = excluded.spec_snapshot`
  ).run({
    id: version.id,
    projectId,
    label: version.label,
    createdAt: version.createdAt,
    prompt: version.prompt ?? null,
    specSnapshot: JSON.stringify(version.spec)
  })
}

/** Absolute path of the database file, for the "show data folder" action. */
export function dataFilePath(): string {
  return filePath()
}

/** Migrate existing projects.json into the database, if present. */
export async function migrateFromJson(jsonPath: string): Promise<number> {
  const { existsSync, readFileSync } = await import('node:fs')
  if (!existsSync(jsonPath)) return 0

  try {
    const raw = readFileSync(jsonPath, 'utf-8')
    if (!raw.trim()) return 0
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return 0

    let count = 0
    for (const project of parsed) {
      try {
        saveProject(project as Project)
        count++
      } catch {
        // Skip individual failures
      }
    }
    return count
  } catch {
    return 0
  }
}

/** Get the cart for a project, creating it if it doesn't exist. */
export function getOrCreateCart(projectId: string): { id: string; createdAt: number; updatedAt: number } {
  const conn = database()
  const row = conn.prepare('SELECT * FROM carts WHERE project_id = ?').get(projectId) as
    | { id: string; created_at: number; updated_at: number }
    | undefined
  if (row) return { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at }

  const id = `${projectId}_cart_${Date.now()}`
  const now = Date.now()
  conn.prepare(
    'INSERT INTO carts (id, project_id, created_at, updated_at) VALUES (@id, @projectId, @createdAt, @updatedAt)'
  ).run({ id, projectId, createdAt: now, updatedAt: now })
  return { id, createdAt: now, updatedAt: now }
}

/** Add a component to the cart. If already present, increment quantity. */
export function addToCart(cartId: string, componentId: string, quantity = 1, retailerUrl?: string, leadTimeDays?: number): void {
  const conn = database()
  const now = Date.now()

  // Touch the cart's updated_at
  conn.prepare('UPDATE carts SET updated_at = ? WHERE id = ?').run(now, cartId)

  const existing = conn
    .prepare('SELECT * FROM cart_items WHERE cart_id = ? AND component_id = ?')
    .get(cartId, componentId) as { id: string; quantity: number } | undefined

  if (existing) {
    conn.prepare(
      'UPDATE cart_items SET quantity = quantity + ?, added_at = ? WHERE id = ?'
    ).run(quantity, now, existing.id)
  } else {
    conn.prepare(
      `INSERT INTO cart_items (id, cart_id, component_id, quantity, retailer_url, lead_time_days, added_at)
       VALUES (@id, @cartId, @componentId, @quantity, @retailerUrl, @leadTimeDays, @addedAt)`
    ).run({
      id: `${cartId}_item_${Date.now()}`,
      cartId,
      componentId,
      quantity,
      retailerUrl: retailerUrl ?? null,
      leadTimeDays: leadTimeDays ?? null,
      addedAt: now
    })
  }
}

/** Remove a component from the cart. */
export function removeFromCart(cartId: string, componentId: string): boolean {
  const conn = database()
  const result = conn
    .prepare('DELETE FROM cart_items WHERE cart_id = ? AND component_id = ?')
    .run(cartId, componentId)
  return result.changes > 0
}

/** Clear all items from a cart. */
export function clearCart(cartId: string): void {
  const conn = database()
  conn.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cartId)
}

/** List all items in a cart with component details. */
export interface CartItem {
  id: string
  componentId: string
  componentName: string
  componentPartName: string | null
  quantity: number
  retailerUrl: string | null
  addedAt: number
  unitPrice: number | null
  unitPriceCurrency: string
  leadTimeDays: number | null
}

export function listCartItems(cartId: string): CartItem[] {
  const conn = database()
  const rows = conn
    .prepare(
      `SELECT ci.id, ci.component_id, pc.name, pc.part_name, pc.unit_price, pc.unit_price_currency,
              ci.quantity, ci.retailer_url, ci.lead_time_days, ci.added_at
        FROM cart_items ci
        JOIN project_components pc ON ci.component_id = pc.id
        WHERE ci.cart_id = ?
        ORDER BY ci.added_at`
    )
    .all(cartId) as Array<{
    id: string
    component_id: string
    name: string
    part_name: string | null
    unit_price: number | null
    unit_price_currency: string
    quantity: number
    retailer_url: string | null
    added_at: number
    lead_time_days: number | null
  }>

  return rows.map((r) => ({
    id: r.id,
    componentId: r.component_id,
    componentName: r.name,
    componentPartName: r.part_name,
    quantity: r.quantity,
    retailerUrl: r.retailer_url,
    addedAt: r.added_at,
    unitPrice: r.unit_price,
    unitPriceCurrency: r.unit_price_currency,
    leadTimeDays: r.lead_time_days
  }))
}

/** Export cart items as CSV text. */
export function exportCart(cartId: string): string {
  const items = listCartItems(cartId)
  const lines = [
    'Component,Part Name,Quantity,Unit Price,Currency,Lead Time (Days),Line Cost (USD),Retailer URL,Added At'
  ]
  for (const item of items) {
    const added = new Date(item.addedAt).toISOString()
    const unitPriceUsd = item.unitPrice ?? 0
    const lineCostUsd = (unitPriceUsd * item.quantity).toFixed(2)
    lines.push(
      `"${item.componentName}","${item.componentPartName ?? ''}",${item.quantity},${
        item.unitPrice ?? ''
      },"${item.unitPriceCurrency}","${item.leadTimeDays ?? ''}","${lineCostUsd}","${item.retailerUrl ?? ''}","${added}"`
    )
  }
  return lines.join('\n') + '\n'
}
