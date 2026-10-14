import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { connectionState, pairingState, requestPairing, listDevices, addDevice, removeDevice } from './bot.js';
import { store } from './store.js';
import { aiProviderStatus, providerCatalog, getAiProviders } from './ai-provider.js';
import { businessMemoryCount, clearBusinessMemory } from './business-assistant.js';

const assets = new Map([
  ['/', ['text/html; charset=utf-8', new URL('./dashboard/index.html', import.meta.url)]],
  ['/assets/dashboard.css', ['text/css; charset=utf-8', new URL('./dashboard/dashboard.css', import.meta.url)]],
  ['/assets/dashboard.js', ['text/javascript; charset=utf-8', new URL('./dashboard/dashboard.js', import.meta.url)]]
]);
const SESSION_TTL = 30 * 60 * 1000;
const sameSecret = (value, secret) => {
  const a = Buffer.from(String(value || '')); const b = Buffer.from(String(secret || ''));
  return b.length >= 12 && a.length === b.length && crypto.timingSafeEqual(a, b);
};
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 64000) fail('Request too large.', 413); chunks.push(chunk); }
  try { const data = JSON.parse(Buffer.concat(chunks).toString() || '{}'); if (!data || Array.isArray(data) || typeof data !== 'object') fail('Invalid request.'); return data; }
  catch (error) { if (error.status) throw error; fail('Invalid JSON.'); }
}
function phone(value) { const result = String(value || '').replace(/\D/g, ''); if (!/^\d{8,15}$/.test(result)) fail('Enter a complete phone number with country code.'); return result; }

