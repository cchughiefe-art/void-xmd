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

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

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
      kind: 'audio'
    };
  }

  const text = commandText || quotedText(msg);
  if (text) {
    return {
      payload: { text },
      kind: 'text'
    };
  }

  return null;
}

function statusSourceTypeFor(inner) {
  if (inner.imageMessage) return 0; // IMAGE
  if (inner.videoMessage) return inner.videoMessage.gifPlayback ? 2 : 1; // GIF / VIDEO
  if (inner.audioMessage) return 3; // AUDIO
  return 4; // TEXT
}

function markAsGroupStatus(inner, sock) {
  const type = Object.keys(inner || {})[0];

  if (!type || !inner[type] || typeof inner[type] !== 'object') {
    throw new Error('Could not build WhatsApp Group Status content.');
  }

  const authorJid = jidNormalizedUser(sock.user?.id || '');
  const sourceType = statusSourceTypeFor(inner);

  inner[type].contextInfo = {
    ...(inner[type].contextInfo || {}),
    isGroupStatus: true,
    statusSourceType: sourceType,
    statusAttributions: [
      {
        type: 5, // GROUP_STATUS in current WAProto
        groupStatus: authorJid ? { authorJid } : undefined
      }
    ],
    statusAudienceMetadata: {
      audienceType: 1 // CLOSE_FRIENDS-style status audience metadata used by current clients
    }
  };

  return inner;
}

async function sendGroupStatus(sock, groupJid, payload) {
  const inner = markAsGroupStatus(
    await generateWAMessageContent(payload, {
      upload: sock.waUploadToServer
    }),
    sock
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

    // Group Status is transported as a status-like text stanza even when the
    // inner message contains image/video media.
    additionalAttributes: {
      type: 'text'
    },

    additionalNodes: [
      {
        tag: 'meta',
        attrs: {
          is_group_status: 'true'
        }
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
  description: 'Post text, image, video or audio as a real WhatsApp Group Status Update.',

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
      `✅ ${prepared.kind} Group Status Update sent.\n` +
      `Check the group's Status Updates section.`
    );
  }
};
