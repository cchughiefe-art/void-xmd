import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, refreshYtDlp, ytDlpAuthStatus } from '../utils.js';
import { downloadYoutubeAudio, resolveYoutubeAudio } from '../youtube-audio.js';

export default [
  {
    name: 'ytstatus',
    aliases: ['ytcookie','ytdlpstatus'],
    category: 'OWNER',
    ownerOnly: true,
    description: 'Show yt-dlp version and current YouTube/music backend',

    async run({ reply }) {
      const auth = ytDlpAuthStatus();
      let version = 'unavailable';

      try {
        version = String(await run('yt-dlp',['--version'],60000)).split('\n')[0].trim();
      } catch (error) {
        version = `ERROR: ${error.message}`;
      }

      await reply(
        `*YouTube / yt-dlp status*\n` +
        `Channel: ${auth.channel}\n` +
        `yt-dlp: ${version}\n` +
        `Saved cookie file: ${auth.present ? `YES (${auth.size} bytes)` : 'NO'}\n` +
        `Music backend: web_embedded + NO COOKIES\n` +
        `Music flow: search → watch URL → bestaudio → MP3`
      );
    }
  },
  {
    name: 'ytrefresh',
    aliases: ['ytdlpupdate'],
    category: 'OWNER',
    ownerOnly: true,
    description: 'Refresh the official yt-dlp build for the configured channel',

    async run({ reply }) {
      const auth = ytDlpAuthStatus();
      await reply(`Refreshing yt-dlp ${auth.channel}…`);
      await refreshYtDlp();
      const version = String(await run('yt-dlp',['--version'],60000)).split('\n')[0].trim();
      await reply(`yt-dlp refreshed: ${version}`);
    }
  },
  {
    name: 'yttest',
    aliases: ['youtubecheck'],
    category: 'OWNER',
    ownerOnly: true,
    description: 'Test the exact no-cookie web_embedded music flow',

    async run({ reply }) {
      await reply('Testing exact Termux-style YouTube music flow…');

      const started = Date.now();
      let search;
      try {
        search = await resolveYoutubeAudio('Rick Astley Never Gonna Give You Up');
      } catch (error) {
        return reply(
          `*YouTube diagnostic*\nFAIL Search: ${String(error?.message || error).slice(0, 1000)}`
        );
      }

      const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'void-yttest-'));
      try {
        const result = await downloadYoutubeAudio(
          search.url,
          folder,
          { maxFilesize: '20M', timeout: 180000 }
        );

        const bytes = fs.statSync(result.file).size;

        await reply(
          `*YouTube diagnostic*\n` +
          `PASS Search: ${search.id} | ${search.title}\n` +
          `PASS Real MP3: ${Math.round(bytes / 1024)} KiB\n` +
          `Strategy: ${result.strategy}\n` +
          `Time: ${Date.now() - started}ms`
        );
      } catch (error) {
        await reply(
          `*YouTube diagnostic*\n` +
          `PASS Search: ${search.id} | ${search.title}\n` +
          `FAIL Real MP3: ${String(error?.message || error).replace(/\s+/g,' ').slice(0, 1200)}`
        );
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    }
  }
];
