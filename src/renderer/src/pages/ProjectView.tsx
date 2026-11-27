import { useState, useEffect } from 'react'
import type { ComponentType } from 'react'
import type { Component, Connection, DesignVersion, DrcSummary, DrcViolation, Project, Sheet, SheetPort } from '@shared/types'
import { useApp, newId } from '../state/useApp'
import { DIFFICULTY_LABELS, DIFFICULTY_STYLES, currency, relativeTime } from '../lib/format'
import { exportBomCsv, exportProjectJson, exportWiringSvg } from '../lib/export'
import { CircuitIcon, DownloadIcon, ListIcon, ChatIcon, TrashIcon, SparkIcon, SheetIcon } from '../components/Icons'
import OverviewTab from './tabs/OverviewTab'
import PartsTab from './tabs/PartsTab'
import WiringTab from './tabs/WiringTab'
import MechTab from './tabs/MechTab'
import SheetTab from './tabs/SheetTab'
import SheetSelector from '../components/SheetSelector'
import PartTab from './tabs/PartTab'
import ChatTab from './tabs/ChatTab'
import InfoTab from './tabs/InfoTab'
import InspectorPanel from '../components/InspectorPanel'

type TabId = 'overview' | 'bom' | 'wiring' | 'mech' | 'chat' | 'product' | 'part' | 'sheets'

