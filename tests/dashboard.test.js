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

test('session user login limits every account route and revokes existing sessions', async () => {
  loadStore();
  accounts = [{ id: 'primary', primary: true, phone: '2348000000001', connected: true }, { id: '2348000000002', phone: '2348000000002', connected: false }];
  const server = createChatServer({ devices, adminKey: secret });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const owner = (route, data) => fetch(base + route, { method: 'POST', headers: { 'x-admin-key': secret, 'content-type': 'application/json' }, body: JSON.stringify(data) });
  try {
    const grant = await owner('/api/accounts/2348000000002/access', {}); assert.equal(grant.status, 200);
    const credentials = await grant.json(); assert.ok(credentials.key.length >= 24);
    assert.ok(!JSON.stringify(store.getGlobal('webSessionUsers')).includes(credentials.key));
    const login = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify(credentials) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0], { csrf } = await login.json();
    const user = (route, data, headers = {}) => fetch(base + route, { method: data === undefined ? 'GET' : 'POST', headers: { cookie, 'x-csrf-token': csrf, ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const state = await (await user('/api/state')).json();
    assert.equal(state.role, 'account'); assert.deepEqual(state.accounts.map(x => x.id), ['2348000000002']);
    assert.equal((await user('/api/accounts/primary')).status, 403);
    assert.equal((await user('/api/accounts/primary/settings', { personality: 'intrusion' })).status, 403);
    assert.equal((await user('/api/accounts/2348000000002/settings', { personality: 'my style', learnTone: false })).status, 200);
    assert.equal(store.getBusiness('2348000000002').learnTone, false);
    assert.equal((await user('/api/accounts/2348000000002/settings', {}, { 'x-csrf-token': '' })).status, 403);
    assert.equal((await user('/api/providers/groq', { key: 'intrusion' })).status, 403);
    assert.equal((await user('/api/status')).status, 403);
    assert.equal((await user('/api/pair', { phone: '2348000000001', primary: true })).status, 403);
    assert.equal((await user('/api/pair', { phone: '2348000000002', primary: false })).status, 200);
    assert.equal((await user('/api/accounts/2348000000002/access', {})).status, 403);
    assert.equal((await user('/api/accounts/2348000000002/remove', { confirm: true })).status, 403);
    assert.equal((await user('/api/accounts/2348000000002/clear-tone', {})).status, 200);
    await owner('/api/accounts/2348000000002/access', {});
    assert.equal((await user('/api/state')).status, 401);
    const revoked = await owner('/api/accounts/2348000000002/access', { revoke: true }); assert.equal(revoked.status, 200);
    assert.equal(store.getGlobal('webSessionUsers')['2348000000002'], undefined);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); }
});

test('customer signup requires HTTPS, reserves only new numbers, isolates login and limits capacity', async () => {
 loadStore(); store.setGlobal('webSessionUsers', {});
 accounts = [{ id:'primary', primary:true, phone:'2348000000001', connected:true }];
 const previous = process.env.WEB_TRUST_PROXY; process.env.WEB_TRUST_PROXY='true';
 const server=createChatServer({devices,adminKey:secret,allowSignup:true}); await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const signup=(phone,secure=true)=>fetch(base+'/api/signup',{method:'POST',headers:secure?{'x-forwarded-proto':'https'}:{},body:JSON.stringify({phone,password:'customer-password-123'})});
 try {
  assert.equal((await signup('2348000000003',false)).status,403);
  assert.equal((await signup('2348000000001')).status,409);
  assert.equal((await signup('2348000000003')).status,201);
  assert.equal((await signup('2348000000003')).status,409);
  assert.equal(store.getBusiness('2348000000003').enabled,false);
  assert.equal(store.getBusiness('2348000000003').learnTone,false);
  const login=await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({accountId:'2348000000003',key:'customer-password-123'})});
  assert.equal(login.status,200); const cookie=login.headers.get('set-cookie').split(';')[0], {csrf}=await login.json();
  const state=await (await fetch(base+'/api/state',{headers:{cookie}})).json(); assert.equal(state.accounts.length,1); assert.equal(state.accounts[0].status,'not-linked');
  const enable=await fetch(base+'/api/accounts/2348000000003/settings',{method:'POST',headers:{cookie,'x-csrf-token':csrf},body:JSON.stringify({enabled:true})}); assert.equal(enable.status,400);
  assert.equal((await fetch(base+'/api/accounts/primary',{headers:{cookie}})).status,403);
  const oldMax=process.env.MAX_WHATSAPP_SESSIONS; process.env.MAX_WHATSAPP_SESSIONS='2';
  try { assert.equal((await signup('2348000000004')).status,409); } finally { if(oldMax===undefined)delete process.env.MAX_WHATSAPP_SESSIONS;else process.env.MAX_WHATSAPP_SESSIONS=oldMax; }
 } finally {await new Promise(r=>server.close(r));if(previous===undefined)delete process.env.WEB_TRUST_PROXY;else process.env.WEB_TRUST_PROXY=previous;fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});}
});
