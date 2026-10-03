import { downloadMediaMessage, getContentType } from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from '../config.js';
import { jidNumber, sleep } from '../utils.js';

function unwrapAll(message) {
  let current = message;

  for (let i = 0; i < 10 && current; i++) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }

    if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message;
      continue;
    }

    const wrapper =
      current.viewOnceMessage ||
      current.viewOnceMessageV2 ||
      current.viewOnceMessageV2Extension;

    if (wrapper?.message) {
      current = wrapper.message;
      continue;
    }

    break;
  }

  return current || null;
}

function directMedia(message) {
  if (!message) return null;

  const type = getContentType(message);
  if (['imageMessage', 'videoMessage', 'audioMessage'].includes(type)) {
    return { message, type };
  }

  return null;
}

function timestampOf(message) {
  const raw = message?.messageTimestamp;

  if (typeof raw === 'number') return raw;
  if (typeof raw === 'bigint') return Number(raw);
  if (raw && typeof raw.toNumber === 'function') return raw.toNumber();

  const low = Number(raw?.low);
  if (Number.isFinite(low) && low > 0) return low;

  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  return Math.floor(Date.now() / 1000);
}

function cleanMedia(media, buffer) {
  if (media.type === 'imageMessage') {
    return { image: buffer };
  }

  if (media.type === 'videoMessage') {
    return {
      video: buffer,
      mimetype: media.message.videoMessage?.mimetype || 'video/mp4'
    };
  }

  return {
    audio: buffer,
    mimetype: media.message.audioMessage?.mimetype || 'audio/ogg; codecs=opus',
    ptt: Boolean(media.message.audioMessage?.ptt)
  };
}

function userJid(value) {
  const number = jidNumber(value);
  return number ? `${number}@s.whatsapp.net` : '';
}

/**
 * Delete only from the WhatsApp account running this Baileys session.
 * This does not revoke the message from the recipient.
 */
async function deleteForMe(sock, jid, message) {
  if (!jid || !message?.key?.id) return false;

  const timestamp = timestampOf(message);

  try {
    await sock.chatModify(
      {
        deleteForMe: {
          deleteMedia: true,
          key: message.key,
          timestamp
        }
      },
      jid
    );
    return true;
  } catch {}

  // Compatibility fallback for older/RC Baileys chat modification shape.
  try {
    await sock.chatModify(
      {
        clear: {
          messages: [
            {
              id: message.key.id,
              fromMe: Boolean(message.key.fromMe),
              timestamp
            }
          ]
        }
      },
      jid
    );
    return true;
  } catch {}

  return false;
}

/**
 * Remove the command from the source chat for everyone where WhatsApp allows
 * it, then clean the revoke tombstone only from this bot account's own view.
 */
async function removeCommandAndLocalTrace(sock, chat, raw) {
  let revoked = false;

  try {
    await sock.sendMessage(chat, { delete: raw.key });
    revoked = true;
  } catch {}

  // Give WhatsApp a moment to apply the revoke, then remove the local row.
  // Repeating delete-for-me is intentional: it also cleans the locally
  // rendered "You deleted this message" row when the same key is reused.
  if (revoked) await sleep(700);

  for (let attempt = 0; attempt < 3; attempt++) {
    await deleteForMe(sock, chat, raw);
    if (attempt < 2) await sleep(350);
  }
}

/**
 * Send media normally so the recipient receives and keeps it, then erase only
 * this session's local sent copy. A delayed second pass handles sync lag.
 */
async function sendThenHideLocally(sock, jid, media, buffer) {
  const sent = await sock.sendMessage(jid, cleanMedia(media, buffer));

  await sleep(250);
  await deleteForMe(sock, jid, sent);
  await sleep(500);
  await deleteForMe(sock, jid, sent);

  return sent;
}

export default {
  name: 'vv2',
  aliases: ['viewonce2', 'vvprivate'],
  category: 'TOOLS',
  description: 'Recover view-once media to this account and the main account, with secondary-session stealth cleanup',
  ownerOnly: false,

  async run({ quoted, sock, chat, raw, sessionId }) {
    if (!quoted?.message) {
      throw new Error('Reply to a view-once image/video/audio with .vv2');
    }

    const media = directMedia(unwrapAll(quoted.message));

    if (!media) {
      throw new Error('The replied message does not contain recoverable image/video/audio media.');
    }

    const target = {
      key: {
        remoteJid: chat,
        id: quoted.stanzaId,
        participant: quoted.participant
      },
      message: media.message
    };

    let buffer;
    try {
      buffer = await downloadMediaMessage(
        target,
        'buffer',
        {},
        {
          logger: pino({ level: 'silent' }),
          reuploadRequest: sock.updateMediaMessage
        }
      );
    } catch (error) {
      throw new Error(
        `Could not download the replied media. It may already have expired or been opened: ${error.message}`
      );
    }

    if (!buffer?.length) {
      throw new Error('WhatsApp returned no media data for that message.');
    }

    const selfJid = userJid(sock.user?.id);
    const ownerJid = `${config.owner}@s.whatsapp.net`;
    const isSecondary = Boolean(sessionId && sessionId !== 'primary');

    if (!selfJid) {
      throw new Error('Could not determine this linked WhatsApp account.');
    }

    // 1) Always keep one clean recovered copy in the account that ran .vv2.
    //    For a secondary session this is the secondary account's own self-chat.
    await sock.sendMessage(selfJid, cleanMedia(media, buffer));

    // 2) Also deliver to the configured primary/main owner account.
    //    If this IS the primary account, selfJid === ownerJid, so do not send
    //    a duplicate. When a secondary sends it, the primary keeps the media
    //    while the secondary silently removes its own local sent copy.
    if (ownerJid !== selfJid) {
      if (isSecondary) {
        await sendThenHideLocally(sock, ownerJid, media, buffer);
      } else {
        await sock.sendMessage(ownerJid, cleanMedia(media, buffer));
      }
    }

    // 3) Remove .vv2 from the source chat and then remove the local revoke
    //    tombstone from this bot account's own view.
    await removeCommandAndLocalTrace(sock, chat, raw);
  }
};
