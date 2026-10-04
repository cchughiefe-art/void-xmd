import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { run } from './utils.js';

const isUrl = value => /^https?:\/\//i.test(String(value || '').trim());
const isYouTubeUrl = value => /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i.test(String(value || ''));

const BLOCKED_WORDS = [
  'mixtape','mix tape','mega mix','megamix','dj mix','djset','dj set',
  'continuous mix','non stop','nonstop','full mix','compilation','playlist',
  'full album','album mix','greatest hits mix','best of mix','one hour mix',
  '1 hour mix','2 hour mix','3 hour mix'
];

let nodeDepsPromise;

function blockedTitle(title = '') {
  const text = String(title).toLowerCase();
  return BLOCKED_WORDS.some(word => text.includes(word));
}

function clearFolder(folder) {
  fs.mkdirSync(folder, { recursive: true });
  for (const name of fs.readdirSync(folder)) {
    fs.rmSync(path.join(folder, name), { recursive: true, force: true });
  }
}

function safeName(value = 'audio') {
  return String(value)
    .replace(/[^\p{L}\p{N}._ -]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'audio';
}

function shortError(error, max = 500) {
  const text = String(error?.message || error || 'unknown error')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

async function loadNodeDeps() {
  nodeDepsPromise ||= Promise.all([
    import('@distube/ytdl-core'),
    import('yt-search')
  ]).then(([ytdlModule, ytSearchModule]) => ({
    ytdl: ytdlModule.default || ytdlModule,
    ytSearch: ytSearchModule.default || ytSearchModule
  })).catch(error => {
    nodeDepsPromise = null;
    throw new Error(
      `Anita-style Node engine dependencies are unavailable: ${error.message}. ` +
      'Run npm install @distube/ytdl-core@4.16.12 yt-search@2.13.1'
    );
  });

  return nodeDepsPromise;
}

export async function nodeYoutubeEngineStatus() {
  try {
    const { ytdl, ytSearch } = await loadNodeDeps();
    return {
      available: typeof ytdl === 'function' && typeof ytSearch === 'function',
      ytdl: typeof ytdl === 'function',
      search: typeof ytSearch === 'function'
    };
  } catch (error) {
    return { available: false, ytdl: false, search: false, error: error.message };
  }
}

function candidateProxyRoutes(ytdl) {
  const routes = [{ name: 'node-direct', agent: undefined }];

  const httpProxy = String(process.env.OUTBOUND_PROXY_HTTP || '').trim();
  if (httpProxy && typeof ytdl.createProxyAgent === 'function') {
    try {
      routes.push({
        name: 'node-http-proxy',
        agent: ytdl.createProxyAgent({ uri: httpProxy })
      });
    } catch {}
  }

  return routes;
}

async function nodeSearch(query, options = {}) {
  const { ytSearch } = await loadNodeDeps();
  const result = await ytSearch(query);
  const maxDuration = Number(options.maxDuration || 720);

  const videos = Array.isArray(result?.videos) ? result.videos : [];
  const usable = videos.filter(video => {
    const title = String(video?.title || '').trim();
    const seconds = Number(video?.seconds || video?.duration?.seconds || 0);
    if (!video?.videoId || !title || blockedTitle(title)) return false;
    if (seconds && (seconds < 20 || seconds > maxDuration)) return false;
    return true;
  });

  if (!usable.length) throw new Error('Node YouTube search returned no suitable song result.');

  const video = usable[0];
  return {
    id: video.videoId,
    title: video.title,
    artist: video.author?.name || video.author || '',
    duration: Number(video.seconds || video.duration?.seconds || 0),
    thumbnail: video.thumbnail || video.image || '',
    url: video.url || `https://www.youtube.com/watch?v=${video.videoId}`,
    searchEngine: 'yt-search'
  };
}

function baseNoCookieArgs() {
  return [
    '--no-cookies',
    '--no-cookies-from-browser',
    '--remote-components', 'ejs:github',
    '--extractor-args', 'youtube:player_client=web_embedded'
  ];
}

async function ytdlpSearch(query, options = {}) {
  const count = Math.max(3, Number(options.searchCount || 9));
  const maxDuration = Number(options.maxDuration || 720);
  const timeout = Number(options.searchTimeout || 120000);

  const output = await run('yt-dlp', [
    ...baseNoCookieArgs(),
    `ytsearch${count}:${query}`,
    '--flat-playlist',
    '--skip-download',
    '--no-warnings',
    '--print', '%(id)s\t%(title)s\t%(duration)s\t%(channel)s'
  ], timeout);

  for (const line of String(output || '').split(/\r?\n/)) {
    const [id, rawTitle, rawDuration, artist = ''] = line.split('\t');
    const title = String(rawTitle || '').trim();
    const duration = Number(rawDuration);

    if (!id || !title || blockedTitle(title)) continue;
    if (Number.isFinite(duration) && duration > 0 && duration > maxDuration) continue;

    return {
      id,
      title,
      artist,
      duration: Number.isFinite(duration) ? duration : 0,
      thumbnail: '',
      url: `https://www.youtube.com/watch?v=${id}`,
      searchEngine: 'yt-dlp-fallback'
    };
  }

  throw new Error('yt-dlp search returned no suitable song result.');
}

export async function resolveYoutubeAudio(input, options = {}) {
  const value = String(input || '').trim();
  if (!value) throw new Error('A YouTube URL or search query is required.');

  if (isUrl(value)) {
    if (!isYouTubeUrl(value)) throw new Error('This helper only handles YouTube URLs or search queries.');
    return {
      id: '',
      title: '',
      artist: '',
      duration: 0,
      thumbnail: '',
      url: value,
      searchEngine: 'direct-url'
    };
  }

  const errors = [];

  try {
    return await nodeSearch(value, options);
  } catch (error) {
    errors.push(`Node search: ${shortError(error)}`);
  }

  try {
    return await ytdlpSearch(value, options);
  } catch (error) {
    errors.push(`yt-dlp search: ${shortError(error)}`);
  }

  throw new Error(`All YouTube search engines failed.\n${errors.join('\n')}`);
}

function runFfmpegFromStream(stream, output, metadata = {}, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', 'pipe:0',
      '-vn',
      '-ac', '2',
      '-ar', '44100',
      '-c:a', 'libmp3lame',
      '-b:a', '192k'
    ];

    if (metadata.title) args.push('-metadata', `title=${metadata.title}`);
    if (metadata.artist) args.push('-metadata', `artist=${metadata.artist}`);

    args.push(output);

    const ffmpeg = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { stream.destroy?.(); } catch {}
      fn(value);
    };

    const timer = setTimeout(() => {
      try { stream.destroy?.(); } catch {}
      ffmpeg.kill('SIGKILL');
      finish(reject, new Error('Node audio conversion timed out.'));
    }, timeout);

    ffmpeg.stderr.on('data', chunk => {
      stderr += chunk;
      if (stderr.length > 5000) stderr = stderr.slice(-5000);
    });

    stream.once('error', error => {
      ffmpeg.stdin.destroy(error);
      finish(reject, error);
    });

    ffmpeg.once('error', error => finish(reject, error));

    ffmpeg.once('close', code => {
      if (code !== 0) {
        return finish(reject, new Error(stderr.trim() || `ffmpeg exited ${code}`));
      }
      if (!fs.existsSync(output) || fs.statSync(output).size < 1024) {
        return finish(reject, new Error('ffmpeg produced no usable MP3.'));
      }
      finish(resolve, output);
    });

    stream.pipe(ffmpeg.stdin);
  });
}

