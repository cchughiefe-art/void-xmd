import { spawn } from 'node:child_process';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const jidNumber = jid => String(jid || '').split('@')[0].split(':')[0];
export const formatRuntime = seconds => {
  const d = Math.floor(seconds / 86400), h = Math.floor(seconds % 86400 / 3600), m = Math.floor(seconds % 3600 / 60), s = Math.floor(seconds % 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
};
export function run(bin, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Operation timed out')); }, timeout);
    child.stdout.on('data', b => out += b);
    child.stderr.on('data', b => err += b);
    child.once('error', reject);
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error(err.slice(-500) || `Exited ${code}`)); });
  });
}
export async function fetchJson(url, options = {}, timeout = 15000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}
