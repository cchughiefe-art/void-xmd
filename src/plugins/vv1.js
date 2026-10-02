export default {
  name: 'vv1',
  aliases: ['viewonce', 'antivv'],
  category: 'TOOLS',
  description: 'Downloads and resends a replied view-once media message',

  async run({ reply, quoted, sock, chat, raw }) {
    if (!quoted) {
      throw new Error('Usage: Reply to a view-once media message with .vv1');
    }

    const viewOnce = quoted.viewOnceMessage || quoted.viewOnceMessageV2;

    if (!viewOnce) {
      throw new Error('The quoted message is not a view-once file.');
    }

    try {
      const mediaMessage = viewOnce.message;
      const mediaType = Object.keys(mediaMessage)[0];

      const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
      const pino = (await import('pino')).default;

      const buffer = await downloadMediaMessage(
        { message: mediaMessage },
        'buffer',
        {},
        { logger: pino({ level: 'silent' }) }
      );

      if (mediaType === 'imageMessage') {
        await sock.sendMessage(chat, { image: buffer, caption: 'Here is the downloaded view-once image.' }, { quoted: raw });
      } else if (mediaType === 'videoMessage') {
        await sock.sendMessage(chat, { video: buffer, caption: 'Here is the downloaded view-once video.' }, { quoted: raw });
      } else {
        await reply('Unsupported view-once media format.');
      }
    } catch (err) {
      console.error('Download error:', err);
      throw new Error('Failed to process and download the media.');
    }
  }
};