const TABS: Array<{ id: TabId; label: string; icon: ComponentType<{ size?: number }> }> = [
  { id: 'overview', label: 'OVERVIEW', icon: CircuitIcon },
  { id: 'bom', label: 'BOM', icon: ListIcon },
  { id: 'wiring', label: 'WIRING', icon: CircuitIcon },
  { id: 'mech', label: 'MECH', icon: CircuitIcon },
  { id: 'chat', label: 'CHAT', icon: ChatIcon },
  { id: 'product', label: 'PRODUCT', icon: SparkIcon },
  { id: 'part', label: 'PART', icon: CircuitIcon },
  { id: 'sheets', label: 'SHEETS', icon: SheetIcon }
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
  const [drcViolations, setDrcViolations] = useState<{ violations: DrcViolation[]; summary: DrcSummary } | null>(null)
  const [drcChecking, setDrcChecking] = useState(false)
  const [versionDialogOpen, setVersionDialogOpen] = useState(false)
  const [versions, setVersions] = useState<DesignVersion[]>([])
  /** Id of the currently active sheet in a multi-sheet design. */
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null)

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

  async function onSheetChange(sheetId: string) {
    setActiveSheetId(sheetId)
  }

  async function onAddSheet(name: string) {
    const nextSheets = [
      ...(spec.sheets ?? []),
      { id: newId('sheet'), name, x: 0, y: 0, width: 200, height: 150, connectionIds: [], portIds: [] }
    ]
    const nextSpec: typeof spec = { ...spec, sheets: nextSheets }
    await upsertProject({ ...project, spec: nextSpec })
    setActiveSheetId(nextSheets[nextSheets.length - 1].id)
  }

  async function onRenameSheet(sheetId: string, name: string) {
    const nextSheets = (spec.sheets ?? []).map((s) =>
      s.id === sheetId ? { ...s, name } : s
    )
    const nextSpec: typeof spec = { ...spec, sheets: nextSheets }
    await upsertProject({ ...project, spec: nextSpec })
  }

  async function onDeleteSheet(sheetId: string) {
    const sheet = (spec.sheets ?? []).find((s) => s.id === sheetId)
    if (!sheet) return
    const nextSheets = (spec.sheets ?? []).filter((s) => s.id !== sheetId)
    // Remove connections that belong to this sheet, and ports owned by it.
    const nextConnections = spec.connections.filter(
      (c) => c.sheetId !== sheetId && !sheet.connectionIds.includes(c.id)
    )
    const nextPorts = (spec.ports ?? []).filter((p) => p.sheetId !== sheetId)
    const nextSpec: typeof spec = {
      ...spec,
      sheets: nextSheets,
      connections: nextConnections,
      ports: nextPorts
    }
    await upsertProject({ ...project, spec: nextSpec })
    setActiveSheetId((prev) => (prev === sheetId ? (nextSheets[0]?.id ?? null) : prev))
  }

  async function onReorderSheets(sheetIds: string[]) {
    const byId = new Map((spec.sheets ?? []).map((s) => [s.id, s]))
    const nextSheets = sheetIds.map((id) => byId.get(id)).filter((s): s is Sheet => !!s)
    const nextSpec: typeof spec = { ...spec, sheets: nextSheets }
    await upsertProject({ ...project, spec: nextSpec })
  }

  async function onAddConnection(connection: Omit<Connection, 'id'>) {
    const nextSpec: typeof spec = {
      ...spec,
      connections: [...spec.connections, { ...connection, id: newId('conn') }]
    }
    await upsertProject({ ...project, spec: nextSpec })
  }

  async function onAddPort(port: Omit<SheetPort, 'id'>) {
    const nextSpec: typeof spec = {
      ...spec,
      ports: [...(spec.ports ?? []), { ...port, id: newId('port') }]
    }
    await upsertProject({ ...project, spec: nextSpec })
  }

  async function checkDrc() {
    setDrcChecking(true)
    try {
      const res = await window.api.designRunDrc(project.id)
      if (res.ok && res.data) setDrcViolations(res.data)
    } catch {
      // Ignore
    } finally {
      setDrcChecking(false)
    }
  }

  async function exportNetlist() {
    const res = await window.api.designExportNetlist(project.id)
    if (res.ok && res.data) {
      const blob = new Blob([res.data.netlist], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${spec.title.replace(/[^a-z0-9]/gi, '_')}_netlist.net`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  async function exportGerber() {
    const res = await window.api.pcbExportGerber(project.id)
    if (res.ok && res.data) {
      const { files } = res.data as { files: Record<string, string> }
      // Download each file as a separate blob
      for (const [fileName, content] of Object.entries(files)) {
        const blob = new Blob([content], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${spec.title.replace(/[^a-z0-9]/gi, '_')}_${fileName}`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
      if (res.data.unrouted.length > 0) {
        window.alert(
          `Warning: ${res.data.unrouted.length} connection(s) could not be routed and are missing from Gerber output.`
        )
      }
    }
  }

  async function exportSpec() {
    const res = await window.api.projectsExportSpec(project.id)
    if (res.ok && res.data) {
      const blob = new Blob([res.data.spec], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${spec.title.replace(/[^a-z0-9]/gi, '_')}_spec.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  async function importSpec() {
    const picker = await window.api.openFilePicker()
    if (picker.canceled || !picker.filePath) return
    try {
      const readRes = await window.api.projectsReadFile(picker.filePath)
      if (!readRes.ok || !readRes.data) return
      const res = await window.api.projectsImportSpec({ spec: readRes.data.content })
      if (res.ok && res.data) {
        window.location.href = `/project/${res.data.project.id}`
      }
    } catch {
      // Ignore
    }
  }

  async function saveVersion() {
    const label = prompt('Version name', `Version ${Date.now()}`)
    if (!label) return
    setVersionDialogOpen(false)
    try {
      const res = await window.api.designSaveVersion({
        projectId: project.id,
        label,
        prompt: undefined
      })
      if (res.ok) {
        const listRes = await window.api.designListVersions(project.id)
        if (listRes.ok && listRes.data) setVersions(listRes.data)
      }
    } catch {
      // Ignore
    }
  }

  async function loadVersions() {
    const res = await window.api.designListVersions(project.id)
    if (res.ok && res.data) setVersions(res.data)
  }

  async function restoreVersion(versionId: string) {
    const res = await window.api.designRestoreVersion({
      projectId: project.id,
      versionId
    })
    if (res.ok && res.data) {
      setVersionDialogOpen(false)
      // Reload the page to reflect the restored spec
      window.location.reload()
    }
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
                        exportNetlist()
                        setMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition hover:bg-surface-2"
                    >
                      <DownloadIcon size={14} />
                      Netlist (.net)
                    </button>
                    <button
                      onClick={() => {
                        exportGerber()
                        setMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition hover:bg-surface-2"
                    >
                      <DownloadIcon size={14} />
                      Gerber files
                    </button>
                    <button
                      onClick={() => {
                        exportSpec()
                        setMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition hover:bg-surface-2"
                    >
                      <DownloadIcon size={14} />
                      Design spec (.json)
                    </button>
                    <button
                      onClick={() => {
                        importSpec()
                        setMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition hover:bg-surface-2"
                    >
                      <DownloadIcon size={14} />
                      Import spec (.json)
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

            <SheetSelector
              sheets={spec.sheets ?? []}
              activeSheetId={activeSheetId}
              onSheetChange={onSheetChange}
              onAddSheet={onAddSheet}
              onRenameSheet={onRenameSheet}
              onDeleteSheet={onDeleteSheet}
              onReorderSheets={onReorderSheets}
            />
          </div>

          <button
            onClick={checkDrc}
            disabled={drcChecking}
            className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium text-ink-dim transition hover:bg-surface-1 hover:text-ink"
          >
            {drcChecking ? (
              <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <span>Check DRC</span>
            )}
          </button>
          <button
            onClick={() => {
              setVersionDialogOpen(true)
              void loadVersions()
            }}
            className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium text-ink-dim transition hover:bg-surface-1 hover:text-ink"
          >
            <ListIcon size={14} />
            Versions
          </button>

          <button
            onClick={() => void onDelete()}
            title="Delete project"
            className="btn-ghost hover:bg-danger/5 hover:text-danger"
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </header>

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

      {drcViolations && drcViolations.summary.total > 0 && (
        <div className="px-6 py-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-danger/10 text-danger">
              <TrashIcon size={16} />
            </div>
            <div>
              <div className="text-sm font-medium text-ink">Design Rule Check</div>
              <div className="flex gap-3 text-[11px] font-mono">
                <span className={`text-danger font-bold`}>{drcViolations.summary.errors} errors</span>
                <span className={`text-warning font-bold`}>{drcViolations.summary.warnings} warnings</span>
                <span className="text-ink-dim">{drcViolations.summary.total} total</span>
              </div>
            </div>
          </div>
          <div className="overflow-y-auto max-h-48 border border-line rounded-lg p-3 bg-surface-1/50">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr>
                  <th className="pb-1 text-ink-faint font-medium">Severity</th>
                  <th className="pb-1 text-ink-faint font-medium">Issue</th>
                  <th className="pb-1 text-ink-faint font-medium">Component</th>
                </tr>
              </thead>
              <tbody>
                {drcViolations.violations.map((v) => (
                  <tr key={v.id} className="border-t border-line/30">
                    <td className="py-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          v.severity === 'error'
                            ? 'text-danger bg-danger/10'
                            : v.severity === 'warning'
                              ? 'text-warning bg-warning/10'
                              : 'text-ink-dim bg-surface-2'
                        }`}
                      >
                        {v.severity}
                      </span>
                    </td>
                    <td className="py-1.5 text-ink truncate">{v.message}</td>
                    <td className="py-1.5 text-ink-faint truncate">
                      {v.componentName ?? v.pinName ?? v.designator ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
        {activeTab === 'sheets' && (
          <SheetTab
            spec={spec}
            activeSheetId={activeSheetId}
            onSheetChange={onSheetChange}
            onAddConnection={onAddConnection}
            onAddPort={onAddPort}
          />
        )}
      </div>

      {inspectorComponent && (
        <InspectorPanel
          component={inspectorComponent}
          onChange={(updates) => void onComponentUpdate(inspectorComponent.id, updates)}
          onClose={() => setInspectorComponent(null)}
        />
      )}

      {versionDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setVersionDialogOpen(false)} />
          <div className="relative z-10 w-full max-w-md p-6 bg-surface-0 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold tracking-tight">Versions</h3>
              <button onClick={() => setVersionDialogOpen(false)} className="btn-ghost p-1.5 hover:bg-surface-1">
                <span className="sr-only">Close</span>
                <TrashIcon size={16} className="text-ink-dim" />
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {versions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <p className="text-[12px] text-ink-dim">No saved versions yet.</p>
                  <button
                    onClick={() => {
                      setVersionDialogOpen(false)
                      void saveVersion()
                    }}
                    className="mt-4 btn-secondary"
                  >
                    Save first version
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between p-2 rounded-lg border border-line bg-surface-1 hover:bg-surface-2 cursor-pointer"
                      onClick={() => {
                        setVersionDialogOpen(false)
                        void restoreVersion(v.id)
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{v.label}</div>
                        <div className="text-[11px] text-ink-faint">
                          {new Date(v.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setVersionDialogOpen(false)
                            void restoreVersion(v.id)
                          }}
                          className="btn-ghost p-1 hover:bg-surface-2"
                          title="Restore"
                        >
                          <ListIcon size={14} className="text-accent" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4 pt-4 border-t border-line">
              <button
                onClick={() => {
                  setVersionDialogOpen(false)
                  void saveVersion()
                }}
                className="btn-primary w-full"
              >
                Save current version
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}