async function nodeDownload(resolved, folder, options = {}) {
  const { ytdl } = await loadNodeDeps();
  const maxFilesizeBytes = Number(options.maxFilesizeBytes || 90 * 1024 * 1024);
  const timeout = Number(options.timeout || 180000);
  const failures = [];

  for (const route of candidateProxyRoutes(ytdl)) {
    const output = path.join(folder, `${safeName(resolved.title || resolved.id || 'youtube-audio')}.mp3`);

    try {
      const info = await ytdl.getInfo(resolved.url, {
        agent: route.agent,
        playerClients: ['WEB_EMBEDDED', 'IOS', 'ANDROID', 'TV']
      });

      const details = info?.videoDetails || {};
      const title = resolved.title || details.title || 'YouTube audio';
      const artist = resolved.artist || details.author?.name || details.ownerChannelName || '';

      const formats = Array.isArray(info?.formats) ? info.formats : [];
      const audioCandidates = formats.filter(f =>
        f &&
        f.hasAudio &&
        !f.hasVideo &&
        (!f.contentLength || Number(f.contentLength) <= maxFilesizeBytes)
      );

      if (!audioCandidates.length) {
        throw new Error('No audio-only stream format was available.');
      }

      const stream = ytdl.downloadFromInfo(info, {
        agent: route.agent,
        filter: 'audioonly',
        quality: 'highestaudio',
        highWaterMark: 1 << 25
      });

      await runFfmpegFromStream(stream, output, { title, artist }, timeout);

      if (fs.statSync(output).size > maxFilesizeBytes) {
        fs.rmSync(output, { force: true });
        throw new Error('Converted MP3 exceeded the configured size limit.');
      }

      return {
        file: output,
        strategy: route.name,
        videoId: resolved.id || details.videoId || '',
        title,
        artist,
        duration: resolved.duration || Number(details.lengthSeconds || 0),
        thumbnail: resolved.thumbnail || details.thumbnails?.at?.(-1)?.url || '',
        url: resolved.url
      };
    } catch (error) {
      fs.rmSync(output, { force: true });
      failures.push(`${route.name}: ${shortError(error)}`);
    }
  }

  throw new Error(`Anita-style Node stream failed.\n${failures.join('\n')}`);
}

