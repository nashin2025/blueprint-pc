# Decision 002 — Phase 4 Workstream B: CAD Export (STEP/STL) Feasibility Spike

- **Date**: 2026-11-26
- **Council**: Product Council + Feature Council
- **Status**: Approved
- **Question**: Should Phase 4 include a client-side STEP/STL CAD export for designs? If so, how is it scoped?
- **Context**: Phase 3 (Project Library, .bpzip import/export) is complete and committed on branch feature/phase3-project-library. Three.js currently loads .stl/.obj/.gltf/.glb but cannot load .step. No solid-modelling kernel (OpenCASCADE-class) exists in the dependency tree. README documents "no real CAD export" as an honest limitation.

---

## Decision

**Approved as a 2-day time-boxed feasibility spike.** Not a committed implementation.

The spike investigates whether a client-side WASM solid-modelling kernel (OpenCASCADE.js, cadquery-wasm, or similar) can produce STEP and/or STL from already-loaded Three.js mesh data within Electron. If the answer is no, the limitation is documented and workstream ends. If yes, a follow-up implementation issue is created.

---

## Rationale Summary

### Why a spike, not a committed feature

| Concern | Reasoning |
|---------|-----------|
| STEP export requires a solid-modelling kernel | Viewing meshes (Three.js) ≠ generating B-Rep solid geometry. STEP from mesh is effectively reverse-engineering. |
| No kernel in the dependency tree | OpenCASCADE.js / cadquery-wasm would be a new, large dependency (~50MB+ WASM). Unproven in Electron. |
| STL-from-mesh is trivial; STEP-from-mesh is not | Binary STL from a mesh is straightforward. STEP requires constructive solid geometry, which meshes don't preserve. |
| Time-boxing prevents sink cost | 2 days maximum, then a documented go/no-go. Prevents months of wasted effort on an impossible path. |

### Possible outcomes

| Outcome | Action |
|---------|--------|
| **Go** — kernel produces valid STEP from mesh in Electron | Create implementation issue: build export pipeline, add "Export STEP/STL" button to MECH tab |
| **No-go** — kernel too large/slow, or cannot produce STEP from mesh | Document limitation in README. Consider lightweight alternative: "open source URL in browser" to let user download from original source |
| **Partial go** — STL works, STEP doesn't | Document STL as a quick win; STEP remains a limitation |

---

## Council Votes

### Product Council

| Member | Vote | Key Points |
|--------|------|------------|
| Product Strategist (Lead) | Approve | Addresses documented limitation. Even a "no-go" result is valuable — stops us from building something impossible. |
| Lean Delivery Lead | Approve | Time-boxing to 2 days is the right call. Prevents sink-cost on an unproven path. |
| Design Lead | Approve | Export to CAD is a pro-user feature; UI can be minimal (one export button). |
| Business Operations Lead | Approve | Zero new infrastructure if client-side works. If no-go, no sunk cost. |
| Principal Engineer | Concern | No OpenCASCADE-class kernel in deps. STL-from-mesh trivial; STEP-from-mesh not feasible. 2 days may not prove impossibility. |
| Frontend Specialist | Approve | If viable, UI is one export button + download. Low complexity. |

### Feature Council

| Member | Vote | Key Points |
|--------|------|------------|
| Principal Engineer (Lead) | Concern | Feasibility is the open question. Spike must produce concrete evidence, not just "we looked." |
| Frontend Specialist | Approve | UI is trivial if backend works. |
| Backend Specialist | Approve | File write + download IPC is straightforward. Kernel question is the only unknown. |
| QA Lead | Approve | If go, add self-checks for export round-trip. |

**Vote tally:** 5 Approve, 1 Concern (Principal Engineer — feasibility uncertainty)

---

## Action Items (Spike)

| # | Task | Size | Estimate |
|---|------|------|----------|
| B1 | Research OpenCASCADE.js / cadquery-wasm / alternative WASM kernels | S | 0.5 day |
| B2 | Prototype: load mesh in Three.js, attempt STEP export via candidate kernel | M | 1.0 day |
| B3 | Document go/no-go decision with technical evidence | XS | 0.5 day |

**Total: ~2 days** (hard time-box)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Kernel too large (>100MB WASM) for Electron | Time-box to 2 days; document no-go if size/prohibitive |
| STEP from mesh is fundamentally reverse-engineering | Document no-go; STL-from-mesh as possible quick win |
| 2 days insufficient to prove impossibility | Spike documents "inconclusive — needs server kernel investigation" |

---

## References

- README.md — documented limitation: "no real CAD export"
- src/renderer/src/pages/tabs/MechTab.tsx — existing Three.js CAD viewing (loads .stl/.obj/.gltf/.glb)
- Decision 001 — Phase 3 scope (deferred B and D to Phase 4)
