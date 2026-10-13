import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.CHAT_ONLY = 'true';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'void-dashboard-test-'));
process.env.AI_PROVIDER_ORDER = 'groq,openrouter';
const { loadStore, store } = await import('../src/store.js');
loadStore();
const { createChatServer } = await import('../src/chat-web-server.js');
const secret = 'test-admin-password-for-dashboard';
let accounts = [{ id: 'primary', primary: true, phone: '2348000000001', connected: true, status: 'connected' }, { id: '2348000000002', primary: false, phone: '2348000000002', connected: true, status: 'connected' }];
const devices = {
  list: () => accounts,
  pair: async () => '1111-2222',
  add: async phone => ({ phone, code: '3333-4444' }),
  remove: async id => { accounts = accounts.filter(x => x.id !== id); }
};

test('dashboard authenticates, hides keys, isolates settings and guards mutations', async () => {
  const server = createChatServer({ devices, adminKey: secret });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', csrf = '';
  const request = (url, data, extra = {}) => fetch(base + url, { method: data === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), 'content-type': 'application/json', ...extra }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  try {
    const root = await request('/'); assert.equal(root.status, 200); assert.match(await root.text(), /VOID XMD V2/);
    assert.match(root.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await request('/assets/dashboard.js')).status, 200);
    assert.equal((await request('/api/state')).status, 401);
    assert.equal((await request('/api/login', { key: 'wrong' })).status, 401);
    const login = await request('/api/login', { key: secret }); assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0]; assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    csrf = (await login.json()).csrf; assert.ok(csrf);
    const state = await (await request('/api/state')).json(); assert.equal(state.accounts.length, 2);
    assert.equal((await request('/api/accounts/primary/settings', { enabled: true, mode: 'public' })).status, 400);
    assert.equal((await request('/api/providers/groq', { key: 'test-provider-secret', model: 'openai/gpt-oss-20b', enabled: true })).status, 200);
    const redacted = await (await request('/api/state')).text(); assert.ok(!redacted.includes('test-provider-secret')); assert.ok(!redacted.includes(secret));
    assert.equal((await request('/api/providers/openrouter', { model: 'paid/model' })).status, 400);
    assert.equal((await request('/api/accounts/primary/settings', { personality: 'Primary style', enabled: true, mode: 'public' })).status, 200);
    assert.equal((await request('/api/accounts/2348000000002/settings', { personality: 'Second style', enabled: false, mode: 'public' })).status, 200);
    assert.equal(store.getBusiness('primary').personality, 'Primary style'); assert.equal(store.getBusiness('2348000000002').personality, 'Second style');
    assert.equal((await request('/api/accounts/primary/settings', { enabled: true, mode: 'private' })).status, 400);
    assert.equal((await request('/api/accounts/primary/pause', { phone: '2348111111111' })).status, 200);
    assert.equal(store.isBusinessChatPaused('primary', '2348111111111'), true);
    assert.equal(store.isBusinessChatPaused('2348000000002', '2348111111111'), false);
    assert.equal((await request('/api/accounts/primary/resume', { phone: '2348111111111' })).status, 200);
    assert.equal((await request('/api/providers/groq', { enabled: false }, { 'x-csrf-token': '' })).status, 403);
    assert.equal((await request('/api/providers/groq', { enabled: false }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/api/providers/groq', { enabled: false })).status, 200);
    assert.ok(!(await (await request('/api/state')).json()).providers.find(x => x.name === 'groq').configured);
    assert.equal((await request('/api/accounts/primary/remove', { confirm: true })).status, 400);
    assert.equal((await request('/api/accounts/2348000000002/remove', {})).status, 400);
    assert.equal((await request('/api/pair', { phone: '2348000000003', primary: false })).status, 200);
    assert.equal((await request('/api/accounts/2348000000002/remove', { confirm: true })).status, 200);
    assert.equal((await request('/api/accounts/nonexistent')).status, 404);
    assert.equal((await request('/api/logout', {})).status, 200);
    assert.equal((await request('/api/state')).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); }
});

test('login attempts are limited', async () => {
  const server = createChatServer({ devices, adminKey: secret });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/login`;
    for (let i = 0; i < 5; i++) assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify({ key: 'bad' }) })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify({ key: secret }) })).status, 429);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
