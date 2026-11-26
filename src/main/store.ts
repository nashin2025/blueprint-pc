import type { DesignVersion, Project } from '@shared/types'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataDir } from './paths'
import {
  saveProject as dbSaveProject,
  getProject as dbGetProject,
  listProjects as dbListProjects,
  deleteProject as dbDeleteProject,
  archiveProject as dbArchiveProject,
  purgeProject as dbPurgeProject,
  dataFilePath as dbDataFilePath,
  migrateFromJson as dbMigrateFromJson,
  saveProjectVersion as dbSaveProjectVersion
} from './db'
import { imagesDir } from './images'
import { modelsDir } from './sync/model-downloader'

let migrated = false

function ensureMigrated(): void {
  if (migrated) return
  migrated = true

  // Migrate from the old JSON file if it exists (fire-and-forget)
  const jsonPath = join(dataDir(), 'projects.json')
  if (existsSync(jsonPath)) {
    void dbMigrateFromJson(jsonPath).then((count) => {
      if (count > 0) {
        console.log(`[store] migrated ${count} project(s) from projects.json to SQLite`)
      }
    }).catch((err) => {
      console.error('[store] migration from projects.json failed:', err)
    })
  }
}

export const store = {
  list(includeArchived = false): Project[] {
    ensureMigrated()
    return dbListProjects(includeArchived)
  },

  get(id: string): Project | null {
    ensureMigrated()
    return dbGetProject(id)
  },

  save(project: Project): Project {
    ensureMigrated()
    dbSaveProject(project)
    return project
  },

  delete(id: string): boolean {
    ensureMigrated()
    return dbDeleteProject(id)
  },

  archive(id: string, archived: boolean): boolean {
    ensureMigrated()
    return dbArchiveProject(id, archived)
  },

  purge(id: string): boolean {
    ensureMigrated()
    return dbPurgeProject(id)
  },

  /** Deep-copy a project: new ID, copied assets, new component IDs. */
  duplicate(id: string): Project {
    ensureMigrated()
    const project = dbGetProject(id)
    if (!project) throw new Error(`Project not found: ${id}`)

    const { spec } = project

    // Copy image files to data/images/ with new names
    const imageMap = new Map<string, string>()
    if (spec.imageFile) {
      const src = join(imagesDir(), spec.imageFile)
      const ext = spec.imageFile.split('.').pop() ?? 'bin'
      const newName = `${randomUUID()}.${ext}`
      const dest = join(imagesDir(), newName)
      if (existsSync(src)) {
        mkdirSync(imagesDir(), { recursive: true })
        writeFileSync(dest, readFileSync(src))
        imageMap.set(spec.imageFile, newName)
      }
    }

    // Copy model files to data/models/ with new names
    const modelMap = new Map<string, string>()
    for (const comp of spec.components) {
      if (!comp.modelFilePath || !existsSync(comp.modelFilePath)) continue
      const ext = comp.modelFilePath.split('.').pop() ?? 'bin'
      const newName = `${randomUUID()}.${ext}`
      const dest = join(modelsDir(), newName)
      mkdirSync(modelsDir(), { recursive: true })
      writeFileSync(dest, readFileSync(comp.modelFilePath))
      modelMap.set(comp.modelFilePath, dest)
    }

    // Deep copy with new IDs and rebased paths
    const next: Project = JSON.parse(JSON.stringify(project))
    next.id = randomUUID()
    next.createdAt = Date.now()
    next.updatedAt = Date.now()

    if (next.spec.imageFile && imageMap.has(next.spec.imageFile)) {
      next.spec.imageFile = imageMap.get(next.spec.imageFile)!
    }

    const compIdMap = new Map<string, string>()
    for (const comp of next.spec.components) {
      if (comp.image && imageMap.has(comp.image)) {
        comp.image = imageMap.get(comp.image)!
      }
      if (comp.modelFilePath && modelMap.has(comp.modelFilePath)) {
        comp.modelFilePath = modelMap.get(comp.modelFilePath)!
      }
      compIdMap.set(comp.id, randomUUID())
    }
    for (const comp of next.spec.components) {
      comp.id = compIdMap.get(comp.id)!
    }
    for (const conn of next.spec.connections) {
      conn.from.componentId = compIdMap.get(conn.from.componentId) ?? conn.from.componentId
      conn.to.componentId = compIdMap.get(conn.to.componentId) ?? conn.to.componentId
      conn.id = randomUUID()
    }
    for (const step of next.spec.steps) step.id = randomUUID()
    for (const msg of next.chat) msg.id = randomUUID()
    for (const ver of next.versions) ver.id = randomUUID()

    dbSaveProject(next)
    return next
  },

  /** Absolute path of the data file, for the "show data folder" action. */
  dataFilePath(): string {
    return dbDataFilePath()
  },

  /** Save a design version snapshot for a project. */
  saveVersion(projectId: string, version: DesignVersion): void {
    ensureMigrated()
    dbSaveProjectVersion(projectId, version)
  }
}

export { dataDir } from './paths'
