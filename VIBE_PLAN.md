# Blueprint PC — Gap Implementation Plan

**Project**: blueprint-pc — Electron + React EDA application (schematic → PCB → simulation → sourcing → manufacturing)

**Stack**: Electron 40 + React 19 + TypeScript + Tailwind v4 + Vite (electron-vite)

**Path**: `C:\Users\Nashin\Desktop\New folder (4)\blueprint-pc`

---

## Context

blueprint-pc already implements: schematic capture, multi-sheet, footprints, BOM/parts catalogue, sourcing scraping, DRC, Gerber export, netlist export, circuit simulation (SPICE-like), PCB layout (placement + Manhattan A* routing), signal integrity, thermal analysis, library management, real-time collaboration, 3D mechanical viewer.

**Gap**: Compared to production EDA tools (KiCad, EasyEDA, CircuitMaker, Flux, Altium), blueprint-pc lacks depth in routing, annotation/sync, manufacturing outputs, and rule enforcement — not breadth.

---

## Phase 1 — Quick Wins (self-contained, high value)

These build directly on existing code in `pcb-layout.ts`, `gerber.ts`, `drc.ts`, `store.ts`.

### T1.1 Pick-and-place / centroid file export
- **File**: `src/main/pickplace.ts` (new)
- **Function**: `generatePickPlace(placements, traces, pads)` → CSV with designator, X, Y, rotation, side, footprint
- **IPC**: `pcb:pick-place` handler + preload method `pcbPickPlace`
- **Why**: Unlocks SMT assembly; fabs/assemblers expect centroid files

### T1.2 Gerber X2 enhancement
- **File**: `src/main/gerber.ts` (modify)
- Add Gerber X2 attributes (`%TF.FileAttribute,X2*%`, metadata comments, `%LN*%` layer names)
- **Why**: Most fabs now prefer X2 over plain RS-274X

### T1.3 Canonical JSON project file format
- **File**: `src/main/store.ts` + `src/main/db.ts` (modify)
- Add deterministic JSON serialization of `Project` + `DesignSpec` (sorted keys, stable IDs, no timestamps in content hash)
- Add `.bpjson` import/export alongside `.bpzip`
- **Why**: Git-friendly diffs, offline work, merge-friendly collaboration

### T1.4 Real-time DRC during routing
- **File**: `src/main/pcb-layout.ts` (modify `routeTraces` + add `routeTraceIncremental`)
- Add DRC violation checking per-trace during routing (not just post-process)
- **IPC**: `pcb:route-trace-incremental` + `pcb:drc-realtime`
- **Why**: Violations visible while routing, not after export

### T1.5 STEP export + 3D mechanical clearance
- **File**: `src/main/step-export.ts` (new)
- Generate STEP AP203/AP214 from board geometry (board outline + traces as extrusions + pads)
- Add clearance checking in `src/main/mech-clearance.ts` (component-to-component, component-to-board-edge)
- **IPC**: `pcb:export-step`, `mech:clearance-check`
- **Why**: Enclosure fit is a hard gate for physical products

---

## Phase 2 — Production-Critical (harder, architectural)

### T2.1 Forward/backward annotation + ECO sync
- **Files**: `src/main/annotation.ts` (new), `src/main/eco.ts` (new)
- Link schematic component → PCB footprint via `footprintId` / `designator`
- Detect schematic→PCB divergences (new part, deleted part, changed net)
- Generate ECO (engineering change order) to apply to PCB
- **IPC**: `annotation:compare`, `eco:apply`
- **Why**: #1 cause of respins is schematic/PCB divergence

### T2.2 Push-and-shove routing
- **File**: `src/main/pcb-layout.ts` (replace/augment `routeTraces`)
- When a new trace crosses an existing trace, push the existing trace aside (rip-up + reroute)
- Add `pushShoveRoute()` with obstacle inflation + retry logic
- **Why**: Manual trace-moving makes multi-layer boards impractical

