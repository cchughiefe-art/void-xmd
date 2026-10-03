import { downloadMediaMessage, getContentType } from '@whiskeysockets/baileys';
import pino from 'pino';

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

export default {
  name: 'vv1',
  aliases: ['vv', 'viewonce', 'antivv'],
  category: 'TOOLS',
  description: 'Recover and resend a replied view-once image, video, or audio with no added text or caption',

  async run({ quoted, sock, chat }) {
    if (!quoted?.message) {
      throw new Error('Reply to a view-once image/video/audio with .vv1');
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

    if (media.type === 'imageMessage') {
      await sock.sendMessage(chat, { image: buffer });
      return;
    }

    if (media.type === 'videoMessage') {
      await sock.sendMessage(chat, {
        video: buffer,
        mimetype: media.message.videoMessage?.mimetype || 'video/mp4'
      });
      return;
    }

    await sock.sendMessage(chat, {
      audio: buffer,
      mimetype: media.message.audioMessage?.mimetype || 'audio/ogg; codecs=opus',
      ptt: Boolean(media.message.audioMessage?.ptt)
    });
  }
};
