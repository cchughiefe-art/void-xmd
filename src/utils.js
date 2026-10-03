import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const jidNumber = jid => String(jid || '').split('@')[0].split(':')[0];
export const formatRuntime = seconds => {
  const d = Math.floor(seconds / 86400), h = Math.floor(seconds % 86400 / 3600), m = Math.floor(seconds % 3600 / 60), s = Math.floor(seconds % 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
};

function spawnRun(bin, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error('Operation timed out'));
    }, timeout);

    child.stdout.on('data', b => out += b);
    child.stderr.on('data', b => err += b);
    child.once('error', error => finish(reject, error));
    child.once('close', code => {
      if (settled) return;
      finish(
        code === 0 ? resolve : reject,
        code === 0 ? out.trim() : new Error(err.slice(-1600) || `Exited ${code}`)
      );
    });
  });
}

const YTDLP_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
let ytDlpPromise;

function managedYtDlpPath() {
  return path.join(config.dataDir, 'bin', 'yt-dlp');
}

export function ytDlpCookiesPath() {
  const configured = String(process.env.YTDLP_COOKIES_FILE || '').trim();
  return configured
    ? path.resolve(configured)
    : path.join(config.dataDir, 'youtube-cookies.txt');
}

export function ytDlpAuthStatus() {
  const cookieFile = ytDlpCookiesPath();
  let size = 0;
  let present = false;

  try {
    const stat = fs.statSync(cookieFile);
    present = stat.isFile() && stat.size > 20;
    size = stat.size;
  } catch {}

  return {
    cookieFile,
    present,
    size,
    managedBinary: managedYtDlpPath(),
    managedBinaryPresent: fs.existsSync(managedYtDlpPath())
  };
}

async function downloadLatestYtDlp(target) {
  if (process.platform !== 'linux') {
    throw new Error('Automatic yt-dlp installation is only configured for Linux.');
  }

  const asset =
    process.arch === 'x64' ? 'yt-dlp_linux' :
    process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' :
    '';

  if (!asset) {
    throw new Error(`No automatic yt-dlp binary is configured for ${process.platform}/${process.arch}.`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });

  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
  const [binaryResponse, sumsResponse] = await Promise.all([
    fetch(`${base}/${asset}`, { signal: AbortSignal.timeout(120000) }),
    fetch(`${base}/SHA2-256SUMS`, { signal: AbortSignal.timeout(30000) })
  ]);

  if (!binaryResponse.ok) {
    throw new Error(`yt-dlp download failed (${binaryResponse.status}).`);
  }
  if (!sumsResponse.ok) {
    throw new Error(`yt-dlp checksum download failed (${sumsResponse.status}).`);
  }

  const bytes = Buffer.from(await binaryResponse.arrayBuffer());
  const sums = await sumsResponse.text();
  const line = sums.split(/\r?\n/).find(x => x.trim().endsWith(`  ${asset}`));
  if (!line) throw new Error('Could not find yt-dlp checksum.');

  const expected = line.trim().split(/\s+/)[0].toLowerCase();
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');

  if (actual !== expected) {
    throw new Error('yt-dlp checksum verification failed.');
  }

  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, bytes, { mode: 0o755 });
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, target);

  return target;
}

async function ensureYtDlp({ force = false } = {}) {
  const target = managedYtDlpPath();

  if (!force && fs.existsSync(target)) {
    try {
      const stat = fs.statSync(target);
      if (Date.now() - stat.mtimeMs < YTDLP_MAX_AGE_MS) return target;
    } catch {}
  }

  ytDlpPromise ||= (async () => {
    const hadOld = fs.existsSync(target);

    try {
      return await downloadLatestYtDlp(target);
    } catch (error) {
      // If refreshing an existing verified/working local binary fails because
      // GitHub is temporarily unavailable, keep using the old binary.
      if (hadOld && fs.existsSync(target)) return target;
      throw error;
    }
  })().finally(() => {
    ytDlpPromise = null;
  });

  return ytDlpPromise;
}

export async function refreshYtDlp() {
  return ensureYtDlp({ force: true });
}

function hasArg(args, name) {
  return args.some(arg => String(arg) === name || String(arg).startsWith(`${name}=`));
}

function prepareYtDlpArgs(args) {
  const prepared = [...args];

  // Current yt-dlp YouTube support benefits from a JS runtime. Node already
  // exists on VOID XMD hosts, so explicitly enable it.
  if (!hasArg(prepared, '--js-runtimes') && !hasArg(prepared, '--no-js-runtimes')) {
    prepared.unshift('--js-runtimes', 'node');
  }

  // Allow yt-dlp to obtain its official EJS component when YouTube needs it.
  if (!hasArg(prepared, '--remote-components')) {
    prepared.unshift('--remote-components', 'ejs:github');
  }

  const auth = ytDlpAuthStatus();
  if (
    auth.present &&
    !hasArg(prepared, '--cookies') &&
    !hasArg(prepared, '--cookies-from-browser')
  ) {
    try { fs.chmodSync(auth.cookieFile, 0o600); } catch {}
    prepared.unshift('--cookies', auth.cookieFile);
  }

  return prepared;
}

function ytDlpFriendlyError(error) {
  const message = String(error?.message || error || 'yt-dlp failed.');
  const auth = ytDlpAuthStatus();

  if (/sign in to confirm you.?re not a bot/i.test(message)) {
    if (auth.present) {
      return new Error(
        'YouTube rejected the saved authentication cookies. They may be expired. ' +
        `Replace ${auth.cookieFile} with a fresh cookies.txt exported from a browser session you own, then retry.`
      );
    }

    return new Error(
      'YouTube is requiring authenticated cookies from this server IP. ' +
      `Export cookies.txt from a YouTube browser session you own and upload it to ${auth.cookieFile}. ` +
      'Do not paste the cookies into WhatsApp or chat.'
    );
  }

  if (/cookies.*expired|account.*authentication|login required/i.test(message) && auth.present) {
    return new Error(
      `The saved yt-dlp cookies may be expired or invalid. Replace ${auth.cookieFile} with a fresh export and retry.`
    );
  }

  return error instanceof Error ? error : new Error(message);
}

export async function run(bin, args, timeout = 120000) {
  if (bin !== 'yt-dlp') return spawnRun(bin, args, timeout);

  const prepared = prepareYtDlpArgs(args);

  let local;
  try {
    local = await ensureYtDlp();
  } catch {
    // Fall back to the host's yt-dlp when the managed binary cannot be
    // installed/refreshed. This keeps the bot usable during GitHub outages.
    local = 'yt-dlp';
  }

  try {
    return await spawnRun(local, prepared, timeout);
  } catch (error) {
    // If the managed path disappeared or cannot execute, one final fallback to
    // the host binary is useful. Do not retry authentication failures.
    const message = String(error?.message || '');
    if (
      local !== 'yt-dlp' &&
      (error?.code === 'ENOENT' || /ENOENT|not found/i.test(message))
    ) {
      try {
        return await spawnRun('yt-dlp', prepared, timeout);
      } catch (fallbackError) {
        throw ytDlpFriendlyError(fallbackError);
      }
    }

    throw ytDlpFriendlyError(error);
  }
}

export async function fetchJson(url, options = {}, timeout = 15000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}
