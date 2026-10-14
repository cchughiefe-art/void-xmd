import { store } from './store.js';
import { config } from './config.js';
import { createHash } from 'node:crypto';
export function collectTone(sessionId, messages, bodyOf) {
  const settings = store.getBusiness(sessionId);
  if (settings.learnTone === false) return;
  const samples = [...(settings.learnedTone || [])];
  const known = new Set(samples.map(x => x.id));
  for (const raw of messages.slice(-500)) {
    const jid = raw.key?.remoteJid || '';
    if (!raw.key?.fromMe || !/@(?:s.whatsapp.net|lid)$/.test(jid)) continue;
    const text = String(bodyOf(raw) || '').trim();
    if (text.length < 3 || text.length > 280 || text.startsWith(config.prefix) || /https?:|\d{5,}|@|api.?key|password|otp|secret|token/i.test(text)) continue;
    const id = createHash('sha256').update(text).digest('hex').slice(0, 20);
    if (!known.has(id)) { samples.push({ id, text }); known.add(id); }
  }
  const bounded = samples.slice(-24);
  if (JSON.stringify(bounded) !== JSON.stringify(settings.learnedTone || [])) store.updateBusiness(sessionId, { learnedTone: bounded });
}
