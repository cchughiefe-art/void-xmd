import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { config } from './config.js';
import { store } from './store.js';
import { jidNumber } from './utils.js';
import { askAi } from './ai-provider.js';

const NSFW_WORDS = /\b(?:porn|porno|xxx|nudes?|sex\s*video|hentai|onlyfans)\b/i;
const TEMU_LINK = /(?:https?:\/\/)?(?:www\.)?temu\.com\//i;

const deletedMessageCache = new Map();
const suppressedDeletes = new Set();

const cacheKey = key => `${key?.remoteJid || ''}:${key?.id || ''}`;

function pruneMessageCache() {
  while (deletedMessageCache.size > 500) {
    const first = deletedMessageCache.keys().next().value;
    if (!first) break;
    deletedMessageCache.delete(first);
  }
}

export function rememberMessage(raw) {
  if (!raw?.key?.id || raw.key.fromMe || raw.key.remoteJid === 'status@broadcast') return;
  deletedMessageCache.set(cacheKey(raw.key), raw);
  pruneMessageCache();
}

export function suppressAntiDelete(key) {
  const id = cacheKey(key);
  if (!id) return;
  suppressedDeletes.add(id);
  const timer = setTimeout(() => suppressedDeletes.delete(id), 30000);
  timer.unref?.();
}

function unwrapViewOnce(message) {
  let current = message;
  let found = false;

  for (let i = 0; i < 8 && current; i++) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }

    const wrapper =
      current.viewOnceMessage ||
      current.viewOnceMessageV2 ||
      current.viewOnceMessageV2Extension;

    if (wrapper?.message) {
      found = true;
      current = wrapper.message;
      continue;
    }

    break;
  }

  if (!found) {
    const direct = current?.imageMessage || current?.videoMessage || current?.audioMessage;
    if (direct?.viewOnce) found = true;
  }
  return found ? current : null;
}

async function resendViewOnce(sock, chat, raw) {
  const inner = unwrapViewOnce(raw.message);
  if (!inner) return false;

  const mediaType = inner.imageMessage
    ? 'image'
    : inner.videoMessage
      ? 'video'
      : inner.audioMessage
        ? 'audio'
        : '';

  if (!mediaType) return false;

  const content = inner[`${mediaType}Message`];
  const stream = await downloadContentFromMessage(content, mediaType);
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);

  if (mediaType === 'image') {
    await sock.sendMessage(chat, {
      image: buffer,
      caption: content.caption || 'View-once image preserved by anti-view-once.'
    }, { quoted: raw });
  } else if (mediaType === 'video') {
    await sock.sendMessage(chat, {
      video: buffer,
      caption: content.caption || 'View-once video preserved by anti-view-once.',
      mimetype: content.mimetype || 'video/mp4'
    }, { quoted: raw });
  } else {
    await sock.sendMessage(chat, {
      audio: buffer,
      mimetype: content.mimetype || 'audio/ogg; codecs=opus',
      ptt: Boolean(content.ptt)
    }, { quoted: raw });
  }

  return true;
}

export async function handleDeletedMessages(sock, event) {
  const keys = Array.isArray(event?.keys) ? event.keys : [];
  for (const key of keys) {
    const id = cacheKey(key);

    if (suppressedDeletes.has(id)) {
      suppressedDeletes.delete(id);
      continue;
    }

    const cached = deletedMessageCache.get(id);
    if (!cached) continue;

    const chat = key.remoteJid;
    if (!chat?.endsWith('@g.us')) continue;

    const settings = store.getGroup(chat);
    if (!settings.antidelete) continue;

    const sender = cached.key.participant || cached.participant || '';
    const mention = sender ? `@${jidNumber(sender)}` : 'A member';

    await sock.sendMessage(chat, {
      text: `Anti-delete\n${mention} deleted a message.`,
      mentions: sender ? [sender] : []
    }).catch(() => {});

    await sock.sendMessage(chat, {
      forward: cached,
      force: true
    }).catch(error => {
      console.error('Anti-delete forward:', error.message);
    });
  }
}

export async function handleCalls(sock, calls = []) {
  if (!store.getGlobal('anticall', false)) return;

  for (const call of calls) {
    if (call?.status !== 'offer' || !call.id || !call.from) continue;

    await sock.rejectCall(call.id, call.from).catch(error => {
      console.error('Anti-call reject:', error.message);
    });

    if (!call.isGroup) {
      await sock.sendMessage(call.from, {
        text: 'Calls are disabled for this bot account. Please send a message instead.'
      }).catch(() => {});
    }
  }
}


async function aiReply(text) {
  return askAi(text, {
    system: 'You are the concise WhatsApp group assistant for VOID XMD. Be helpful and brief.',
    temperature: 0.6,
    maxTokens: 300,
    timeout: 30000
  });
}

async function removeMessage(sock, chat, raw, notice) {
  suppressAntiDelete(raw.key);
  await sock.sendMessage(chat, { delete: raw.key }).catch(() => {});
  if (notice) await sock.sendMessage(chat, { text: notice }).catch(() => {});
}

export async function handleStatusAutomation(sock, raw) {
  if (raw.key.remoteJid !== 'status@broadcast') return false;

  if (store.getGlobal('autoviewstatus', false) || store.getGlobal('autostatus', false)) {
    await sock.readMessages([raw.key]).catch(() => {});
  }

  if (store.getGlobal('autostatusreact', false) && raw.key.participant) {
    await sock.sendMessage('status@broadcast', {
      react: { text: '❤️', key: raw.key }
    }).catch(() => {});
  }

  return true;
}

