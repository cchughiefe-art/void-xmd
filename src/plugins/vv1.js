import { downloadMediaMessage, getContentType } from '@whiskeysockets/baileys';
import pino from 'pino';

function unwrap(message) {
  if (!message) return null;
  if (message.viewOnceMessage?.message) return message.viewOnceMessage.message;
  if (message.viewOnceMessageV2?.message) return message.viewOnceMessageV2.message;
  if (message.viewOnceMessageV2Extension?.message) return message.viewOnceMessageV2Extension.message;
  if (message.ephemeralMessage?.message) return unwrap(message.ephemeralMessage.message);
  return null;
}

export default {
  name: 'vv1',
  aliases: ['vv', 'vv2', 'viewonce', 'antivv'],
  category: 'TOOLS',
  description: 'Download and resend a replied view-once image/video',

  async run({ quoted, sock, chat, raw }) {
    if (!quoted?.message) {
      throw new Error('Reply to a view-once image or video with .vv1');
    }

    const mediaMessage = unwrap(quoted.message);
    if (!mediaMessage) {
      throw new Error('The replied message is not a supported view-once message.');
    }

    const mediaType = getContentType(mediaMessage);
    if (!['imageMessage', 'videoMessage', 'audioMessage'].includes(mediaType)) {
      throw new Error('Unsupported view-once media type.');
    }

    const buffer = await downloadMediaMessage(
      {
        key: {
          remoteJid: chat,
          id: quoted.stanzaId,
          participant: quoted.participant
        },
        message: mediaMessage
      },
      'buffer',
      {},
      {
        logger: pino({ level: 'silent' }),
        reuploadRequest: sock.updateMediaMessage
      }
    );

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
        caption: mediaMessage.videoMessage?.caption || 'Recovered view-once video'
      }, { quoted: raw });
      return;
    }

    await sock.sendMessage(chat, {
      audio: buffer,
      mimetype: mediaMessage.audioMessage?.mimetype || 'audio/ogg',
      ptt: Boolean(mediaMessage.audioMessage?.ptt)
    }, { quoted: raw });
  }
};
