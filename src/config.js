import path from 'node:path';

const digits = (value = '') => String(value).replace(/\D/g, '');
export const config = Object.freeze({
  name: process.env.BOT_NAME || 'VOID XMD',
  prefix: process.env.PREFIX || '.',
  mode: (process.env.MODE || 'public').toLowerCase(),
  owner: digits(process.env.OWNER_NUMBER),
  pairingNumber: digits(process.env.PAIRING_NUMBER),
  port: Number(process.env.PORT || 3000),
  webAdminKey: process.env.WEB_ADMIN_KEY || '',
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  timezone: process.env.TIMEZONE || 'Africa/Lagos',
  aiBaseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  aiKey: process.env.AI_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'gpt-4.1-mini'
  ,braveSearchKey: process.env.BRAVE_SEARCH_API_KEY || ''
});

export function validateConfig() {
  const errors = [];
  if (!config.owner) errors.push('OWNER_NUMBER is required (country code, no +).');
  if (!['public', 'private'].includes(config.mode)) errors.push('MODE must be public or private.');
  if (!Number.isInteger(config.port) || config.port < 1) errors.push('PORT must be valid.');
  if (config.webAdminKey.length < 12) errors.push('WEB_ADMIN_KEY must contain at least 12 characters.');
  if (errors.length) throw new Error(`Invalid configuration:\n- ${errors.join('\n- ')}`);
}
