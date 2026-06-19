# 0015 — End-to-End Testing with Playwright

**Status:** accepted (2026-06-18)

Established for [VEG-434]. The frontend had solid Vitest + RTL component coverage
([0010](0010-frontend-testing-and-routing.md)) but no way to exercise the real
app in a real browser — so layout, responsive collapse, and full navigation
flows went unverified, and presentational changes (the M3.7 design-system work)
could not be screenshotted as before/after evidence. VEG-422 (the app-shell
restyle) surfaced the gap concretely: a token-driven visual change could be
checked for structure in jsdom but never *seen*.

[VEG-434]: https://linear.app/vega-apps/issue/VEG-434

---

## Decision

**Playwright (`@playwright/test`), Chromium only, hermetic.** E2E specs live in
`frontend/e2e/`, driven by `playwright.config.ts`. `npm run test:e2e` runs them.

**Frontend-only, backend stubbed at the network layer.** Playwright boots *only*
the Vite dev server (`webServer: npm run dev`, `reuseExistingServer` locally,
fresh on CI). Every `/api/**` request is fulfilled in the browser with canned
data via `page.route` (see `e2e/stubs.ts`) — FastAPI, SQLite, and Scryfall are
never involved. This keeps the suite fast and deterministic and honours
CLAUDE.md's "mock Scryfall — no network calls in tests."

**Scope is the harness + golden paths, not visual regression.** Three specs:
the app shell (brand/nav/status + navigation), the Inscribe happy path
(search → pick printing → inscribe), and a screenshot-capability check at
desktop and mobile widths. Selectors are kept loose (role/text, `.status`) so
they survive the pending VEG-422 restyle.

Chosen for consistency with the other Vega Apps projects (GrimoireOS already
runs Playwright).

## Alternatives

- **Boot the real FastAPI backend too** (uvicorn in `webServer`, tests hit live
  endpoints). Rejected for now: it needs a seeded catalog/DB fixture, is slower,
  and adds flake — all for paths that stub cleanly. Revisit if a flow's value is
  in the backend integration itself (e.g. the bulk-inscribe transaction), at
  which point a dedicated backend-booting project can be added alongside this one.
- **Pixel visual-regression / snapshot diffing** (`toHaveScreenshot`). Deferred
  (explicitly out of scope for VEG-434): committed baselines are noisy and
  font-rendering-sensitive across machines. The screenshot *capability* is in
  place, so this can be layered on later if wanted.
- **Cypress / WebdriverIO.** Rejected: Playwright is the lighter, faster fit,
  already used elsewhere in the workspace.
- **No E2E, keep relying on jsdom.** Rejected: jsdom cannot see layout or
  responsive behaviour, which is exactly what the M3.7 visual work changes.

## Reasoning

Boring, durable, single-developer-friendly, and reuses a tool already proven in
the workspace. The hermetic stub-the-API approach mirrors the unit-test rule
(mock the network) one layer up, so the E2E suite stays fast and never depends
on backend state. CI wiring is deliberately left out — this repo has no GitHub
Actions yet; `npm run test:e2e` is a local/verification-gate step until then.

## Notes

- Browser binary (`npx playwright install chromium`) is a local install, not
  committed. Artefacts (`test-results/`, `playwright-report/`) are gitignored.
- Vitest excludes `e2e/**` so it does not try to run Playwright specs in jsdom.
