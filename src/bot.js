import fs from 'node:fs';
import path from 'node:path';
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestWaWebVersion,
  getContentType,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { config } from './config.js';
import { execute } from './commands.js';
import { store } from './store.js';
import { jidNumber, sleep } from './utils.js';
import {
  applyConnectionAutomation,
  handleCalls,
  handleDeletedMessages,
  handleMessageAutomation,
  handleStatusAutomation,
  rememberMessage
} from './automation.js';

const originalConsoleInfo = console.info.bind(console);
console.info = (...args) => {
  const first = String(args[0] ?? '');
  if (
    first.startsWith('Closing session:') ||
    first.startsWith('Opening session:') ||
    first.startsWith('Removing old closed session:')
  ) return;
  originalConsoleInfo(...args);
};

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
let activeSocket;
let latestPairingCode = '';
let pairingPromise = null;

const groupMetadataCache = new Map();
const GROUP_METADATA_TTL = 60_000;

async function getGroupMetadataCached(sock, jid, force = false) {
  const now = Date.now();
  const cached = groupMetadataCache.get(jid);

  if (!force && cached && now - cached.at < GROUP_METADATA_TTL) {
    return cached.value;
  }

  const value = await sock.groupMetadata(jid);
  groupMetadataCache.set(jid, { at: now, value });
  return value;
}


const bodyOf = message => {
  const m = message?.message;
  if (!m) return '';
  const type = getContentType(m);
  const content = m[type];
  return m.conversation ||
    content?.text ||
    content?.caption ||
    content?.selectedButtonId ||
    content?.singleSelectReply?.selectedRowId ||
    '';
};

export function connectionState() {
  return Boolean(activeSocket?.user);
}

export function pairingState() {
  return { connected: connectionState(), code: latestPairingCode };
}

export async function requestPairing(number) {
  const phone = String(number || '').replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) {
    throw new Error('Enter a valid international number without + or spaces.');
  }
  if (!activeSocket) {
    throw new Error('WhatsApp connection is still starting. Try again in a few seconds.');
  }
  if (activeSocket.authState?.creds?.registered || connectionState()) {
    throw new Error('A WhatsApp account is already connected.');
  }
  if (pairingPromise) return pairingPromise;

  pairingPromise = (async () => {
    try {
      const code = await activeSocket.requestPairingCode(phone);
      latestPairingCode = code.match(/.{1,4}/g)?.join('-') || code;
      console.log(`${config.name} pairing code: ${latestPairingCode}`);
      return latestPairingCode;
    } finally {
      pairingPromise = null;
    }
  })();

  return pairingPromise;
}

