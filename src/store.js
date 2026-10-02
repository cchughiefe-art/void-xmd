import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const defaults = {
  users: {},
  groups: {},
  economy: {},
  global: {},
  secrets: { apiKeys: {}, currentKey: '' }
};

const dbFile = path.join(config.dataDir, 'void-xmd.json');
let state = structuredClone(defaults);

const groupDefaults = () => ({
  welcome: false,
  goodbye: false,
  antilink: false,
  antibadwords: false,
  warnings: {},
  rules: '',
  badwords: [],
  antiLinkMode: 'off',
  antisticker: false,
  antinsfw: false,
  antimedia: false,
  antimention: false,
  antitag: false,
  antitemu: false,
  autotyping: false,
  autoviewstatus: false,
  autostatusreact: false,
  autoreact: false,
  autorecording: false,
  alwaysonline: false,
  autoread: false,
  chatbot: false
});

export function loadStore() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  try {
    const parsed = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    state = {
      ...structuredClone(defaults),
      ...parsed,
      users: parsed.users || {},
      groups: parsed.groups || {},
      economy: parsed.economy || {},
      global: parsed.global || {},
      secrets: {
        apiKeys: parsed.secrets?.apiKeys || {},
        currentKey: parsed.secrets?.currentKey || ''
      }
    };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Database recovery:', error.message);
  }
}

function save() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${dbFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, dbFile);
  try { fs.chmodSync(dbFile, 0o600); } catch {}
}

export const store = {
  getGroup(jid) {
    state.groups[jid] ||= groupDefaults();
    state.groups[jid] = { ...groupDefaults(), ...state.groups[jid] };
    return state.groups[jid];
  },

  updateGroup(jid, patch) {
    Object.assign(this.getGroup(jid), patch);
    save();
    return this.getGroup(jid);
  },

  getGlobal(key, fallback = undefined) {
    return key in state.global ? state.global[key] : fallback;
  },

  setGlobal(key, value) {
    state.global[key] = value;
    save();
    return value;
  },

  getApiKey(name) {
    return state.secrets.apiKeys[String(name).toLowerCase()] || '';
  },

  setApiKey(name, value) {
    state.secrets.apiKeys[String(name).toLowerCase()] = String(value);
    save();
  },

  removeApiKey(name) {
    delete state.secrets.apiKeys[String(name).toLowerCase()];
    if (state.secrets.currentKey === String(name).toLowerCase()) state.secrets.currentKey = '';
    save();
  },

  listApiKeys() {
    return Object.keys(state.secrets.apiKeys).sort();
  },

  setCurrentKey(name) {
    const key = String(name).toLowerCase();
    if (!state.secrets.apiKeys[key]) throw new Error(`No API key named "${key}" is stored.`);
    state.secrets.currentKey = key;
    save();
    return key;
  },

  getCurrentKey() {
    return state.secrets.currentKey || '';
  },

  balance(jid) {
    state.economy[jid] ??= 100;
    return state.economy[jid];
  },

  addCoins(jid, amount) {
    state.economy[jid] = this.balance(jid) + amount;
    save();
    return state.economy[jid];
  },

  leaderboard(limit = 10) {
    return Object.entries(state.economy)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  },

  stats() {
    return {
      users: Object.keys(state.users).length,
      groups: Object.keys(state.groups).length
    };
  },

  see(jid) {
    state.users[jid] = Date.now();
    save();
  }
};
