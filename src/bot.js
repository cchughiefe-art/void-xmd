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
const sessions = new Map();
const PRIMARY_SESSION = 'primary';
const extraSessionsDir = path.join(config.dataDir, 'sessions');

let bootPromise = null;
let started = false;
let waVersionPromise = null;

const groupMetadataCache = new Map();
const GROUP_METADATA_TTL = 60_000;

function maxSessions() {
  const value = Number(process.env.MAX_WHATSAPP_SESSIONS || 3);
  if (!Number.isInteger(value)) return 3;
  return Math.max(1, Math.min(10, value));
}

function sessionCacheKey(sessionId, jid) {
  return `${sessionId}:${jid}`;
}

async function getGroupMetadataCached(sock, jid, sessionId, force = false) {
  const now = Date.now();
  const key = sessionCacheKey(sessionId, jid);
  const cached = groupMetadataCache.get(key);
  if (!force && cached && now - cached.at < GROUP_METADATA_TTL) return cached.value;
  const value = await sock.groupMetadata(jid);
  groupMetadataCache.set(key, { at: now, value });
  return value;
}

function clearGroupMetadataForSession(sessionId, jid = '') {
  if (jid) {
    groupMetadataCache.delete(sessionCacheKey(sessionId, jid));
    return;
  }
  for (const key of groupMetadataCache.keys()) {
    if (key.startsWith(`${sessionId}:`)) groupMetadataCache.delete(key);
  }
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

function formatPairingCode(code) {
  const plain = String(code || '').replace(/[^A-Za-z0-9]/g, '');
  return plain.match(/.{1,4}/g)?.join('-') || plain;
}

function createRecord({ id, authDir, phone = '', primary = false }) {
  return {
    id,
    authDir,
    phone,
    primary,
    socket: null,
    authState: null,
    connected: false,
    loggedOut: false,
    pairingCode: '',
    pairingPromise: null,
    intentionalStop: false,
    reconnectTimer: null,
    stopConnectionAutomation: () => {}
  };
}

function getPrimary() {
  return sessions.get(PRIMARY_SESSION);
}

export function connectionState() {
  return Boolean(getPrimary()?.connected);
}

export function pairingState() {
  const primary = getPrimary();
  return { connected: Boolean(primary?.connected), code: primary?.pairingCode || '' };
}

async function currentWaVersion() {
  waVersionPromise ||= fetchLatestWaWebVersion();
  try {
    return await waVersionPromise;
  } catch (error) {
    waVersionPromise = null;
    throw error;
  }
}

async function requestPairingFor(record, number) {
  const phone = String(number || '').replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) throw new Error('Enter a valid international number without + or spaces.');
  if (!record?.socket) throw new Error('WhatsApp connection is still starting. Try again in a few seconds.');
  if (record.authState?.creds?.registered || record.connected) throw new Error('That WhatsApp session is already connected.');
  if (record.pairingPromise) return record.pairingPromise;

  record.pairingPromise = (async () => {
    let lastError;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const code = await record.socket.requestPairingCode(phone);
        record.phone = phone;
        record.pairingCode = formatPairingCode(code);
        return record.pairingCode;
      } catch (error) {
        lastError = error;
        if (attempt < 5) await sleep(1000);
      }
    }
    throw lastError || new Error('Could not generate a pairing code.');
  })();

  try {
    return await record.pairingPromise;
  } finally {
    record.pairingPromise = null;
  }
}

export async function requestPairing(number) {
  const primary = getPrimary();
  if (!primary) throw new Error('WhatsApp connection is still starting. Try again in a few seconds.');
  return requestPairingFor(primary, number);
}

function findSession(identifier) {
  const value = String(identifier || '').trim();
  const digits = value.replace(/\D/g, '');
  if (!value) return null;
  if (sessions.has(value)) return sessions.get(value);
  for (const record of sessions.values()) {
    const jid = jidNumber(record.socket?.user?.id);
    if (digits && (digits === record.phone || digits === jid)) return record;
  }
  return null;
}

export function listDevices() {
  return [...sessions.values()].map(record => ({
    id: record.id,
    primary: record.primary,
    phone: record.phone || jidNumber(record.socket?.user?.id) || '',
    jid: record.socket?.user?.id || '',
    connected: Boolean(record.connected),
    loggedOut: Boolean(record.loggedOut),
    status: record.connected ? 'connected' : record.loggedOut ? 'logged-out' : record.pairingCode ? 'waiting-for-pair' : 'connecting'
  }));
}

async function stopRecord(record, { logout = false, removeFiles = false } = {}) {
  if (!record) return;
  record.intentionalStop = true;
  record.connected = false;
  clearTimeout(record.reconnectTimer);
  record.reconnectTimer = null;
  try { record.stopConnectionAutomation?.(); } catch {}
  const socket = record.socket;
  record.socket = null;
  if (socket) {
    try {
      if (logout) await socket.logout();
      else socket.end?.(new Error('Session stopped'));
    } catch {}
  }
  clearGroupMetadataForSession(record.id);
  if (removeFiles) fs.rmSync(record.authDir, { recursive: true, force: true });
}

