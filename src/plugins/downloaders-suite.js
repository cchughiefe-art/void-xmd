import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../utils.js';

const requireText = (text, usage) => {
  const value = String(text || '').trim();
  if (!value) throw new Error(usage);
  return value;
};

const isUrl = value => /^https?:\/\//i.test(value);

async function ytdlpInfo(input, format) {
  const source = isUrl(input) ? input : `ytsearch1:${input}`;
  const output = await run('yt-dlp', [
    '--no-playlist',
    '--no-warnings',
    '--print', '%(url)s',
    '--print', '%(title)s',
    '--print', '%(uploader)s',
    '-f', format,
    source
  ], 120000);

  const [url, title = 'Media', uploader = ''] = output.split('\n');
  if (!url || !/^https?:\/\//i.test(url)) throw new Error('No downloadable media URL was returned.');
  return { url, title, uploader };
}

async function sendStream({ input, audio, sock, chat, raw, caption }) {
  const format = audio
    ? 'bestaudio[ext=m4a]/bestaudio'
    : 'best[ext=mp4][height<=720]/best[height<=720]/best';
  const info = await ytdlpInfo(input, format);

  if (audio) {
    return sock.sendMessage(chat, {
      audio: { url: info.url },
      mimetype: 'audio/mp4',
      fileName: `${info.title}.m4a`
    }, { quoted: raw });
  }

  return sock.sendMessage(chat, {
    video: { url: info.url },
    caption: caption || `${info.title}${info.uploader ? `\n${info.uploader}` : ''}`
  }, { quoted: raw });
}

async function sendAsDocument({ input, audio, sock, chat, raw }) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'void-dl-'));
  try {
    const template = path.join(folder, '%(title).100B-%(id)s.%(ext)s');
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--max-filesize', '90M',
      '--restrict-filenames',
      '-o', template
    ];
    if (audio) args.push('-x', '--audio-format', 'mp3', '--audio-quality', '192K');
    else args.push('-f', 'best[ext=mp4][height<=720]/best[height<=720]/best');
    args.push(isUrl(input) ? input : `ytsearch1:${input}`);

    await run('yt-dlp', args, 180000);
    const file = fs.readdirSync(folder).find(name => fs.statSync(path.join(folder, name)).isFile());
    if (!file) throw new Error('Download completed without a file.');
    const full = path.join(folder, file);
    const mimetype = audio ? 'audio/mpeg' : 'video/mp4';
    await sock.sendMessage(chat, {
      document: { url: full },
      mimetype,
      fileName: file
    }, { quoted: raw });
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

function googleDriveUrl(input) {
  const match = String(input).match(/(?:\/d\/|id=)([-\w]{10,})/);
  if (!match) throw new Error('Usage: .gdrive <public Google Drive file URL>');
  return `https://drive.usercontent.google.com/download?id=${match[1]}&export=download&confirm=t`;
}

async function mediafireUrl(input) {
  const url = requireText(input, 'Usage: .mediafire <MediaFire URL>');
  if (!/mediafire\.com/i.test(url)) throw new Error('Please provide a MediaFire URL.');
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 VOID-XMD' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`MediaFire returned ${response.status}`);
  const html = await response.text();
  const match =
    html.match(/aria-label="Download file"[^>]+href="([^"]+)"/i) ||
    html.match(/id="downloadButton"[^>]+href="([^"]+)"/i) ||
    html.match(/href="([^"]+)"[^>]*id="downloadButton"/i);
  if (!match) throw new Error('Could not find the MediaFire download URL.');
  return match[1].replace(/&amp;/g, '&');
}

async function spotifyQuery(input) {
  if (!isUrl(input)) return input;
  if (!/open\.spotify\.com/i.test(input)) throw new Error('Usage: .spotify <song name or Spotify URL>');
  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(input)}`, {
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Spotify metadata returned ${response.status}`);
  const data = await response.json();
  return [data.title, data.author_name].filter(Boolean).join(' ');
}

const urlDownloader = (name, { audio = false, description = `Download media with ${name}` } = {}) => ({
  name,
  category: 'DOWNLOADERS',
  description,
  async run({ text, sock, chat, raw, reply }) {
    const url = requireText(text, `Usage: .${name} <URL>`);
    if (!isUrl(url)) throw new Error(`.${name} requires a direct page or media URL.`);
    await reply(`⏳ Processing ${name}…`);
    await sendStream({ input: url, audio, sock, chat, raw });
  }
});

