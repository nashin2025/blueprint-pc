/**
 * Presence indicator for real-time collaboration.
 *
 * Shows the users currently connected to the same project room, each with a
 * coloured dot matching their cursor colour. Hovering a user reveals their
 * cursor coordinates when available.
 *
 * Props:
 *   users - connected users in the current room, from useCollaboration state.
 */

import type { CollabUser } from '@shared/types'

interface CollabPresenceProps {
  users: CollabUser[]
}

export default function CollabPresence({ users }: CollabPresenceProps) {
  const others = users.filter((u) => u.cursor !== null)

  return (
    <div className="flex shrink-0 flex-col gap-1.5 pt-0.5">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-surface-1">
        <span className="w-2 h-2 rounded-full bg-accent" />
        <span className="text-[11px] font-medium text-ink">Collaborating</span>
        <span className="ml-auto text-[10px] font-mono text-ink-faint">{users.length}</span>
      </div>

      <div className="flex flex-col gap-1">
        {users.map((user) => (
          <div
            key={user.id}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-default hover:bg-surface-2 transition"
            title={`${user.displayName}${user.cursor ? ` · ${Math.round(user.cursor.x)}, ${Math.round(user.cursor.y)}` : ''}`}
          >
            <div
              className="size-3 rounded-full border border-white/40"
              style={{ backgroundColor: user.color }}
            />
            <div className="min-w-0 truncate">
              <div className="text-[11px] font-medium text-ink truncate">{user.displayName}</div>
              {user.cursor && (
                <div className="text-[9px] text-ink-faint truncate">
                  cursor {Math.round(user.cursor.x)}, {Math.round(user.cursor.y)}
                </div>
              )}
            </div>
            {users.length > 1 && others.some((o) => o.id === user.id) && (
              <span className="ml-auto size-1.5 rounded-full border border-white/40" style={{ backgroundColor: user.color }} />
            )}
          </div>
        ))}
        {users.length === 0 && (
          <div className="px-2.5 py-1.5 text-[11px] text-ink-faint">
            Just you
          </div>
        )}
      </div>
    </div>
  )
}
