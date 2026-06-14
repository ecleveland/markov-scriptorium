# 0001 — Foundational Architecture Decisions

**Status:** accepted (2026-04-27)

Six foundational decisions made together before any code was written.

---

## 1. Tech Stack: Python Backend + TypeScript Frontend

**Decision:** Hybrid — Python for the backend/API/scanner, TypeScript for the web frontend.

**Alternatives:**
- Full Python (weaker UI story, would need Streamlit/Gradio or a separate frontend anyway)
- Full TypeScript (weaker scanner/ML ecosystem, JS OCR tooling is less mature)

**Reasoning:** Python is the natural home for the scanner pipeline (OCR, image processing, Scryfall bulk data wrangling). TypeScript is the natural home for a rich interactive web UI. The hybrid costs some complexity but gives the best tool for each job. The owner also wants to learn Python, so the backend is a good vehicle for that.

---

## 2. Storage: SQLite

**Decision:** SQLite as the sole database.

**Alternatives:**
- PostgreSQL (more powerful queries, familiar to the owner from other projects)
- JSON flat files (simplest, but no query capabilities)

**Reasoning:** Local-first and single-user means no need for a database server process. SQLite is a single file — trivial to back up, move between machines, and reason about. The data volumes (tens of thousands of cards, dozens of decks) are well within SQLite's comfort zone. PostgreSQL's advantages (full-text search, JSONB, concurrency) aren't load-bearing here — Scryfall handles the heavy query work.

---

## 3. UI Surface: Local Web App

**Decision:** Browser-based web application running on localhost.

**Alternatives:**
- Desktop app via Tauri/Electron (adds build complexity for little gain over a local web app)
- CLI/TUI (poor fit for visual card browsing and deck building)

**Reasoning:** A web app is the most natural target for the TypeScript frontend. It works on any device with a browser (including potential future phone access via Tailscale). Webcam-based card scanning via the browser's `getUserMedia` API is well-supported. "Local" just means `localhost` — it still feels like an app.

---

## 4. Card-Deck Relationship: Hybrid (Default Reserved)

**Decision:** Each deck carries a flag indicating whether it claims its cards from inventory (reserved) or merely references them. Defaults to reserved.

**Alternatives:**
- Pure reserved (simpler, but brews and theorycraft would incorrectly claim cards)
- Pure referenced (simpler, but doesn't reflect physical reality of sleeved decks)

**Reasoning:** Sleeved, active decks physically claim their cards — they can't be in two places at once. But brew-in-progress decks and wishlists shouldn't subtract from availability. A per-deck boolean is minimal additional complexity and matches real-world usage.

---

## 5. Auth: Single-User, No Auth

**Decision:** No authentication. The server binds to localhost and is assumed to be used by one person.

**Alternatives:**
- Basic password gate (marginal security for marginal risk)
- Multi-user accounts (massive overkill for a personal tool)

**Reasoning:** The server only runs locally. There's no attack surface to protect against. If remote access is added later (e.g. via Tailscale), a simple auth layer can be bolted on at that point.

---

## 6. Hosting: Purely Local

**Decision:** The application runs entirely on the owner's machine. No cloud, no deployment pipeline, no hosting costs.

**Alternatives:**
- Self-hosted on a VPS (adds ops burden for no benefit)
- Cloud-hosted (conflicts with local-first principle)

**Reasoning:** Every other decision points here. SQLite is a local file. No auth means no multi-tenant concerns. The web app is accessed via localhost. Remote access, if ever needed, can be handled at the network layer (Tailscale) without changing the hosting model.
