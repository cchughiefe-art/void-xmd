# VOID XMD V2 for Nervox

This branch starts in private-message AI chat mode with four total WhatsApp sessions. `npm start` and `npm run start:chat` use a 320 MB JavaScript heap ceiling. This is not a ceiling on total RAM: Baileys/native buffers still consume additional memory. Test one account first and watch the panel's RAM before adding others. Four accounts on 512 MiB is a target, not a verified capacity guarantee.

## Upload and start

1. Upload the contents of the release ZIP into the server root, not an extra nested folder. It contains a minimal package.json and lockfile with only Baileys, Boom and Pino. No credentials are included.
2. Select a Node.js 22 or 24 container. Set the startup command to `npm start` (or `node --max-old-space-size=320 src/chat-index.js`). Let the panel install dependencies, or use `npm ci --omit=dev` if it exposes a shell. Do not disable dependency install scripts: Baileys may need its supported install process.
3. Copy `.env.chat.example` to `.env`. Set OWNER_NUMBER and PAIRING_NUMBER to the first account, with country code and no plus sign. Use `DATA_DIR=./data` so sessions remain in the persistent server directory. Set PORT to the allocated panel port. Replace WEB_ADMIN_KEY with a random password of at least 12 characters.
4. Configure your existing Gemini and/or Groq keys privately in `.env` or panel environment variables. Never upload keys, `.env`, or session data to GitHub. No provider accounts or keys have been created by this change.
5. Start. The console prints the first account's temporary pairing code. Open WhatsApp → Linked devices → Link a device → Link with phone number and enter it.
6. From the main owner's WhatsApp, send `.adddevice 234...` for each additional account. `.devices` shows their status. The four-session limit includes the primary account.
7. On each linked account, use Message yourself and send `.public`, `.setaipersonality YOUR STYLE`, then `.businessai on`. AI replies are OFF until enabled for that account. Business knowledge, pause state, personality and conversation memory are isolated per account.
8. Test from a different number. Groups, statuses, calls, downloads, media commands, feature generation and anti-delete automation are disabled in this profile. Manual replies still take over the conversation; `.pauseai NUMBER` / `.resumeai NUMBER` provide explicit control.

Keep periodic copies of the `data` directory securely. Never run the same auth/session directory concurrently on the old and new servers. Use a fresh pairing if the old account remains active elsewhere.

## AI commands

- `.providers` / `.aistatus`: configuration and cooldown status, without secret values.
- `.setaimodel PROVIDER MODEL`: main owner selects a supported model. OpenRouter accepts only `openrouter/free` or a `:free` model.
- `.addapikey PROVIDER KEY`: main-owner private-chat alternative. Prefer server environment variables; deleting a WhatsApp message containing a secret is only best effort.
- `.ai MESSAGE`: linked-account owner tests AI.
- `.businesshelp`, `.businessstatus`, `.setbusinessinfo`, `.setbusinessrules`: existing account-level settings remain available.
- `.stats`: process RSS memory and session count.

Fallback only uses configured keys. Requests run at most two at a time, with bounded pending work, a shared time budget, and cooldown after rate-limit/auth failures. Conversation memory is limited to 80 chats across accounts and 10 messages per chat. Provider availability and account quotas can still interrupt replies. No live API or WhatsApp verification was performed during build.

## API options checked on 13 October 2026

There is no complete, permanent list of every free AI service. These are adapters for the researched options, not a claim that every model or account is free. Use providers' free account modes, without paid billing enabled, if you must avoid charges. Except OpenRouter's model-ID guard, the client cannot determine or enforce account billing tiers.