export async function removeDevice(identifier) {
  const record = findSession(identifier);
  if (!record) throw new Error('Device not found. Use .devices to list connected sessions.');
  if (record.primary) throw new Error('The primary device cannot be removed with .removedevice.');
  const label = record.phone || jidNumber(record.socket?.user?.id) || record.id;
  await stopRecord(record, { logout: true, removeFiles: true });
  sessions.delete(record.id);
  return { id: record.id, phone: label };
}

export async function addDevice(number) {
  const phone = String(number || '').replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) throw new Error('Usage: .adddevice 2348012345678');

  const existing = findSession(phone);
  if (existing) {
    if (existing.connected) throw new Error('That WhatsApp number is already connected.');
    if (existing.pairingCode) return { id: existing.id, phone, code: existing.pairingCode, reused: true };
    throw new Error('A session for that number already exists. Use .devices to check it.');
  }

  if (sessions.size >= maxSessions()) {
    throw new Error(`Session limit reached (${maxSessions()}). Increase MAX_WHATSAPP_SESSIONS only if the server has enough RAM.`);
  }

  fs.mkdirSync(extraSessionsDir, { recursive: true });
  const authDir = path.join(extraSessionsDir, phone);
  const record = createRecord({ id: phone, authDir, phone, primary: false });
  sessions.set(record.id, record);

  try {
    await connectSession(record);
    const code = await requestPairingFor(record, phone);
    return { id: record.id, phone, code, reused: false };
  } catch (error) {
    await stopRecord(record, { logout: false, removeFiles: true });
    sessions.delete(record.id);
    throw error;
  }
}

function scheduleReconnect(record) {
  if (record.intentionalStop || record.loggedOut || record.reconnectTimer) return;
  record.reconnectTimer = setTimeout(() => {
    record.reconnectTimer = null;
    connectSession(record).catch(error => {
      logger.error({ err: error, session: record.id }, 'Session reconnect failed');
      scheduleReconnect(record);
    });
  }, 3000);
  record.reconnectTimer.unref?.();
}

