import crypto from 'node:crypto';
import {
  downloadContentFromMessage,
  generateWAMessageContent,
  generateWAMessageFromContent,
  jidNormalizedUser
} from '@whiskeysockets/baileys';

const unwrap = message => {
  let current = message;
  for (let i = 0; i < 8 && current; i++) {
    const next =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message;
    if (!next) break;
    current = next;
  }
  return current || {};
};

const quotedText = message =>
  message?.conversation ||
  message?.extendedTextMessage?.text ||
  message?.imageMessage?.caption ||
  message?.videoMessage?.caption ||
  '';

async function mediaBuffer(message, type) {
  const stream = await downloadContentFromMessage(message, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function payloadFromMessage(message, commandText = '') {
  const msg = unwrap(message);

  if (msg.imageMessage) {
    return {
      payload: {
        image: await mediaBuffer(msg.imageMessage, 'image'),
        caption: commandText || msg.imageMessage.caption || '',
        mimetype: msg.imageMessage.mimetype || 'image/jpeg'
      },
      kind: 'image'
    };
  }

  if (msg.videoMessage) {
    return {
      payload: {
        video: await mediaBuffer(msg.videoMessage, 'video'),
        caption: commandText || msg.videoMessage.caption || '',
        mimetype: msg.videoMessage.mimetype || 'video/mp4',
        gifPlayback: Boolean(msg.videoMessage.gifPlayback)
      },
      kind: 'video'
    };
  }

  if (msg.audioMessage) {
    return {
      payload: {
        audio: await mediaBuffer(msg.audioMessage, 'audio'),
        mimetype: msg.audioMessage.mimetype || 'audio/ogg; codecs=opus',
        ptt: Boolean(msg.audioMessage.ptt)
      },
      kind: msg.audioMessage.ptt ? 'voice note' : 'audio'
    };
  }

  const text = commandText || quotedText(msg);
  if (text) return { payload: { text }, kind: 'text' };

  return null;
}

function markInnerAsGroupStatus(inner) {
  const type = Object.keys(inner || {})[0];
  if (!type || !inner[type] || typeof inner[type] !== 'object') {
    throw new Error('Could not build WhatsApp group-status content.');
  }

  inner[type].contextInfo = {
    ...(inner[type].contextInfo || {}),
    isGroupStatus: true
  };

  return inner;
}

async function sendGroupStatus(sock, groupJid, payload) {
  const inner = markInnerAsGroupStatus(
    await generateWAMessageContent(payload, {
      upload: sock.waUploadToServer
    })
  );

  const messageSecret = crypto.randomBytes(32);

  const generated = generateWAMessageFromContent(
    groupJid,
    {
      messageContextInfo: { messageSecret },
      groupStatusMessageV2: {
        message: inner
      }
    },
    {
      userJid: jidNormalizedUser(sock.user?.id || '')
    }
  );

  await sock.relayMessage(groupJid, generated.message, {
    messageId: generated.key.id,
    additionalNodes: [
      {
        tag: 'meta',
        attrs: { is_group_status: 'true' }
      }
    ]
  });

  return generated;
}

export default {
  name: 'setgcs',
  aliases: ['gcs', 'gcstory', 'groupstatus'],
  category: 'GROUP STATUS',
  groupOnly: true,
  description: 'Post text or replied image/video/audio as a real WhatsApp Group Status Update.',

  async run({ text, quoted, raw, sock, chat, reply }) {
    const sourceMessage = quoted?.message || raw?.message || {};
    const prepared = await payloadFromMessage(
      sourceMessage,
      String(text || '').trim()
    );

    if (!prepared) {
      throw new Error(
        'Usage: .gcs <text> OR reply to an image/video/audio with .gcs [caption]'
      );
    }

    await sendGroupStatus(sock, chat, prepared.payload);

    await reply(
      `✅ ${prepared.kind} group Status Update sent.\n` +
      `Check the group Status section in WhatsApp.`
    );
  }
};
