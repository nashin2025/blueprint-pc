import { useApp } from '../state/useApp'
import { CartIcon, ChipIcon, GearIcon, ListIcon, PlusIcon } from './Icons'
import { relativeTime } from '../lib/format'

interface SidebarProps {
  onOpenSettings: () => void
  onOpenLibrary: () => void
  onOpenCart: () => void
  onSelectProject: (id: string | null) => void
  libraryOpen: boolean
  cartOpen: boolean
}

export default function Sidebar({
  onOpenSettings,
  onOpenLibrary,
  onOpenCart,
  onSelectProject,
  libraryOpen,
  cartOpen
}: SidebarProps) {
  const { projects, activeId } = useApp()

  return (
    <aside className="flex shrink-0 flex-col border-r border-line bg-surface-0">
      <div className="flex h-16 items-center gap-2 px-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <ChipIcon size={18} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight">Blueprint PC</div>
          <div className="truncate font-mono text-[10px] uppercase tracking-widest text-ink-faint">
            local studio
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 pb-6">
        <div className="space-y-1 px-2 mb-6">
          <button
            onClick={() => onSelectProject(null)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition ${
              !libraryOpen && activeId === null
                ? 'bg-surface-2 text-ink'
                : 'text-ink-dim hover:bg-surface-1 hover:text-ink'
            }`}
          >
            <PlusIcon size={16} />
            <span className="text-sm font-medium">New design</span>
          </button>
          <button
            onClick={onOpenLibrary}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition ${
              libraryOpen ? 'bg-surface-2 text-ink' : 'text-ink-dim hover:bg-surface-1 hover:text-ink'
            }`}
          >
            <ListIcon size={16} />
            <span className="text-sm font-medium">Part library</span>
          </button>
          <button
            onClick={onOpenCart}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition ${
              cartOpen ? 'bg-surface-2 text-ink' : 'text-ink-dim hover:bg-surface-1 hover:text-ink'
            }`}
          >
            <CartIcon size={16} />
            <span className="text-sm font-medium">Cart</span>
          </button>
        </div>

        <div className="flex items-center justify-between px-2 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Projects {projects.length > 0 && <span className="ml-1 text-ink-faint/70">· {projects.length}</span>}
          </span>
        </div>

        <ul className="space-y-0.5 px-2">
          {projects.length === 0 ? (
            <p className="px-4 py-4 text-[12px] leading-relaxed text-ink-faint">
              Nothing here yet. Describe a project to generate your first design.
            </p>
          ) : (
            projects.map((p) => {
              const isActive = !libraryOpen && p.id === activeId
              return (
                <li key={p.id}>
                  <button
                    onClick={() => onSelectProject(p.id)}
                    className={`group flex items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition ${
                      isActive ? 'bg-surface-2' : 'hover:bg-surface-1'
                    }`}
                  >
                    <ChipIcon
                      size={14}
                      className={`mt-0.5 shrink-0 ${isActive ? 'text-accent' : 'text-ink-faint'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[13px] leading-tight font-medium ${
                          isActive ? 'text-ink' : 'text-ink-dim group-hover:text-ink'
                        }`}
                      >
                        {p.spec.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                        {p.spec.components.length} parts · {relativeTime(p.updatedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      </nav>

      <div className="border-t border-line p-4">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink-dim transition hover:bg-surface-1 hover:text-ink"
        >
          <GearIcon size={16} />
          Settings
        </button>
        <button
          onClick={() => void window.api.showDataFolder()}
          className="mt-2.5 w-full rounded-lg px-3 py-2 text-left font-mono text-[10px] uppercase tracking-widest text-ink-faint transition hover:bg-surface-1 hover:text-ink-dim"
        >
          Open data folder
        </button>
      </div>
    </aside>
  )
}
