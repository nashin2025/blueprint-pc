/**
 * Real-time collaboration WebSocket server.
 *
 * Runs inside the Electron main process on a local TCP port. Each connected
 * renderer joins a room keyed by project ID. Presence (join/leave/cursor) and
 * design operations are broadcast to every other client in the same room.
 *
 * The server is intentionally stateless about the design itself: it relays
 * operations and presence, it does not store or mutate the project spec.
 * Conflict resolution (last-write-wins) is applied by the receiver using the
 * pure helpers exported from this module.
 *
 * Started and stopped exclusively through IPC handlers (see src/main/ipc.ts).
 * The renderer never touches this module directly.
 */

import { WebSocket, WebSocketServer } from 'ws'
import type {
  CollabUser,
  CollabOperation,
  CursorPosition,
  DesignSpec,
  Component,
  Connection,
  Sheet,
  ServerToClientMessage,
  ClientToServerMessage
} from '@shared/types'

const DEFAULT_PORT = 8765

/** Distinct cursor/presence colours, assigned deterministically per user id. */
const USER_COLOURS = [
  '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
  '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e'
]

/**
 * Pure: map a user id to a colour from the fixed palette. Same id always gets
 * the same colour, so a user's cursor colour is stable across reconnects.
 */
export function colourForUserId(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0
  }
  return USER_COLOURS[Math.abs(hash) % USER_COLOURS.length]
}

/**
 * Pure: build a CollabUser from an id and display name.
 */
export function createCollabUser(id: string, displayName: string): CollabUser {
  return {
    id,
    displayName,
    color: colourForUserId(id),
    cursor: null,
    lastSeen: Date.now()
  }
}

/**
 * Pure: last-write-wins conflict resolution. The operation with the greater
 * (or equal) timestamp wins. Equal timestamps favour the second operation
 * (b), which is deterministic for concurrent edits from different clients.
 */
export function lastWriteWins(a: CollabOperation, b: CollabOperation): CollabOperation {
  return b.timestamp >= a.timestamp ? b : a
}

/**
 * Pure: apply a single remote operation to a design spec, returning a new
 * spec. Structural operations (add/remove/update) mutate the spec; cursor
 * moves are ephemeral presence data and leave the spec untouched. Unknown
 * operation types return the spec unchanged so new types can be added without
 * breaking older clients.
 */
export function applyOperationToSpec(spec: DesignSpec, operation: CollabOperation): DesignSpec {
  switch (operation.type) {
    case 'component.added': {
      const component = operation.payload.component as Component
      return { ...spec, components: [...spec.components, component] }
    }
    case 'component.moved':
      // Canvas position is ephemeral presence data; it never touches the spec.
      return spec
    case 'component.updated': {
      const { id, updates } = operation.payload as { id: string; updates: Partial<Component> }
      return {
        ...spec,
        components: spec.components.map((c) =>
          c.id === id ? { ...c, ...updates } : c
        )
      }
    }
    case 'component.removed': {
      const { id } = operation.payload as { id: string }
      return { ...spec, components: spec.components.filter((c) => c.id !== id) }
    }
    case 'connection.added': {
      const connection = operation.payload.connection as Connection
      return { ...spec, connections: [...spec.connections, connection] }
    }
    case 'connection.removed': {
      const { id } = operation.payload as { id: string }
      return { ...spec, connections: spec.connections.filter((c) => c.id !== id) }
    }
    case 'sheet.added': {
      const sheet = operation.payload.sheet as Sheet
      return { ...spec, sheets: [...(spec.sheets ?? []), sheet] }
    }
    case 'sheet.renamed': {
      const { sheetId, name } = operation.payload as { sheetId: string; name: string }
      return {
        ...spec,
        sheets: (spec.sheets ?? []).map((s) =>
          s.id === sheetId ? { ...s, name } : s
        )
      }
    }
    case 'sheet.deleted': {
      const { sheetId } = operation.payload as { sheetId: string }
      const sheet = (spec.sheets ?? []).find((s) => s.id === sheetId)
      const sheetConnectionIds = sheet?.connectionIds ?? []
      return {
        ...spec,
        sheets: (spec.sheets ?? []).filter((s) => s.id !== sheetId),
        connections: spec.connections.filter(
          (c) => c.sheetId !== sheetId && !sheetConnectionIds.includes(c.id)
        ),
        ports: (spec.ports ?? []).filter((p) => p.sheetId !== sheetId)
      }
    }
    default:
      return spec
  }
}

/**
 * Per-client connection state tracked by the server.
 */
interface ClientState {
  ws: WebSocket
  userId: string
  displayName: string
  rooms: Set<string>
}

/**
 * WebSocket collaboration server. One instance is shared by the IPC handlers
 * (exported as `collabServer`).
 */
class CollaborationServer {
  private wss: WebSocketServer | null = null
  private port: number | null = null
  private clients = new Map<WebSocket, ClientState>()
  private rooms = new Map<string, Set<WebSocket>>()

