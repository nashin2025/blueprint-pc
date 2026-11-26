# Decision 003 — Phase 4 Workstream D: Schematik MCP Part Data Enrichment

- **Date**: 2026-11-26
- **Council**: Product Council + Feature Council
- **Status**: Approved
- **Question**: Should Phase 4 enrich part data (descriptions, pinouts, prices) from the keyless Schematik MCP instead of/in addition to brittle retailer scraping?
- **Context**: Phase 3 is complete. `src/main/sync/schematik.ts` already implements a keyless MCP client (`tools/call` → `get_part`), sitemap enumeration, and bounded resumable sync (40 parts/run, 400ms gap). `src/main/catalogue/db.ts` has a SQLite `parts` table with `description`, `price_text`, `price_value`, `pinout` columns and `fetched_at` timestamp. Retailer scraping is brittle (eBay=403, Amazon/CAPTCHA, price parsing from display text).

---

## Decision

**Approved.** Wire the existing Schematik MCP client into part library and part detail views. Cache results in SQLite with a 7-day staleness policy plus explicit per-part refresh. Fallback chain: Schematik → retailer scrape → category glyph (no regression in coverage).

---

## Rationale Summary

### Why Schematik MCP

| Problem with current state | Schematik MCP solution |
|---------------------------|------------------------|
| Retailer scraping is brittle (eBay returns 403, Amazon CAPTCHA) | Keyless MCP, no account needed |
| Price parsing from display text ("from 3.95 EUR") | Structured price value + currency from source |
| Part descriptions come from AI model (may hallucinate) | Real descriptions from the part database |
| Pinouts are AI-generated suggestions | Structured pinouts from source |
| No cache freshness — parts fetched once, never refreshed | `fetched_at` column exists; staleness policy added |

### Staleness policy: 7 days + explicit refresh

| Decision | Reasoning |
|----------|-----------|
| Refresh after 7 days | Balances freshness with politeness to the free source |
| Explicit per-part refresh button | User can force-refresh a part they know changed |
| No automatic bulk re-fetch | Would hammer the source; violates "be a good guest" principle |
| Fallback: Schematik → retailer scrape → glyph | Never regress coverage if MCP is unavailable |

### Why not replace retailer scraping entirely

Schematik may not cover all 6,000+ parts. The fallback chain ensures the app never shows less data than it does today.

---

## Council Votes

### Product Council

| Member | Vote | Key Points |
|--------|------|------------|
| Product Strategist (Lead) | Approve | Real descriptions and pinouts are a genuine UX improvement over AI-generated guesses. |
| Lean Delivery Lead | Approve | MCP client already exists — this is integration work, not a spike. Shippable increment. |
| Design Lead | Approve | Part detail view gets real data; fallback chain prevents regressions. |
| Business Operations Lead | Approve | Keyless MCP = zero cost. Better part data = more trustworthy BOM prices. |
| Principal Engineer | Approve | SQLite cache already exists for catalogue. Staleness policy (7 days) is straightforward. |
| Frontend Specialist | Approve | Part library and detail views already exist; just swap data sources. |

### Feature Council

| Member | Vote | Key Points |
|--------|------|------------|
| Principal Engineer (Lead) | Approve | Straightforward integration. `fetched_at` column already present. |
| Frontend Specialist | Approve | Part library/detail exist; wire in new data sources. |
| Backend Specialist | Approve | IPC handlers for on-demand refresh + staleness check. Cache invalidation via `fetched_at`. |
| QA Lead | Approve | Add self-checks for staleness logic and fallback chain. |

**Vote tally:** 6 Approve, 0 Concern

---

## Action Items

### Backend

| # | Task | Size | Estimate | Dependencies |
|---|------|------|----------|--------------|
| D1 | IPC: `catalogue:refresh-part(slug)` — on-demand Schematik fetch + cache update | S | 0.5 day | Existing MCP client (`fetchPart`) |
| D2 | IPC: `catalogue:stale-parts(maxAgeDays)` — list parts older than N days | XS | 0.25 day | Existing `fetched_at` column |
| D3 | Staleness check helper: `isStale(fetchedAt, maxAgeDays)` | XS | 0.25 day | None |

### Frontend

| # | Task | Size | Estimate | Dependencies |
|---|------|------|----------|--------------|
| D4 | Part detail view: show Schematik description + structured pinouts | M | 1.0 day | D1, D2 |
| D5 | Part library: staleness indicator + per-part refresh button | S | 0.5 day | D2 |
| D6 | Fallback chain UI: Schematik → retailer scrape → category glyph | S | 0.5 day | D4 |

### Testing

| # | Task | Size | Estimate |
|---|------|------|----------|
| D7 | Self-checks: staleness logic, fallback chain, pinout normalisation | S | 0.5 day |

**Total: ~4.0 days**

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Schematik MCP changes or disappears | Fallback chain: Schematik → retailer scrape → glyph |
| Stale cached data misleads user | 7-day staleness + explicit refresh button per part |
| Third-party pin data incorrect | Treat as suggestion (same as current AI-generated pins) |
| MCP rate limits bulk enrichment | Bounded batches (40/run), 400ms gap — already implemented |

---

## Success Metrics

1. Part detail view shows Schematik description and structured pinouts when available
2. Part prices fall back gracefully when Schematik is unavailable
3. No regression in part coverage (same number of parts with usable data as today)

---

## References

- `src/main/sync/schematik.ts` — existing MCP client (`fetchPart`, `runSync`)
- `src/main/catalogue/db.ts` — SQLite parts table with `fetched_at`, `description`, `pinout`
- Decision 001 — Phase 3 scope (deferred D to Phase 4)
