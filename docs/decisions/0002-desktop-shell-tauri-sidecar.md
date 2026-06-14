# 0002 — Desktop Shell: Tauri + Python Sidecar

**Status:** accepted (2026-06-14)

Refines decision #3 (UI Surface) of [0001](0001-foundational-architecture.md). That ADR
chose a localhost web app and rejected Tauri/Electron as "build complexity for little gain."
This revisits that conclusion — not to overturn the web-app architecture, but to set a
desktop shell as the long-term distribution target. Crucially, the underlying architecture
("Python server + web frontend") is preserved either way, so this is additive, not a rewrite.

---

## Decision

The long-term target is a **Tauri** desktop application wrapping the existing hybrid stack:

- The **TypeScript frontend** renders in the OS-native webview (WKWebView / WebView2 /
  WebKitGTK) — no bundled Chromium.
- The **Python backend** ships as a **sidecar**: a standalone executable (frozen with
  PyInstaller) that Tauri bundles and launches as a child process. It serves the existing
  FastAPI/uvicorn API over `127.0.0.1` on an OS-assigned free port.
- The Rust shell spawns the sidecar on launch, learns the port via the sidecar's stdout,
  forwards it to the frontend, and **kills the sidecar on exit**.

**Build order: localhost-first.** Build and ship the plain localhost web app first; add the
Tauri shell once there is something worth wrapping. Because the architecture is identical,
this incurs near-zero rework.

---

## Alternatives Considered

- **Stay localhost-only (0001 as written)** — simplest, but never feels like an installed
  app and has no update/distribution story.
- **PyWebView** — keeps everything in Python (no Rust), genuinely lightweight, good fit for
  the Python-learning goal. Rejected as the *long-term* target because it lacks Tauri's
  installers, auto-updater, and native polish — though it remains a valid fallback if Tauri's
  overhead proves not worth it.
- **Electron** — heaviest option (~150MB+ Chromium), and we wouldn't leverage its Node
  ecosystem since the backend is Python. Rejected.

---

## Reasoning

For a tool intended to run for years, possibly across multiple machines, Tauri's
distribution story is the differentiator: real installers (`.dmg`/`.msi`/`.AppImage`), a
built-in cryptographically-signed auto-updater, and native niceties (tray, menus,
notifications). It does this without bundling a browser, unlike Electron. The Rust surface
the owner must maintain is small and mostly configuration (~40 lines of boilerplate), so it
does not meaningfully compete with the Python-learning goal.

Spawning the sidecar from Rust (rather than JS) ties the Python process to the app lifecycle
and sidesteps Tauri's JS capability/permission system entirely.

---

## Consequences & Trade-offs

**Positive:**
- A true installed-app experience with a self-update path.
- Local-only / no-auth posture is *strengthened* — the API never leaves `127.0.0.1`.
- No architectural lock-in: the localhost web app is the foundation; the shell is a wrapper
  added later.

**Costs / risks to manage:**
- **Bundle size:** the Rust shell is tiny (~10MB), but the PyInstaller sidecar — once it
  includes the scanner's CV stack (OpenCV, numpy, Pillow, OCR) — can reach several hundred
  MB. Tauri's "small binary" advantage is largely spent on the Python runtime.
- **No cross-compilation:** the PyInstaller sidecar must be built on each target OS. Shipping
  macOS + Windows means building on both (or via CI runners).
- **Code signing:** distributing beyond the owner's own machine requires an Apple Developer
  cert (~$99/yr) + notarization and a Windows signing cert to avoid Gatekeeper/SmartScreen
  warnings. Skippable for personal use.
- **Four known footguns** to get right early: (1) kill the sidecar on `RunEvent::Exit` or
  orphan Python processes; (2) widen the Tauri CSP `connect-src` to allow `http://127.0.0.1:*`
  or `fetch` is blocked; (3) name the sidecar binary with the Rust target triple; (4) handle
  the startup race where `backend-ready` may fire before the frontend's listener attaches
  (belt-and-suspenders: also expose a `get_backend_port` command).

**Decisions deferred to implementation:**
- SQLite and downloaded Scryfall bulk data live in the OS app-data dir (Tauri `app_data_dir`),
  not beside the binary.
- Frontend↔Python transport: localhost HTTP (chosen, keeps dev and packaged builds identical)
  vs. stdio IPC (no open port). Revisit only if a port-free posture becomes desirable.
- Camera access for scanning needs an `Info.plist` usage string on macOS and triggers a
  permission prompt.
