import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const blobHash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const hash = file => fs.existsSync(file) ? blobHash(fs.readFileSync(file)) : null;
const allowed = name => /^(src\/|scripts\/|tests\/|index\.js$)/.test(name) && !name.split('/').some(x => !x || x === '.' || x === '..') && !name.includes('\\');
export async function startupUpdate(root = process.cwd(), { fetcher = fetch } = {}) {
  if (process.env.AUTO_UPDATE === 'false') return { status: 'disabled' };
  const signal = AbortSignal.timeout(35000);
  const changed = []; let temp;
  try {
    const get = async url => {
      const response = await fetcher(url, { signal, headers: { 'user-agent': 'VOID-XMD-V2', accept: 'application/vnd.github+json' } });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      const reader = response.body.getReader(); let size = 0; const chunks = [];
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Update response too large'); } chunks.push(value); }
      return JSON.parse(Buffer.concat(chunks).toString());
    };
    const api = 'https://api.github.com/repos/cchughiefe-art/void-xmd';
    const meta = path.join(root, '.void-update.json');
    const previous = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta)) : {};
    const ref = await get(`${api}/git/ref/heads/void-xmd-v2`), commit = ref.object?.sha;
    if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Invalid revision');
    if (previous.commit === commit) { console.log('GitHub: already up to date.'); return { status: 'unchanged' }; }
    const tree = await get(`${api}/git/trees/${commit}?recursive=1`);
    if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Incomplete update listing');
    const entries = tree.tree.filter(x => x.type === 'blob');
    for (const f of ['package.json', 'package-lock.json']) {
      if (entries.find(x => x.path === f)?.sha !== hash(path.join(root, f))) throw new Error('Dependency change requires manual update and install');
    }
    let releaseFiles;
    const manifest = entries.find(x => x.path === 'chat-release.json');
    if (manifest) {
      const blob = await get(`${api}/git/blobs/${manifest.sha}`), bytes = Buffer.from(blob.content || '', 'base64');
      if (blob.encoding !== 'base64' || blobHash(bytes) !== manifest.sha) throw new Error('Invalid release manifest');
      releaseFiles = JSON.parse(bytes.toString());
      if (!Array.isArray(releaseFiles) || releaseFiles.length > 250 || releaseFiles.some(x => typeof x !== 'string' || !allowed(x))) throw new Error('Unsafe release manifest');
    }
    const files = entries.filter(x => allowed(x.path) && (releaseFiles ? releaseFiles.includes(x.path) : fs.existsSync(path.join(root, x.path))));
    if (files.some(x => !['100644', '100755'].includes(x.mode))) throw new Error('Unsupported file type');
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'void-update-'));
    fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
    let total = 0;
    for (const entry of files) {
      const target = path.join(root, entry.path), current = hash(target);
      if (current === entry.sha) continue;
      if (previous.files?.[entry.path] && current !== previous.files[entry.path]) throw new Error(`Local edit conflict: ${entry.path}`);
      if (signal.aborted) throw new Error('Update timed out');
      const blob = await get(`${api}/git/blobs/${entry.sha}`);
      if (blob.encoding !== 'base64') throw new Error('Unexpected blob encoding');
      const bytes = Buffer.from(blob.content, 'base64'); total += bytes.length;
      if (total > 20 * 1024 * 1024 || blobHash(bytes) !== entry.sha) throw new Error('Update integrity check failed');
      const source = path.join(temp, entry.path); fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, bytes);
      if (/\.m?js$/.test(entry.path)) execFileSync(process.execPath, ['--check', source], { timeout: 5000, stdio: 'pipe' });
      changed.push({ source, target, old: fs.existsSync(target) ? fs.readFileSync(target) : null });
    }
    try {
      for (const item of changed) { fs.mkdirSync(path.dirname(item.target), { recursive: true }); fs.copyFileSync(item.source, item.target); }
      const metadata = `${meta}.tmp`; fs.writeFileSync(metadata, JSON.stringify({ commit, files: Object.fromEntries(files.map(x => [x.path, x.sha])) })); fs.renameSync(metadata, meta);
    } catch (error) {
      for (const item of changed) { if (item.old === null) fs.rmSync(item.target, { force: true }); else fs.writeFileSync(item.target, item.old); } throw error;
    }
    console.log(`GitHub: applied ${changed.length} changed files (${commit.slice(0, 7)}). No git needed.`);
    return { status: 'updated', count: changed.length };
  } catch (error) { console.warn(`GitHub update skipped; starting installed code: ${error.message.split('\n')[0]}`); return { status: 'skipped' }; }
  finally { if (temp) fs.rmSync(temp, { recursive: true, force: true }); }
}