export function createChatServer({ devices = { list: listDevices, add: addDevice, remove: removeDevice, pair: requestPairing }, adminKey = config.webAdminKey } = {}) {
  const sessions = new Map(); const attempts = new Map(); let pairingBusy = false;
  return http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost'); const path = url.pathname;
      if (req.method === 'GET' && assets.has(path)) { const [type, file] = assets.get(path); res.writeHead(200, { 'content-type': type }); return res.end(fs.readFileSync(file)); }
      if (req.method === 'GET' && path === '/health') return send(200, { status: 'running', whatsapp: 'private' });
      const now = Date.now();
      for (const [id, session] of sessions) if (session.expires <= now) sessions.delete(id);
      for (const [ip, record] of attempts) if (record.until <= now) attempts.delete(ip);
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
        let origin; try { origin = new URL(req.headers.origin); } catch { fail('Invalid origin.', 403); }
        if (origin.host !== req.headers.host) fail('Cross-site request rejected.', 403);
      }
      const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
      const cookie = value => `void_admin=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value ? SESSION_TTL / 1000 : 0}${secure ? '; Secure' : ''}`;
      if (req.method === 'POST' && path === '/api/login') {
        const ip = req.socket.remoteAddress || 'unknown'; const record = attempts.get(ip) || { count: 0, until: now + 60000 };
        if (record.count >= 5) return send(429, { error: 'Too many attempts. Try again in one minute.' });
        record.count++; attempts.set(ip, record);
        if (attempts.size > 128) attempts.delete(attempts.keys().next().value);
        const data = await readJson(req);
        const accountId = String(data.accountId || '').trim();
        let role = 'owner', credential;
        if (accountId) {
          credential = store.getGlobal('webSessionUsers', {})[accountId];
          const candidate = crypto.scryptSync(String(data.key || '').slice(0, 256), credential?.salt || 'invalid-account', 32).toString('hex');
          if (!credential || !sameSecret(candidate, credential.hash)) return send(401, { error: 'Incorrect account ID or password.' });
          role = 'account';
        } else if (!sameSecret(data.key, adminKey)) return send(401, { error: 'Incorrect owner password.' });
        if (sessions.size >= 10) sessions.delete(sessions.keys().next().value);
        const token = crypto.randomBytes(32).toString('hex'); const csrf = crypto.randomBytes(24).toString('hex');
        sessions.set(token, { csrf, expires: now + SESSION_TTL, role, accountId, revision: credential?.revision });
        res.setHeader('set-cookie', cookie(token)); return send(200, { csrf });
      }
      const token = /(?:^|;\s*)void_admin=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      const session = token ? sessions.get(token) : null;
      const headerAuth = sameSecret(req.headers['x-admin-key'], adminKey);
      if (!session && !headerAuth) return send(401, { error: 'Sign in to manage this bot.' });
      if (!['GET', 'HEAD'].includes(req.method) && !headerAuth && req.headers['x-csrf-token'] !== session.csrf) fail('Session check failed. Sign in again.', 403);
      const owner = headerAuth || session?.role === 'owner';
      if (!owner && session) {
        const credential = store.getGlobal('webSessionUsers', {})[session.accountId];
        if (!credential || credential.revision !== session.revision) { sessions.delete(token); return send(401, { error: 'Access changed. Sign in again.' }); }
      }
      if (session) session.expires = now + SESSION_TTL;
      if (req.method === 'POST' && path === '/api/logout') { if (token) sessions.delete(token); res.setHeader('set-cookie', cookie('')); return send(200, { ok: true }); }
      if (req.method === 'GET' && path === '/api/state') {
        const providers = aiProviderStatus().map(p => ({ ...p, enabled: store.getGlobal(`${p.name}Enabled`, true), model: store.getGlobal(`${p.name}Model`, process.env[`${p.name.toUpperCase()}_MODEL`] || p.model), hasSavedKey: Boolean(store.getApiKey(p.name)) }));
        return send(200, { csrf: session?.csrf || '', name: config.name, role: owner ? 'owner' : 'account', accountId: session?.accountId || '', accounts: devices.list().filter(x => owner || x.id === session.accountId), maxAccounts: Number(process.env.MAX_WHATSAPP_SESSIONS || 4), memoryMB: Math.round(process.memoryUsage().rss / 1048576), uptimeSeconds: Math.floor(process.uptime()), providers: owner ? providers : providers.map(p => ({ name: p.name, configured: p.configured, cooldownSeconds: p.cooldownSeconds })), cloudflareAccountId: !owner ? '' : process.env.CLOUDFLARE_ACCOUNT_ID || store.getGlobal('cloudflareAccountId', '') });
      }
      if (req.method === 'GET' && path === '/api/status') { if (!owner) fail('Owner access required.', 403); return send(200, pairingState()); }
      if (req.method === 'POST' && path === '/api/pair') {
        if (pairingBusy) fail('Pairing is already in progress. Please wait.', 409);
        const data = await readJson(req); const number = phone(data.phone);
        if (!owner) {
          const assigned = store.getGlobal('webSessionUsers', {})[session.accountId];
          if (number !== assigned.phone || Boolean(data.primary) !== (session.accountId === 'primary')) fail('You can only pair your assigned WhatsApp account.', 403);
        }
        pairingBusy = true;
        try { const code = data.primary === true ? await devices.pair(number) : (await devices.add(number)).code; return send(200, { code, phone: number }); }
        finally { pairingBusy = false; }
      }
      const accountMatch = /^\/api\/accounts\/([a-zA-Z0-9_-]+)(?:\/(settings|pause|resume|clear-memory|remove|access|clear-tone))?$/.exec(path);
      if (accountMatch) {
        const [, id, action] = accountMatch;
        if (!owner && id !== session.accountId) fail('This account is not yours.', 403);
        if (!owner && ['access', 'remove'].includes(action)) fail('Owner access required.', 403);
        if (id !== 'primary' && !devices.list().some(x => x.id === id)) fail('Account not found.', 404);
        if (req.method === 'GET' && !action) return send(200, { id, settings: store.getBusiness(id), mode: store.getSessionSetting(id, 'mode', 'public'), memoryChats: businessMemoryCount(id) });
        if (req.method !== 'POST') fail('Method not allowed.', 405);
        const data = await readJson(req);
        if (action === 'access') {
          const users = { ...store.getGlobal('webSessionUsers', {}) };
          if (data.revoke === true) { delete users[id]; store.setGlobal('webSessionUsers', users); return send(200, { ok: true }); }
          const assigned = devices.list().find(x => x.id === id);
          const number = phone(assigned?.phone);
          const key = crypto.randomBytes(24).toString('base64url'), salt = crypto.randomBytes(16).toString('hex');
          users[id] = { phone: number, salt, hash: crypto.scryptSync(key, salt, 32).toString('hex'), revision: crypto.randomBytes(16).toString('hex') };
          store.setGlobal('webSessionUsers', users);
          return send(200, { accountId: id, key });
        }
        if (action === 'clear-tone') { store.updateBusiness(id, { learnedTone: [] }); return send(200, { ok: true }); }
        if (action === 'settings') {
          const patch = {};
          for (const field of ['personality', 'styleExamples', 'name', 'info', 'rules', 'hours', 'location', 'tone']) {
            if (data[field] !== undefined) { if (typeof data[field] !== 'string' || data[field].length > 10000) fail(`Invalid ${field}.`); patch[field] = data[field].trim(); }
          }
          if (data.learnTone !== undefined) { if (typeof data.learnTone !== 'boolean') fail('Invalid tone learning setting.'); patch.learnTone = data.learnTone; }
          if (data.enabled !== undefined) { if (typeof data.enabled !== 'boolean') fail('Invalid AI setting.'); patch.enabled = data.enabled; }
          const mode = data.mode ?? store.getSessionSetting(id, 'mode', 'public');
          if (!['public', 'private'].includes(mode)) fail('Invalid account mode.');
          if ((patch.enabled ?? store.getBusiness(id).enabled) && mode !== 'public') fail('Use public mode for automatic AI replies.');
          if (patch.enabled && !getAiProviders().length) fail('Configure an AI provider before enabling replies.');
          store.updateBusiness(id, patch); store.setSessionSetting(id, 'mode', mode); return send(200, { ok: true });
        }
        if (action === 'pause' || action === 'resume') { store.setBusinessChatPaused(id, phone(data.phone), action === 'pause', 'manual-command'); return send(200, { ok: true }); }
        if (action === 'clear-memory') { if (data.confirm !== true) fail('Confirmation required.'); return send(200, { removed: clearBusinessMemory(id) }); }
        if (action === 'remove') { if (data.confirm !== true) fail('Confirmation required.'); if (id === 'primary') fail('The primary account cannot be removed here.'); await devices.remove(id); return send(200, { ok: true }); }
      }
      const providerMatch = /^\/api\/providers\/([a-z]+)$/.exec(path);
      if (req.method === 'POST' && providerMatch) {
        if (!owner) fail('Owner access required.', 403);
        const item = providerCatalog.find(x => x.name === providerMatch[1]); if (!item) fail('Unknown provider.');
        const data = await readJson(req);
        if (data.model !== undefined && (typeof data.model !== 'string' || data.model.length > 160 || /[\r\n]/.test(data.model))) fail('Invalid model.');
        if (item.name === 'openrouter' && data.model && data.model !== 'openrouter/free' && !data.model.endsWith(':free')) fail('Choose openrouter/free or a model ending in :free.');
        if (data.key !== undefined && (typeof data.key !== 'string' || data.key.length > 2048 || /[\r\n]/.test(data.key))) fail('Invalid API key.');
        if (data.enabled !== undefined && typeof data.enabled !== 'boolean') fail('Invalid provider setting.');
        if (data.accountId !== undefined && !/^[a-zA-Z0-9]{1,100}$/.test(String(data.accountId))) fail('Invalid Cloudflare account ID.');
        if (data.model) store.setGlobal(`${item.name}Model`, data.model.trim());
        if (data.key?.trim()) store.setApiKey(item.name, data.key.trim());
        if (data.enabled !== undefined) store.setGlobal(`${item.name}Enabled`, data.enabled);
        if (item.name === 'cloudflare' && data.accountId) store.setGlobal('cloudflareAccountId', data.accountId);
        if (data.removeKey === true) store.removeApiKey(item.name);
        return send(200, { ok: true });
      }
      send(404, { error: 'Not found.' });
    } catch (error) {
      if (error.status) return send(error.status, { error: error.message });
      console.error('Dashboard request failed:', error.message);
      send(400, { error: 'Could not complete the request. Check the server console for details.' });
    }
  });
}
export function startWebServer() {
  return createChatServer().listen(config.port, '0.0.0.0', () => console.log(`VOID XMD V2 dashboard on port ${config.port}`));
}
