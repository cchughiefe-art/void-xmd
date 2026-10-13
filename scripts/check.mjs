import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
function check(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) check(file);
    else if (/\.m?js$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
for (const dir of ['src', 'scripts', 'tests']) check(dir);
const root = spawnSync(process.execPath, ['--check', 'index.js'], { stdio: 'inherit' });
if (root.status !== 0) process.exit(root.status || 1);
console.log('All JavaScript syntax checks passed.');
