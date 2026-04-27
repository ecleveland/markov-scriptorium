# The Markov Scriptorium

> A personal tool for storing, tracking, and managing a Magic: The Gathering card collection and the decks built from it.
>
> Named for Edgar Markov, patriarch of the Innistrad vampires — a fitting patron for a meticulously curated hoard kept in candlelight.

**Short handle:** `scriptorium` (or `markov` / `tms` for tighter contexts)

---

## Core Goals

- Track the physical card inventory — what I own, how many, and where each copy lives
- Manage deck lists and tie them back to owned cards
- Know at a glance what's available, what's tied up in a deck, and what's missing
- Make ongoing maintenance as frictionless as possible (bulk add, fast search, minimal typing)

---

## Data Model (First Pass)

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

### The Card ↔ Deck Relationship (Key Design Decision)

When a card is in a deck, what does that *mean* for the inventory count?

- **Reserved model** — adding a card to a deck subtracts it from the available pool. Best if cards are physically sleeved and can't be in two places at once.
- **Referenced model** — inventory stays whole; decks just point at cards. Best for digital or proxy-heavy play.
- **Hybrid** — each deck has a flag for whether it "claims" its cards. Most flexible, more complex.

**Leaning toward:** hybrid, defaulting to reserved. The reality is sleeved decks claim cards, brew folders don't.

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

## MVP Features

1. Add cards to inventory — manual entry with Scryfall-powered autocomplete
2. Create a deck and add cards to it
3. View a card's full ownership across printings and foils
4. View a deck's "owned vs. needed" breakdown
5. Search and filter inventory (by name, set, color, type, tag, location)

---

## Card Scanning (Notable Feature)

Visual card recognition that matches scans to Scryfall. Highly feasible — multiple established approaches exist.

### Approaches

1. **OCR + fuzzy match** — capture image, OCR the title, fuzzy-match against Scryfall card name catalog. Reference: [mtgscan](https://github.com/fortierq/mtgscan) (uses Azure OCR + SymSpell). Best accuracy/effort ratio.
2. **Perceptual hashing** — pre-hash all card images from Scryfall bulk data, hash the captured frame, find nearest match. Reference: [YamCR](https://github.com/ForOhForError/Yet-Another-Magic-Card-Recognizer). Good for real-time webcam.
3. **Multimodal LLM** — pass image to Claude / GPT-4V / Gemini, validate response against Scryfall. Trivial to wire up; costs per scan; can hallucinate on obscure cards.

### Recommended Path

**Primary:** OCR + fuzzy match
- Crop to title bar (cleanest, most consistent region across printings)
- OCR via Google Vision or Azure (both have free tiers)
- Fuzzy match against Scryfall `/catalog/card-names`
- For printing disambiguation, prompt user OR use perceptual hash on the art crop as a tiebreaker

**Killer UX:** **batch scanning** — lay 9 cards on a table, one photo, recognize all. Transformative for collection imports vs. one-at-a-time scanning. mtgscan handles this natively.

### Open Questions

- Mobile (phone camera) vs. desktop (webcam) — both, or pick one for MVP?
- Do we need real-time live recognition, or is photo-then-process enough?
- Scryfall bulk data refresh cadence (their data file updates daily)
- How to handle foils, alters, signed cards, and non-English printings during scan

---

## Future / Wishlist Features

- **Bulk import via pasted decklist** (standard MTG text format: `4 Lightning Bolt`)
- **CSV import/export** compatible with Manabox, Deckbox, Archidekt
- **Price tracking** — periodic snapshots, total collection value over time as a chart
- **Auto-generated wishlist** from deck gaps
- **Trade log** — track what went in and out, with whom, for what
- **Draft / sealed pool tracking**
- **Proxy flagging** for playtest decks so they don't pollute value totals
- **Deck statistics** — mana curve, color pips, type distribution, tag breakdowns
- **Location map** — visualize which binder / box holds what
- **Multi-user / shared collection** support (long-term, if ever)

---

## Key Decisions to Make Before Building

1. Reserved vs. referenced inventory (or hybrid)
2. Per-printing granularity — confirmed yes
3. Tech stack (TBD with Claude Code)
4. Storage — local SQLite, cloud DB, or JSON?
5. UI surface — web app, desktop, CLI, or TUI?
6. Hosting — purely local, self-hosted, or cloud?
7. Auth — single-user only, or accounts from day one?

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

## Open Questions / Ideas Parking Lot

*(Dump new ideas here as they come up — no structure required.)*

-
-
-
