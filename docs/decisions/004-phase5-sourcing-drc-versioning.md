# Decision 004 — Phase 5: Component Sourcing, Design Rules, Version Control

- **Date**: 2026-11-26
- **Council**: Product Council + Feature Council
- **Status**: Approved
- **Question**: What should Phase 5 of Blueprint PC cover, and what is the implementation scope?
- **Context**: Phases 1–4 are complete and merged to master. The app generates hardware designs from prompts, manages a project library, imports/exports .bpzip bundles, and enriches part data from Schematik MCP. Documented limitations remain: no sourcing/cart, no design rule checking, no design versioning. PCB Layout (A) and Circuit Simulation (E) deferred to Phase 6 as feasibility spikes.

---

## Decision

**Approved scope — Phase 5 = Component Sourcing (B) + Design Rules/DRC (C) + Version Control (D).**

All three are local-first, frontend/backend integration work with no new infrastructure or dependencies. Total estimate: ~8 business days.

---

## Rationale Summary

### Candidate directions considered

| Direction | Addresses | Nature of work | Risk | Decision |
|-----------|-----------|----------------|------|----------|
| **B** Component sourcing | "Can't buy parts from the BOM" | Cart, retailer links, CSV export | Medium | **Include (MVP)** |
| **C** Design rules/DRC | "No error detection on designs" | Rule engine, violation UI | Medium | **Include (MVP)** |
| **D** Version control | "One version per project, no undo" | Version snapshots, diff, restore | Medium | **Include (MVP)** |
| **A** PCB layout | "No physical PCB layout" | Trace routing, footprint placement, DRC | **High** | **Defer to Phase 6** |
| **E** Circuit simulation | "No way to verify designs work" | SPICE-like numerical solver | **High** | **Defer to Phase 6** |

### Key decisions

1. **No real checkout/payment.** — Retailers don't all have APIs. Cart adds parts; clicking "buy" opens the retailer URL in the user's browser. Zero payment processing complexity.
2. **DRC runs on demand, not real-time.** — Running rule checks on every wire placement could be slow. User triggers DRC via button or on save.
3. **Versions are snapshots, not branches.** — For a single-user local app, "version control" means save points with diff and restore. No merge conflicts, no remote sync yet.
4. **Price staleness warning.** — Retailer prices are volatile. Show "price fetched X days ago" and flag stale prices (>7 days).

### Why A and E are deferred

- **A (PCB Layout)** requires a geometry kernel, collision detection, netlist-to-layout mapping — a major engineering spike with uncertain client-side feasibility.
- **E (Circuit Simulation)** requires a SPICE-like numerical solver — another major spike. Both deserve their own investigation before committing.

---

## Council Votes

### Product Council

| Member | Vote | Key Points |
|--------|------|------------|
| Product Strategist (Lead) | Approve | Addresses real gaps: sourcing parts, catching errors, saving design versions |
| Lean Delivery Lead | Approve | All three are integration work, no spikes. Shippable increment. |
| Design Lead | Approve | DRC violations need clear UI; versioning needs simple save/restore; sourcing needs clean retailer links |
| Business Operations Lead | Approve | Zero new infrastructure cost. Sourcing could drive affiliate revenue later. |
| Principal Engineer | Approve | SQLite already supports versioning. DRC is rule-based. Sourcing is redirect + cart state. |
| Frontend Specialist | Approve | Cart UI, violation badges, version selector — all clean frontend additions |

### Feature Council

| Member | Vote | Key Points |
|--------|------|------------|
| Principal Engineer (Lead) | Approve | Straightforward plan. SQLite already multi-project. DRC is rule-based, no new deps. |
| Frontend Specialist | Approve | Cart drawer, violation modal, version selector — clean UI additions. |
| Backend Specialist | Approve | Cart table, DRC rules, version snapshots — all straightforward SQLite/IPC work. |
| QA Lead | Approve | Add self-checks for DRC rules, cart operations, version diff. Add E2E for critical flows. |

**Vote tally:** 6 Approve, 0 Concern

---

## Action Items

### Backend

| # | Task | Size | Estimate | Dependencies |
|---|------|------|----------|--------------|
| B1 | DB: cart table + cart_items table | XS | 0.25 day | None |
| B2 | IPC: cart:add, cart:remove, cart:list, cart:clear, cart:export | S | 0.5 day | B1 |
| C1 | DRC engine: unconnected pins, duplicate designators, missing footprint | M | 1.0 day | Existing spec schema |
| C2 | IPC: design:run-drc, design:get-drc-violations | S | 0.5 day | C1 |
| D1 | DB: design_versions table (snapshot of spec JSON) | XS | 0.25 day | None |
| D2 | IPC: design:save-version, design:list-versions, design:restore-version, design:diff-versions | M | 1.0 day | D1 |

### Frontend

| # | Task | Size | Estimate | Dependencies |
|---|------|------|----------|--------------|
| B3 | Cart UI: add-to-cart button, cart drawer, export CSV | M | 1.0 day | B2 |
| C3 | DRC UI: violations modal, severity badges, run button | M | 1.0 day | C2 |
| D3 | Version UI: save version dialog, version list, restore confirmation | M | 1.0 day | D2 |
| B4 | Price staleness warning on part cards | S | 0.5 day | Existing fetchedAt |

### Testing

| # | Task | Size | Estimate |
|---|------|------|----------|
| T1 | Self-checks: DRC rules, cart operations, version diff | S | 0.5 day |
| T2 | E2E: add to cart, run DRC, save/restore version | S | 0.5 day |

**Total: ~8.0 business days** (Medium complexity)

**Sequencing:** DB → Backend IPC → Frontend → Testing

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Retailer prices go stale or 403 | Price staleness warning + fallback chain already exists |
| DRC false positives annoy user | Severity levels (error/warning/info), user decides what to fix |
| Version diff is hard to read | Show component count, title, and key field changes only |
| Cart state lost on refresh | Persist in SQLite immediately on add/remove |

---

## Success Metrics

1. User can add parts to cart and export as CSV
2. DRC catches unconnected pins and duplicate designators
3. User can save, list, and restore design versions

---

## References

- README.md — full current feature set and documented limitations
- `src/main/db.ts` — SQLite project database schema
- `src/main/ipc.ts` — existing IPC surface
- Decision 001 — Phase 3 scope
- Decision 002/003 — Phase 4 workstreams
