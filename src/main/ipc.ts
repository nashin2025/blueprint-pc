import { dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { store } from './store'
import { loadSettings, saveSettings } from './settings'
import { requestDesign, LlmError, listNvidiaModels } from './ai/llm'
import { normaliseDesign } from './ai/normalise'
import { generateImage, generateSummary } from './ai/info'
import { loadImageDataUrl, saveImage } from './images'
import { resolvePartImage } from './partimages'
import { getOffers } from './offers'
import { addToCart, clearCart, database, exportCart, getOrCreateCart, listCartItems, removeFromCart } from './db'
import { countParts, getPart, lookupModel, searchParts, saveModelFilePathByUrl, savePart, staleParts } from './catalogue/db'
import { lastSyncAt, runSync, syncStatus, fetchPart } from './sync/schematik'
import { cadDiscoveryStatus, runCadDiscovery } from './sync/cad-discovery'
import { modelDownloadStatus, runModelDownload, downloadModelFile } from './sync/model-downloader'
import { searchSnapedaPart, getSnapeda3dUrl } from './snapeda'
import { login, logout, getSessionCookie, isAuthenticated } from './grabcad/auth'
import { searchGrabcadParts } from './grabcad/search'
import { getModelArchiveUrl, downloadAndExtractModel } from './grabcad/download'
import type { AppSettings, Component, Connection, DesignSpec, DielectricStackup, Footprint, GenerateRequest, HierarchicalBlock, InfoRequest, PcbDesignRules, Project, Sheet, SheetPort } from '@shared/types'
import { createBundle, extractBundle } from './zip'
import { runDrc, summarizeDrc } from './drc'
import { buildNetlist } from './netlist'
import { flattenHierarchy, expandBlockInPlace, validateBlock } from './hierarchical-design'
import { getDrcRules, saveDrcRules } from './drc-rules'
import { placeComponents, attachPads, routeTraces } from './pcb-layout'
import type { PcbPad, PcbVia } from './pcb-layout'
import { generateGerberFiles } from './gerber'
import { generateLandPattern } from './footprint-generator'
import { collabServer } from './collaboration'
import {
  analyseTrace,
  estimateCrosstalk,
  reflectionCoefficient,
  propagationDelayNs
} from './signal-integrity'

/**
 * Every IPC channel is registered once at startup. Each handler returns an
 * IpcResult so the renderer never has to distinguish "threw" from "returned a
 * falsy value" - it always gets { ok, data } or { ok, error }.
 */

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof LlmError) return { ok: false, error: err.message }
  if (err instanceof Error) return { ok: false, error: err.message }
  return { ok: false, error: 'Something went wrong.' }
}

const MODEL_EXTS = ['.stl', '.obj', '.gltf', '.glb']

function endsWithModelExt(url: string): boolean {
  const base = url.split('?')[0].split('#')[0].toLowerCase()
  return MODEL_EXTS.some((ext) => base.endsWith(ext))
}

/** Mirrors the grid layout used by the MechTab Three.js scene so the main
 *  process can compute component positions from a DesignSpec that stores no
 *  3D coordinates of its own. All values are in scene units (mm). */
export interface PositionedComponent {
  componentId: string
  name: string
  x: number
  y: number
  z: number
}

function gridComponentPositions(components: Component[]): PositionedComponent[] {
  const boxSize = 2.2
  const gridCols = Math.ceil(Math.sqrt(components.length))
  const gridRows = Math.ceil(components.length / gridCols)
  return components.map((part, i) => {
    const col = i % gridCols
    const row = Math.floor(i / gridCols)
    const x = (col - gridCols / 2) * boxSize
    const z = (row - gridRows / 2) * boxSize
    return { componentId: part.id, name: part.name, x, y: 0, z }
  })
}

/** Fetches a product page (main process, so no CORS) and returns the first direct
 *  link to a downloadable 3D model file, or null when none is found. A missing
 *  model is a normal outcome, not an error. */