export default [
  {
    name: 'play2',
    category: 'DOWNLOADERS',
    description: 'Search and stream audio without creating a temporary MP3',
    async run({ text, sock, chat, raw, reply }) {
      const input = requireText(text, 'Usage: .play2 artist song');
      await reply('🎵 Searching…');
      await sendStream({ input, audio: true, sock, chat, raw });
    }
  },
  {
    name: 'playdoc',
    category: 'DOWNLOADERS',
    description: 'Search/download audio and send it as a document',
    async run({ text, sock, chat, raw, reply }) {
      const input = requireText(text, 'Usage: .playdoc artist song');
      await reply('🎵 Preparing audio document…');
      await sendAsDocument({ input, audio: true, sock, chat, raw });
    }
  },
  {
    name: 'playch',
    category: 'DOWNLOADERS',
    description: 'Search a song and include its channel/uploader',
    async run({ text, sock, chat, raw, reply }) {
      const input = requireText(text, 'Usage: .playch artist song');
      const info = await ytdlpInfo(input, 'bestaudio[ext=m4a]/bestaudio');
      await reply(`🎵 ${info.title}\nChannel: ${info.uploader || 'Unknown'}`);
      await sock.sendMessage(chat, {
        audio: { url: info.url },
        mimetype: 'audio/mp4',
        fileName: `${info.title}.m4a`
      }, { quoted: raw });
    }
  },
  {
    name: 'video',
    category: 'DOWNLOADERS',
    description: 'Search or download a video',
    async run({ text, sock, chat, raw, reply }) {
      const input = requireText(text, 'Usage: .video <URL or search query>');
      await reply('🎬 Finding video…');
      await sendStream({ input, audio: false, sock, chat, raw });
    }
  },
  {
    name: 'video2',
    category: 'DOWNLOADERS',
    description: 'Alternate video downloader capped to 720p',
    async run(ctx) {
      const input = requireText(ctx.text, 'Usage: .video2 <URL or search query>');
      await ctx.reply('🎬 Processing video…');
      await sendStream({ input, audio: false, ...ctx });
    }
  },
  {
    name: 'videodoc',
    category: 'DOWNLOADERS',
    description: 'Download a video and send it as a document',
    async run({ text, sock, chat, raw, reply }) {
      const input = requireText(text, 'Usage: .videodoc <URL or search query>');
      await reply('📦 Preparing video document…');
      await sendAsDocument({ input, audio: false, sock, chat, raw });
    }
  },
  urlDownloader('fbdl'),
  urlDownloader('igdl'),
  urlDownloader('pinterestdl'),
  urlDownloader('douyin'),
  urlDownloader('aio'),
  urlDownloader('snackvideo'),
  urlDownloader('soundcloud', { audio: true }),
  urlDownloader('videy'),
  urlDownloader('xnxxdl'),
  urlDownloader('xxxdl'),
  urlDownloader('dlanime'),
  urlDownloader('animedl'),
  urlDownloader('dlmovie'),
  urlDownloader('dlseries'),
  {
    name: 'spotify',
    category: 'DOWNLOADERS',
    description: 'Resolve a Spotify song or search and download matching audio',
    async run({ text, sock, chat, raw, reply }) {
      const input = requireText(text, 'Usage: .spotify <song name or Spotify URL>');
      await reply('🎵 Resolving Spotify track…');
      const query = await spotifyQuery(input);
      await sendStream({ input: query, audio: true, sock, chat, raw });
    }
  },
  {
    name: 'gdrive',
    category: 'DOWNLOADERS',
    description: 'Send a public Google Drive file as a document',
    async run({ text, sock, chat, raw }) {
      const url = googleDriveUrl(text);
      await sock.sendMessage(chat, {
        document: { url },
        mimetype: 'application/octet-stream',
        fileName: 'google-drive-file'
      }, { quoted: raw });
    }
  },
  {
    name: 'mediafire',
    category: 'DOWNLOADERS',
    description: 'Resolve a MediaFire download and send it as a document',
    async run({ text, sock, chat, raw, reply }) {
      await reply('📦 Resolving MediaFire link…');
      const url = await mediafireUrl(text);
      await sock.sendMessage(chat, {
        document: { url },
        mimetype: 'application/octet-stream',
        fileName: 'mediafire-download'
      }, { quoted: raw });
    }
  },
  {
    name: 'webdl',
    category: 'DOWNLOADERS',
    description: 'Send a direct web file URL as a document',
    async run({ text, sock, chat, raw }) {
      const url = requireText(text, 'Usage: .webdl <direct HTTPS URL>');
      if (!isUrl(url)) throw new Error('A direct HTTP/HTTPS URL is required.');
      await sock.sendMessage(chat, {
        document: { url },
        mimetype: 'application/octet-stream',
        fileName: decodeURIComponent(new URL(url).pathname.split('/').pop() || 'download')
      }, { quoted: raw });
    }
  },
  {
    name: 'apk',
    category: 'DOWNLOADERS',
    description: 'Send a direct APK URL as an Android package document',
    async run({ text, sock, chat, raw }) {
      const url = requireText(text, 'Usage: .apk <direct APK URL>');
      if (!isUrl(url)) throw new Error('For safety, .apk accepts direct HTTP/HTTPS URLs only.');
      await sock.sendMessage(chat, {
        document: { url },
        mimetype: 'application/vnd.android.package-archive',
        fileName: decodeURIComponent(new URL(url).pathname.split('/').pop() || 'app.apk')
      }, { quoted: raw });
    }
  },
  {
    name: 'savetube',
    aliases: ['ytmp4'],
    category: 'DOWNLOADERS',
    description: 'Download YouTube/video content as MP4',
    async run({ text, sock, chat, raw, reply }) {
      const input = requireText(text, 'Usage: .savetube <URL or search query>');
      await reply('🎬 Preparing MP4…');
      await sendStream({ input, audio: false, sock, chat, raw });
    }
  }
];
