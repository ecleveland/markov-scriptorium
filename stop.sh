#!/bin/bash
#
# Stop the Markov Scriptorium dev servers by freeing the dev ports.
# (dev.sh's Ctrl-C handler normally does this; use stop.sh to clean up after a
# crash or an orphaned run.)
set -u

for port in 8000 5173; do
  if PIDS=$(lsof -ti :"$port" 2>/dev/null) && [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill 2>/dev/null || true
    echo "Port $port cleared."
  else
    echo "Port $port already free."
  fi
done
