# CLAUDE.md

Instructions for Claude Code working on **The Markov Scriptorium**.

## Read First

Before any non-trivial change, read `docs/PROJECT.md`. It is the source of truth for goals, data model, and feature scope. If a request conflicts with PROJECT.md, flag it before proceeding.

## Project Identity

The Markov Scriptorium is a personal tool for tracking and managing a Magic: The Gathering card collection and the decks built from it. The flavor is gothic-archival — Edgar Markov, vampire patriarch of Innistrad, presiding over a candlelit catalog. Code can be plain and functional; user-facing text and conceptual naming should lean into the flavor.

## Domain Vocabulary

Use these terms in user-facing strings, route names, and conceptual naming. Internal variable names can be plainer where clarity demands it — don't sacrifice code readability for theme.

- **Volume** — a binder, box, or storage container holding cards
- **Tome** — a deck (each deck is a bound book in the scriptorium)
- **The Vault** — high-value or reserved cards
- **The Reliquary** — foils, signed, or otherwise special cards
- **The Index** — the search / browse view of the collection
- **Inscribe** — the verb for adding a card to the collection
- **Catalog** — the full collection, conceptually
- **Folio** — a specific physical printing instance (set + collector number + foil/non-foil + condition)

## Working Style

- **Design before code.** When a request is ambiguous or touches the data model, propose the approach in plain text first. Wait for confirmation before scaffolding.
- **Small, reviewable changes.** Prefer multiple focused commits over one sweeping one.
- **Ask before adding dependencies.** Especially heavy ones. List what you considered and why.
- **No silent decisions.** When a real design choice gets made (database schema, framework, library), record it as a short ADR in `docs/decisions/`.
- **Commit messages:** imperative mood, present tense ("Add scanner endpoint", not "Added scanner endpoint"). Body explains *why* if non-obvious.

## Tech Stack

Not yet chosen. When discussing or recommending options, optimize for:

1. Single-developer maintainability over enterprise patterns
2. Local-first storage — data lives on disk, not in someone else's cloud, unless I explicitly opt into hosted
3. Boring, durable tools over trendy ones — this project should still run in 5 years
4. Python or TypeScript ecosystems preferred (familiar to me)

## Scryfall Integration

- Scryfall is the canonical card database. Never hand-roll card data.
- **Default to local bulk data**, not live API calls. Scryfall publishes a full bulk JSON daily (~500MB). Download nightly, load into a local DB, serve all reads from local. Reserve live API for what bulk doesn't cover (current prices, real-time autocomplete typeahead).
- Always send a real `User-Agent` header naming this app, per Scryfall's API requirements.
- Store the Scryfall ID as the canonical foreign key for any card reference.
- Respect the rate limits and the fan content guidelines: https://scryfall.com/docs/api

## Data Model Hard Rules

- A card is identified by its **printing**, not its name. Same name across two sets = two records.
- Foil and non-foil are tracked separately even within the same printing.
- The reserved-vs-referenced question for cards-in-decks is unresolved (see PROJECT.md). Do not implement either side without confirming first.

## Testing

- Required for: data model logic, the scanner pipeline, and any Scryfall sync code.
- UI and glue code can lean lighter on tests but should be exercised manually before committing.
- Prefer fast unit tests over integration suites that require network access. Mock Scryfall in tests.

## What to Flag, Not Decide

Ask before doing any of these:

- Changes to the data model or schema
- Adding a new dependency
- Picking a framework or major library
- Anything that costs money (API plans, hosted services)
- Destructive operations (data migrations, deletes, schema drops)
- Auth, accounts, or anything that lets other people in
- Anything that publishes data outside the local environment

## What to Just Do

No need to ask before:

- Fixing bugs with obvious causes
- Refactors that don't change behavior
- Adding tests for existing code
- Fixing typos, formatting, lint warnings
- Documentation updates that match decisions already made
