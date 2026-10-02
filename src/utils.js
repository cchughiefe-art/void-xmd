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
        code === 0 ? out.trim() : new Error(err.slice(-500) || `Exited ${code}`)
      );
    });
  });
}

let ytDlpPromise;

async function ensureYtDlp() {
  if (process.platform !== 'linux') {
    throw new Error('yt-dlp is missing. Install yt-dlp on this host.');
  }

  const asset =
    process.arch === 'x64' ? 'yt-dlp_linux' :
    process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' :
    '';

  if (!asset) {
    throw new Error(`No automatic yt-dlp binary is configured for ${process.platform}/${process.arch}.`);
  }

  const dir = path.join(config.dataDir, 'bin');
  const target = path.join(dir, 'yt-dlp');

  if (fs.existsSync(target)) return target;

  ytDlpPromise ||= (async () => {
    fs.mkdirSync(dir, { recursive: true });

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
  })().finally(() => {
    ytDlpPromise = null;
  });

  return ytDlpPromise;
}

export async function run(bin, args, timeout = 120000) {
  if (bin !== 'yt-dlp') return spawnRun(bin, args, timeout);

  try {
    return await spawnRun('yt-dlp', args, timeout);
  } catch (error) {
    if (error?.code !== 'ENOENT' && !String(error?.message || '').includes('ENOENT')) {
      throw error;
    }

    const local = await ensureYtDlp();
    return spawnRun(local, args, timeout);
  }
}
export async function fetchJson(url, options = {}, timeout = 15000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}
