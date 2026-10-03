import { downloadMediaMessage, getContentType } from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from '../config.js';

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

function normalizeRecipient(jid) {
  const value = String(jid || '').trim();
  if (!value) return '';
  return value;
}

async function sendCleanMedia(sock, jid, media, buffer) {
  if (media.type === 'imageMessage') {
    await sock.sendMessage(jid, { image: buffer });
    return;
  }

  if (media.type === 'videoMessage') {
    await sock.sendMessage(jid, {
      video: buffer,
      mimetype: media.message.videoMessage?.mimetype || 'video/mp4'
    });
    return;
  }

  await sock.sendMessage(jid, {
    audio: buffer,
    mimetype: media.message.audioMessage?.mimetype || 'audio/ogg; codecs=opus',
    ptt: Boolean(media.message.audioMessage?.ptt)
  });
}

async function deleteCommand(sock, chat, raw) {
  try {
    await sock.sendMessage(chat, { delete: raw.key });
    return true;
  } catch {
    return false;
  }
}

export default {
  name: 'vv2',
  aliases: ['viewonce2', 'vvprivate'],
  category: 'TOOLS',
  description: 'Recover replied view-once media and privately send a clean copy to the command sender and main owner',
  ownerOnly: true,

  async run({ quoted, sock, chat, raw, sender }) {
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

    const ownerJid = `${config.owner}@s.whatsapp.net`;
    const recipients = [...new Set([
      normalizeRecipient(sender),
      normalizeRecipient(ownerJid)
    ].filter(Boolean))];

    for (const jid of recipients) {
      await sendCleanMedia(sock, jid, media, buffer);
    }

    await deleteCommand(sock, chat, raw);
  }
};
