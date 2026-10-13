# VOID XMD V2

A lightweight WhatsApp AI chat edition of VOID-XMD for small Node.js hosting servers.

- Up to four linked WhatsApp accounts.
- Separate account personalities, business information, pause states, and conversation histories.
- Gemini, Groq, OpenRouter free models, Cloudflare Workers AI, and Hugging Face adapters with automatic fallback.
- Optional trial/experimental provider adapters; see their restrictions before enabling.
- Text chatting, account linking, owner controls, and persistent session storage.
- Mobile settings dashboard with protected login, per-account settings, pairing, and provider management.
- No downloader startup, media commands, status automation, or group automation in chat mode.

Read **[CHAT-SETUP.md](CHAT-SETUP.md)** for Nervox setup, AI provider limits, and account commands.

## Start

Use Node.js 22 or 24. Install with `npm ci --omit=dev`, copy `.env.chat.example` to `.env`, configure owner/pairing numbers and provider keys, then run `npm start`.

Run `npm test` and `npm run check` for automated validation. Live WhatsApp pairing and four-account RAM usage must be checked on the actual server. A 512 MiB server may need fewer accounts if traffic or memory usage is high.

Keep `.env`, API keys, and `data` session credentials out of GitHub. Preserve `data` on the hosting server.

The original full bot remains on the main branch. This branch starts the AI chat edition by default.

## Dashboard

Open your server’s public HTTP/HTTPS address at `/` and sign in with WEB_ADMIN_KEY. Set PORT to the allocated hosting port. For Nervox’s default startup, set STARTUP FILE to `index.js`. See CHAT-SETUP.md for details.
