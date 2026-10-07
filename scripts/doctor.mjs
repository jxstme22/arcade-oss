#!/usr/bin/env node
/**
 * ARCADE-OSS doctor — environment + endpoint preflight. Read-only.
 *
 * Hard fails (exit non-zero): node < 22, data dir not writable.
 * Soft warns (exit still 0): venue/price RPC unreachable (offline demo),
 * missing optional env, missing data files. Offline must never fail doctor.
 */
const out = [];
const warn = (m) => { out.push(`WARN  ${m}`); };
const ok = (m) => { out.push(`ok    ${m}`); };
let fail = 0;
const bad = (m) => { out.push(`FAIL  ${m}`); fail++; };

// 1. node version
{
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) ok(`node ${process.versions.node} (>=22)`);
  else bad(`node ${process.versions.node} < 22`);
}

// 2. data dir writable
{
  const { mkdirSync, writeFileSync, unlinkSync } = await import("node:fs");
  const dir = process.env.ARCADE_DATA_DIR || "./data";
  try {
    mkdirSync(dir, { recursive: true });
    const probe = `${dir}/.doctor-probe`;
    writeFileSync(probe, "ok");
    unlinkSync(probe);
    ok(`data dir writable (${dir})`);
  } catch (e) {
    bad(`data dir not writable (${dir}): ${String((e && e.message) || e).slice(0, 100)}`);
  }
}

// 3. endpoint probes (warn-only)
async function probe(name, url, opts = {}) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), ...opts });
    if (r.ok) ok(`${name} reachable (${r.status})`);
    else warn(`${name} status ${r.status} (offline or degraded)`);
  } catch (e) {
    warn(`${name} unreachable (${String((e && e.message) || e).slice(0, 80)}) — offline mode`);
  }
}
await probe("rounds feed", "https://prediction-market-api.jup.ag/api/v1/play/rounds?asset=BTC");
await probe("price service", "https://prediction-market-price-service.fly.dev/price/crypto/btcusdt?timestamp=1");

// 4. env / config presence (informational only)
{
  const { existsSync } = await import("node:fs");
  const show = (k, secret) => {
    const v = process.env[k] || "";
    out.push(`info  ${k}=${v ? (secret ? "<set>" : v) : "<empty>"}`);
  };
  show("ARCADE_DATA_DIR", false);
  show("ARCADE_KILL_FILE", false);
  show("ARCADE_SIGNER_KEYFILE", true);
  show("PAPER_JEV_ONLY", false);
  show("TYPESAFE_API_KEY", true);
  show("TELEGRAM_BOT_TOKEN", true);
  const live = process.env.ARCADE_KILL_FILE || "";
  if (!live || !existsSync(live)) ok("live loops inert (no kill file)");
  else warn(`kill file present (${live}) — live loops consult it`);
  for (const f of [".env", "config/live.conf", "config/strategy.json", "config/board.json"]) {
    out.push(`info  ${f}: ${existsSync(f) ? "present" : "absent"}`);
  }
}

console.log(out.join("\n"));
process.exit(fail ? 1 : 0);
