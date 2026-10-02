import { downloadMediaMessage, getContentType } from '@whiskeysockets/baileys';
import pino from 'pino';

function unwrapAll(message) {
  let current = message;
  let wasViewOnce = false;

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
      wasViewOnce = true;
      current = wrapper.message;
      continue;
    }

    break;
  }

  return { message: current || null, wasViewOnce };
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
  aliases: ['vv', 'vv2', 'viewonce', 'antivv'],
  category: 'TOOLS',
  description: 'Recover and resend a replied view-once image, video, or audio',

  async run({ quoted, sock, chat, raw }) {
    if (!quoted?.message) {
      throw new Error('Reply to a view-once image/video/audio with .vv1');
    }

    const unwrapped = unwrapAll(quoted.message);
    const media = directMedia(unwrapped.message);

    if (!media) {
      throw new Error('The replied message does not contain recoverable image/video/audio media.');
    }

    const { message: mediaMessage, type: mediaType } = media;

    const target = {
      key: {
        remoteJid: chat,
        id: quoted.stanzaId,
        participant: quoted.participant
      },
      message: mediaMessage
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

    if (mediaType === 'imageMessage') {
      await sock.sendMessage(chat, {
        image: buffer,
        caption: mediaMessage.imageMessage?.caption || 'Recovered view-once image'
      }, { quoted: raw });
      return;
    }

    if (mediaType === 'videoMessage') {
      await sock.sendMessage(chat, {
        video: buffer,
        caption: mediaMessage.videoMessage?.caption || 'Recovered view-once video',
        mimetype: mediaMessage.videoMessage?.mimetype || 'video/mp4'
      }, { quoted: raw });
      return;
    }

    await sock.sendMessage(chat, {
      audio: buffer,
      mimetype: mediaMessage.audioMessage?.mimetype || 'audio/ogg; codecs=opus',
      ptt: Boolean(mediaMessage.audioMessage?.ptt)
    }, { quoted: raw });
  }
};
