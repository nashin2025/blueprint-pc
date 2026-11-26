# Decision 005: Phase 6 — PCB Layout & Circuit Simulation Feasibility Spikes

- **Date**: 2026-11-26
- **Council**: Product Council + Feature Council
- **Status**: Approved
- **Question**: Is client-side PCB layout and circuit simulation feasible for Blueprint PC?
- **Context**: Phase 6 of the Blueprint PC roadmap explores two feasibility spikes: (A) PCB Layout — component placement, Manhattan trace routing, and design-rule checks; (E) Circuit Simulation — Modified Nodal Analysis (MNA) DC operating point and backward-Euler transient analysis. Both must run entirely client-side in the Electron renderer (no server, no native modules beyond what's already bundled).

## Council Votes

### Product Council
- **Product Strategist**: Approve — feasibility spikes are low-cost, high-value exploration before committing to implementation.
- **Lean Delivery Lead**: Approve — both spikes fit within Phase 6 (M, S-M effort) and defer commitment until results are known.
- **Design Lead**: Approve — PCB 3D visualization via Three.js (already bundled) aligns with existing CAD view patterns.
- **Business Operations Lead**: Approve — no new dependencies; uses existing Three.js bundle.
- **Principal Engineer**: Approve — pure TypeScript, zero imports, runs in renderer main thread or Web Worker.
- **Frontend Specialist**: Approve — Three.js output adapter pattern matches existing CAD view architecture.

### Feature Council
- **Principal Engineer**: Approve — both algorithms (greedy placement, A* Manhattan router, MNA + Gaussian elimination, Newton-Raphson, backward Euler) are straightforward to implement in pure TS.
- **Frontend Specialist**: Approve — Three.js geometry output adapter keeps renderer concerns separate.
- **Backend Specialist**: N/A — no backend changes.
- **QA Lead**: Approve — self-checks cover placement, routing, DRC, netlist parsing, MNA symmetry, DC convergence, transient response, and singular matrix detection.

## Decision

Both spikes are **feasible**:

### Workstream A — PCB Layout (Partially Feasible, ~3 business days)

**Verdict**: Partially feasible. Core algorithms work on small boards (<20 components). Not fabrication-grade — no rip-up/reroute, no copper pours, no differential pairs, no Gerber export.

**Approach**: Build from scratch in pure TypeScript (no suitable npm libraries found):
- Greedy component placement with AABB collision detection
- Manhattan A* trace router with turn penalties and obstacle inflation
- DRC: trace-to-trace, trace-to-pad, trace-to-via clearance checks
- Three.js output adapter: board plane, extruded traces, pads, vias, component boxes

**Files**: `src/main/pcb-layout.ts` (~500 lines, zero imports)

**Limitations**:
- Single-layer routing only
- No rip-up/reroute when a net can't be routed
- No via insertion mid-trace
- No copper pours or planes
- Gerber export not included

**Self-checks**: 15 checks covering placement, overlap detection, routing around obstacles, DRC violations, and Three.js geometry export — all passing.

### Workstream E — Circuit Simulation (Feasible, ~1-3 business days)

**Verdict**: Feasible. DC operating point and transient simulation work on small circuits (<50 nodes) entirely client-side.

**Approach**: Build from scratch in pure TypeScript (no suitable npm libraries found):
- DesignSpec → netlist parser (net names define electrical nodes)
- Modified Nodal Analysis (MNA) system builder
- Dense Gaussian elimination with partial pivoting (O(n³), trivial for n < 50)
- Newton-Raphson for nonlinear devices (diodes/LEDs with piecewise linear model)
- Backward-Euler transient analysis for capacitors and inductors

**Files**: `src/main/circuit-sim.ts` (~580 lines, zero imports)

**Limitations**:
- No BJT/MOSFET/BSIM models
- No AC analysis, no frequency domain
- No adaptive timestep
- Dense (not sparse) matrix — O(n³) limits to small circuits

**Self-checks**: 14 checks covering netlist parsing, MNA symmetry, DC convergence (resistor divider, LED circuit), transient RC response, singular matrix detection — all passing.

## Rationale Summary

- **No existing libraries**: npm search found no actively-maintained, dependency-light PCB layout or circuit simulation libraries suitable for Electron renderer use.
- **Pure TypeScript**: Both spikes use zero imports, zero Node modules — runs in renderer main thread or Web Worker.
- **Three.js reuse**: PCB 3D output uses the existing Three.js bundle (already bundled for CAD view).
- **Self-contained**: Each spike is a single file with comprehensive self-checks.

## Deferred Items

- PCB rip-up/reroute, copper pours, Gerber export → Phase 6 post-spike decision
- Circuit simulation BJT/MOSFET models, AC analysis, adaptive timestep → Phase 6 post-spike decision
- UI integration of PCB editor and simulator → Phase 6 post-spike decision

## References

- `src/main/pcb-layout.ts` — PCB layout spike implementation
- `src/main/circuit-sim.ts` — Circuit simulation spike implementation
- `scripts/selfcheck.ts` — Self-checks (PCB + circuit sections)