async function findModelUrl(productUrl: string): Promise<string | null> {
  let controller: AbortController | null = null
  try {
    controller = new AbortController()
    const timer = setTimeout(() => controller?.abort(), 15000)
    const res = await fetch(productUrl, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const html = await res.text()
    const base = new URL(productUrl)
    const seen = new Set<string>()
    const attrRe = /(?:href|src)=["']([^"']+)["']/gi
    let match: RegExpExecArray | null
    while ((match = attrRe.exec(html)) !== null) {
      const raw = match[1]
      if (!raw || raw.startsWith('data:')) continue
      let abs: string
      try {
        abs = new URL(raw, base).href
      } catch {
        continue
      }
      if (seen.has(abs)) continue
      seen.add(abs)
      if (endsWithModelExt(abs)) return abs
    }
    return null
  } catch {
    return null
  } finally {
    controller = null
  }
}

export function registerIpc(): void {
  ipcMain.handle('projects:list', async (): Promise<Project[]> => {
    return store.list()
  })

  ipcMain.handle('projects:get', async (_e, id: string) => {
    return store.get(id)
  })

  ipcMain.handle('projects:save', async (_e, project: Project) => {
    return store.save(project)
  })

  ipcMain.handle('projects:delete', async (_e, id: string) => {
    return store.delete(id)
  })

  ipcMain.handle('projects:archive', async (_e, args: { id: string; archived: boolean }) => {
    return store.archive(args.id, args.archived)
  })

  ipcMain.handle('projects:purge', async (_e, id: string) => {
    return store.purge(id)
  })

  ipcMain.handle('projects:duplicate', async (_e, id: string) => {
    return store.duplicate(id)
  })

  ipcMain.handle('projects:export', async (_e, args: { id: string; outputPath: string }) => {
    return await createBundle(args.id, args.outputPath)
  })

  ipcMain.handle('projects:import', async (_e, zipPath: string) => {
    return await extractBundle(zipPath)
  })

  ipcMain.handle('projects:export-spec', async (_e, projectId: string) => {
    try {
      const project = store.get(projectId)
      if (!project) return { ok: false, error: `Project not found: ${projectId}` }
      const specJson = JSON.stringify(project.spec, null, 2)
      return { ok: true as const, data: { spec: specJson } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('projects:import-spec', async (_e, args: { spec: string }) => {
    try {
      const spec: DesignSpec = JSON.parse(args.spec)
      // Validate minimal structure
      if (!spec.title || !spec.components || !spec.connections || !spec.steps) {
        return { ok: false, error: 'Invalid spec: missing title, components, connections, or steps' }
      }
      const project: Project = {
        id: randomUUID(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        archived: false,
        spec,
        chat: [],
        versions: []
      }
      store.save(project)
      return { ok: true as const, data: { project } }
    } catch (err) {
      return fail(err)
    }
  })

  // -------------------------------------------------------------------------
  // Multi-sheet schematic support
  // -------------------------------------------------------------------------

  ipcMain.handle('sheets:add-sheet', async (_e, args: { projectId: string; name: string }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }
      const sheet: Sheet = {
        id: randomUUID(),
        name: args.name,
        x: 0,
        y: 0,
        width: 200,
        height: 150,
        connectionIds: [],
        portIds: []
      }
      const nextSpec: DesignSpec = {
        ...project.spec,
        sheets: [...(project.spec.sheets ?? []), sheet]
      }
      const next: Project = { ...project, spec: nextSpec, updatedAt: Date.now() }
      store.save(next)
      return { ok: true as const, data: { project: next, sheet } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(
    'sheets:rename-sheet',
    async (_e, args: { projectId: string; sheetId: string; name: string }) => {
      try {
        const project = store.get(args.projectId)
        if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }
        const nextSheets = (project.spec.sheets ?? []).map((s) =>
          s.id === args.sheetId ? { ...s, name: args.name } : s
        )
        const nextSpec: DesignSpec = { ...project.spec, sheets: nextSheets }
        const next: Project = { ...project, spec: nextSpec, updatedAt: Date.now() }
        store.save(next)
        return { ok: true as const, data: { project: next } }
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle('sheets:delete-sheet', async (_e, args: { projectId: string; sheetId: string }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }
      const sheet = (project.spec.sheets ?? []).find((s) => s.id === args.sheetId)
      if (!sheet) return { ok: false, error: `Sheet not found: ${args.sheetId}` }
      const nextSheets = (project.spec.sheets ?? []).filter((s) => s.id !== args.sheetId)
      const nextConnections = project.spec.connections.filter(
        (c) => c.sheetId !== args.sheetId && !sheet.connectionIds.includes(c.id)
      )
      const nextPorts = (project.spec.ports ?? []).filter((p) => p.sheetId !== args.sheetId)
      const nextSpec: DesignSpec = {
        ...project.spec,
        sheets: nextSheets,
        connections: nextConnections,
        ports: nextPorts
      }
      const next: Project = { ...project, spec: nextSpec, updatedAt: Date.now() }
      store.save(next)
      return { ok: true as const, data: { project: next } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(
    'sheets:add-port',
    async (_e, args: { projectId: string; sheetId: string; name: string; direction: 'input' | 'output' }) => {
      try {
        const project = store.get(args.projectId)
        if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }
        const port: SheetPort = {
          id: randomUUID(),
          sheetId: args.sheetId,
          name: args.name,
          x: 0,
          y: 0,
          direction: args.direction
        }
        const nextSheets = (project.spec.sheets ?? []).map((s) =>
          s.id === args.sheetId ? { ...s, portIds: [...s.portIds, port.id] } : s
        )
        const nextSpec: DesignSpec = {
          ...project.spec,
          sheets: nextSheets,
          ports: [...(project.spec.ports ?? []), port]
        }
        const next: Project = { ...project, spec: nextSpec, updatedAt: Date.now() }
        store.save(next)
        return { ok: true as const, data: { project: next, port } }
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle(
    'sheets:connect-port',
    async (_e, args: { projectId: string; portId1: string; portId2: string }) => {
      try {
        const project = store.get(args.projectId)
        if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }
        const ports = project.spec.ports ?? []
        const p1 = ports.find((p) => p.id === args.portId1)
        const p2 = ports.find((p) => p.id === args.portId2)
        if (!p1 || !p2) return { ok: false, error: 'One or both ports not found' }
        if (p1.direction === p2.direction) {
          return { ok: false, error: 'Cannot connect two ports of the same direction' }
        }
        const connection: Connection = {
          id: randomUUID(),
          sheetId: p1.sheetId,
          from: { componentId: p1.id, pin: p1.name },
          to: { componentId: p2.id, pin: p2.name },
          kind: 'signal',
          net: `sheet-link:${p1.id}:${p2.id}`
        }
        // Register the logical connection on every sheet it touches.
        const nextSheets = (project.spec.sheets ?? []).map((s) => {
          const ids = [...s.connectionIds]
          if (s.id === p1.sheetId && !ids.includes(connection.id)) ids.push(connection.id)
          if (s.id === p2.sheetId && !ids.includes(connection.id)) ids.push(connection.id)
          return { ...s, connectionIds: ids }
        })
        const nextSpec: DesignSpec = {
          ...project.spec,
          sheets: nextSheets,
          connections: [...project.spec.connections, connection]
        }
        const next: Project = { ...project, spec: nextSpec, updatedAt: Date.now() }
        store.save(next)
        return { ok: true as const, data: { project: next, connection } }
      } catch (err) {
        return fail(err)
      }
    }
  )

  // -------------------------------------------------------------------------
  // Hierarchical design (sub-circuits)
  // -------------------------------------------------------------------------

  ipcMain.handle('hierarchical:create-block', async (_e, args: { projectId: string; block: HierarchicalBlock }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }

      const nextBlocks = [...(project.spec.hierarchicalBlocks ?? []), args.block]
      const validation = validateBlock({ ...project.spec, hierarchicalBlocks: nextBlocks })
      if (!validation.valid) {
        return { ok: false, error: `Invalid block: ${validation.errors.join('; ')}` }
      }

      const nextSpec: DesignSpec = { ...project.spec, hierarchicalBlocks: nextBlocks }
      const next: Project = { ...project, spec: nextSpec, updatedAt: Date.now() }
      store.save(next)
      return { ok: true as const, data: { project: next, block: args.block } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('hierarchical:save-block', async (_e, args: { projectId: string; block: HierarchicalBlock }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }

      const nextBlocks = (project.spec.hierarchicalBlocks ?? []).map((b) =>
        b.id === args.block.id ? args.block : b
      )
      const validation = validateBlock({ ...project.spec, hierarchicalBlocks: nextBlocks })
      if (!validation.valid) {
        return { ok: false, error: `Invalid block: ${validation.errors.join('; ')}` }
      }

      const nextSpec: DesignSpec = { ...project.spec, hierarchicalBlocks: nextBlocks }
      const next: Project = { ...project, spec: nextSpec, updatedAt: Date.now() }
      store.save(next)
      return { ok: true as const, data: { project: next } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('hierarchical:delete-block', async (_e, args: { projectId: string; blockId: string }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }

      const block = (project.spec.hierarchicalBlocks ?? []).find((b) => b.id === args.blockId)
      if (!block) return { ok: false, error: `Block not found: ${args.blockId}` }

      const nextBlocks = (project.spec.hierarchicalBlocks ?? []).filter((b) => b.id !== args.blockId)
      // Remove any component instances of this block from the design.
      const nextComponents = project.spec.components.filter(
        (c) => c.hierarchicalBlockId !== args.blockId
      )
      const nextSpec: DesignSpec = {
        ...project.spec,
        hierarchicalBlocks: nextBlocks,
        components: nextComponents
      }
      const next: Project = { ...project, spec: nextSpec, updatedAt: Date.now() }
      store.save(next)
      return { ok: true as const, data: { project: next } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('hierarchical:expand-block', async (_e, args: { projectId: string; componentId: string }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }

      const comp = project.spec.components.find((c) => c.id === args.componentId)
      if (!comp || !comp.hierarchicalBlockId) {
        return { ok: false, error: `Component ${args.componentId} is not a hierarchical block instance` }
      }

      const nextSpec = expandBlockInPlace(project.spec, args.componentId)
      const validation = validateBlock(nextSpec)
      if (!validation.valid) {
        return { ok: false, error: `Expanded design is invalid: ${validation.errors.join('; ')}` }
      }

      const next: Project = { ...project, spec: nextSpec, updatedAt: Date.now() }
      store.save(next)
      return { ok: true as const, data: { project: next } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('hierarchical:get-block', async (_e, args: { projectId: string; blockId: string }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }

      const block = (project.spec.hierarchicalBlocks ?? []).find((b) => b.id === args.blockId)
      if (!block) return { ok: false, error: `Block not found: ${args.blockId}` }

      return { ok: true as const, data: { block } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('hierarchical:flatten', async (_e, projectId: string) => {
    try {
      const project = store.get(projectId)
      if (!project) return { ok: false, error: `Project not found: ${projectId}` }

      const flat = flattenHierarchy(project.spec)
      const validation = validateBlock(flat)
      if (!validation.valid) {
        return { ok: false, error: `Flattened design is invalid: ${validation.errors.join('; ')}` }
      }

      const next: Project = { ...project, spec: flat, updatedAt: Date.now() }
      store.save(next)
      return { ok: true as const, data: { project: next } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('projects:read-file', async (_e, filePath: string) => {
    try {
      const { readFileSync } = await import('node:fs')
      const content = readFileSync(filePath, 'utf-8')
      return { ok: true as const, data: { content } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('cart:getOrCreate', async (_e, projectId: string) => {
    try {
      return { ok: true as const, data: getOrCreateCart(projectId) }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('cart:add', async (_e, args: { cartId: string; componentId: string; quantity?: number; retailerUrl?: string; leadTimeDays?: number }) => {
    try {
      addToCart(args.cartId, args.componentId, args.quantity ?? 1, args.retailerUrl, args.leadTimeDays)
      return { ok: true as const }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('cart:remove', async (_e, args: { cartId: string; componentId: string }) => {
    try {
      const removed = removeFromCart(args.cartId, args.componentId)
      return { ok: true as const, data: { removed } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('cart:list', async (_e, cartId: string) => {
    try {
      return { ok: true as const, data: listCartItems(cartId) }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('cart:clear', async (_e, cartId: string) => {
    try {
      clearCart(cartId)
      return { ok: true as const }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('cart:export', async (_e, cartId: string) => {
    try {
      return { ok: true as const, data: exportCart(cartId) }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('cart:set-lead-time', async (_e, args: { cartId: string; componentId: string; leadTimeDays: number }) => {
    try {
      const conn = database()
      conn.prepare(
        'UPDATE cart_items SET lead_time_days = ? WHERE cart_id = ? AND component_id = ?'
      ).run(args.leadTimeDays, args.cartId, args.componentId)
      return { ok: true as const }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('design:export-netlist', async (_e, projectId: string) => {
    try {
      const project = store.get(projectId)
      if (!project) return { ok: false, error: `Project not found: ${projectId}` }
      return { ok: true as const, data: { netlist: buildNetlist(project.spec) } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('design:run-drc', async (_e, projectId: string) => {
    try {
      const project = store.get(projectId)
      if (!project) return { ok: false, error: `Project not found: ${projectId}` }
      const rules = getDrcRules(projectId)
      const violations = runDrc(project.spec, rules)
      const summary = summarizeDrc(violations)
      return { ok: true as const, data: { violations, summary, rules } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('drc:get-rules', async (_e, projectId: string) => {
    try {
      const rules = getDrcRules(projectId)
      return { ok: true as const, data: rules }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('drc:save-rules', async (_e, args: { projectId: string; rules: PcbDesignRules }) => {
    try {
      saveDrcRules(args.projectId, args.rules)
      return { ok: true as const }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('pcb:export-gerber', async (_e, projectId: string) => {
    try {
      const project = store.get(projectId)
      if (!project) return { ok: false, error: `Project not found: ${projectId}` }
      const { spec } = project

      const boardW = 100 // 100mm board
      const boardH = 80  // 80mm board

      // Place components
      const componentIds = spec.components.map((c) => c.id)
      const names = Object.fromEntries(spec.components.map((c) => [c.id, c.name]))
      const { placements } = placeComponents(componentIds, names, boardW, boardH)

      // Attach pads to placements
      const pinNamesByComponent = Object.fromEntries(
        spec.components.map((c) => [c.id, c.pins])
      )
      const placed = attachPads(placements, pinNamesByComponent)

      // Build pad lookup: "componentId:pinName" -> PcbPad
      const padLookup = new Map<string, PcbPad>()
      for (const p of placed) {
        for (const pad of p.pads) {
          padLookup.set(`${p.componentId}:${pad.pinName}`, pad)
        }
      }

      // Route traces
      const routeConnections = spec.connections.map((conn) => ({
        net: conn.net ?? 'NET_1',
        fromPin: padLookup.get(`${conn.from.componentId}:${conn.from.pin}`)!,
        toPin: padLookup.get(`${conn.to.componentId}:${conn.to.pin}`)!,
      }))
      const { traces, unrouted } = routeTraces(
        routeConnections,
        placed,
        boardW,
        boardH,
        1,
        0.25
      )

      // Collect all pads
      const allPads = placed.flatMap((p) => p.pads)
      const vias: PcbVia[] = [] // Simple router has no vias

      // Generate Gerber files
      const files = generateGerberFiles(placed, traces, allPads, vias)

      return {
        ok: true as const,
        data: { files, unrouted, boardW, boardH },
      }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('pcb:clearance-check', async (_e, args: { projectId: string; clearance: number }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }
      const clearance = Math.max(0, Number(args.clearance) || 0)
      const positions = gridComponentPositions(project.spec.components)
      const violations: Array<{
        componentId1: string
        componentId2: string
        name1: string
        name2: string
        distance: number
        clearance: number
      }> = []
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const a = positions[i]
          const b = positions[j]
          const dx = a.x - b.x
          const dz = a.z - b.z
          const distance = Math.sqrt(dx * dx + dz * dz)
          // Zero distance means two components share a grid cell; ignore rather
          // than report a spurious violation on overlapping primitives.
          if (distance > 0 && distance < clearance) {
            violations.push({
              componentId1: a.componentId,
              componentId2: b.componentId,
              name1: a.name,
              name2: b.name,
              distance,
              clearance,
            })
          }
        }
      }
      return { ok: true as const, data: { violations, clearance } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('pcb:measure-distance', async (_e, args: { projectId: string; compId1: string; compId2: string }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }
      const positions = gridComponentPositions(project.spec.components)
      const byId = new Map(positions.map((p) => [p.componentId, p]))
      const a = byId.get(args.compId1)
      const b = byId.get(args.compId2)
      if (!a || !b) return { ok: false, error: 'One or both components not found' }
      const dx = a.x - b.x
      const dz = a.z - b.z
      const distance = Math.sqrt(dx * dx + dz * dz)
      return { ok: true as const, data: { componentId1: args.compId1, componentId2: args.compId2, distance } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('footprints:add', async (_e, args: { projectId: string; footprint: Footprint }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }
      const nextSpec: typeof project.spec = {
        ...project.spec,
        footprints: [...(project.spec.footprints ?? []), args.footprint]
      }
      await store.save({ ...project, spec: nextSpec })
      return { ok: true as const, data: { project: { ...project, spec: nextSpec } } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('footprints:update', async (_e, args: { projectId: string; footprint: Footprint }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }
      const nextFootprints = (project.spec.footprints ?? []).map((f) =>
        f.id === args.footprint.id ? args.footprint : f
      )
      const nextSpec: typeof project.spec = {
        ...project.spec,
        footprints: nextFootprints
      }
      await store.save({ ...project, spec: nextSpec })
      return { ok: true as const, data: { project: { ...project, spec: nextSpec } } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('footprints:delete', async (_e, args: { projectId: string; footprintId: string }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }
      const nextFootprints = (project.spec.footprints ?? []).filter((f) => f.id !== args.footprintId)
      const nextSpec: typeof project.spec = {
        ...project.spec,
        footprints: nextFootprints
      }
      await store.save({ ...project, spec: nextSpec })
      return { ok: true as const, data: { project: { ...project, spec: nextSpec } } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('footprints:generate-land-pattern', async (_e, args: { kind: string; params: Record<string, number> }) => {
    try {
      const footprint = generateLandPattern({
        kind: args.kind as any,
        ...args.params
      } as any)
      return { ok: true as const, data: { footprint } }
    } catch (err) {
      return fail(err)
    }
  })

  // -------------------------------------------------------------------------
  // Signal integrity analysis
  // -------------------------------------------------------------------------

  ipcMain.handle('si:analyse-trace', async (_e, args: {
    traceWidthMm: number
    traceLengthMm: number
    stackup: DielectricStackup
    targetImpedanceOhms?: number
    aggressorTrace?: {
      widthMm: number
      separationMm: number
      heightMm: number
      lengthMm: number
      er: number
      riseTimeNs: number
    }
  }) => {
    try {
      const result = analyseTrace({
        traceWidthMm: args.traceWidthMm,
        traceLengthMm: args.traceLengthMm,
        stackup: args.stackup,
        targetImpedanceOhms: args.targetImpedanceOhms,
        aggressorTrace: args.aggressorTrace
      })
      return { ok: true as const, data: { result } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('si:estimate-crosstalk', async (_e, args: {
    widthMm: number
    separationMm: number
    heightMm: number
    lengthMm: number
    er: number
    riseTimeNs: number
  }) => {
    try {
      const result = estimateCrosstalk(args)
      return { ok: true as const, data: { result } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('si:reflection-coefficient', async (_e, args: { z1Ohms: number; z2Ohms: number }) => {
    try {
      const gamma = reflectionCoefficient(args.z1Ohms, args.z2Ohms)
      return { ok: true as const, data: { gamma } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('si:propagation-delay', async (_e, args: { effectiveEr: number; lengthMm: number }) => {
    try {
      const delay = propagationDelayNs(args.effectiveEr, args.lengthMm)
      return { ok: true as const, data: { delayNs: delay } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('design:save-version', async (_e, args: { projectId: string; label: string; prompt?: string }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }
      const id = `${args.projectId}_ver_${Date.now()}`
      const now = Date.now()
      store.saveVersion(args.projectId, {
        id,
        label: args.label,
        createdAt: now,
        prompt: args.prompt ?? undefined,
        spec: project.spec
      })
      return { ok: true as const, data: { id, createdAt: now } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('design:list-versions', async (_e, projectId: string) => {
    try {
      const project = store.get(projectId)
      if (!project) return { ok: false, error: `Project not found: ${projectId}` }
      return { ok: true as const, data: project.versions }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('design:restore-version', async (_e, args: { projectId: string; versionId: string }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }
      const version = project.versions.find((v) => v.id === args.versionId)
      if (!version) return { ok: false, error: `Version not found: ${args.versionId}` }
      const restored: Project = {
        ...project,
        spec: version.spec,
        updatedAt: Date.now(),
        versions: [...project.versions, {
          id: `${args.projectId}_ver_restored_${Date.now()}`,
          label: `Restored: ${version.label}`,
          createdAt: Date.now(),
          spec: version.spec
        }]
      }
      store.save(restored)
      return { ok: true as const, data: restored }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('design:diff-versions', async (_e, args: { projectId: string; versionId1: string; versionId2: string }) => {
    try {
      const project = store.get(args.projectId)
      if (!project) return { ok: false, error: `Project not found: ${args.projectId}` }
      const v1 = project.versions.find((v) => v.id === args.versionId1)
      const v2 = project.versions.find((v) => v.id === args.versionId2)
      if (!v1 || !v2) return { ok: false, error: 'One or both versions not found' }

      const s1 = v1.spec
      const s2 = v2.spec

      const diff: {
        titleChanged: boolean
        componentsAdded: number
        componentsRemoved: number
        componentsChanged: number
        connectionsAdded: number
        connectionsRemoved: number
      } = {
        titleChanged: s1.title !== s2.title,
        componentsAdded: s2.components.length - s1.components.length > 0 ? s2.components.length - s1.components.length : 0,
        componentsRemoved: s1.components.length - s2.components.length > 0 ? s1.components.length - s2.components.length : 0,
        componentsChanged: 0,
        connectionsAdded: s2.connections.length - s1.connections.length > 0 ? s2.connections.length - s1.connections.length : 0,
        connectionsRemoved: s1.connections.length - s2.connections.length > 0 ? s1.connections.length - s2.connections.length : 0
      }

      // Count changed components (same id, different properties)
      const c1ById = new Map(s1.components.map((c) => [c.id, c]))
      const c2ById = new Map(s2.components.map((c) => [c.id, c]))
      for (const [id, c2] of c2ById) {
        const c1 = c1ById.get(id)
        if (c1 && (c1.name !== c2.name || c1.partName !== c2.partName || c1.quantity !== c2.quantity)) {
          diff.componentsChanged++
        }
      }

      return { ok: true as const, data: { diff, v1, v2 } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('settings:load', async (): Promise<AppSettings> => {
    return loadSettings()
  })

  ipcMain.handle('settings:save', async (_e, settings: AppSettings) => {
    return saveSettings(settings)
  })

  ipcMain.handle('offers:get', async (_e, partName: string, force?: boolean) => {
    try {
      const result = await getOffers(partName, force === true)
      return { ok: true as const, data: result }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('app:showDataFolder', async () => {
    await shell.showItemInFolder(store.dataFilePath())
    return true
  })

  ipcMain.handle('app:openFilePicker', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import .bpzip project bundle',
      filters: [{ name: 'Blueprint PC Project', extensions: ['bpzip'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }
    return { canceled: false, filePath: result.filePaths[0] }
  })

  ipcMain.handle('design:generate', async (_e, req: GenerateRequest) => {
    try {
      const raw = await requestDesign({
        provider: req.provider,
        apiKey: req.apiKey,
        model: req.model,
        prompt: req.prompt,
        currentSpec: req.currentSpec
      })
      const spec: DesignSpec = normaliseDesign(raw)
      return { ok: true as const, data: spec }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('nvidia:models', async (_e, apiKey: string) => {
    try {
      const models = await listNvidiaModels(apiKey)
      return { ok: true as const, data: models }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('info:summarize', async (_e, req: InfoRequest) => {
    try {
      const summary = await generateSummary(req.spec, {
        provider: req.provider,
        apiKey: req.apiKey,
        model: req.model
      })
      return { ok: true as const, data: summary }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('info:image', async (_e, req: InfoRequest) => {
    try {
      const image = await generateImage(req.spec, {
        provider: req.provider,
        apiKey: req.apiKey,
        model: req.model
      })
      // Persist on disk and hand back only the filename, so projects.json stays
      // small even when a design is regenerated several times.
      const imageFile = saveImage(image.base64, image.mime)
      return { ok: true as const, data: imageFile }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('images:load', async (_e, filename: string) => {
    return { ok: true as const, data: loadImageDataUrl(filename) }
  })

  ipcMain.handle('partimage:resolve', async (_e, args: { imageUrl?: string; productUrl?: string; query?: string }) => {
    try {
      // Returns null for "no photo found", which is a normal outcome, not an error.
      const filename = await resolvePartImage(args.imageUrl, args.productUrl, args.query)
      return { ok: true as const, data: filename }
    } catch (err) {
      return fail(err)
    }
  })

  // -------------------------------------------------------------------------
  // Local parts catalogue
  // -------------------------------------------------------------------------

  ipcMain.handle('catalogue:status', async () => {
    try {
      return {
        ok: true as const,
        data: { progress: syncStatus(), lastSyncAt: lastSyncAt(), count: countParts() }
      }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:search', async (_e, args: { query: string; limit?: number }) => {
    try {
      return { ok: true as const, data: searchParts(args.query, args.limit ?? 20) }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:get', async (_e, slug: string) => {
    try {
      return { ok: true as const, data: getPart(slug) }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:sync', async (_e, batch?: number) => {
    try {
      // The sync is slow by design; it does not block startup.
      const progress = await runSync(batch)
      return { ok: true as const, data: progress }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:refresh-part', async (_e, slug: string) => {
    try {
      const part = await fetchPart(slug)
      if (!part) return { ok: false, error: `Part not found in Schematik: ${slug}` }
      savePart(part)
      return { ok: true as const, data: { slug: part.slug, name: part.name, fetchedAt: part.fetchedAt } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:stale-parts', async (_e, maxAgeDays: number) => {
    try {
      return { ok: true as const, data: staleParts(maxAgeDays) }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:find-model-url', async (_e, args: { productUrl: string; partName?: string }) => {
    try {
      // 1. Try the part's product page first: scrape direct .stl/.obj/.gltf/.glb links.
      const pageModelUrl = await findModelUrl(args.productUrl)
      if (pageModelUrl) return { ok: true as const, data: pageModelUrl }

      // 2. Fall back to SnapEDA: search by part name, then extract the signed
      //    S3 GLB URL from its 3D viewer page. Keyless, no account needed.
      //    SnapEDA is behind Cloudflare (403) - blocked is reported so the UI
      //    can tell the user manual paste is the reliable path.
      if (args.partName) {
        const part = await searchSnapedaPart(args.partName)
        if (part.ok && part.data) {
          const snapedaUrl = await getSnapeda3dUrl(part.data.modelId, part.data.unipartId)
          if (snapedaUrl.ok && snapedaUrl.data) return { ok: true as const, data: snapedaUrl.data }
        }
        // SnapEDA blocked (403) or no match - fall through to return null.
        // The blocked flag isn't surfaced here; cad-discovery-status covers it.
      }

      // null = no model link found anywhere, which is a normal outcome.
      return { ok: true as const, data: null }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:cad-discovery-status', async () => {
    try {
      return { ok: true as const, data: cadDiscoveryStatus() }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:run-cad-discovery', async (_e, batch?: number) => {
    try {
      const progress = await runCadDiscovery(batch)
      return { ok: true as const, data: progress }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:lookup-model', async (_e, args: { name: string; partNumber?: string }) => {
    try {
      const result = lookupModel(args.name, args.partNumber)
      return { ok: true as const, data: result }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:download-model-by-url', async (_e, args: { modelUrl: string }) => {
    try {
      const localPath = await downloadModelFile(args.modelUrl)
      if (!localPath) return { ok: false, error: 'Download failed' }
      saveModelFilePathByUrl(args.modelUrl, localPath)
      return { ok: true as const, data: localPath }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:model-download-status', async () => {
    try {
      return { ok: true as const, data: modelDownloadStatus() }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:run-model-download', async (_e, batch?: number) => {
    try {
      const progress = await runModelDownload(batch)
      return { ok: true as const, data: progress }
    } catch (err) {
      return fail(err)
    }
  })

  // -------------------------------------------------------------------------
  // GrabCAD Community Library (authenticated, Playwright-backed)
  // -------------------------------------------------------------------------

  ipcMain.handle('catalogue:grabcad-status', async () => {
    try {
      return { ok: true as const, data: { authenticated: isAuthenticated() } }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:grabcad-login', async (_e, args: { email: string; password: string }) => {
    try {
      return await login(args.email, args.password)
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:grabcad-logout', async () => {
    try {
      logout()
      return { ok: true as const, data: null }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:grabcad-search', async (_e, args: { query: string }) => {
    try {
      const sessionCookie = getSessionCookie()
      if (!sessionCookie) {
        return { ok: false, error: 'Not logged in to GrabCAD. Sign in first.' }
      }
      return await searchGrabcadParts(args.query, sessionCookie)
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('catalogue:grabcad-download', async (_e, args: { slug: string }) => {
    try {
      const sessionCookie = getSessionCookie()
      if (!sessionCookie) {
        return { ok: false, error: 'Not logged in to GrabCAD. Sign in first.' }
      }

      // 1. Resolve the model slug to its CloudFront archive URL.
      const archiveRes = await getModelArchiveUrl(args.slug, sessionCookie)
      if (!archiveRes.ok) return { ok: false, error: archiveRes.error }

      // 2. Download the ZIP from CloudFront and extract CAD files to disk.
      const downloadRes = await downloadAndExtractModel(archiveRes.data.archiveUrl, args.slug)
      if (!downloadRes.ok) return { ok: false, error: downloadRes.error }

      // Save the first extracted CAD file path back to the catalogue DB keyed
      // by model URL, so future lookups can find it. We don't have a catalogue
      // slug for a GrabCAD model, so we key by the archive URL instead.
      const firstFile = downloadRes.data.files[0]
      if (firstFile) {
        saveModelFilePathByUrl(archiveRes.data.archiveUrl, firstFile)
      }

      return {
        ok: true as const,
        data: {
          slug: args.slug,
          archiveUrl: archiveRes.data.archiveUrl,
          files: downloadRes.data.files,
          extractDir: downloadRes.data.zipPath,
          localFile: firstFile ?? null
        }
      }
    } catch (err) {
      return fail(err)
    }
  })

  // -------------------------------------------------------------------------
  // Real-time collaboration
  // -------------------------------------------------------------------------

  ipcMain.handle('collaboration:start', async (_e, port?: number) => {
    try {
      const result = collabServer.start(port)
      if (result.ok) {
        return { ok: true as const, data: { port: result.port } }
      }
      return { ok: false as const, error: result.error }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('collaboration:stop', async () => {
    try {
      const result = collabServer.stop()
      if (result.ok) {
        return { ok: true as const }
      }
      return { ok: false as const, error: result.error }
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle('collaboration:status', async () => {
    try {
      return { ok: true as const, data: collabServer.status() }
    } catch (err) {
      return fail(err)
    }
  })
}