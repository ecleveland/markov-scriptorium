#!/bin/bash
#
# Run the Markov Scriptorium backend + frontend with hot reload.
#
# Usage:
#   ./dev.sh            Fast boot: seed a handful of cards, skip the Scryfall
#                       download. Best for working on the app itself.
#   ./dev.sh --full     Real catalog: download Scryfall bulk data (~500 MB) on
#                       startup instead of seeding. (alias: --refresh)
#   ./dev.sh --help
#
# Backend → http://127.0.0.1:8000   Frontend → http://localhost:5173
# Schema migrations apply automatically on backend startup. Ctrl-C stops both.
set -e

FULL=0
for arg in "$@"; do
  case "$arg" in
    --full | --refresh) FULL=1 ;;
    -h | --help)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

trap 'kill 0' EXIT
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Free the dev ports from any prior run so we don't silently bind elsewhere.
for port in 8000 5173; do
  if PIDS=$(lsof -ti :"$port" 2>/dev/null) && [ -n "$PIDS" ]; then
    echo "Freeing port $port (pids: $(echo "$PIDS" | tr '\n' ' '))"
    echo "$PIDS" | xargs kill 2>/dev/null || true
  fi
done

if [ "$FULL" -eq 1 ]; then
  echo "Full mode: the backend will download Scryfall bulk data (~500 MB) on startup."
  export SCRIPTORIUM_AUTO_REFRESH=1
else
  echo "Fast mode: skipping the Scryfall download; seeding a handful of dev cards."
  export SCRIPTORIUM_AUTO_REFRESH=0
  (cd "$ROOT_DIR/backend" && uv run python scripts/seed_dev.py)
fi

echo "Backend  → http://127.0.0.1:8000"
(cd "$ROOT_DIR/backend" && uv run uvicorn scriptorium.main:app --reload --port 8000) &

echo "Frontend → http://localhost:5173"
(cd "$ROOT_DIR/frontend" && npm run dev) &

wait
