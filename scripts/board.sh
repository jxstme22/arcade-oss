#!/usr/bin/env bash
# Board launcher: flock singleton under $DATA_DIR, sources .env,
# relative paths only. Pass --once for a single snapshot.
set -u
cd "$(dirname "$0")/.." || exit 1
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
DATA_DIR="${ARCADE_DATA_DIR:-./data}"
mkdir -p "$DATA_DIR"
exec flock "$DATA_DIR/board.lock" node notify/board.mjs "$@"