  /** Start listening on `port` (default 8765). Idempotent guard prevents double-start. */
  start(port = DEFAULT_PORT): { ok: true; port: number } | { ok: false; error: string } {
    if (this.wss !== null) {
      return { ok: false, error: 'Collaboration server already running' }
    }
    try {
      this.wss = new WebSocketServer({ port })
      this.wss.on('connection', (ws: WebSocket) => this.handleConnection(ws))
      this.wss.on('error', (err: Error) => {
        console.error('[collab] WebSocket server error:', err.message)
      })
      this.port = port
      console.log(`[collab] WebSocket server listening on port ${port}`)
      return { ok: true, port }
    } catch (err) {
      this.wss = null
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to start collaboration server'
      }
    }
  }

  /** Stop the server and close every client connection. */
  stop(): { ok: true } | { ok: false; error: string } {
    if (this.wss === null) {
      return { ok: false, error: 'Collaboration server is not running' }
    }
    try {
      for (const [ws, client] of this.clients) {
        this.removeClientFromAllRooms(client)
        ws.close()
      }
      this.clients.clear()
      this.rooms.clear()
      this.wss.close()
      this.wss = null
      this.port = null
      console.log('[collab] WebSocket server stopped')
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to stop collaboration server'
      }
    }
  }

  /** Current server status, used by the `collaboration:status` IPC handler. */
  status(): { running: boolean; port: number | null; clientCount: number } {
    return {
      running: this.wss !== null,
      port: this.port,
      clientCount: this.clients.size
    }
  }

  // ------------------------------------------------------------------
  // Connection lifecycle
  // ------------------------------------------------------------------

  private handleConnection(ws: WebSocket): void {
    const client: ClientState = {
      ws,
      userId: '',
      displayName: '',
      rooms: new Set()
    }
    this.clients.set(ws, client)

    ws.on('message', (raw: Buffer) => {
      try {
        const message = JSON.parse(raw.toString('utf-8')) as ClientToServerMessage
        this.handleMessage(client, message)
      } catch {
        this.send(ws, { type: 'error', message: 'Invalid message format' })
      }
    })

    ws.on('close', () => {
      this.removeClientFromAllRooms(client)
      this.clients.delete(ws)
    })

    ws.on('error', () => {
      this.removeClientFromAllRooms(client)
      this.clients.delete(ws)
    })
  }

  // ------------------------------------------------------------------
  // Message handling
  // ------------------------------------------------------------------

  private handleMessage(client: ClientState, message: ClientToServerMessage): void {
    switch (message.type) {
      case 'join':
        this.handleJoin(client, message)
        break
      case 'leave':
        this.handleLeave(client, message)
        break
      case 'cursor.move':
        this.handleCursorMove(client, message)
        break
      case 'operation':
        this.handleOperation(client, message)
        break
      default:
        this.send(client.ws, { type: 'error', message: 'Unknown message type' })
    }
  }

  private handleJoin(client: ClientState, message: Extract<ClientToServerMessage, { type: 'join' }>): void {
    client.userId = message.userId
    client.displayName = message.displayName
    client.rooms.add(message.projectId)

    let room = this.rooms.get(message.projectId)
    if (!room) {
      room = new Set()
      this.rooms.set(message.projectId, room)
    }
    room.add(client.ws)

    this.send(client.ws, { type: 'joined', projectId: message.projectId, userId: message.userId })
    this.broadcastPresence(message.projectId)
  }

  private handleLeave(client: ClientState, message: Extract<ClientToServerMessage, { type: 'leave' }>): void {
    client.rooms.delete(message.projectId)
    const room = this.rooms.get(message.projectId)
    if (!room) return
    room.delete(client.ws)
    if (room.size === 0) {
      this.rooms.delete(message.projectId)
    } else {
      this.broadcastPresence(message.projectId)
    }
  }

  private handleCursorMove(client: ClientState, message: Extract<ClientToServerMessage, { type: 'cursor.move' }>): void {
    if (!client.rooms.has(message.projectId)) return
    const cursor: CursorPosition = { x: message.x, y: message.y }
    if (message.sheetId) cursor.sheetId = message.sheetId
    // Echo the cursor to everyone else in the room, not the sender.
    this.broadcastToRoom(
      message.projectId,
      { type: 'cursor', userId: client.userId, x: message.x, y: message.y, sheetId: message.sheetId },
      client.ws
    )
  }

  private handleOperation(client: ClientState, message: Extract<ClientToServerMessage, { type: 'operation' }>): void {
    if (!client.rooms.has(message.operation.projectId)) return
    this.broadcastToRoom(message.operation.projectId, { type: 'operation', operation: message.operation }, client.ws)
  }

  // ------------------------------------------------------------------
  // Broadcasting
  // ------------------------------------------------------------------

  /** Send the full presence list for a room to every client in that room. */
  private broadcastPresence(projectId: string): void {
    const room = this.rooms.get(projectId)
    if (!room) return

    const users: CollabUser[] = []
    for (const ws of room) {
      const client = this.clients.get(ws)
      if (client && client.userId) {
        users.push(createCollabUser(client.userId, client.displayName))
      }
    }

    const payload = JSON.stringify({ type: 'presence', users })
    for (const ws of room) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
      }
    }
  }

  /** Broadcast a message to every client in a room except an excluded socket. */
  private broadcastToRoom(
    projectId: string,
    message: ServerToClientMessage,
    excludeWs?: WebSocket
  ): void {
    const room = this.rooms.get(projectId)
    if (!room) return
    const payload = JSON.stringify(message)
    for (const ws of room) {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
      }
    }
  }

  private send(ws: WebSocket, message: ServerToClientMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  /** Remove a client from every room it belongs to, broadcasting presence updates. */
  private removeClientFromAllRooms(client: ClientState): void {
    const projectIds = Array.from(client.rooms)
    for (const projectId of projectIds) {
      client.rooms.delete(projectId)
      const room = this.rooms.get(projectId)
      if (!room) continue
      room.delete(client.ws)
      if (room.size === 0) {
        this.rooms.delete(projectId)
      } else {
        this.broadcastPresence(projectId)
      }
    }
  }
}

export const collabServer = new CollaborationServer()
