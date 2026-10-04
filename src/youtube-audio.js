import fs from 'node:fs';
import path from 'node:path';
import { run } from './utils.js';

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

  let primaryError;
  try {
    await run('yt-dlp', [
      ...base,
      '-f', 'bestaudio[ext=m4a]/bestaudio/b[acodec!=none]',
      source
    ], timeout);

    const file = findMp3(folder);
    if (!file) throw new Error('Primary YouTube audio extraction produced no MP3.');
    return { file, strategy: 'audio-only' };
  } catch (error) {
    primaryError = error;
  }

  // Current YouTube cookie sessions can expose metadata correctly while
  // audio-only format extraction fails with "The page needs to be reloaded".
  // web_embedded commonly still exposes format 18 (combined A/V). Downloading
  // that format and letting ffmpeg extract its audio keeps .music working.
  clearFolder(folder);

  try {
    await run('yt-dlp', [
      ...base,
      '--extractor-args', 'youtube:player_client=web_embedded',
      '-f', '18/b[acodec!=none]/b',
      source
    ], timeout);

    const file = findMp3(folder);
    if (!file) throw new Error('Embedded YouTube fallback produced no MP3.');
    return { file, strategy: 'web-embedded-format-18' };
  } catch (fallbackError) {
    throw new Error(
      `YouTube audio download failed. Primary: ${String(primaryError?.message || primaryError).slice(0, 350)} ` +
      `Fallback: ${String(fallbackError?.message || fallbackError).slice(0, 350)}`
    );
  }
}
