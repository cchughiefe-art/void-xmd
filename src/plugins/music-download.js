import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadYoutubeAudio } from '../youtube-audio.js';

export default {
  name: 'music', aliases: ['play','ytmp3'], category: 'DOWNLOADERS', description: 'Search and download music',
  async run({ text, sock, chat, raw, reply }) {
    if (!text) throw new Error('Usage: .music artist and song title');
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'void-music-'));
    try {
      await reply('🎵 Finding and preparing your music…');
      const result = await downloadYoutubeAudio(text, folder, {
        maxFilesize: '90M',
        maxDuration: 1200,
        timeout: 180000
      });
      const file = result.file;
      await sock.sendMessage(chat, {
        audio: { url: file },
        mimetype: 'audio/mpeg',
        fileName: path.basename(file),
        ptt: false
      }, { quoted: raw });
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  }
};
