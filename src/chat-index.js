import { startupUpdate } from './startup-update.js';
try { process.loadEnvFile?.('.env'); } catch (error) { if (error.code !== 'ENOENT') console.warn('Could not load .env:', error.message); }
await startupUpdate();
process.env.CHAT_ONLY = 'true';
process.env.MAX_WHATSAPP_SESSIONS ||= '4';
await import('./index.js');