export async function handleMessageAutomation(ctx) {
  const {
    sock, raw, chat, sender, body, isGroup, isAdmin, isBotAdmin,
    metadata, contextInfo
  } = ctx;

  if (!isGroup) return false;
  const settings = store.getGroup(chat);

  if (settings.autoread) {
    void sock.readMessages([raw.key]).catch(() => {});
  }

  if (settings.alwaysonline) {
    void sock.sendPresenceUpdate('available', chat).catch(() => {});
  }

  if (settings.autotyping) {
    void sock.sendPresenceUpdate('composing', chat).catch(() => {});
    const timer = setTimeout(() => void sock.sendPresenceUpdate('paused', chat).catch(() => {}), 2500);
    timer.unref?.();
  } else if (settings.autorecording) {
    void sock.sendPresenceUpdate('recording', chat).catch(() => {});
    const timer = setTimeout(() => void sock.sendPresenceUpdate('paused', chat).catch(() => {}), 2500);
    timer.unref?.();
  }

  if (settings.autoreact && !raw.key.fromMe) {
    void sock.sendMessage(chat, {
      react: { text: '👍', key: raw.key }
    }).catch(() => {});
  }

  if (settings.antiviewonce && !raw.key.fromMe) {
    try {
      await resendViewOnce(sock, chat, raw);
    } catch (error) {
      console.error('Anti-view-once:', error.message);
    }
  }

  if (raw.key.fromMe || isAdmin) return false;

  const type = Object.keys(raw.message || {})[0] || '';
  const mentions = contextInfo?.mentionedJid || [];
  const normalized = String(body || '');

  const linkMatch = /chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(normalized);
  if (linkMatch && isBotAdmin) {
    const mode = settings.antiLinkMode && settings.antiLinkMode !== 'off' ? settings.antiLinkMode : (settings.antilink ? 'delete' : 'off');
    if (mode !== 'off') {
      if (mode === 'warn') {
        const g = store.getGroup(chat);
        g.warnings[sender] = (g.warnings[sender] || 0) + 1;
        store.updateGroup(chat, { warnings: g.warnings });
        await removeMessage(sock, chat, raw, `⚠️ @${jidNumber(sender)} links are not allowed. Warning ${g.warnings[sender]}/3.`);
        if (g.warnings[sender] >= 3) {
          await sock.groupParticipantsUpdate(chat, [sender], 'remove').catch(() => {});
        }
      } else if (mode === 'kick') {
        await removeMessage(sock, chat, raw, `🚫 @${jidNumber(sender)} was removed for posting a group invite link.`);
        await sock.groupParticipantsUpdate(chat, [sender], 'remove').catch(() => {});
      } else {
        await removeMessage(sock, chat, raw, '🚫 Group invite links are not allowed here.');
      }
      return true;
    }
  }

  if (settings.antisticker && type === 'stickerMessage' && isBotAdmin) {
    await removeMessage(sock, chat, raw, '🚫 Stickers are disabled in this group.');
    return true;
  }

  if (
    settings.antimedia &&
    ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(type) &&
    isBotAdmin
  ) {
    await removeMessage(sock, chat, raw, '🚫 Media is disabled in this group.');
    return true;
  }

  if (settings.antitag && mentions.length && isBotAdmin) {
    await removeMessage(sock, chat, raw, '🚫 Tagging members is disabled in this group.');
    return true;
  }

  if (settings.antimention && mentions.length >= 5 && isBotAdmin) {
    await removeMessage(sock, chat, raw, '🚫 Mass mentions are disabled in this group.');
    return true;
  }

  if (settings.antitemu && TEMU_LINK.test(normalized) && isBotAdmin) {
    await removeMessage(sock, chat, raw, '🚫 Temu links are disabled in this group.');
    return true;
  }

  if (settings.antinsfw && NSFW_WORDS.test(normalized) && isBotAdmin) {
    await removeMessage(sock, chat, raw, '🚫 NSFW content is disabled in this group.');
    return true;
  }

  if (settings.antibadwords && settings.badwords?.length) {
    const lower = normalized.toLowerCase();
    const bad = settings.badwords.find(word => lower.includes(String(word).toLowerCase()));
    if (bad && isBotAdmin) {
      await removeMessage(sock, chat, raw, '🚫 That word is blocked in this group.');
      return true;
    }
  }

  if (
    settings.chatbot &&
    normalized &&
    !normalized.startsWith(config.prefix) &&
    !raw.key.fromMe
  ) {
    try {
      const answer = await aiReply(normalized);
      if (answer) await sock.sendMessage(chat, { text: answer }, { quoted: raw });
    } catch (error) {
      console.error('Chatbot automation:', error.message);
    }
  }

  return false;
}

export function applyConnectionAutomation(sock) {
  let timer;

  const refresh = async () => {
    if (store.getGlobal('alwaysonline', false)) {
      await sock.sendPresenceUpdate('available').catch(() => {});
    }
    if (store.getGlobal('autobio', false)) {
      const text = `${config.name} • online • ${new Date().toLocaleString('en-NG', { timeZone: config.timezone })}`;
      await sock.updateProfileStatus(text.slice(0, 139)).catch(() => {});
    }
  };

  refresh();
  timer = setInterval(refresh, 15 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
