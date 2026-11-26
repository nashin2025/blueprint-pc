import { useState, useEffect } from 'react'
import type { ComponentType } from 'react'
import type { Component, Project } from '@shared/types'
import { useApp } from '../state/useApp'
import { DIFFICULTY_LABELS, DIFFICULTY_STYLES, currency, relativeTime } from '../lib/format'
import { exportBomCsv, exportProjectJson, exportWiringSvg } from '../lib/export'
import { CircuitIcon, DownloadIcon, ListIcon, ChatIcon, TrashIcon, SparkIcon } from '../components/Icons'
import OverviewTab from './tabs/OverviewTab'
import PartsTab from './tabs/PartsTab'
import WiringTab from './tabs/WiringTab'
import MechTab from './tabs/MechTab'
import PartTab from './tabs/PartTab'
import ChatTab from './tabs/ChatTab'
import InfoTab from './tabs/InfoTab'
import InspectorPanel from '../components/InspectorPanel'

type TabId = 'overview' | 'bom' | 'wiring' | 'mech' | 'chat' | 'product' | 'part'

const TABS: Array<{ id: TabId; label: string; icon: ComponentType<{ size?: number }> }> = [
  { id: 'overview', label: 'OVERVIEW', icon: CircuitIcon },
  { id: 'bom', label: 'BOM', icon: ListIcon },
  { id: 'wiring', label: 'WIRING', icon: CircuitIcon },
  { id: 'mech', label: 'MECH', icon: CircuitIcon },
  { id: 'chat', label: 'CHAT', icon: ChatIcon },
  { id: 'product', label: 'PRODUCT', icon: SparkIcon },
  { id: 'part', label: 'PART', icon: CircuitIcon }
]

interface ProjectViewProps {
  project: Project
  /** Controlled active tab. The parent owns tab state. */
  activeTab: TabId
  /** Called when the user clicks a tab. */
  onTabChange: (tab: TabId) => void
  /** Called by canvas tabs (MECH) to report zoom changes. */
  onCanvasZoom: (zoom: number) => void
}

