#!/usr/bin/env bash
# No-signer check: no key material may live in this package, and the trading
# library's signer loader must only be reachable past the live gate.
# Fails on: PEM blocks, or loadSigner used in live/ outside the armed path.
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0

if grep -rn --exclude-dir=node_modules --exclude-dir=data --exclude-dir=.git --exclude="check-no-signer.sh" -- "-----BEGIN" . 2>/dev/null | grep -q .; then
  echo "FAIL: PEM key block found in package"; fail=1
else
  echo "ok: no PEM blocks"
fi

for f in live/aagree.mjs live/mom60.mjs; do
  gate_line=$(grep -n "loadGate();" "$f" | head -1 | cut -d: -f1)
  inert_line=$(grep -n "inertExit(" "$f" | head -1 | cut -d: -f1)
  signer_line=$(grep -n "loadSigner(" "$f" | head -1 | cut -d: -f1)
  if [ -z "$gate_line" ] || [ -z "$inert_line" ] || [ -z "$signer_line" ]; then
    echo "FAIL: $f missing gate/inert/signer structure"; fail=1; continue
  fi
  if [ "$signer_line" -gt "$inert_line" ] && [ "$inert_line" -gt "$gate_line" ]; then
    echo "ok: $f loads signer only past the gate (gate:$gate_line inert:$inert_line signer:$signer_line)"
  else
    echo "FAIL: $f signer reachable before the gate"; fail=1
  fi
done

if grep -rn --include="*.mjs" -- "loadSigner(" strategies paper notify live/gate.mjs 2>/dev/null | grep -q .; then
  echo "FAIL: loadSigner referenced outside live loops"; fail=1
else
  echo "ok: loadSigner confined to live loops"
fi

[ "$fail" = "0" ] && echo "CHECK PASS: no signer" || echo "CHECK FAIL: signer"
exit "$fail"
