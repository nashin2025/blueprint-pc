/**
 * Real-time collaboration state for the renderer.
 *
 * Manages a WebSocket connection to the collaboration server started by the
 * main process (ws://localhost:8765). Tracks connected users, cursor
 * positions, and provides methods to send local operations and receive remote
 * ones. Remote operations are queued in `receivedOperations`; the consumer
 * applies them to the local design spec using `applyOperationToSpec` from
 * `@main/collaboration` and persists via `useApp`.
 *
 * Reconnection: if the socket closes unexpectedly (not via `disconnect`),
 * the store attempts to rejoin the same room after a short backoff.
 */

import { create } from 'zustand'
import type { CollabOperation, CollabOperationType, CollabUser, CursorPosition, ServerToClientMessage } from '@shared/types'

const COLLAB_WS_URL = 'ws://localhost:8765'
const RECONNECT_DELAY_MS = 2000

interface CollabState {
  projectId: string | null
  userId: string | null
  displayName: string | null
  connected: boolean
  connecting: boolean
  reconnecting: boolean
  users: CollabUser[]
  cursors: Record<string, CursorPosition>
  error: string | null
  /** Remote operations received but not yet applied by the consumer. */
  receivedOperations: CollabOperation[]
  ws: WebSocket | null
  reconnectTimer: ReturnType<typeof setTimeout> | null

  connect: (projectId: string, userId: string, displayName: string) => void
  disconnect: () => void
  sendCursor: (x: number, y: number, sheetId?: string) => void
  sendOperation: (type: CollabOperationType, payload: Record<string, unknown>) => void
  /** Mark a received operation as processed so it is dropped from the queue. */
  markOperationProcessed: (operationId: string) => void
}

export const useCollaboration = create<CollabState>((set, get) => ({
  projectId: null,
  userId: null,
  displayName: null,
  connected: false,
  connecting: false,
  reconnecting: false,
  users: [],
  cursors: {},
  error: null,
  receivedOperations: [],
  ws: null,
  reconnectTimer: null,

  connect(projectId, userId, displayName) {
    const { ws: existingWs, reconnectTimer } = get()
    // Clear any pending reconnect timer.
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      set({ reconnectTimer: null })
    }
    // If already connected, leave the previous room first.
    if (existingWs?.readyState === WebSocket.OPEN) {
      const prevProject = get().projectId
      const prevUser = get().userId
      if (prevProject && prevUser) {
        try {
          existingWs.send(JSON.stringify({ type: 'leave', projectId: prevProject, userId: prevUser }))
        } catch {
          // Ignore, the socket is about to be replaced.
        }
      }
    }

    set({
      connecting: true,
      reconnecting: false,
      error: null,
      projectId,
      userId,
      displayName,
      users: [],
      cursors: {}
    })

    try {
      const ws = new WebSocket(COLLAB_WS_URL)
      set({ ws })

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'join',
          projectId,
          userId,
          displayName
        }))
        set({ connected: true, connecting: false, error: null })
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerToClientMessage
          switch (message.type) {
            case 'presence': {
              const byId = new Map(get().users.map((u) => [u.id, u]))
              for (const user of message.users) byId.set(user.id, user)
              set({ users: Array.from(byId.values()) })
              break
            }
            case 'cursor':
              set((state) => ({
                cursors: { ...state.cursors, [message.userId]: { x: message.x, y: message.y, sheetId: message.sheetId } }
              }))
              break
            case 'operation':
              if (message.operation.userId !== get().userId) {
                set((state) => ({
                  receivedOperations: [...state.receivedOperations, message.operation]
                }))
              }
              break
            case 'error':
              set({ error: message.message })
              break
            case 'joined':
              // Join acknowledged; nothing to store beyond connection state.
              break
          }
        } catch {
          // Ignore malformed messages; keep the connection alive.
        }
      }

      ws.onclose = () => {
        set({ connected: false, connecting: false, users: [], cursors: {}, ws: null })
        // Only auto-reconnect if we were actively connected (not a user-initiated
        // disconnect) and we still have a room to rejoin.
        const { projectId: pid, userId: uid, displayName: dn } = get()
        if (pid && uid && dn) {
          set({ reconnecting: true })
          const timer = setTimeout(() => {
            void get().connect(pid, uid, dn)
            set({ reconnectTimer: null })
          }, RECONNECT_DELAY_MS)
          set({ reconnectTimer: timer })
        }
      }

      ws.onerror = () => {
        set({ error: 'WebSocket connection failed', connecting: false })
        ws.close()
      }
    } catch (err) {
      set({
        connecting: false,
        error: err instanceof Error ? err.message : 'Failed to connect'
      })
    }
  },

  disconnect() {
    const { ws, projectId, userId, reconnectTimer } = get()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      set({ reconnectTimer: null })
    }
    if (ws && projectId && userId) {
      try {
        ws.send(JSON.stringify({ type: 'leave', projectId, userId }))
      } catch {
        // Ignore
      }
    }
    if (ws) ws.close()
    set({
      connected: false,
      connecting: false,
      reconnecting: false,
      users: [],
      cursors: {},
      error: null,
      receivedOperations: [],
      ws: null,
      projectId: null,
      userId: null,
      displayName: null
    })
  },

  sendCursor(x, y, sheetId) {
    const { ws, projectId, userId } = get()
    if (!ws || ws.readyState !== WebSocket.OPEN || !projectId || !userId) return
    ws.send(JSON.stringify({ type: 'cursor.move', projectId, userId, x, y, sheetId }))
  },

  sendOperation(type, payload) {
    const { ws, projectId, userId } = get()
    if (!ws || ws.readyState !== WebSocket.OPEN || !projectId || !userId) return
    const operation: CollabOperation = {
      id: `${userId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      projectId,
      userId,
      timestamp: Date.now(),
      payload
    }
    ws.send(JSON.stringify({ type: 'operation', operation }))
  },

  markOperationProcessed(operationId) {
    set((state) => ({
      receivedOperations: state.receivedOperations.filter((op) => op.id !== operationId)
    }))
  }
}))
