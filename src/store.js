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
let delayedSaveTimer = null;
let dirty = false;

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
  antidelete: false,
  antiviewonce: false,
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

function saveNow() {
  if (delayedSaveTimer) {
    clearTimeout(delayedSaveTimer);
    delayedSaveTimer = null;
  }
  dirty = false;

  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${dbFile}.tmp`;

  // Compact JSON is much faster to serialize/write than pretty-printed JSON
  // and uses less of Heaven's disk I/O.
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, dbFile);
  try { fs.chmodSync(dbFile, 0o600); } catch {}
}

function scheduleSave(delay = 4000) {
  dirty = true;
  if (delayedSaveTimer) return;

  delayedSaveTimer = setTimeout(() => {
    delayedSaveTimer = null;
    if (dirty) {
      try {
        saveNow();
      } catch (error) {
        console.error('Delayed database save:', error.message);
      }
    }
  }, delay);

  delayedSaveTimer.unref?.();
}

export function flushStore() {
  if (dirty) saveNow();
}

export const store = {
  getGroup(jid) {
    state.groups[jid] ||= groupDefaults();
    state.groups[jid] = { ...groupDefaults(), ...state.groups[jid] };
    return state.groups[jid];
  },

  updateGroup(jid, patch) {
    Object.assign(this.getGroup(jid), patch);
    saveNow();
    return this.getGroup(jid);
  },

  getGlobal(key, fallback = undefined) {
    return key in state.global ? state.global[key] : fallback;
  },

  setGlobal(key, value) {
    state.global[key] = value;
    saveNow();
    return value;
  },

  getApiKey(name) {
    return state.secrets.apiKeys[String(name).toLowerCase()] || '';
  },

  setApiKey(name, value) {
    state.secrets.apiKeys[String(name).toLowerCase()] = String(value);
    saveNow();
  },

  removeApiKey(name) {
    delete state.secrets.apiKeys[String(name).toLowerCase()];
    if (state.secrets.currentKey === String(name).toLowerCase()) state.secrets.currentKey = '';
    saveNow();
  },

  listApiKeys() {
    return Object.keys(state.secrets.apiKeys).sort();
  },

  setCurrentKey(name) {
    const key = String(name).toLowerCase();
    if (!state.secrets.apiKeys[key]) throw new Error(`No API key named "${key}" is stored.`);
    state.secrets.currentKey = key;
    saveNow();
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
    saveNow();
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

  // This runs for every incoming message. Do NOT synchronously rewrite the
  // entire JSON database on the command hot path.
  see(jid) {
    const now = Date.now();
    const previous = state.users[jid] || 0;
    state.users[jid] = now;

    // Persist presence/last-seen data in batches. Important settings/keys still
    // use saveNow() immediately.
    if (now - previous > 15000) scheduleSave();
  }
};

process.once('beforeExit', () => {
  try { flushStore(); } catch {}
});
process.once('SIGTERM', () => {
  try { flushStore(); } catch {}
});
process.once('SIGINT', () => {
  try { flushStore(); } catch {}
});
