#!/usr/bin/env bash
# Paper tick launcher: flock singleton under $DATA_DIR, sources .env,
# relative paths only. Never touches live.
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
exec flock "$DATA_DIR/paper.lock" node paper/agree-runner.mjs "$@"
