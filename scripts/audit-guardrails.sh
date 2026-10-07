#!/usr/bin/env bash
# Live execution guardrail audit. Read-only. Exits non-zero on any violation.
#
# Verifies the shipped posture is INERT:
#   1. no kill file arms the loops (missing file, or flags anything but armed);
#   2. no signer keyfile is configured or present;
#   3. both live loops exit dry_build / INERT when spawned bare.
set -u
cd "$(dirname "$0")/.." || exit 1
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
fail=0

echo "=== ARCADE-OSS LIVE GUARDRAIL AUDIT ==="
echo ""
echo "--- 1. kill file ---"
KF="${ARCADE_KILL_FILE:-}"
echo "  ARCADE_KILL_FILE: ${KF:-<unset>}"
if [ -z "$KF" ]; then
  echo "  PASS  no kill file: loops are inert"
elif [ ! -f "$KF" ]; then
  echo "  PASS  kill file missing: loops are inert"
else
  t=$(grep -E "^ARCADE_LIVE_TRADING=" "$KF" 2>/dev/null | cut -d= -f2 | tr -d ' ' | head -1)
  d=$(grep -E "^ARCADE_LIVE_DRY_RUN=" "$KF" 2>/dev/null | cut -d= -f2 | tr -d ' ' | head -1)
  k=$(grep -E "^ARCADE_LIVE_KILL=" "$KF" 2>/dev/null | cut -d= -f2 | tr -d ' ' | head -1)
  echo "  flags: TRADING=${t:-?} DRY_RUN=${d:-?} KILL=${k:-?}"
  if [ "$t" = "1" ] && [ "$d" = "0" ] && [ "$k" != "1" ]; then
    echo "  FAIL  kill file ARMS the loops"; fail=1
  else
    echo "  PASS  kill file disarmed"
  fi
fi

echo ""
echo "--- 2. signer ---"
SK="${ARCADE_SIGNER_KEYFILE:-}"
echo "  ARCADE_SIGNER_KEYFILE: ${SK:-<unset>}"
if [ -z "$SK" ]; then
  echo "  PASS  no signer configured"
elif [ ! -f "$SK" ]; then
  echo "  PASS  signer file absent"
else
  echo "  FAIL  signer keyfile present -- live CAN broadcast"; fail=1
fi

echo ""
echo "--- 3. loop spawn test (bare env) ---"
for loop in aagree mom60; do
  out=$(env -u ARCADE_KILL_FILE -u ARCADE_SIGNER_KEYFILE node "live/${loop}.mjs" 2>&1)
  code=$?
  if [ "$code" = "0" ] && echo "$out" | grep -q "INERT"; then
    echo "  PASS  live/${loop}.mjs -> dry_build INERT (exit 0)"
  else
    echo "  FAIL  live/${loop}.mjs exit=$code out=$(echo "$out" | head -c 120)"; fail=1
  fi
done

echo ""
if [ "$fail" = "0" ]; then echo "AUDIT PASS: package is inert"; else echo "AUDIT FAIL"; fi
exit "$fail"
