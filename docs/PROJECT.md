# The Markov Scriptorium

> A personal tool for storing, tracking, and managing a Magic: The Gathering card collection and the decks built from it.
>
> Named for Edgar Markov, patriarch of the Innistrad vampires — a fitting patron for a meticulously curated hoard kept in candlelight.

Last brought in line with the code on 2026-11-20.

**Short handle:** `scriptorium` (or `markov` / `tms` for tighter contexts)

---

## Core Goals

- Track the physical card inventory — what I own, how many, and where each copy lives
- Manage deck lists and tie them back to owned cards
- Know at a glance what's available, what's tied up in a deck, and what's missing
- Make ongoing maintenance as frictionless as possible (bulk add, fast search, minimal typing)

---

## Data model

Inventory lots, one per printing and finish, are decided in [ADR 0009](decisions/0009-inventory-schema.md). Decks, called Tomes, are decided in [ADR 0018](decisions/0018-deck-schema.md).

### Inventory

Each record represents an owned printing, not just a card name. Same card from two different sets = two different records.

- Card name
- Set / printing (Scryfall ID as canonical key)
- Quantity
- Foil vs. non-foil (tracked separately — they have different prices and feel different in a deck)
- Condition (NM / LP / MP / HP / DMG)
- Language
- Physical location (binder name, box, deck sleeve, etc.)
- Acquisition date and price paid (optional, enables value tracking)
- Tags / notes

### Decks

- Name
- Format (Commander, Modern, Standard, Pioneer, Legacy, Pauper, Cube, Brew, etc.)
- Commander / companion (if applicable)
- Card list with quantities
- Status (active / shelved / in-progress / playtest)
- Notes and changelog

### The card to deck relationship

Three models were weighed. A reserved model subtracts a deck's cards from the available pool, a referenced model leaves inventory whole and lets decks point at cards, and a hybrid gives each deck a flag for whether it claims its cards.

**Decided:** hybrid, defaulting to reserved ([ADR 0018](decisions/0018-deck-schema.md)). Each deck has a `claims_cards` flag, on unless the user turns it off. Sleeved decks claim their cards, brew folders don't. Reservation is computed at read time, never stored.

---

## External Data Source

Use the **Scryfall API** as the canonical card database. Do not hand-roll card data.

- Free, comprehensive, well-documented
- Includes images, oracle text, legality, rulings, prices (TCGplayer / Cardmarket / Cardhoarder)
- Bulk data downloads available for offline caching
- Autocomplete endpoint for fast card-name search
- Card recognition endpoint for future phone-camera scanning

Docs: https://scryfall.com/docs/api

---

## What has shipped

- **Inscribe** at `/inscribe` adds a card to the collection with Scryfall autocomplete, one lot per printing and finish. See [ADR 0009](decisions/0009-inventory-schema.md) and [ADR 0011](decisions/0011-bulk-onboarding-backend.md).
- **Decklist paste and CSV import** at `/import/decklist` and `/import/csv`, reached from `/import`. See [ADR 0012](decisions/0012-decklist-paste-onboarding.md) and [ADR 0013](decisions/0013-csv-import-onboarding.md).
- **The Index and the Catalog** at `/index`, `/index/:scryfallId`, `/catalog` and `/catalog/:lotId` search, filter and show every owned printing and foil. See [ADR 0016](decisions/0016-inventory-browse-and-data-fetching.md), [ADR 0021](decisions/0021-inventory-search-api.md) and [ADR 0022](decisions/0022-the-index-browse-view.md).
- **Tomes** at `/tomes`, `/tomes/:deckId` and `/tomes/:deckId/breakdown` hold decks and show owned versus needed. See [ADR 0018](decisions/0018-deck-schema.md) and [ADR 0020](decisions/0020-reservation-rule.md).
- **The Scrying Glass** at `/scan` scans a single card. See [ADR 0025](decisions/0025-scanner-capture-and-recognition-contract.md) to [ADR 0029](decisions/0029-near-set-code-pins-the-printing.md).
- **The Muniment Room** at `/archive` seals backups and exports the collection. See [ADR 0023](decisions/0023-backups-and-export.md) and [ADR 0024](decisions/0024-shrunk-backups-and-daily-copies.md).
- **The gothic design system** covers every page, with a dev-only gallery at `/specimens`. See [ADR 0014](decisions/0014-visual-identity-and-design-tokens.md), [ADR 0017](decisions/0017-component-layer-convention.md), [ADR 0030](decisions/0030-self-hosted-variable-fonts.md), [ADR 0031](decisions/0031-the-leaf-layout.md), [ADR 0033](decisions/0033-the-ledger-and-the-lit-plate.md), [ADR 0034](decisions/0034-the-ledger-on-every-page.md) and [ADR 0035](decisions/0035-the-house-seal.md).

---

## Card Scanning (Notable Feature)

Visual card recognition that matches scans to Scryfall. Highly feasible — multiple established approaches exist.

### Approaches weighed

