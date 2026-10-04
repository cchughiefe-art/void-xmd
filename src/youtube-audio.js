import fs from 'node:fs';
import path from 'node:path';
import { run } from './utils.js';

const isUrl = value => /^https?:\/\//i.test(String(value || '').trim());
const isYouTubeUrl = value => /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i.test(String(value || ''));

const BLOCKED_WORDS = [
  'mixtape','mix tape','mega mix','megamix','dj mix','djset','dj set',
  'continuous mix','non stop','nonstop','full mix','compilation','playlist',
  'full album','album mix','greatest hits mix','best of mix','one hour mix',
  '1 hour mix','2 hour mix','3 hour mix'
];

function blockedTitle(title = '') {
  const text = String(title).toLowerCase();
  return BLOCKED_WORDS.some(word => text.includes(word));
}

function clearFolder(folder) {
  for (const name of fs.readdirSync(folder)) {
    fs.rmSync(path.join(folder, name), { recursive: true, force: true });
  }
}

function findMp3(folder) {
  const files = fs.readdirSync(folder)
    .filter(name => name.toLowerCase().endsWith('.mp3'))
    .map(name => ({ name, full: path.join(folder, name) }))
    .filter(item => fs.statSync(item.full).isFile())
    .sort((a, b) => fs.statSync(b.full).mtimeMs - fs.statSync(a.full).mtimeMs);
  return files[0]?.full || '';
}

function baseNoCookieArgs() {
  return [
    '--no-cookies',
    '--no-cookies-from-browser',
    '--remote-components', 'ejs:github',
    '--extractor-args', 'youtube:player_client=web_embedded'
  ];
}

async function searchYoutube(query, count = 9, timeout = 120000) {
  const output = await run('yt-dlp', [
    ...baseNoCookieArgs(),
    `ytsearch${Math.max(3, count)}:${query}`,
    '--flat-playlist',
    '--skip-download',
    '--no-warnings',
    '--print', '%(id)s\t%(title)s\t%(duration)s'
  ], timeout);

  const results = [];

  for (const line of String(output || '').split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const [id, rawTitle, rawDuration] = parts;
    const title = String(rawTitle || '').trim();
    const duration = Number(rawDuration);

    if (!id || !title) continue;
    if (blockedTitle(title)) continue;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 720) continue;

    results.push({
      id,
      title,
      duration,
      url: `https://www.youtube.com/watch?v=${id}`
    });

    if (results.length >= 3) break;
  }

  if (!results.length) {
    throw new Error('No suitable individual YouTube song result was found.');
  }

  return results;
}

export async function resolveYoutubeAudio(input, options = {}) {
  const value = String(input || '').trim();
  if (!value) throw new Error('A YouTube URL or search query is required.');

  if (isUrl(value)) {
    if (!isYouTubeUrl(value)) {
      throw new Error('This helper only handles YouTube URLs or search queries.');
    }
    return { url: value, title: '', duration: 0, source: 'url' };
  }

  const results = await searchYoutube(
    value,
    Number(options.searchCount || 9),
    Number(options.searchTimeout || 120000)
  );

  return { ...results[0], source: 'search' };
}

export function youtubeSource(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('A YouTube URL or search query is required.');
  return isUrl(value) ? value : `ytsearch1:${value}`;
}

export function isYoutubeAudioInput(input) {
  const value = String(input || '').trim();
  return !isUrl(value) || isYouTubeUrl(value);
}

export async function downloadYoutubeAudio(input, folder, options = {}) {
  clearFolder(folder);

  const resolved = await resolveYoutubeAudio(input, options);
  const timeout = Number(options.timeout || 180000);
  const concurrentFragments = String(options.concurrentFragments || 6);
  const maxFilesize = String(options.maxFilesize || '90M');

  const archive = path.join(folder, '.music-dl-archive.txt');
  const outputTemplate = path.join(folder, '%(title).100B-%(id)s.%(ext)s');

  // This intentionally mirrors the user's previously working Termux script:
  // 1) search with web_embedded and no cookies
  // 2) resolve a normal watch URL
  // 3) download bestaudio m4a/bestaudio with web_embedded and no cookies
  await run('yt-dlp', [
    ...baseNoCookieArgs(),
    resolved.url,
    '--download-archive', archive,
    '--no-playlist',
    '--continue',
    '--concurrent-fragments', concurrentFragments,
    '--retries', '10',
    '--fragment-retries', '10',
    '--socket-timeout', '20',
    '--no-overwrites',
    '--ignore-errors',
    '--max-filesize', maxFilesize,
    '--embed-metadata',
    '--restrict-filenames',
    '-o', outputTemplate,
    '-f', 'bestaudio[ext=m4a]/bestaudio',
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '192K'
  ], timeout);

  const file = findMp3(folder);
  if (!file) {
    throw new Error(
      `yt-dlp finished but no MP3 was produced for ${resolved.title || resolved.url}.`
    );
  }

  return {
    file,
    strategy: 'termux-web-embedded-no-cookies',
    videoId: resolved.id || '',
    title: resolved.title || path.basename(file, path.extname(file)),
    duration: resolved.duration || 0,
    url: resolved.url
  };
}
