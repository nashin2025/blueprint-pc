import type { Project } from '@shared/types'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths'
import {
  saveProject as dbSaveProject,
  getProject as dbGetProject,
  listProjects as dbListProjects,
  deleteProject as dbDeleteProject,
  dataFilePath as dbDataFilePath,
  migrateFromJson as dbMigrateFromJson
} from './db'

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
  list(): Project[] {
    ensureMigrated()
    return dbListProjects()
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

  /** Absolute path of the data file, for the "show data folder" action. */
  dataFilePath(): string {
    return dbDataFilePath()
  }
}

export { dataDir } from './paths'