| Provider | Free allowance / limitation | Setup |
| --- | --- | --- |
| Gemini | Selected models such as Gemini 3.8 Flash have a free tier; per-project quotas and data-use terms apply | https://aistudio.google.com/ and https://ai.google.dev/gemini-api/docs/pricing |
| Groq | Free plan, per-model RPM/RPD/token limits | https://console.groq.com/keys and https://console.groq.com/docs/rate-limits |
| OpenRouter | Unfunded free-model allowance: 50/day, 20/minute | https://openrouter.ai/settings/keys and https://openrouter.ai/pricing; default openrouter/free selects free models |
| Cloudflare Workers AI | 10,000 neurons/day on Workers Free; some frontier models require payment | https://developers.cloudflare.com/workers-ai/platform/pricing/; account ID plus scoped Workers AI token required |
| Hugging Face | $0.10 monthly credits, subject to change; limited fallback capacity | https://huggingface.co/settings/tokens and https://huggingface.co/docs/inference-providers/pricing; set a currently available HUGGINGFACE_MODEL |
| Mistral | Free mode / experimentation, account-specific limits | https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key; opt-in experimental adapter |
| NVIDIA | Developer preview / prototyping access, not an unlimited production plan | https://build.nvidia.com/ and https://docs.api.nvidia.com/nim/docs/run-anywhere; opt-in experimental adapter |
| Cohere | Free trial, 1,000 calls/month; explicitly not production/commercial | https://cohere.com/pricing and https://docs.cohere.com/docs/rate-limits; opt-in for testing only |
| Cerebras | Current pricing includes conditional one-time promo credit requiring a payment method; not guaranteed ongoing free API | https://www.cerebras.ai/pricing; optional adapter, disabled by default |

To enable an experimental adapter, explicitly list its name in AI_EXPERIMENTAL_PROVIDERS after checking the provider's terms for your intended use. Do not enable Cohere trial for a live customer bot. Cerebras is included for compatibility, not recommended as an ongoing free provider.

GitHub Models was investigated but current documentation redirected away from its old setup page; it was not added as a verified free fallback. Services offering only temporary signup credits, paid APIs, browser-only chat or user-funded SDK calls are not silently treated as free APIs. Other OpenAI-compatible services can be configured with AI_ALLOW_CUSTOM=true and the existing AI_BASE_URL / AI_API_KEY / AI_MODEL settings, after checking their terms and costs.

## Existing full bot

The original runtime remains available via `npm run start:full` in the GitHub checkout. The release ZIP contains the chat runtime, dashboard, and its dependencies; use the original checkout for full bot features.


## Settings website

The dashboard is served by the same bot process at `/`. Set a strong WEB_ADMIN_KEY in your server environment or `.env`, then use it as the admin password. Browser logins last about 30 minutes and use an HttpOnly SameSite cookie. API mutations require a session-specific CSRF token. Saved API keys are never returned by the settings API. Only the main admin has dashboard access; this is not a public customer portal.

Open the hosting panel's public address and allocated port, for example `http://YOUR_SERVER_ADDRESS:YOUR_PORT/`, or use the HTTPS domain assigned by your provider. Prefer HTTPS when entering passwords or keys. PORT must match the allocated port. If the host does not expose HTTP access, request that from support; the website cannot be reached merely by starting Node.js. No public dashboard URL was supplied or deployed during this build.

Nervox startup: the default `node ${STARTUP_FILE}` now works with STARTUP FILE set to `index.js`. The root entry starts chat mode with a 320 MB JS heap ceiling. A repository URL must point to the Git repository, not its GitHub `/tree/` page. Use repository `https://github.com/cchughiefe-art/void-xmd` and branch `void-xmd-v2` if there is a separate branch setting. If your host cannot select a branch, upload and extract the latest dashboard ZIP manually. Do not merge into main merely to make a panel's default clone work.

Dashboard controls include primary/extra account pairing, per-account AI on/off, public/private mode, personality, knowledge, tone, rules, contact pause/resume, conversation memory clearing, non-primary account disconnect, provider keys/models, saved-key removal, and provider enable/disable. Environment credentials must be removed in the server settings. Experimental-provider flags remain server settings.