async function ytdlpFallback(resolved, folder, options = {}) {
  const timeout = Number(options.timeout || 180000);
  const concurrentFragments = String(options.concurrentFragments || 6);
  const maxFilesize = String(options.maxFilesize || '90M');
  const outputTemplate = path.join(folder, '%(title).100B-%(id)s.%(ext)s');

  await run('yt-dlp', [
    ...baseNoCookieArgs(),
    resolved.url,
    '--no-playlist',
    '--continue',
    '--concurrent-fragments', concurrentFragments,
    '--retries', '10',
    '--fragment-retries', '10',
    '--socket-timeout', '20',
    '--max-filesize', maxFilesize,
    '--restrict-filenames',
    '-o', outputTemplate,
    '-f', 'bestaudio[ext=m4a]/bestaudio',
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '192K'
  ], timeout);

  const file = fs.readdirSync(folder)
    .filter(name => name.toLowerCase().endsWith('.mp3'))
    .map(name => path.join(folder, name))
    .find(full => fs.statSync(full).isFile());

  if (!file) throw new Error('yt-dlp fallback completed without producing an MP3.');

  return {
    file,
    strategy: 'yt-dlp-fallback',
    videoId: resolved.id || '',
    title: resolved.title || path.basename(file, path.extname(file)),
    artist: resolved.artist || '',
    duration: resolved.duration || 0,
    thumbnail: resolved.thumbnail || '',
    url: resolved.url
  };
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
  const failures = [];

  try {
    return await nodeDownload(resolved, folder, options);
  } catch (error) {
    failures.push(shortError(error, 1400));
  }

  try {
    return await ytdlpFallback(resolved, folder, options);
  } catch (error) {
    failures.push(`yt-dlp fallback: ${shortError(error, 1400)}`);
  }

  throw new Error(
    `YouTube audio failed on the Anita-style Node engine and yt-dlp fallback.\n${failures.join('\n')}`
  );
}
