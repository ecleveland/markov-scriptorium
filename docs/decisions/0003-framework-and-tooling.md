# 0003 — Backend/Frontend Frameworks & Python Tooling

**Status:** accepted (2026-06-14)

Resolves the M1 framework decisions ([VEG-205], [VEG-206]) and the Python dependency-tooling
choice, made together at the start of Milestone 1 (Project Scaffolding). Builds on the stack
split in [0001](0001-foundational-architecture.md) #1 (Python backend + TypeScript frontend).

[VEG-205]: https://linear.app/vega-apps/issue/VEG-205
[VEG-206]: https://linear.app/vega-apps/issue/VEG-206

---

## 1. Backend Web Framework: FastAPI

**Decision:** FastAPI for the Python backend API.

**Alternatives:** Flask (simpler, battle-tested, but manual validation/docs/async).

**Reasoning:** FastAPI's Pydantic-based request/response validation and auto-generated
OpenAPI docs remove a lot of boilerplate, and its heavy reliance on type hints doubles as a
teaching aid while the owner is learning Python. Async support is built in if the scanner or
Scryfall sync ever needs it. The modern default for new Python APIs.

---

## 2. Frontend Framework: React + Vite

**Decision:** React, built with Vite, for the TypeScript web UI.

**Alternatives:** Svelte + Vite (less boilerplate, smaller bundles, smaller ecosystem);
Vue + Vite (middle ground).

**Reasoning:** Largest ecosystem and the deepest pool of examples/answers — valuable for a
solo developer. Pairs cleanly with the future Tauri shell ([0002](0002-desktop-shell-tauri-sidecar.md)),
which renders a web frontend in a native webview. The extra boilerplate over Svelte is an
acceptable price for the "still works in 5 years" durability the project prioritizes.

---

## 3. Python Dependency & Environment Management: uv

**Decision:** uv for virtualenvs, dependency installation, and lockfile management.

**Alternatives:** Poetry (mature, established, slower); pip + venv + requirements.txt
(most durable, but no lockfile and more manual hygiene).

**Reasoning:** A single fast tool covering env creation, dependency resolution, and a
committed lockfile (reproducible installs). Comes from the same authors as ruff, which M1
already plans to adopt for lint/format ([VEG-210]), keeping the Python toolchain coherent.
The main risk is that uv is newer than pip/Poetry — mitigated by the fact that it manages a
standard `pyproject.toml` + lockfile, so migrating away later is low-cost if needed.

[VEG-210]: https://linear.app/vega-apps/issue/VEG-210

---

## Consequences

- Backend deps live in `pyproject.toml` with a `uv.lock`; the README documents `uv` setup.
- Frontend is a Vite + React + TypeScript project.
- Still-open M1 decisions tracked separately: monorepo layout ([VEG-207]), dev tooling
  specifics ([VEG-210]), and the schema migration strategy ([VEG-278]).

[VEG-207]: https://linear.app/vega-apps/issue/VEG-207
[VEG-278]: https://linear.app/vega-apps/issue/VEG-278
