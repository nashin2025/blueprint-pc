import { create } from 'zustand'
import type { AppSettings, DesignSpec, Project } from '@shared/types'

/**
 * Global app state: which projects exist, which one is open, and the user's
 * AI settings. Everything else is component-local, because component-local
 * state does not need to survive a page switch.
 */

const EMPTY_SETTINGS: AppSettings = {
  provider: 'nvidia',
  geminiApiKey: '',
  geminiModel: 'gemini-3.8-flash',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  nvidiaApiKey: '',
  nvidiaModel: 'meta/llama-3.3-70b-instruct',
  imageModel: 'black-forest-labs/flux.1-schnell',
  enableImages: false
}

interface AppState {
  projects: Project[]
  activeId: string | null
  settings: AppSettings
  loaded: boolean
  /** Canvas zoom percentage, reported by the active 3D / canvas tab (MECH). */
  canvasZoom: number

  hydrate: () => Promise<void>
  selectProject: (id: string | null) => void
  upsertProject: (project: Project) => Promise<void>
  removeProject: (id: string) => Promise<void>
  updateSettings: (settings: AppSettings) => Promise<void>
  /** Report the current canvas zoom from a canvas tab. */
  setCanvasZoom: (zoom: number) => void
}

export const useApp = create<AppState>((set, get) => ({
  projects: [],
  activeId: null,
  settings: EMPTY_SETTINGS,
  loaded: false,
  canvasZoom: 100,

  async hydrate() {
    try {
      const [projects, settings] = await Promise.all([window.api.listProjects(), window.api.loadSettings()])
      set({
        projects,
        settings,
        loaded: true,
        activeId: get().activeId ?? projects[0]?.id ?? null
      })
    } catch (err) {
      // If the preload/IPC bridge isn't available yet (e.g. dev mode without
      // Electron), still finish loading so the UI isn't stuck forever.
      console.error('[useApp] hydrate failed:', err)
      set({
        projects: [],
        settings: EMPTY_SETTINGS,
        loaded: true,
        activeId: null
      })
    }
  },

  selectProject(id) {
    set({ activeId: id })
  },

  async upsertProject(project) {
    const saved = await window.api.saveProject(project)
    set((state) => {
      const others = state.projects.filter((p) => p.id !== saved.id)
      return { projects: [saved, ...others], activeId: saved.id }
    })
  },

  async removeProject(id) {
    await window.api.deleteProject(id)
    set((state) => {
      const projects = state.projects.filter((p) => p.id !== id)
      return {
        projects,
        activeId: state.activeId === id ? (projects[0]?.id ?? null) : state.activeId
      }
    })
  },

  async updateSettings(settings) {
    const saved = await window.api.saveSettings(settings)
    set({ settings: saved })
  },

  setCanvasZoom: (zoom) => set({ canvasZoom: zoom })
}))

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Builds an empty project shell, ready to receive a first design. */
export function blankProject(spec: DesignSpec): Project {
  const now = Date.now()
  return {
    id: newId('prj'),
    createdAt: now,
    updatedAt: now,
    spec,
    chat: [],
    versions: [
      {
        id: newId('ver'),
        label: 'Initial design',
        createdAt: now,
        spec
      }
    ]
  }
}