export async function startBot() {
  const authDir = path.join(config.dataDir, 'auth');
  fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestWaWebVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    logger,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 10000
  });

  activeSocket = sock;
  sock.authState = state;
  sock.ev.on('creds.update', saveCreds);

  let initialPairRequested = false;
  let stopConnectionAutomation = () => {};

  sock.ev.on('connection.update', async update => {
    if (
      update.qr &&
      !state.creds.registered &&
      config.pairingNumber &&
      !initialPairRequested
    ) {
      initialPairRequested = true;
      try {
        const code = await requestPairing(config.pairingNumber);
        console.log(
          `\n================================\n${config.name} PAIRING CODE: ${code}\nWhatsApp > Linked devices > Link with phone number\n================================\n`
        );
      } catch (error) {
        logger.error({ err: error }, 'Pairing code request failed');
      }
    }

    if (update.connection === 'open') {
      latestPairingCode = '';
      stopConnectionAutomation();
      stopConnectionAutomation = applyConnectionAutomation(sock);
      logger.info({ jid: sock.user?.id }, `${config.name} connected`);
    }

    if (update.connection === 'close') {
      stopConnectionAutomation();
      if (activeSocket === sock) activeSocket = undefined;
      const status = new Boom(update.lastDisconnect?.error).output?.statusCode;
      if (status === DisconnectReason.loggedOut) {
        logger.error(`Logged out. Delete ${authDir} and pair again.`);
      } else {
        logger.warn({ status }, 'Disconnected; reconnecting with saved credentials');
        await sleep(3000);
        startBot().catch(err => logger.error(err));
      }
    }
  });

  if (!state.creds.registered && !config.pairingNumber) {
    console.log('No WhatsApp session. Open /pair to generate a pairing code.');
  }

  sock.ev.on('call', calls => {
    handleCalls(sock, calls).catch(error => logger.error(error));
  });

  sock.ev.on('messages.delete', event => {
    handleDeletedMessages(sock, event).catch(error => logger.error(error));
  });

  sock.ev.on('group-participants.update', async event => {
    groupMetadataCache.delete(event.id);
    const settings = store.getGroup(event.id);
    const meta = await getGroupMetadataCached(sock, event.id, true).catch(() => null);
    if (!meta) return;

    for (const member of event.participants) {
      const mention = `@${jidNumber(member)}`;
      if (event.action === 'add' && settings.welcome) {
        await sock.sendMessage(event.id, {
          text: `Welcome ${mention} to *${meta.subject}*`,
          mentions: [member]
        });
      }
      if (event.action === 'remove' && settings.goodbye) {
        await sock.sendMessage(event.id, {
          text: `Goodbye ${mention}`,
          mentions: [member]
        });
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const raw of messages) {
      try {
        if (!raw.message) continue;

        if (raw.key.remoteJid === 'status@broadcast') {
          await handleStatusAutomation(sock, raw);
          continue;
        }

        rememberMessage(raw);

        const body = bodyOf(raw).trim();
        const chat = raw.key.remoteJid;
        const isGroup = chat.endsWith('@g.us');
        const sender = isGroup
          ? (raw.key.participant || raw.participant || sock.user?.id)
          : (raw.key.fromMe ? sock.user?.id || chat : chat);

        store.see(sender);

        let metadata = null;
        let isAdmin = false;
        let isBotAdmin = false;

        if (isGroup) {
          metadata = await getGroupMetadataCached(sock, chat);
          const admins = metadata.participants.filter(p => p.admin).map(p => jidNumber(p.id));
          isAdmin = admins.includes(jidNumber(sender));
          isBotAdmin = admins.includes(jidNumber(sock.user?.id));
        }

        const messageType = getContentType(raw.message);
        const messageContent = raw.message?.[messageType];
        const contextInfo =
          messageContent?.contextInfo ||
          raw.message?.extendedTextMessage?.contextInfo ||
          raw.message?.imageMessage?.contextInfo ||
          raw.message?.videoMessage?.contextInfo ||
          raw.message?.documentMessage?.contextInfo ||
          {};

        const moderated = await handleMessageAutomation({
          sock,
          raw,
          chat,
          sender,
          body,
          isGroup,
          isAdmin,
          isBotAdmin,
          metadata,
          contextInfo
        });
        if (moderated) continue;

        if (!body.startsWith(config.prefix)) continue;

        const [head, ...args] = body.slice(config.prefix.length).trim().split(/\s+/);
        if (!head) continue;

        const command = head.toLowerCase();
        const text = args.join(' ');
        const isOwner =
          jidNumber(sender) === config.owner ||
          (raw.key.fromMe && jidNumber(sock.user?.id) === config.owner);

        if (store.getGlobal('mode', config.mode) === 'private' && !isOwner) continue;

        const reply = (message, mentions = []) =>
          sock.sendMessage(chat, { text: String(message), mentions }, { quoted: raw });

        const quoted = contextInfo.quotedMessage
          ? {
              participant: contextInfo.participant,
              message: contextInfo.quotedMessage,
              stanzaId: contextInfo.stanzaId
            }
          : null;

        const downloadMedia = async () => {
          const target = quoted
            ? {
                key: {
                  remoteJid: chat,
                  id: quoted.stanzaId,
                  participant: quoted.participant
                },
                message: quoted.message
              }
            : raw;

          const type = getContentType(target.message || {});
          if (!['imageMessage', 'audioMessage', 'videoMessage', 'documentMessage', 'stickerMessage'].includes(type)) {
            throw new Error('Reply to an image, audio, video, document, or sticker first.');
          }

          return downloadMediaMessage(
            target,
            'buffer',
            {},
            { logger, reuploadRequest: sock.updateMediaMessage }
          );
        };

        await execute({
          command,
          args,
          text,
          reply,
          sock,
          chat,
          sender,
          isOwner,
          isGroup,
          isAdmin,
          isBotAdmin,
          metadata,
          mentions: contextInfo.mentionedJid || [],
          quoted,
          downloadMedia,
          raw,
          pushName: raw.pushName || 'User',
          timestamp: Number(raw.messageTimestamp) * 1000 || Date.now()
        });
      } catch (error) {
        logger.error(error);
        if (raw.key.remoteJid && raw.key.remoteJid !== 'status@broadcast') {
          await sock.sendMessage(
            raw.key.remoteJid,
            { text: `❌ ${error.message || 'Command failed.'}` },
            { quoted: raw }
          ).catch(() => {});
        }
      }
    }
  });

  return sock;
}
