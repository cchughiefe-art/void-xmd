import { startupUpdate } from './startup-update.js';
startupUpdate();
process.env.CHAT_ONLY = 'true';
process.env.MAX_WHATSAPP_SESSIONS ||= '4';
await import('./index.js');
