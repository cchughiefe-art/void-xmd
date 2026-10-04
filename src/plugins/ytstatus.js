import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, refreshYtDlp, ytDlpAuthStatus } from '../utils.js';
import {
  downloadYoutubeAudio,
  nodeYoutubeEngineStatus,
  resolveYoutubeAudio
} from '../youtube-audio.js';

export default [
  {
    name: 'ytstatus',
    aliases: ['ytcookie','ytdlpstatus','ytengine'],
    category: 'OWNER',
    ownerOnly: true,
    description: 'Show the current YouTube downloader engines',

    async run({ reply }) {
      const auth = ytDlpAuthStatus();
      const node = await nodeYoutubeEngineStatus();

      let version = 'unavailable';
      try {
        version = String(await run('yt-dlp',['--version'],60000)).split('\n')[0].trim();
      } catch (error) {
        version = `ERROR: ${error.message}`;
      }

      await reply(
        `*YouTube downloader status*\n` +
        `Primary: Anita-style Node stream\n` +
        `Node engine: ${node.available ? 'READY' : 'MISSING'}\n` +
        `Node search: ${node.search ? 'READY' : 'MISSING'}\n` +
        `Dependencies: ${node.available ? 'installed on server' : 'server install failed'}\n` +
        `Node HTTP proxy fallback: ${process.env.OUTBOUND_PROXY_HTTP ? 'CONFIGURED' : 'NO'}\n` +
        `Secondary: yt-dlp\n` +
        `yt-dlp channel: ${auth.channel}\n` +
        `yt-dlp: ${version}\n` +
        `yt-dlp proxy fallback: ${process.env.OUTBOUND_PROXY_SOCKS5 || process.env.OUTBOUND_PROXY_HTTP ? 'CONFIGURED' : 'NO'}\n` +
        `Saved cookies: ${auth.present ? 'present but not required by the primary engine' : 'not used'}\n\n` +
        `Order: Node direct → Node HTTP proxy → yt-dlp direct → yt-dlp SOCKS5 → yt-dlp HTTP`
      );
    }
  },
  {
    name: 'ytrefresh',
    aliases: ['ytdlpupdate'],
    category: 'OWNER',
    ownerOnly: true,
    description: 'Refresh the yt-dlp fallback engine',

    async run({ reply }) {
      const auth = ytDlpAuthStatus();
      await reply(`Refreshing yt-dlp ${auth.channel} fallback…`);
      await refreshYtDlp();
      const version = String(await run('yt-dlp',['--version'],60000)).split('\n')[0].trim();
      await reply(`yt-dlp fallback refreshed: ${version}`);
    }
  },
  {
    name: 'yttest',
    aliases: ['youtubecheck'],
    category: 'OWNER',
    ownerOnly: true,
    description: 'Test the exact primary + fallback music path',

    async run({ reply }) {
      await reply('Testing Anita-style Node stream + yt-dlp fallback…');

      const started = Date.now();
      const node = await nodeYoutubeEngineStatus();

      if (!node.available) {
        return reply(
          `*YouTube diagnostic*\n` +
          `FAIL Node engine: ${String(node.error || 'dependency installation failed').slice(0, 1600)}`
        );
      }

      let search;
      try {
        search = await resolveYoutubeAudio('Rick Astley Never Gonna Give You Up');
      } catch (error) {
        return reply(
          `*YouTube diagnostic*\n` +
          `Node engine: READY\n` +
          `FAIL Search: ${String(error?.message || error).slice(0, 1500)}`
        );
      }

      const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'void-yttest-'));

      try {
        const result = await downloadYoutubeAudio(
          search.url,
          folder,
          {
            maxFilesize: '20M',
            maxFilesizeBytes: 20 * 1024 * 1024,
            timeout: 180000
          }
        );

        const bytes = fs.statSync(result.file).size;

        await reply(
          `*YouTube diagnostic*\n` +
          `Node engine: READY\n` +
          `PASS Search: ${search.title || search.url}\n` +
          `Search engine: ${search.searchEngine}\n` +
          `PASS Real MP3: ${Math.round(bytes / 1024)} KiB\n` +
          `Download strategy: ${result.strategy}\n` +
          `Time: ${Date.now() - started}ms`
        );
      } catch (error) {
        await reply(
          `*YouTube diagnostic*\n` +
          `Node engine: READY\n` +
          `PASS Search: ${search.title || search.url}\n` +
          `FAIL Real MP3: ${String(error?.message || error).replace(/\s+/g,' ').slice(0, 2200)}`
        );
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    }
  }
];
