import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startupUpdate } from '../src/startup-update.js';
test('disabled updater leaves installed files unchanged', () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'void-test-'));
 const previous = process.env.AUTO_UPDATE;
 try {
  fs.writeFileSync(path.join(dir, 'index.js'), 'original');
  process.env.AUTO_UPDATE = 'false'; startupUpdate(dir);
  assert.deepEqual(fs.readdirSync(dir), ['index.js']);
  assert.equal(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), 'original');
 } finally { if (previous === undefined) delete process.env.AUTO_UPDATE; else process.env.AUTO_UPDATE = previous; fs.rmSync(dir, { recursive: true }); }
});
test('missing git keeps the existing install and settings', () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'void-test-'));
 const oldPath = process.env.PATH, oldAuto = process.env.AUTO_UPDATE;
 try {
  fs.writeFileSync(path.join(dir, '.env'), 'KEEP_ME');
  fs.writeFileSync(path.join(dir, 'index.js'), 'original');
  process.env.PATH = dir; delete process.env.AUTO_UPDATE;
  startupUpdate(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'KEEP_ME');
 } finally { process.env.PATH = oldPath; if (oldAuto === undefined) delete process.env.AUTO_UPDATE; else process.env.AUTO_UPDATE = oldAuto; fs.rmSync(dir, { recursive: true }); }
});
