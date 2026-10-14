import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startupUpdate } from '../src/startup-update.js';
const sha = text => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex');
const commit = 'a'.repeat(40);
function fixture() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'void-update-test-'));
 fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}'); fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
 fs.writeFileSync(path.join(root, '.env'), 'SECRET=keep');
 fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src/example.js'), 'export const old = true;');
 const content = 'export const updated = true;';
 const entries = ['package.json','package-lock.json'].map(f => ({ path:f, sha:sha(fs.readFileSync(path.join(root,f),'utf8')), type:'blob', mode:'100644' }));
 entries.push({ path:'src/example.js', sha:sha(content), type:'blob', mode:'100644' });
 let calls = 0;
 const fetcher = async url => { calls++;
  const data = url.includes('/git/ref/') ? { object:{ sha:commit } } : url.includes('/git/trees/') ? { tree:entries } : { encoding:'base64', content:Buffer.from(content).toString('base64') };
  return new Response(JSON.stringify(data));
 };
 return { root, fetcher, entries, calls:()=>calls };
}
test('updater downloads verified changes without git, then skips unchanged commit', async () => {
 const f=fixture(); try {
  assert.equal((await startupUpdate(f.root,{ fetcher:f.fetcher })).status,'updated');
  assert.match(fs.readFileSync(path.join(f.root,'src/example.js'),'utf8'), /updated/);
  assert.equal(fs.readFileSync(path.join(f.root,'.env'),'utf8'),'SECRET=keep');
  const calls=f.calls(); assert.equal((await startupUpdate(f.root,{fetcher:f.fetcher})).status,'unchanged'); assert.equal(f.calls(),calls+1);
 } finally { fs.rmSync(f.root,{recursive:true,force:true}); }
});
test('network failure and changed dependencies leave installed files untouched',async()=>{
 const f=fixture(); try {
  assert.equal((await startupUpdate(f.root,{fetcher:async()=>{throw new Error('offline');}})).status,'skipped');
  f.entries[0].sha='b'.repeat(40);
  assert.equal((await startupUpdate(f.root,{fetcher:f.fetcher})).status,'skipped');
  assert.match(fs.readFileSync(path.join(f.root,'src/example.js'),'utf8'), /old/);
 } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});
test('local edits and corrupted downloaded blobs are preserved rather than overwritten',async()=>{
 const f=fixture(); try {
  fs.writeFileSync(path.join(f.root,'src/example.js'),'local edit');
  fs.writeFileSync(path.join(f.root,'.void-update.json'),JSON.stringify({commit:'c'.repeat(40),files:{'src/example.js':'d'.repeat(40)}}));
  assert.equal((await startupUpdate(f.root,{fetcher:f.fetcher})).status,'skipped');
  assert.equal(fs.readFileSync(path.join(f.root,'src/example.js'),'utf8'),'local edit');
  fs.rmSync(path.join(f.root,'.void-update.json')); f.entries[2].sha='e'.repeat(40);
  assert.equal((await startupUpdate(f.root,{fetcher:f.fetcher})).status,'skipped');
  assert.equal(fs.readFileSync(path.join(f.root,'src/example.js'),'utf8'),'local edit');
 } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});
