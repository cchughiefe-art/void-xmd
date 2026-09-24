# VOID XMD

Raven-ready WhatsApp multi-device bot with pairing-code login. It includes a modular command menu, AI support, media downloading, group tools, protection, games, economy, owner controls, persistent configuration, and a health endpoint.

This uses the unofficial Baileys WhatsApp Web protocol. Use it only with accounts and groups you control, avoid unsolicited messaging, and expect WhatsApp-side changes to occasionally require dependency updates.

## Raven deployment

1. Upload this folder or connect its Git repository to Raven.
2. Choose **Dockerfile** deployment.
3. Add a persistent volume mounted at `/data`. This is essential because the WhatsApp session lives in `/data/auth`.
4. Add the environment variables below.
5. Expose port `3000` and set the health check to `/health`.
6. Deploy and open the Raven logs. The first start prints an eight-digit pairing code.
7. On WhatsApp, open **Settings > Linked devices > Link a device > Link with phone number**, enter the code, and wait for `VOID XMD connected` in the logs.

Required variables:

```env
BOT_NAME=VOID XMD
PREFIX=.
MODE=public
OWNER_NUMBER=2348012345678
PAIRING_NUMBER=2348012345678
PORT=3000
DATA_DIR=/data
TIMEZONE=Africa/Lagos
WEB_ADMIN_KEY=replace-with-a-long-random-password
```

Use the complete international number without `+` or spaces. `OWNER_NUMBER` controls owner-only commands. `PAIRING_NUMBER` is optional when using the pairing website.

Optional AI variables:

```env
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=your_key
AI_MODEL=gpt-4.1-mini
BRAVE_SEARCH_API_KEY=optional_search_key
```

Any provider exposing an OpenAI-compatible `/chat/completions` endpoint can be used.

## Local test

```bash
cp .env.example .env
# Edit .env, then export it into the shell
set -a; . ./.env; set +a
npm install
npm run check
npm start
```

## Important notes

- Keep `/data` persistent or you will need to pair again after every redeploy.
- Never commit `.env` or `/data/auth`; the auth directory controls the linked WhatsApp session.
- Downloader commands depend on sites supported by `yt-dlp`. A particular site may stop working when it changes its delivery system.
- Commands that crash, freeze, flood, hijack, leak sessions, steal credentials, or bypass WhatsApp safeguards are intentionally excluded.
- `anticall`, `antidelete`, `antiviewonce`, `autoreact`, and `autostatus` are visible but safely disabled until you decide their exact behavior.

## Main commands

Send `.menu` in WhatsApp for the generated command list. Plugin commands are discovered from `src/plugins` and added to the menu automatically. Start with `.ping`, `.botinfo`, `.weather Lagos`, `.wikipedia Nigeria`, `.ai explain blockchain`, and `.groupinfo`.

## Add your own command

Every custom command is a separate file in `src/plugins`. Copy `src/plugins/_example.js` to a new filename such as `hello.js`. Files beginning with `_` are ignored, which keeps the example from becoming a live command.

Minimal plugin:

```js
export default {
  name: 'hello',
  aliases: ['hi'],
  category: 'CUSTOM',
  description: 'Say hello',
  ownerOnly: false,
  groupOnly: false,
  adminOnly: false,
  async run({ reply, pushName, args, text }) {
    await reply(`Hello ${pushName}! You wrote: ${text || 'nothing'}`);
  }
};
```

Restart the Raven service after adding the file. `.hello` and `.hi` will then work and `.menu` will show `hello` under `CUSTOM`.

The command context can provide:

- `reply(text, mentions)` to reply to the message
- `sock` for supported Baileys actions
- `chat`, `sender`, `pushName`, `raw` and `quoted`
- `args` as an array and `text` as the joined arguments
- `isOwner`, `isGroup`, `isAdmin`, `isBotAdmin` and `metadata`
- `config` for the bot name, prefix, timezone and other non-secret runtime configuration

One plugin file may also export an array of command objects. See `text-tools.js`, `calculators.js`, `date-tools.js`, and `user-tools.js` for working examples.

Run `npm run check` before redeploying. A duplicate command name, invalid plugin name, or missing `run()` function stops startup with a clear error instead of silently loading a broken command.

## Search, music, stickers and voice effects

```text
.websearch best affordable phones in Nigeria
.music Burna Boy Last Last
.play Davido Feel
```

`.websearch` uses a keyless search fallback. For more consistent results, add `BRAVE_SEARCH_API_KEY` to Raven. Keep this key in Raven environment variables, never inside a plugin or GitHub commit.

To make a sticker, send an image with `.sticker` as its caption or reply to an image with `.sticker`.

To change a voice note, reply to the audio with one of:

```text
.voice deep
.voice chipmunk
.voice robot
.voice echo
.voice slow
.voice fast
.voice reverse
```

Music downloads are limited to 20 minutes and 90 MB per request to protect the Raven service. The Docker image already installs `yt-dlp` and FFmpeg for these commands.

## Pairing website and feature builder

Open your Raven public URL or `/pair`, for example:

```text
https://your-raven-domain.example/pair
```

Enter `WEB_ADMIN_KEY` and the complete WhatsApp number, then select **Generate pairing code**. The admin key must contain at least 12 characters and must remain private.

The owner can request a new command naturally inside WhatsApp:

```text
.feature add a command called greeting that welcomes the user by name
```

The bot creates a pending draft. Open `/pair`, enter the admin key, load the drafts, inspect the complete code, and approve it. Approved plugins are saved in `/data/plugins`, loaded immediately, and survive Raven redeployments because `/data` is persistent.

Generated plugins cannot access session files, environment secrets, shells, processes, unrestricted bot actions, or the full configuration. They receive a reduced command context and have a 10-second execution limit. Complex features that need media, group moderation, external APIs, or new dependencies should still be added manually in `src/plugins` and tested before deployment.