export default function ProjectView({ project, activeTab, onTabChange, onCanvasZoom }: ProjectViewProps) {
  const { upsertProject, removeProject } = useApp()
  const [menuOpen, setMenuOpen] = useState(false)
  const [inspectorComponent, setInspectorComponent] = useState<Component | null>(null)

  const spec = project.spec
  const partsCost = spec.components.reduce((sum, c) => sum + (c.unitPrice ?? 0) * c.quantity, 0)
  const pricedCount = spec.components.filter((c) => c.unitPrice).length

  async function onAddComponent(component: Component) {
    const nextSpec: typeof spec = {
      ...spec,
      components: [...spec.components, component]
    }
    await upsertProject({ ...project, spec: nextSpec })
    onTabChange('bom')
  }

  async function onModelUrlChange(partId: string, modelUrl: string) {
    const idx = spec.components.findIndex((c) => c.id === partId)
    if (idx === -1) return
    const nextComponents = [...spec.components]
    nextComponents[idx] = { ...nextComponents[idx], modelUrl }
    const nextSpec: typeof spec = { ...spec, components: nextComponents }
    await upsertProject({ ...project, spec: nextSpec })
  }

  async function onComponentUpdate(partId: string, updates: Partial<Component>) {
    const idx = spec.components.findIndex((c) => c.id === partId)
    if (idx === -1) return
    const nextComponents = [...spec.components]
    nextComponents[idx] = { ...nextComponents[idx], ...updates }
    const nextSpec: typeof spec = { ...spec, components: nextComponents }
    await upsertProject({ ...project, spec: nextSpec })
    setInspectorComponent(null)
  }

  // On project load, populate modelUrl for any component that doesn't have one
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const missing = spec.components.filter((c) => !c.modelUrl)
      if (missing.length === 0) return

      for (const c of missing) {
        if (cancelled) return
        try {
          const res = await window.api.catalogue.lookupModel({
            name: c.partName ?? c.name
          })
          if (cancelled) return
          if (res.ok && res.data) {
            const idx = spec.components.findIndex((x) => x.id === c.id)
            if (idx === -1) continue
            const nextComponents = [...spec.components]
            nextComponents[idx] = {
              ...nextComponents[idx],
              modelUrl: res.data.modelUrl ?? undefined,
              modelFilePath: res.data.modelFilePath ?? undefined
            }
            const nextSpec: typeof spec = { ...spec, components: nextComponents }
            await upsertProject({ ...project, spec: nextSpec })
          }
        } catch {
          // Individual lookup failures are non-fatal
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [spec.components, project.id, upsertProject])

  async function onDelete() {
    const confirmed = window.confirm(`Delete "${spec.title}"? This cannot be undone.`)
    if (!confirmed) return
    await removeProject(project.id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-line bg-surface-0/80 px-6 pb-0 pt-5 backdrop-blur">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${DIFFICULTY_STYLES[spec.difficulty]}`}
              >
                {DIFFICULTY_LABELS[spec.difficulty]}
              </span>
              <span className="font-mono text-[11px] text-ink-faint">
                {spec.components.length} parts · {spec.connections.length} connections ·{' '}
                {spec.steps.length} steps
              </span>
              <span className="text-[11px] text-ink-faint">· updated {relativeTime(project.updatedAt)}</span>
            </div>

            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">{spec.title}</h1>
            {spec.summary && (
              <p className="mt-1 line-clamp-2 max-w-3xl text-[13px] leading-relaxed text-ink-dim">
                {spec.summary}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="mr-1 text-right">
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">parts cost</div>
              <div className="text-sm font-medium">
                {pricedCount > 0 ? currency(partsCost) : '—'}
                {pricedCount > 0 && pricedCount < spec.components.length && (
                  <span className="ml-1 text-[11px] text-ink-faint">partial</span>
                )}
              </div>
            </div>

            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="btn-secondary"
              >
                <DownloadIcon size={14} />
                Export
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="animate-fade-up absolute right-0 z-20 mt-1.5 w-56 overflow-hidden card p-2 shadow-lg">
                    <button
                      onClick={() => {
                        exportWiringSvg(spec)
                        setMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition hover:bg-surface-2"
                    >
                      <DownloadIcon size={14} />
                      Wiring diagram (.svg)
                    </button>
                    <button
                      onClick={() => {
                        exportBomCsv(spec)
                        setMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition hover:bg-surface-2"
                    >
                      <ListIcon size={14} />
                      Parts list (.csv)
                    </button>
                    <button
                      onClick={() => {
                        exportProjectJson(project)
                        setMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition hover:bg-surface-2"
                    >
                      <DownloadIcon size={14} />
                      Full project (.json)
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => void onDelete()}
              title="Delete project"
              className="btn-ghost hover:bg-danger/5 hover:text-danger"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        </div>

        <nav className="mt-5 flex gap-0.5 overflow-x-auto border-b border-line/50 pb-3">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = activeTab === t.id
            return (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[12px] font-medium transition ${
                  active ? 'text-accent tab-active' : 'text-ink-dim hover:text-ink'
                }`}
              >
                <Icon size={13} />
                {t.label}
              </button>
            )
          })}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-0">
        {activeTab === 'overview' && <OverviewTab spec={spec} project={project} />}
        {activeTab === 'bom' && (
          <PartsTab
            spec={spec}
            onSelectComponent={(comp) => setInspectorComponent(comp)}
          />
        )}
        {activeTab === 'wiring' && <WiringTab spec={spec} />}
        {activeTab === 'mech' && <MechTab spec={spec} onModelUrlChange={onModelUrlChange} onCanvasZoom={onCanvasZoom} />}
        {activeTab === 'chat' && <ChatTab project={project} onSave={upsertProject} onBack={() => onTabChange('overview')} />}
        {activeTab === 'product' && <InfoTab project={project} onSave={upsertProject} />}
        {activeTab === 'part' && <PartTab onAdd={onAddComponent} />}
      </div>

      {inspectorComponent && (
        <InspectorPanel
          component={inspectorComponent}
          onChange={(updates) => void onComponentUpdate(inspectorComponent.id, updates)}
          onClose={() => setInspectorComponent(null)}
        />
      )}
    </div>
  )
}
