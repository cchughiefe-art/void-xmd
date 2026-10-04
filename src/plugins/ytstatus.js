import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, refreshYtDlp, ytDlpAuthStatus } from '../utils.js';
import { downloadYoutubeAudio } from '../youtube-audio.js';

async function probe(input) {
  const started = Date.now();
  try {
    const out = await run('yt-dlp', [
      '--simulate','--no-playlist','--no-warnings',
      '--print','%(id)s | %(title)s', input
    ], 120000);
    return { ok: true, ms: Date.now() - started, detail: String(out).split('\n')[0].slice(0, 240) };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, detail: String(error?.message || error).replace(/\s+/g,' ').slice(0, 700) };
  }
}

export default [
  {
    name: 'ytstatus', aliases: ['ytcookie','ytdlpstatus'], category: 'OWNER', ownerOnly: true,
    description: 'Show yt-dlp channel/version and secure YouTube cookie status',
    async run({ reply }) {
      const auth = ytDlpAuthStatus();
      let version = 'unavailable';
      try { version = String(await run('yt-dlp',['--version'],60000)).split('\n')[0].trim(); }
      catch (error) { version = `ERROR: ${error.message}`; }
      await reply(
        `*YouTube / yt-dlp status*\n` +
        `Channel: ${auth.channel}\n` +
        `yt-dlp: ${version}\n` +
        `Cookies: ${auth.present ? `YES (${auth.size} bytes)` : 'NO'}\n` +
        `Cookie file: ${auth.cookieFile}\n` +
        `Player clients: ${process.env.YTDLP_YOUTUBE_PLAYER_CLIENTS || 'default,web_embedded'}`
      );
    }
  },
  {
    name: 'ytrefresh', aliases: ['ytdlpupdate'], category: 'OWNER', ownerOnly: true,
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
    name: 'yttest', aliases: ['youtubecheck'], category: 'OWNER', ownerOnly: true,
    description: 'Live-test YouTube direct URL and search extraction',
    async run({ reply }) {
      await reply('Running YouTube direct + search diagnostics…');
      const direct = await probe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      const search = await probe('ytsearch1:Rick Astley Never Gonna Give You Up');

      const audioStarted = Date.now();
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'void-yttest-'));
      let audio;
      try {
        const result = await downloadYoutubeAudio('Rick Astley Never Gonna Give You Up', folder, {
          maxFilesize: '20M',
          maxDuration: 600,
          timeout: 180000
        });
        const bytes = fs.statSync(result.file).size;
        audio = {
          ok: bytes > 1000,
          ms: Date.now() - audioStarted,
          detail: `${result.strategy} produced ${Math.round(bytes / 1024)} KiB MP3`
        };
      } catch (error) {
        audio = {
          ok: false,
          ms: Date.now() - audioStarted,
          detail: String(error?.message || error).replace(/\s+/g, ' ').slice(0, 700)
        };
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }

      await reply(
        `*YouTube diagnostic*\n` +
        `${direct.ok ? 'PASS' : 'FAIL'} Direct metadata (${direct.ms}ms): ${direct.detail}\n` +
        `${search.ok ? 'PASS' : 'FAIL'} Search metadata (${search.ms}ms): ${search.detail}\n` +
        `${audio.ok ? 'PASS' : 'FAIL'} Real MP3 download (${audio.ms}ms): ${audio.detail}`
      );
    }
  }
];
