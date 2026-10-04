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

const YTDLP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const YTDLP_CHANNEL = String(process.env.YTDLP_CHANNEL || 'nightly').trim().toLowerCase();
let ytDlpPromise;

function ytDlpRepo() {
  if (YTDLP_CHANNEL === 'stable') return 'yt-dlp/yt-dlp';
  if (YTDLP_CHANNEL === 'master') return 'yt-dlp/yt-dlp-master-builds';
  return 'yt-dlp/yt-dlp-nightly-builds';
}

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
    channel: YTDLP_CHANNEL,
    repository: ytDlpRepo(),
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

  const base = `https://github.com/${ytDlpRepo()}/releases/latest/download`;
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

function isYouTubeInvocation(args) {
  return args.some(value => {
    const s = String(value || '');
    return /^(?:ytsearch|ytsearchdate)\d*:/i.test(s) ||
      /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i.test(s);
  });
}

function prepareYtDlpArgs(args, { useCookies = true } = {}) {
  const prepared = [...args];
  const youtube = isYouTubeInvocation(prepared);

  if (!hasArg(prepared, '--js-runtimes') && !hasArg(prepared, '--no-js-runtimes')) {
    prepared.unshift('--js-runtimes', 'node');
  }

  if (!hasArg(prepared, '--remote-components')) {
    prepared.unshift('--remote-components', 'ejs:github');
  }

  const auth = ytDlpAuthStatus();
  const explicitCookies =
    hasArg(prepared, '--cookies') ||
    hasArg(prepared, '--cookies-from-browser');

  const cookiesDisabled =
    hasArg(prepared, '--no-cookies') ||
    hasArg(prepared, '--no-cookies-from-browser');

  const managedCookies =
    youtube &&
    useCookies &&
    auth.present &&
    !explicitCookies &&
    !cookiesDisabled;

  if (managedCookies) {
    try { fs.chmodSync(auth.cookieFile, 0o600); } catch {}
    prepared.unshift('--cookies', auth.cookieFile);
  }

  if (
    youtube &&
    (managedCookies || explicitCookies) &&
    !hasArg(prepared, '--extractor-args')
  ) {
    const clients = String(
      process.env.YTDLP_YOUTUBE_PLAYER_CLIENTS || 'default,web_embedded'
    ).trim();
    prepared.unshift('--extractor-args', `youtube:player_client=${clients}`);
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

  if (/the page needs to be reloaded/i.test(message)) {
    return new Error(
      'YouTube rejected the logged-in player client. VOID XMD is now configured for the current ' +
      'default,web_embedded workaround and nightly yt-dlp. Run .ytrefresh then .yttest.'
    );
  }

  if (/cookies.*expired|account.*authentication|login required/i.test(message) && auth.present) {
    return new Error(
      `The saved yt-dlp cookies may be expired or invalid. Replace ${auth.cookieFile} with a fresh export and retry.`
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function ytdlpProxyFallbacks() {
  if (/^(?:0|false|off|no)$/i.test(String(process.env.OUTBOUND_PROXY_FALLBACK || '1'))) return [];
  return [
    String(process.env.OUTBOUND_PROXY_SOCKS5 || '').trim(),
    String(process.env.OUTBOUND_PROXY_HTTP || '').trim()
  ].filter(Boolean);
}

function redactProxy(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = '***';
      url.password = '***';
    }
    return url.toString();
  } catch {
    return '<invalid proxy>';
  }
}

function withProxy(args, proxy) {
  const clean = [];
  for (let i = 0; i < args.length; i++) {
    if (String(args[i]) === '--proxy') {
      i += 1;
      continue;
    }
    if (String(args[i]).startsWith('--proxy=')) continue;
    clean.push(args[i]);
  }
  return ['--proxy', proxy, ...clean];
}

export async function run(bin, args, timeout = 120000) {
  if (bin !== 'yt-dlp') return spawnRun(bin, args, timeout);

  let local;
  try {
    local = await ensureYtDlp();
  } catch {
    local = 'yt-dlp';
  }

  const prepared = prepareYtDlpArgs(args, { useCookies: true });
  const explicitProxy = hasArg(args, '--proxy');

  try {
    return await spawnRun(local, prepared, timeout);
  } catch (directError) {
    if (explicitProxy) throw ytDlpFriendlyError(directError);

    const failures = [`direct: ${String(directError?.message || directError).replace(/\s+/g, ' ').slice(-500)}`];

    for (const proxy of ytdlpProxyFallbacks()) {
      try {
        let proxyArgs = withProxy(prepared, proxy);

        // Never auto-forward the bot's managed YouTube cookie file through a
        // fallback proxy. Commands that explicitly supplied their own cookie
        // arguments are left untouched.
        if (
          isYouTubeInvocation(args) &&
          !hasArg(args, '--cookies') &&
          !hasArg(args, '--cookies-from-browser')
        ) {
          proxyArgs = proxyArgs.filter((value, index, array) => {
            if (value === '--cookies') return false;
            if (index > 0 && array[index - 1] === '--cookies') return false;
            return true;
          });
          if (!hasArg(proxyArgs, '--no-cookies')) {
            proxyArgs.unshift('--no-cookies', '--no-cookies-from-browser');
          }
        }

        return await spawnRun(local, proxyArgs, timeout);
      } catch (error) {
        failures.push(
          `${redactProxy(proxy)}: ${String(error?.message || error).replace(/\s+/g, ' ').slice(-500)}`
        );
      }
    }

    throw new Error(
      `yt-dlp failed on direct and all configured fallback routes.\n${failures.join('\n')}`
    );
  }
}

export async function fetchJson(url, options = {}, timeout = 15000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}
