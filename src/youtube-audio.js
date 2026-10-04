import fs from 'node:fs';
import path from 'node:path';
import { run, sleep } from './utils.js';

const isUrl = value => /^https?:\/\//i.test(String(value || '').trim());
const isYouTubeUrl = value => /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i.test(String(value || ''));

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

function commonArgs(folder, maxFilesize, maxDuration) {
  return [
    '--no-playlist',
    '--no-warnings',
    '--max-filesize', maxFilesize,
    '--match-filter', `duration <= ${maxDuration}`,
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '192K',
    '--embed-metadata',
    '--restrict-filenames',
    '-o', path.join(folder, '%(title).100B-%(id)s.%(ext)s')
  ];
}

function shortError(error, max = 420) {
  const text = String(error?.message || error || 'unknown error')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

async function tryStrategy({ name, args, source, folder, timeout }) {
  clearFolder(folder);

  try {
    await run('yt-dlp', [...args, source], timeout);

    const file = findMp3(folder);
    if (!file) throw new Error('yt-dlp completed but produced no MP3.');

    return { ok: true, file, strategy: name };
  } catch (error) {
    return { ok: false, error, strategy: name };
  }
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
  const source = youtubeSource(input);
  const maxFilesize = String(options.maxFilesize || '90M');
  const maxDuration = Number(options.maxDuration || 1200);
  const timeout = Number(options.timeout || 180000);
  const base = commonArgs(folder, maxFilesize, maxDuration);

  const strategies = [
    {
      name: 'account-default',
      args: [...base]
    },
    {
      name: 'account-web-safari-hls',
      args: [
        ...base,
        '--extractor-args', 'youtube:player_client=default,web_safari'
      ],
      retry: 2
    },
    {
      name: 'anonymous-visionos',
      args: [
        ...base,
        '--no-cookies',
        '--no-cookies-from-browser',
        '--extractor-args', 'youtube:player_client=visionos'
      ]
    },
    {
      name: 'anonymous-android',
      args: [
        ...base,
        '--no-cookies',
        '--no-cookies-from-browser',
        '--extractor-args', 'youtube:player_client=android'
      ]
    }
  ];

  const failures = [];

  for (const strategy of strategies) {
    const attempts = Number(strategy.retry || 1);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const result = await tryStrategy({
        ...strategy,
        source,
        folder,
        timeout
      });

      if (result.ok) return result;

      failures.push(
        `${strategy.name}${attempts > 1 ? `#${attempt}` : ''}: ${shortError(result.error)}`
      );

      if (attempt < attempts) await sleep(1500);
    }
  }

  throw new Error(
    'YouTube audio download failed after all automatic strategies.\n' +
    failures.map((x, i) => `${i + 1}. ${x}`).join('\n')
  );
}