### T2.3 Differential-pair routing + length tuning
- **File**: `src/main/pcb-layout.ts` (modify)
- Define differential pairs (net pair: P/N)
- Route two traces together with fixed separation
- Add length tuning (meanders) to match pair lengths
- **IPC**: `pcb:route-differential-pair`, `pcb:tune-length`
- **Why**: USB/Ethernet/HDMI/PCIe designs impossible without it

### T2.4 IPC-2581 / ODB++ manufacturing output
- **File**: `src/main/ipc2581.ts` (new)
- XML-based complete manufacturing handoff (netlist, components, layers, drill, assembly)
- Alternative: ODB++ (proprietary, skip — use IPC-2581 as open standard)
- **IPC**: `pcb:export-ipc2581`
- **Why**: Complete manufacturing package beyond bare Gerber

---

## Phase 3 — High Value

### T3.1 3D viewer + mechanical clearance
- **File**: `src/renderer/src/pages/tabs/MechTab.tsx` (modify existing)
- Add component-to-component clearance heatmap (existing spike)
- Add board-edge clearance, keep-in/keep-out zones
- Add 3D collision detection (board + components + enclosure)
- **Why**: Physical fit is a hard requirement

### T3.2 Version-control-friendly / offline text format
- **File**: `src/main/store.ts` + `src/main/db.ts` (modify)
- Canonical JSON with deterministic ordering (see T1.3)
- Offline-first: all edits work locally, sync when online
- **Why**: Teams need Git diffing; users need offline work

### T3.3 Design variants + alternate BOM management
- **Files**: `src/shared/types.ts` (add `Variant`, `BomAlternative`), `src/main/variants.ts` (new)
- Variant = subset of components with different values/footprints
- Alternate BOM = substitute part per component (region, cost, obsolescence)
- **IPC**: `variants:create`, `variants:apply`, `bom:alternate`
- **Why**: Same board, different BOMs (region, cost, obsolescence)

---

## Acceptance Criteria (per phase)

Each phase is "done" when:
1. `npm run typecheck` passes (node + web)
2. `node scripts/selfcheck.ts` passes (all checks, including new ones for the phase)
3. `npm run build` passes
4. `npx playwright test` passes (4 E2E tests)
5. Changes committed to `master` and pushed to GitHub

---

## Files Touched

| File | Phase | Change |
|------|-------|--------|
| `src/main/pickplace.ts` | 1 | New — centroid CSV export |
| `src/main/gerber.ts` | 1 | Modify — Gerber X2 attributes |
| `src/main/store.ts` | 1,3 | Modify — canonical JSON, offline |
| `src/main/db.ts` | 1,3 | Modify — `.bpjson` import/export |
| `src/main/pcb-layout.ts` | 1,2 | Modify — real-time DRC, push-and-shove, diff pairs, length tuning |
| `src/main/step-export.ts` | 1 | New — STEP AP203/AP214 export |
| `src/main/mech-clearance.ts` | 1,3 | New — mechanical clearance checking |
| `src/main/annotation.ts` | 2 | New — schematic↔PCB annotation |
| `src/main/eco.ts` | 2 | New — ECO application |
| `src/main/ipc2581.ts` | 2 | New — IPC-2581 manufacturing output |
| `src/main/variants.ts` | 3 | New — design variants + alternate BOM |
| `src/main/ipc.ts` | 1,2,3 | Modify — new IPC handlers |
| `src/main/preload.ts` | 1,2,3 | Modify — new preload methods |
| `src/shared/types.ts` | 2,3 | Modify — variant/BOM/annotation types |
| `scripts/selfcheck.ts` | 1,2,3 | Modify — add self-checks for new code |

---

## Risks

- **Push-and-shove routing**: Complex algorithm; may need rip-up/reroute iterations. Mitigation: start with simple push (no full rip-up), validate on small boards.
- **STEP export**: STEP format is complex; keep to AP203 subset (extruded board + rectangular pads). Mitigation: verify with a STEP viewer.
- **Annotation/ECO**: Requires linking schematic designators to PCB footprints; needs `footprintId` on components. Mitigation: use existing `footprintId` field from footprint library work.
- **IPC-2581**: XML schema is large; implement minimal viable subset. Mitigation: focus on netlist + components + layers.
