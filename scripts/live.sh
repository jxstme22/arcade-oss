#!/usr/bin/env bash
# Live loop launcher (INERT unless the kill file arms it). Flock singleton
# under $DATA_DIR, sources .env, relative paths only.
# Loop defaults to the flagship A:AGREE mirror; ARCADE_LOOP=mom60 for MOM60.
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
LOOP="${ARCADE_LOOP:-aagree}"
exec flock "$DATA_DIR/live.lock" node "live/${LOOP}.mjs" "$@"
