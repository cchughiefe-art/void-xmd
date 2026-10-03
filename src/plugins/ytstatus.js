import { run, refreshYtDlp, ytDlpAuthStatus } from '../utils.js';

export default [
  {
    name: 'ytstatus',
    aliases: ['ytcookie', 'ytdlpstatus'],
    category: 'OWNER',
    ownerOnly: true,
    description: 'Show yt-dlp version and whether secure YouTube cookies are installed',

    async run({ reply }) {
      const auth = ytDlpAuthStatus();

      let version = 'unavailable';
      try {
        version = String(await run('yt-dlp', ['--version'], 60000)).split('\n')[0].trim();
      } catch (error) {
        version = `ERROR: ${error.message}`;
      }

      await reply(
        `*YouTube / yt-dlp status*\n` +
        `yt-dlp: ${version}\n` +
        `Cookies: ${auth.present ? `YES (${auth.size} bytes)` : 'NO'}\n` +
        `Cookie file: ${auth.cookieFile}\n` +
        `Managed binary: ${auth.managedBinaryPresent ? 'YES' : 'NO'}\n\n` +
        `Cookies are never printed by this command.`
      );
    }
  },
  {
    name: 'ytrefresh',
    aliases: ['ytdlpupdate'],
    category: 'OWNER',
    ownerOnly: true,
    description: 'Download the latest official yt-dlp Linux binary and verify its SHA-256 checksum',

    async run({ reply }) {
      await reply('Refreshing yt-dlp from the official release…');
      await refreshYtDlp();
      const version = String(await run('yt-dlp', ['--version'], 60000)).split('\n')[0].trim();
      await reply(`yt-dlp refreshed successfully: ${version}`);
    }
  }
];
