import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../utils.js';

export default {
  name: 'music', aliases: ['play','ytmp3'], category: 'DOWNLOADERS', description: 'Search and download music',
  async run({ text, sock, chat, raw, reply }) {
    if (!text) throw new Error('Usage: .music artist and song title');
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'void-music-'));
    try {
      await reply('🎵 Finding and preparing your music…');
      const source = /^https?:\/\//i.test(text) ? text : `ytsearch1:${text}`;
      await run('yt-dlp', ['--no-playlist','--no-warnings','--max-filesize','90M','--match-filter','duration <= 1200','-x','--audio-format','mp3','--audio-quality','192K','--embed-metadata','--restrict-filenames','-o',path.join(folder,'%(title).100B-%(id)s.%(ext)s'),source], 180000);
      const file = fs.readdirSync(folder).find(name=>name.endsWith('.mp3'));
      if (!file) throw new Error('No downloadable song was found.');
      await sock.sendMessage(chat,{audio:{url:path.join(folder,file)},mimetype:'audio/mpeg',fileName:file,ptt:false},{quoted:raw});
    } finally { fs.rmSync(folder,{recursive:true,force:true}); }
  }
};
