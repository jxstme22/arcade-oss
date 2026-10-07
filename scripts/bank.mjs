#!/usr/bin/env node
/**
 * Bank balance reader — READ-ONLY. Never signs, never broadcasts.
 *
 * Wallet comes from ARCADE_WALLET env or argv[2]; the USDC mint comes from
 * USDC_MINT env or --mint (no on-chain constant is embedded here — supply the
 * well-known USDC mint explicitly). Uses HELIUS_RPC_URL when set, else the
 * public RPC as a slower fallback.
 */
const wallet = process.env.ARCADE_WALLET || process.argv[2] || "";
const mintIdx = process.argv.indexOf("--mint");
const mint = (mintIdx !== -1 && process.argv[mintIdx + 1]) || process.env.USDC_MINT || "";
if (!wallet) { console.error("bank: set ARCADE_WALLET or pass a wallet address"); process.exit(1); }
if (!mint) { console.error("bank: set USDC_MINT or pass --mint <mint>"); process.exit(1); }

const endpoints = process.env.HELIUS_RPC_URL
  ? [process.env.HELIUS_RPC_URL, "https://api.mainnet-beta.solana.com"]
  : ["https://api.mainnet-beta.solana.com"];
let data = null;
for (const ep of endpoints) {
  try {
    const r = await fetch(ep, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
        params: [wallet, { mint }, { encoding: "jsonParsed" }] }),
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) { data = await r.json(); break; }
  } catch {}
}
if (!data) { console.error("bank: rpc unavailable (offline?)"); process.exit(0); }
let best = 0;
for (const a of data?.result?.value ?? []) {
  try { best = Math.max(best, Number(a.account.data.parsed.info.tokenAmount.amount)); } catch {}
}
console.log(JSON.stringify({ wallet, mint, usdc_micro: best, usdc: (best / 1e6).toFixed(2) }));
