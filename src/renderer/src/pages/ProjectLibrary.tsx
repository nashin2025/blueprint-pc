import { useCallback, useState } from 'react'
import type { Project } from '@shared/types'
import { relativeTime } from '../lib/format'
import {
  ArchiveIcon,
  ChevronIcon,
  ChipIcon,
  CopyIcon,
  EditIcon,
  ExportIcon,
  FolderOpenIcon,
  PlusIcon,
  TrashIcon
} from '../components/Icons'

interface ProjectLibraryProps {
  onBack: () => void
  onOpenProject: (id: string) => void
}

export default function ProjectLibrary({ onBack, onOpenProject }: ProjectLibraryProps) {
  const [archivedVisible, setArchivedVisible] = useState(false)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Re-fetch projects from IPC to get fresh data after mutations
  const [projects, setProjects] = useState<Project[]>([])

  useCallback(async () => {
    const list = await window.api.listProjects(archivedVisible)
    setProjects(list)
  }, [archivedVisible, refreshKey])

  // Load on mount
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  ;(async () => {
    const list = await window.api.listProjects(archivedVisible)
    setProjects(list)
  })()

  async function handleRename(id: string, title: string) {
    const proj = await window.api.getProject(id)
    if (!proj) return
    proj.spec.title = title
    proj.updatedAt = Date.now()
    await window.api.saveProject(proj)
    setRenameId(null)
    setRenameValue('')
    setRefreshKey((k) => k + 1)
  }

  async function handleDuplicate(id: string) {
    await window.api.duplicateProject(id)
    setRefreshKey((k) => k + 1)
  }

  async function handleArchive(id: string, archived: boolean) {
    await window.api.archiveProject(id, archived)
    setRefreshKey((k) => k + 1)
  }

  async function handleDelete(id: string) {
    await window.api.purgeProject(id)
    setDeleteId(null)
    setRefreshKey((k) => k + 1)
  }

  async function handleExport(id: string) {
    const proj = await window.api.getProject(id)
    if (!proj) return
    const safeTitle = proj.spec.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    const outputPath = `data/exports/${safeTitle}_${Date.now()}.bpzip`
    await window.api.exportProject({ id, outputPath })
    // Open the data folder so the user can find the file
    await window.api.showDataFolder()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-line bg-surface-0/80 px-6 py-4 flex items-center justify-between backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="btn-ghost hover:bg-surface-1"
          >
            <ChevronIcon size={14} className="text-ink-dim" />
          </button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Project library</h1>
            <p className="text-[12px] text-ink-dim">
              Manage your designs — open, rename, duplicate, archive, or export.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-[12px] text-ink-dim cursor-pointer select-none">
            <input
              type="checkbox"
              checked={archivedVisible}
              onChange={(e) => setArchivedVisible(e.target.checked)}
              className="accent-accent"
            />
            Show archived
          </label>
          <button
            onClick={() => window.api.showDataFolder()}
            className="btn-secondary"
          >
            <FolderOpenIcon size={14} />
            Data folder
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-surface-1 mb-4 text-ink-faint">
              <ArchiveIcon size={20} />
            </div>
            <h3 className="text-sm font-medium">No projects{archivedVisible ? ' here' : ' yet'}</h3>
            <p className="mt-1 text-[12px] text-ink-dim">
              {archivedVisible
                ? 'No archived projects.'
                : 'Generate your first design to create a project.'}
            </p>
            {!archivedVisible && (
              <button onClick={onBack} className="mt-4 btn-primary">
                <PlusIcon size={14} />
                New design
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => {
              const isArchived = p.archived
              return (
                <div
                  key={p.id}
                  className="card p-4 group hover:bg-surface-1 transition"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <ChipIcon size={14} className="text-accent shrink-0" />
                      <div className="min-w-0">
                        {renameId === p.id ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                void handleRename(p.id, renameValue)
                              }
                              if (e.key === 'Escape') {
                                setRenameId(null)
                              }
                            }}
                            onBlur={() => {
                              if (renameValue.trim()) {
                                void handleRename(p.id, renameValue)
                              }
                              setRenameId(null)
                            }}
                            className="input-field w-full text-[13px] font-medium"
                          />
                        ) : (
                          <span
                            className="block truncate text-[13px] leading-tight font-medium"
                            onClick={() => void onOpenProject(p.id)}
                            style={{ cursor: 'pointer' }}
                          >
                            {p.spec.title}
                          </span>
                        )}
                        <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                          {p.spec.components.length} parts · {p.spec.connections.length} connections ·{' '}
                          {relativeTime(p.updatedAt)}
                        </span>
                      </div>
                    </div>
                    {isArchived && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium text-archive-bg bg-archive/10 border border-archive/30">
                        Archived
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void onOpenProject(p.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-dim transition hover:border-accent hover:text-accent"
                    >
                      <ChipIcon size={12} />
                      Open
                    </button>

                    {renameId === p.id ? (
                      <>
                        <button
                          onClick={() => {
                            if (renameValue.trim()) void handleRename(p.id, renameValue)
                            setRenameId(null)
                          }}
                          className="btn-ghost hover:bg-surface-1 p-1.5"
                          title="Save"
                        >
                          <ChevronIcon size={12} className="text-accent" />
                        </button>
                        <button
                          onClick={() => setRenameId(null)}
                          className="btn-ghost hover:bg-danger/5 hover:text-danger p-1.5"
                          title="Cancel"
                        >
                          <TrashIcon size={12} className="text-danger" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          setRenameValue(p.spec.title)
                          setRenameId(p.id)
                        }}
                        className="btn-ghost hover:bg-surface-1 p-1.5"
                        title="Rename"
                      >
                        <EditIcon size={12} />
                      </button>
                    )}

                    <button
                      onClick={() => void handleDuplicate(p.id)}
                      className="btn-ghost hover:bg-surface-1 p-1.5"
                      title="Duplicate"
                    >
                      <CopyIcon size={12} />
                    </button>

                    <button
                      onClick={() => void handleArchive(p.id, !isArchived)}
                      className="btn-ghost hover:bg-surface-1 p-1.5"
                      title={isArchived ? 'Restore' : 'Archive'}
                    >
                      <ArchiveIcon size={12} />
                    </button>

                    <button
                      onClick={() => setDeleteId(p.id)}
                      className="btn-ghost hover:bg-danger/5 hover:text-danger p-1.5"
                      title="Delete"
                    >
                      <TrashIcon size={12} className="text-danger" />
                    </button>

                    <button
                      onClick={() => handleExport(p.id)}
                      className="btn-ghost hover:bg-surface-1 p-1.5"
                      title="Export .bpzip"
                    >
                      <ExportIcon size={12} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-ink/60 backdrop-blur-sm" onClick={() => setDeleteId(null)} />
          <div className="relative z-10 card p-6 max-w-md animate-fade-up">
            <h3 className="text-sm font-medium mb-1">Delete project?</h3>
            <p className="text-[12px] text-ink-dim mb-4">
              This permanently removes the project and all its data. It cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteId(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const id = deleteId
                  setDeleteId(null)
                  void handleDelete(id)
                }}
                className="btn-danger"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