1. **OCR + fuzzy match** reads the title and fuzzy-matches it against the Scryfall card name catalog. Reference: [mtgscan](https://github.com/fortierq/mtgscan). This is the approach that was built.
2. **Perceptual hashing** pre-hashes every card image from the Scryfall bulk data and finds the nearest hash to the captured frame. Reference: [YamCR](https://github.com/ForOhForError/Yet-Another-Magic-Card-Recognizer). Good for real-time webcam.
3. **Multimodal LLM** passes the image to a vision model and validates the answer against Scryfall. It costs per scan and can hallucinate on obscure cards.

### What was built

The Scrying Glass at `/scan` reads cards with OCR and fuzzy match, decided in [ADR 0026](decisions/0026-scanner-recognition-engine-and-name-match.md).

- Apple Vision reads the title on macOS, behind an engine protocol, and Tesseract reads on Linux and Windows ([ADR 0028](decisions/0028-tesseract-as-the-second-scanner-engine.md)). Nothing leaves the machine.
- The reader tries the title region first, then the same region rotated 180 degrees for an upside-down card, then the full frame.
- rapidfuzz matches the text against the card and face names in the local catalog and answers up to five full names with a confidence.
- The user picks the printing from the card in hand, through the existing printing picker.
- After a confident name read, the reader also reads the collector number and set code in the corner and pins the printing when exactly one catalog row matches, decided in [ADR 0027](decisions/0027-scanner-corner-read-pins-the-printing.md), and reads a set code one misread glyph off as the set the card was printed in ([ADR 0029](decisions/0029-near-set-code-pins-the-printing.md)). Otherwise the picker stays.

ADR 0025 settled two earlier open questions. The scanner targets a desktop webcam first and a phone camera later. It captures a still in the browser and posts it for processing.

The Scryfall refresh cadence is settled in [ADR 0007](decisions/0007-auto-refresh.md). It runs daily and on startup when the data is more than 24 hours old.

### Still open

Batch scanning, where one photo of nine cards on a table recognizes all of them, is VEG-232. A corner pin for List and promo reprints is VEG-658. A phone camera and portrait stream is VEG-651.

### Open questions

- Non-English printings cannot be read until the catalog imports Scryfall's `printed_name`. That is a schema change, tracked as VEG-650.
- Foils read unless glare covers the title. Alters are unpredictable, and "Type the name instead" covers them.

---

## Planned and wishlist

### Planned

- **Batch scanning** (VEG-232), one photo of several cards at once
- **Volumes as entities** (VEG-279), so a binder or box is a record of its own
- **CSV import that carries** location, notes, tags, acquisition date and price (VEG-614)
- **Guarded restore command** (VEG-613), in place of the manual steps in the README
- **Folio photos** (VEG-641), attach a photo to a folio from the scanner
- **Desktop packaging** (M7, VEG-363 to VEG-367), a Tauri shell with a Python sidecar. Deferred and set to low priority on 2026-11-19. See [ADR 0002](decisions/0002-desktop-shell-tauri-sidecar.md).

### Wishlist

- **Price tracking** — periodic snapshots, total collection value over time as a chart
- **Auto-generated wishlist** from deck gaps
- **Trade log** — track what went in and out, with whom, for what
- **Draft / sealed pool tracking**
- **Proxy flagging** for playtest decks so they don't pollute value totals
- **Deck statistics** — mana curve, color pips, type distribution, tag breakdowns
- **Location map** — visualize which binder / box holds what
- **Multi-user / shared collection** support (long-term, if ever)

---

## Key Decisions (Resolved)

See `docs/decisions/0001-foundational-architecture.md` for full reasoning.

1. **Tech stack:** Python backend + TypeScript frontend (hybrid)
2. **Per-printing granularity:** confirmed yes
3. **Storage:** SQLite (local file, no server process)
4. **UI surface:** Local web app (browser-based, localhost), with a Tauri desktop shell + Python sidecar as the long-term distribution target, deferred and low priority as of 2026-11-19. Build localhost-first (see `docs/decisions/0002-desktop-shell-tauri-sidecar.md`)
5. **Card-deck model:** Hybrid, with a per-deck flag that defaults to reserved (see `docs/decisions/0018-deck-schema.md`)
6. **Hosting:** Purely local (Tailscale for optional remote access later)
7. **Auth:** Single-user, no auth

---

## Naming

**Chosen:** *The Markov Scriptorium*

The flavor: Edgar Markov, ancient vampire patriarch, presiding over a candlelit scriptorium where every card in the collection is meticulously catalogued. Gothic, archival, personal. Leaves room for a strong visual identity later (deep reds, blacks, serif typography, wax-seal motifs, Markov family crest).

**Runners-up worth remembering** (in case of rebrand or sub-projects):

- Planeswalker's Codex / Athenaeum / Compendium
- Manabase / Manabase Codex / Manavault
- Untapped
- The Aetherium / Aetherbase
- Manawell

---

Open questions become Linear tickets in the VEG project. This file lists only decisions and scope.
