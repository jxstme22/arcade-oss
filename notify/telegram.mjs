/**
 * Telegram sender — used ONLY in telegram board mode.
 *
 * Credentials come from env (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, optional
 * TELEGRAM_CHAT_ID_2). There are no defaults: missing credentials throw
 * instead of sending anywhere. The token is never printed or logged.
 * This module is dynamically imported by board.mjs ONLY when
 * ARCADE_BOARD_MODE=telegram; console/once modes never load it.
 */

function creds() {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const chats = [process.env.TELEGRAM_CHAT_ID, process.env.TELEGRAM_CHAT_ID_2].filter(Boolean);
  if (!token) throw new Error("telegram: TELEGRAM_BOT_TOKEN not set");
  if (!chats.length) throw new Error("telegram: TELEGRAM_CHAT_ID not set");
  return { token, chats };
}

export async function sendMessage(text) {
  const { token, chats } = creds();
  let delivered = 0;
  for (const chat of chats) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(10000),
        });
        if (r.ok) { delivered++; break; }
        if (r.status === 429) { await new Promise((x) => setTimeout(x, 2000 * attempt)); continue; }
        break;
      } catch {
        await new Promise((x) => setTimeout(x, 1500 * attempt));
      }
    }
  }
  return delivered > 0;
}
