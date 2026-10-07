#!/usr/bin/env bash
# No-hardcoded-paths/secrets check. Fails on machine-global path literals,
# IP literals, bot-token shapes, or non-empty credential assignments anywhere
# in the package -- except the documented carve-outs:
#   - scripts/check-no-hardcoded-paths.sh itself (it must name the patterns),
#   - .env.example (placeholders only; values must stay empty),
#   - docs/HISTORY.md (retrospective notes may name retired locations),
#   - scripts/systemd/ (install-time placeholder paths, never real ones).
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0

scan() {
  grep -rn --exclude-dir=node_modules --exclude-dir=data --exclude-dir=.git \
    --exclude="check-no-hardcoded-paths.sh" \
    --exclude=".env.example" \
    -- "$1" . \
    2>/dev/null | grep -v "^./docs/HISTORY.md" | grep -v "^./scripts/systemd/" || true
}

hit=$(scan "/opt/\|/etc/\|/root/\|/tmp/")
if [ -n "$hit" ]; then echo "FAIL: machine-global path literal:"; echo "$hit" | head -10; fail=1
else echo "ok: no machine-global paths"; fi

hit=$(scan "[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}")
if [ -n "$hit" ]; then echo "FAIL: IP literal:"; echo "$hit" | head -10; fail=1
else echo "ok: no IP literals"; fi

hit=$(scan "[0-9]\{6,\}:[A-Za-z0-9_-]\{20,\}")
if [ -n "$hit" ]; then echo "FAIL: bot-token shape:"; echo "$hit" | head -10; fail=1
else echo "ok: no bot tokens"; fi

hit=$(grep -rn --exclude-dir=node_modules --exclude-dir=data --exclude-dir=.git \
  -- "^TELEGRAM_BOT_TOKEN=.\|^TELEGRAM_CHAT_ID=.\|^TYPESAFE_API_KEY=.\|^HELIUS_RPC_URL=https\?" . \
  2>/dev/null | grep -v "^./scripts/systemd/" || true)
if [ -n "$hit" ]; then echo "FAIL: non-empty credential:"; echo "$hit" | head -10; fail=1
else echo "ok: no embedded credentials"; fi

[ "$fail" = "0" ] && echo "CHECK PASS: no hardcoded paths/secrets" || echo "CHECK FAIL"
exit "$fail"
