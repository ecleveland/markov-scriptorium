# 0010 — Frontend Testing and Routing Stack

**Status:** accepted (2026-06-17)

Established while building the Inscribe form ([VEG-219]), the first frontend
feature with real logic. It needed a test runner (none existed) and navigation
(the app was a single health-check view). Builds on [0003](0003-framework-and-tooling.md)
(React + Vite + TypeScript for the frontend).

[VEG-219]: https://linear.app/vega-apps/issue/VEG-219

---

## Decision

**Testing: Vitest + React Testing Library (jsdom).** Tests run under Vitest with
`@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`,
and a jsdom environment. `npm test` runs `vitest run`. Component behaviour is
tested through the DOM (roles/labels), with the `api` client mocked — no network,
matching the backend's "mock Scryfall in tests" rule.

Vitest config lives in a **separate `vitest.config.ts`**, not in `vite.config.ts`.
Vite 8 (rolldown-based) and the Vite that Vitest bundles (v7) are different
installs, so Vitest's `test`-field type augmentation lands on the wrong Vite copy
and breaks `tsc -b` if added to `vite.config.ts`. Keeping it in its own file —
excluded from every `tsconfig` `include` — keeps the production type-check on a
clean Vite 8 config while Vitest still loads its config at runtime.

**Routing: `react-router-dom` (v7).** A `BrowserRouter` in `main.tsx`; routes in
`App.tsx`. `/` redirects to `/inscribe`. A `StatusHeader` (the former inline
health check) is the persistent layout shell.

## Alternatives

- **Vitest-only, no RTL** — pure-logic units only. Rejected: the Inscribe flow's
  value is in its component behaviour (search → printing → submit), which would
  go untested in the same PR. CLAUDE.md requires UI tests to ship with the UI.
- **Jest** — heavier, needs extra config to work with Vite/ESM; Vitest is the
  native fit and reuses the Vite pipeline.
- **No router yet** — render Inscribe as the only view, add routing later.
  Reasonable, but the catalog will soon have the Index, Volumes, and Tome views;
  introducing the router now with one route is cheap and avoids a later refactor
  of `main.tsx`/`App.tsx`. (This was a deliberate call to add it early.)
- **TanStack Query / SWR for data fetching** — deferred. The current needs
  (debounced autocomplete, one POST) are met by `fetch` + a small typed `api.ts`
  client and a `useDebouncedValue` hook. Revisit when shared cached lists appear.

## Reasoning

Boring, durable, single-developer-friendly tools that reuse the existing Vite
toolchain (see [0003]). Vitest + RTL is the standard React-on-Vite test stack;
react-router is the default SPA router. The one wrinkle — the dual-Vite type
clash — is contained to a one-line config split documented in `vitest.config.ts`.

[0003]: 0003-framework-and-tooling.md
