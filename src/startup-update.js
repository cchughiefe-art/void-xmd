import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const hash = file => fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
export function startupUpdate(root = process.cwd()) {
  if (process.env.AUTO_UPDATE === 'false') return;
  let temp;
  const changed = [];
  try {
    const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, timeout: 45000, stdio: 'pipe', maxBuffer: 4 * 1024 * 1024 }).toString().trim();
    const repo = 'https://github.com/cchughiefe-art/void-xmd.git';
    const branch = 'void-xmd-v2';
    const meta = path.join(root, '.void-update.json');
    const previous = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta)) : {};
    const latest = run('git', ['ls-remote', repo, `refs/heads/${branch}`]).split(/\s/)[0];
    if (!/^[a-f0-9]{40}$/.test(latest)) throw new Error('Invalid remote revision');
    if (previous.commit === latest) { console.log('GitHub: already up to date.'); return; }
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'void-update-'));
    run('git', ['clone', '--depth', '1', '--single-branch', '--branch', branch, repo, temp]);
    const commit = run('git', ['rev-parse', 'HEAD'], temp);
    // Dependencies must be installed deliberately, never changed beneath a running install.
    for (const f of ['package.json', 'package-lock.json']) {
      if (hash(path.join(root, f)) !== hash(path.join(temp, f))) throw new Error('Dependency change requires manual update and npm ci');
    }
    const files = run('git', ['ls-files'], temp).split('\n').filter(f => /^(src\/|scripts\/|tests\/|index\.js$)/.test(f));
    for (const f of files) {
      const source = path.join(temp, f), target = path.join(root, f);
      if (fs.lstatSync(source).isSymbolicLink()) throw new Error('Unsupported symbolic link');
      if (hash(source) === hash(target)) continue;
      if (previous.files?.[f] && hash(target) !== previous.files[f]) throw new Error(`Local edit conflict: ${f}`);
      if (/\.m?js$/.test(f)) run(process.execPath, ['--check', source]);
      changed.push({ f, target, source, old: fs.existsSync(target) ? fs.readFileSync(target) : null });
    }
    try {
      for (const item of changed) { fs.mkdirSync(path.dirname(item.target), { recursive: true }); fs.copyFileSync(item.source, item.target); }
      fs.writeFileSync(meta, JSON.stringify({ commit, files: Object.fromEntries(files.map(f => [f, hash(path.join(temp, f))])) }));
    } catch (error) {
      for (const item of changed) { if (item.old === null) fs.rmSync(item.target, { force: true }); else fs.writeFileSync(item.target, item.old); }
      throw error;
    }
    console.log(`GitHub: applied ${changed.length} changed files (${commit.slice(0, 7)}).`);
  } catch (error) { console.warn(`GitHub update skipped; starting installed code: ${error.message.split('\n')[0]}`); }
  finally { if (temp) fs.rmSync(temp, { recursive: true, force: true }); }
}
