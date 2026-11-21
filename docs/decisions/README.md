# Architecture Decision Records

Short notes recording significant decisions made during the project. Keep them light: what was decided, what was considered, why this choice won.

## Convention

**Filename:** `NNNN-short-title.md` — e.g. `0001-use-sqlite-for-local-storage.md`. Numbers are sequential and never reused, even if a decision is later superseded.

**Format:** free-form prose, but at minimum cover:

- **Decision** — what we're doing
- **Alternatives** — what else was on the table
- **Reasoning** — why this won
- **Status** — proposed / accepted / superseded by NNNN

## Index

| Number | Title | Status | Date |
|--------|-------|--------|------|
| 0001 | [Foundational Architecture Decisions](0001-foundational-architecture.md) | accepted | 2026-04-27 |
| 0002 | [Desktop Shell: Tauri + Python Sidecar](0002-desktop-shell-tauri-sidecar.md) | accepted | 2026-06-14 |
| 0003 | [Backend/Frontend Frameworks & Python Tooling](0003-framework-and-tooling.md) | accepted | 2026-06-14 |
| 0004 | [Schema Migration Strategy: Hand-Rolled SQL Runner](0004-schema-migrations.md) | accepted | 2026-06-14 |
| 0005 | [Scryfall Card Data Schema](0005-scryfall-card-schema.md) | accepted | 2026-06-14 |
| 0006 | [Scryfall Bulk Import Strategy](0006-bulk-import.md) | accepted, full replace superseded by 0019 | 2026-06-15 |
| 0007 | [Scryfall Auto-Refresh Mechanism](0007-auto-refresh.md) | accepted | 2026-06-16 |
| 0008 | [Card Name Search (FTS5 Trigram)](0008-card-name-search.md) | accepted | 2026-06-16 |
| 0009 | [Inventory Schema](0009-inventory-schema.md) | accepted | 2026-06-16 |
| 0010 | [Frontend Testing and Routing Stack](0010-frontend-testing-and-routing.md) | accepted | 2026-06-17 |
| 0011 | [Bulk Onboarding Backend (resolution + atomic bulk inscribe)](0011-bulk-onboarding-backend.md) | accepted | 2026-06-17 |
| 0012 | [Decklist Paste Onboarding (parser + UI)](0012-decklist-paste-onboarding.md) | accepted | 2026-06-17 |
| 0013 | [CSV Import Onboarding (Manabox / Deckbox / Archidekt)](0013-csv-import-onboarding.md) | accepted | 2026-06-18 |
| 0014 | [Visual Identity & Design Tokens](0014-visual-identity-and-design-tokens.md) | accepted | 2026-06-18 |
| 0015 | [End-to-End Testing with Playwright](0015-e2e-playwright.md) | accepted | 2026-06-18 |
| 0016 | [Inventory Browse Surface and Server-State Caching](0016-inventory-browse-and-data-fetching.md) | accepted | 2026-08-23 |
| 0017 | [Component Layer Convention](0017-component-layer-convention.md) | accepted | 2026-09-10 |
| 0018 | [Deck Schema](0018-deck-schema.md) | accepted | 2026-10-02 |
| 0019 | [Importer Upsert and Guarded Sweep](0019-importer-upsert-and-sweep.md) | accepted | 2026-10-08 |
| 0020 | [Reservation rule](0020-reservation-rule.md) | accepted | 2026-10-08 |
| 0021 | [Inventory search API](0021-inventory-search-api.md) | accepted | 2026-10-12 |
| 0022 | [The Index browse view](0022-the-index-browse-view.md) | accepted | 2026-10-13 |
| 0023 | [Backups and export](0023-backups-and-export.md) | accepted | 2026-10-15 |
| 0024 | [Shrunk backups and daily copies](0024-shrunk-backups-and-daily-copies.md) | accepted | 2026-10-16 |
| 0025 | [Scanner capture and recognition contract](0025-scanner-capture-and-recognition-contract.md) | accepted | 2026-10-22 |
| 0026 | [Scanner recognition engine and name match](0026-scanner-recognition-engine-and-name-match.md) | accepted | 2026-10-27 |
| 0027 | [Scanner corner read pins the printing](0027-scanner-corner-read-pins-the-printing.md) | accepted | 2026-10-29 |
| 0028 | [Tesseract as the second scanner engine](0028-tesseract-as-the-second-scanner-engine.md) | accepted | 2026-10-29 |
| 0029 | [A set code one misread glyph off pins under the near set](0029-near-set-code-pins-the-printing.md) | accepted | 2026-11-02 |
| 0030 | [Self-hosted variable fonts from upstream](0030-self-hosted-variable-fonts.md) | accepted | 2026-11-05 |
| 0031 | [The leaf layout](0031-the-leaf-layout.md) | accepted | 2026-11-06 |
| 0032 | [Refresh failure record and single flight](0032-refresh-failure-record-and-single-flight.md) | accepted | 2026-11-12 |
| 0033 | [The ledger and the lit plate](0033-the-ledger-and-the-lit-plate.md) | accepted | 2026-11-12 |
| 0034 | [The ledger on every page](0034-the-ledger-on-every-page.md) | accepted | 2026-11-16 |
| 0035 | [The house seal](0035-the-house-seal.md) | accepted | 2026-11-19 |

## When to write one

Whenever a non-trivial choice gets made that future-you (or Claude Code) would benefit from understanding. Database choice, framework choice, schema design philosophy, the reserved-vs-referenced inventory question, scanner approach, etc.

When in doubt, write it down. ADRs are cheap; recovering lost context is expensive.
