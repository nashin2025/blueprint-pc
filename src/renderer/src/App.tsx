import { useCallback, useEffect, useState } from 'react'
import { hasApiKey } from '@shared/settings'
import { useApp } from './state/useApp'
import Sidebar from './components/Sidebar'
import Home from './pages/Home'
import ProjectView from './pages/ProjectView'
import PartLibrary from './pages/PartLibrary'
import SettingsDialog from './components/SettingsDialog'
import CommandPalette from './components/CommandPalette'
import StatusBar from './components/StatusBar'

type TabId = 'overview' | 'bom' | 'wiring' | 'mech' | 'chat' | 'product' | 'part'

const TABS_ORDER: TabId[] = [
  'overview',
  'bom',
  'wiring',
  'mech',
  'chat',
  'product',
  'part'
]

interface AppProps {
  /** Number of validation errors to show in the status bar. */
  errorCount?: number
}

export default function App({ errorCount = 0 }: AppProps = {}) {
  const { projects, activeId, loaded, hydrate, settings, updateSettings, canvasZoom } = useApp()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const active = projects.find((p) => p.id === activeId) ?? null
  const hasKey = hasApiKey(settings)

  function openProject(id: string | null) {
    setLibraryOpen(false)
    useApp.getState().selectProject(id)
  }

  // Command palette actions. App-level actions plus tab switching for the
  // active project.
  const paletteActions = useCallback(() => {
    const tabLabels: Record<TabId, string> = {
      overview: 'Overview',
      bom: 'BOM',
      wiring: 'Wiring',
      mech: '3D (MECH)',
      chat: 'Chat',
      product: 'Product',
      part: 'Part'
    }
    const actions: Array<{
      id: string
      label: string
      hint?: string
      shortcut?: string
      run: () => void
    }> = [
      {
        id: 'new-design',
        label: 'New design',
        hint: 'Start a blank project',
        shortcut: 'N',
        run: () => {
          openProject(null)
          setPaletteOpen(false)
        }
      },
      {
        id: 'part-library',
        label: 'Part library',
        hint: 'Browse 6,000+ offline parts',
        shortcut: 'L',
        run: () => {
          setLibraryOpen(true)
          setPaletteOpen(false)
        }
      },
      {
        id: 'settings',
        label: 'Settings',
        hint: 'API key and model choice',
        shortcut: ',',
        run: () => {
          setSettingsOpen(true)
          setPaletteOpen(false)
        }
      },
      {
        id: 'data-folder',
        label: 'Open data folder',
        hint: 'Where projects and settings live',
        run: () => {
          void window.api.showDataFolder()
          setPaletteOpen(false)
        }
      }
    ]
    if (active) {
      actions.unshift({
        id: 'switch-project',
        label: `Open "${active.spec.title}"`,
        hint: activeId ? 'Already open' : 'Open this project',
        shortcut: activeId ? undefined : 'O',
        run: () => {
          openProject(activeId)
          setPaletteOpen(false)
        }
      })
      // Tab switching actions for the active project.
      TABS_ORDER.forEach((t) => {
        actions.push({
          id: `tab-${t}`,
          label: tabLabels[t],
          hint: activeTab === t ? 'Active' : 'Switch tab',
          run: () => {
            setActiveTab(t)
            setPaletteOpen(false)
          }
        })
      })
    }
    return actions
  }, [active, activeId, activeTab, openProject])

  // Global keyboard: ⌘K or `/` opens the command palette.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isSlash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      const target = e.target as HTMLElement | null
      const inInput = target?.matches('input, textarea, [contenteditable]')
      if (inInput && !isSlash) return
      if (isSlash || isCmdK) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
      // Escape closes the palette.
      if (e.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen])

  return (
    <div className="flex h-full w-full overflow-hidden bg-surface-0 text-ink">
      <Sidebar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenLibrary={() => setLibraryOpen(true)}
        onSelectProject={openProject}
        libraryOpen={libraryOpen}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        {!loaded ? (
          <div className="flex flex-1 items-center justify-center text-ink-faint">
            Loading your workbench…
          </div>
        ) : libraryOpen ? (
          <PartLibrary onBack={() => setLibraryOpen(false)} />
        ) : !hasKey ? (
          <NoKeyState onOpenSettings={() => setSettingsOpen(true)} />
        ) : active ? (
          <ProjectView
            key={active.id}
            project={active}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onCanvasZoom={useApp.getState().setCanvasZoom}
          />
        ) : (
          <Home />
        )}

        {/* Status bar along the bottom of the work area. */}
        <StatusBar zoom={canvasZoom} errorCount={errorCount} />
      </main>

      {paletteOpen && (
        <CommandPalette
          open={true}
          onClose={() => setPaletteOpen(false)}
          actions={paletteActions()}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={async (next) => {
            await updateSettings(next)
            setSettingsOpen(false)
          }}
        />
      )}
    </div>
  )
}

function NoKeyState({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-surface-0 px-8">
      <div className="max-w-lg p-8">
        <h1 className="h1-premium mb-3">One step before you build</h1>
        <p className="text-body mb-6">
          Blueprint PC needs an AI API key to turn a description into a design. The key stays on this machine —
          it is stored in a local settings file and is only ever sent to the model provider you choose.
        </p>

        <div className="space-y-3">
          <div className="card p-4">
            <div className="text-caption mb-1">NVIDIA NIM</div>
            <p className="text-muted mb-2">Hosted open models with a free tier.</p>
            <a
              href="https://build.nvidia.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[12px] text-accent hover:text-accent/90 underline underline-offset-2"
            >
              Create a key at build.nvidia.com
            </a>
          </div>
          <div className="card p-4">
            <div className="text-caption mb-1">Google Gemini</div>
            <p className="text-muted mb-2">Has a free tier.</p>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[12px] text-accent hover:text-accent/90 underline underline-offset-2"
            >
              Create a key at aistudio.google.com/apikey
            </a>
          </div>
          <div className="card p-4">
            <div className="text-caption mb-1">OpenAI</div>
            <p className="text-muted mb-2">Requires billing to be set up.</p>
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[12px] text-accent hover:text-accent/90 underline underline-offset-2"
            >
              Create a key at platform.openai.com/api-keys
            </a>
          </div>
        </div>

        <button
          onClick={onOpenSettings}
          className="btn-primary mt-6 w-full"
        >
          Open settings
        </button>
      </div>
    </div>
  )
}
