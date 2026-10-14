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

## Tone learning and restart updates
Tone learning uses up to 24 short outgoing personal-message samples per account, from the history WhatsApp actually supplies and new human replies while AI is enabled. It does not fetch your entire phone archive. Incoming messages, group chats, commands, links and obvious credential/number patterns are excluded. These local samples are sent as writing examples to your selected AI provider when replying; filters cannot identify every private detail. This is prompt-based adaptation, not training a new model. Use `.learntone off`, `.learntone on` or `.learntone clear` from the linked account. Already-sent bot replies in historical sync may not be distinguishable from human replies.

On each chat-mode restart, the bot checks the public `void-xmd-v2` branch using git. If unchanged, it starts immediately. Changed source files are staged and syntax checked before application. `.env`, data, sessions and node_modules are excluded. A dependency change requires a manual install; detected local edits after the first update cause an update skip. The first installation establishes the baseline, so back up custom code before enabling. Failed network checks or missing git leave the installed code running. Set `AUTO_UPDATE=false` to disable. This updates changed files rather than making a Git merge commit, and does not remove obsolete files automatically.

## Separate session-user website logins
Sign in as owner with Account ID blank and WEB_ADMIN_KEY as password. Under WhatsApp accounts choose a paired/configured account, then Create / reset session login. Save the displayed account ID and random password and give them only to that account's user. Users enter both fields on the same website. They can view and configure only their assigned session, pause contacts, clear memory/tone and request pairing for its assigned number. Provider configuration, new account creation, session removal and login grants remain owner-only. Reset/revoke invalidates that user's active website sessions. Passwords are stored as salted scrypt hashes. Serve the dashboard through HTTPS before sharing logins across the internet. The owner must provision each session; public sign-up is not enabled.

## Customer signup and HTTPS
The login page now offers customer registration when `WEB_SIGNUP_ENABLED=true` and the request uses HTTPS. New customers register their own WhatsApp number and a password of 12–128 characters, then sign in using that number as Account ID. Their unlinked session appears immediately so they can request pairing. They must enter the pairing code on that WhatsApp account. AI replies and tone learning start disabled. Existing numbers cannot be claimed, and registered reservations count towards MAX_WHATSAPP_SESSIONS. The owner can revoke unused registrations from account access controls. No email/WhatsApp OTP recovery is provided; contact the owner for login reset. Registration alone is not proof of phone ownership; successful WhatsApp pairing is required before automatic replies can be enabled.

For native HTTPS on the assigned port, provide `WEB_TLS_CERT` and `WEB_TLS_KEY` paths for a valid certificate/key covering the hostname customers open. Alternatively ask Nervox for an HTTPS subdomain/reverse proxy to the allocated port. Set WEB_TRUST_PROXY=true only for a configured reverse proxy, restricting direct access to the origin; otherwise clients could forge proxy headers. Do not use a self-signed certificate for customers. Until HTTPS is configured the signup form stays unavailable. HTTPS cannot be activated merely by changing the URL from http to https.

Automatic restart updates now use the GitHub REST API and verified file hashes, with no git binary required. Only chat-release.json files are eligible, keys/data remain excluded, and network/rate-limit failures leave installed files intact. Source/dependency conflicts require manual review. `.env` is loaded before checking AUTO_UPDATE. GitHub's public API limits still apply.

## Handover choice at first linking
The linked account receives one setup message on first connection asking it to choose `.handover manual` or `.handover auto`. Choices are stored per session and can be changed later. `.setup` and `.businessai on` require a choice first. Existing enabled accounts without a choice use manual behavior until a choice is saved. The website remains optional.

When the AI detects a request for a human or a decision requiring approval, it replies, attempts to pin the customer chat at the top of the linked account’s chat list, hard-pauses that contact, and notifies only the linked account's owner in Message yourself. If the owner has not replied, both modes remain paused. In manual mode, even an owner's reply leaves AI paused until `.resumeai NUMBER`. In auto mode, the owner's reply moves that chat into human takeover; each subsequent customer message starts/restarts a 60-second opportunity for the owner to reply. If the owner doesn't reply, AI resumes. A normal owner reply without prior AI handoff follows the same manual/auto preference. Explicit `.pauseai` always needs manual resume. Changing mode does not clear existing hard pauses. Resume cancels pending timers and attempts to unpin that chat.

Chat pinning and self-notification delivery depend on WhatsApp and are not guaranteed; failures are logged. Handover detection currently uses the model's HANDOFF marker, so test the actual provider with requests such as 'I want to speak to a human'. `.start` includes all chat-mode commands and loaded assistant plugin aliases, filtered by the caller's permissions.

## Voice notes and conversational tone
Incoming private-chat audio can be transcribed with the configured Groq key using whisper-large-v3-turbo, then answered as normal chat text. Use `.voice on`, `.voice off` or `.voice status` per linked account. Audio is sent to Groq for transcription and the transcript to the normal chat provider; no audio file is saved by this implementation. Provider retention/usage terms still apply. Voice processing is enabled unless disabled per account, but requires the Groq provider/key to be configured and enabled. Free-tier quotas apply. Local limits are 180 seconds and 6 MiB, with one transcription at a time. Oversized files, missing keys, quota errors and unintelligible recordings get a request to send text. View-once media, groups, outgoing audio and hard-paused contacts are not transcribed. A transcription is never executed as a WhatsApp command. Replies are text, not synthesized voice.

The shared chat-style prompt now considers teasing, insults, quoted insults, frustration and sarcasm in context. It discourages retaliation, overreacting to slang, and confident guesses at hidden intent. This is model interpretation rather than a guaranteed sentiment detector. Vocal prosody is not available from the transcript, and Nigerian Pidgin/noisy recordings can be mistranscribed. Test real recordings after deployment; automated tests use mock audio/provider responses.

Chat-list pinning uses Baileys chatModify({ pin: true }, chatJid). On owner takeover or .resumeai it uses pin: false for a chat recorded as pinned by the handover. It does not create a pinned message inside the conversation. Existing old handovers need to be resumed and triggered again to test the new chat pin.
