import { config } from './config.js';
import { store } from './store.js';
import { jidNumber } from './utils.js';
import { askAi } from './ai-provider.js';

const NSFW_WORDS = /\b(?:porn|porno|xxx|nudes?|sex\s*video|hentai|onlyfans)\b/i;
const TEMU_LINK = /(?:https?:\/\/)?(?:www\.)?temu\.com\//i;

async function aiReply(text) {
  return askAi(text, {
    system: 'You are the concise WhatsApp group assistant for VOID XMD. Be helpful and brief.',
    temperature: 0.6,
    maxTokens: 300,
    timeout: 30000
  });
}

async function removeMessage(sock, chat, raw, notice) {
  await sock.sendMessage(chat, { delete: raw.key }).catch(() => {});
  if (notice) await sock.sendMessage(chat, { text: notice }).catch(() => {});
}

export async function handleStatusAutomation(sock, raw) {
  if (raw.key.remoteJid !== 'status@broadcast') return false;

  if (store.getGlobal('autoviewstatus', false)) {
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
    await sock.readMessages([raw.key]).catch(() => {});
  }

  if (settings.alwaysonline) {
    await sock.sendPresenceUpdate('available', chat).catch(() => {});
  }

  if (settings.autotyping) {
    await sock.sendPresenceUpdate('composing', chat).catch(() => {});
  } else if (settings.autorecording) {
    await sock.sendPresenceUpdate('recording', chat).catch(() => {});
  }

  if (settings.autoreact && !raw.key.fromMe) {
    await sock.sendMessage(chat, {
      react: { text: '👍', key: raw.key }
    }).catch(() => {});
  }

  if (raw.key.fromMe || isAdmin) return false;

  const type = Object.keys(raw.message || {})[0] || '';
  const mentions = contextInfo?.mentionedJid || [];
  const normalized = String(body || '');

  const linkMatch = /chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(normalized);
  if (linkMatch && isBotAdmin) {
    const mode = settings.antiLinkMode || (settings.antilink ? 'delete' : 'off');
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
