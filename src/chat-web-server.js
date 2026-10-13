import http from 'node:http';
import crypto from 'node:crypto';
import { config } from './config.js';
import { connectionState, pairingState, requestPairing } from './bot.js';
export function startWebServer() {
  return http.createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') return send(200, { status: 'running', whatsapp: connectionState() });
      const key = Buffer.from(String(req.headers['x-admin-key'] || '')); const expected = Buffer.from(config.webAdminKey);
      if (key.length !== expected.length || !crypto.timingSafeEqual(key, expected)) return send(401, { error: 'Invalid admin key' });
      if (req.method === 'GET' && path === '/api/status') return send(200, pairingState());
      if (req.method === 'POST' && path === '/api/pair') {
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2048) return send(413, { error: 'Request too large' }); }
        return send(200, { code: await requestPairing(JSON.parse(body).phone) });
      }
      send(404, { error: 'Use the server console for pairing and WhatsApp .help for account controls.' });
    } catch { send(400, { error: 'Pairing request failed. Check server console.' }); }
  }).listen(config.port, '0.0.0.0', () => console.log(`AI chat health endpoint on port ${config.port}`));
}