function attachCommonEvents(record, sock) {
  const sessionId = record.id;

  sock.ev.on('call', calls => {
    handleCalls(sock, calls).catch(error => logger.error({ err: error, session: sessionId }, 'Call automation failed'));
  });

  sock.ev.on('messages.delete', event => {
    handleDeletedMessages(sock, event).catch(error => logger.error({ err: error, session: sessionId }, 'Delete automation failed'));
  });

  sock.ev.on('group-participants.update', async event => {
    clearGroupMetadataForSession(sessionId, event.id);
    const settings = store.getGroup(event.id);
    const meta = await getGroupMetadataCached(sock, event.id, sessionId, true).catch(() => null);
    if (!meta) return;

    for (const member of event.participants) {
      const mention = `@${jidNumber(member)}`;
      if (event.action === 'add' && settings.welcome) {
        await sock.sendMessage(event.id, { text: `Welcome ${mention} to *${meta.subject}*`, mentions: [member] });
      }
      if (event.action === 'remove' && settings.goodbye) {
        await sock.sendMessage(event.id, { text: `Goodbye ${mention}`, mentions: [member] });
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
        const sender = isGroup ? (raw.key.participant || raw.participant || sock.user?.id) : (raw.key.fromMe ? sock.user?.id || chat : chat);
        store.see(sender);

        let metadata = null;
        let isAdmin = false;
        let isBotAdmin = false;

        if (isGroup) {
          metadata = await getGroupMetadataCached(sock, chat, sessionId);
          const admins = metadata.participants.filter(p => p.admin).map(p => jidNumber(p.id));
          isAdmin = admins.includes(jidNumber(sender));
          isBotAdmin = admins.includes(jidNumber(sock.user?.id));
        }

        const messageType = getContentType(raw.message);
        const messageContent = raw.message?.[messageType];
        const contextInfo = messageContent?.contextInfo || raw.message?.extendedTextMessage?.contextInfo || raw.message?.imageMessage?.contextInfo || raw.message?.videoMessage?.contextInfo || raw.message?.documentMessage?.contextInfo || {};

        const moderated = await handleMessageAutomation({ sock, raw, chat, sender, body, isGroup, isAdmin, isBotAdmin, metadata, contextInfo });
        if (moderated) continue;
        if (!body.startsWith(config.prefix)) continue;

        const [head, ...args] = body.slice(config.prefix.length).trim().split(/\s+/);
        if (!head) continue;

        const command = head.toLowerCase();
        const text = args.join(' ');
        const isOwner = jidNumber(sender) === config.owner || (raw.key.fromMe && jidNumber(sock.user?.id) === config.owner);
        if (store.getGlobal('mode', config.mode) === 'private' && !isOwner) continue;

        const reply = (message, mentions = []) => sock.sendMessage(chat, { text: String(message), mentions }, { quoted: raw });
        const quoted = contextInfo.quotedMessage ? { participant: contextInfo.participant, message: contextInfo.quotedMessage, stanzaId: contextInfo.stanzaId } : null;

        const downloadMedia = async () => {
          const target = quoted ? { key: { remoteJid: chat, id: quoted.stanzaId, participant: quoted.participant }, message: quoted.message } : raw;
          const type = getContentType(target.message || {});
          if (!['imageMessage', 'audioMessage', 'videoMessage', 'documentMessage', 'stickerMessage'].includes(type)) throw new Error('Reply to an image, audio, video, document, or sticker first.');
          return downloadMediaMessage(target, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
        };

        await execute({
          command, args, text, reply, sock, chat, sender, isOwner, isGroup, isAdmin, isBotAdmin, metadata,
          mentions: contextInfo.mentionedJid || [], quoted, downloadMedia, raw, pushName: raw.pushName || 'User',
          timestamp: Number(raw.messageTimestamp) * 1000 || Date.now(), sessionId,
          deviceManager: { add: addDevice, list: listDevices, remove: removeDevice, max: maxSessions }
        });
      } catch (error) {
        logger.error({ err: error, session: sessionId });
        if (raw.key.remoteJid && raw.key.remoteJid !== 'status@broadcast') {
          await sock.sendMessage(raw.key.remoteJid, { text: `❌ ${error.message || 'Command failed.'}` }, { quoted: raw }).catch(() => {});
        }
      }
    }
  });
}

async function connectSession(record) {
  record.intentionalStop = false;
  record.loggedOut = false;
  fs.mkdirSync(record.authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(record.authDir);
  const { version } = await currentWaVersion();
  const sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 10000
  });

  record.socket = sock;
  record.authState = state;
  record.connected = false;
  sock.authState = state;
  sock.ev.on('creds.update', saveCreds);

  let initialPairRequested = false;

  sock.ev.on('connection.update', async update => {
    if (record.socket !== sock) return;

    if (record.primary && update.qr && !state.creds.registered && config.pairingNumber && !initialPairRequested) {
      initialPairRequested = true;
      try {
        const code = await requestPairingFor(record, config.pairingNumber);
        console.log(`\n================================\n${config.name} PAIRING CODE: ${code}\nWhatsApp > Linked devices > Link with phone number\n================================\n`);
      } catch (error) {
        logger.error({ err: error, session: record.id }, 'Pairing code request failed');
      }
    }

    if (update.connection === 'open') {
      record.connected = true;
      record.loggedOut = false;
      record.pairingCode = '';
      record.phone = record.phone || jidNumber(sock.user?.id);
      try { record.stopConnectionAutomation?.(); } catch {}
      record.stopConnectionAutomation = applyConnectionAutomation(sock);
      logger.info({ jid: sock.user?.id, session: record.id }, `${config.name} connected`);
    }

    if (update.connection === 'close') {
      record.connected = false;
      try { record.stopConnectionAutomation?.(); } catch {}
      record.stopConnectionAutomation = () => {};
      const status = new Boom(update.lastDisconnect?.error).output?.statusCode;
      if (record.intentionalStop) return;
      if (status === DisconnectReason.loggedOut) {
        record.loggedOut = true;
        record.pairingCode = '';
        logger.error({ session: record.id }, `Logged out. Remove/re-pair session at ${record.authDir}.`);
        return;
      }
      logger.warn({ status, session: record.id }, 'Disconnected; reconnecting with saved credentials');
      scheduleReconnect(record);
    }
  });

  attachCommonEvents(record, sock);
  return sock;
}

async function startSavedDevices() {
  fs.mkdirSync(extraSessionsDir, { recursive: true });
  const entries = fs.readdirSync(extraSessionsDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();

  for (const id of entries) {
    if (sessions.size >= maxSessions()) {
      logger.warn({ limit: maxSessions() }, 'Saved WhatsApp sessions exceed MAX_WHATSAPP_SESSIONS; remaining sessions were not started');
      break;
    }
    const authDir = path.join(extraSessionsDir, id);
    if (!fs.existsSync(path.join(authDir, 'creds.json'))) continue;
    if (sessions.has(id)) continue;

    const record = createRecord({ id, authDir, phone: id.replace(/\D/g, ''), primary: false });
    sessions.set(id, record);
    try {
      await connectSession(record);
    } catch (error) {
      sessions.delete(id);
      logger.error({ err: error, session: id }, 'Could not start saved WhatsApp session');
    }
  }
}

export async function startBot() {
  if (started) return getPrimary()?.socket;
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    const authDir = path.join(config.dataDir, 'auth');
    const primary = createRecord({ id: PRIMARY_SESSION, authDir, phone: config.pairingNumber, primary: true });
    sessions.set(PRIMARY_SESSION, primary);

    try {
      await connectSession(primary);
      await startSavedDevices();
      started = true;
      if (!primary.authState?.creds?.registered && !config.pairingNumber) console.log('No WhatsApp session. Open /pair to generate a pairing code.');
      logger.info({ sessions: sessions.size, maxSessions: maxSessions() }, 'WhatsApp multi-device manager started');
      return primary.socket;
    } catch (error) {
      sessions.delete(PRIMARY_SESSION);
      throw error;
    }
  })();

  try {
    return await bootPromise;
  } finally {
    bootPromise = null;
  }
}
