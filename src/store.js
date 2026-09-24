import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const defaults = { users: {}, groups: {}, economy: {} };
const dbFile = path.join(config.dataDir, 'void-xmd.json');
let state = structuredClone(defaults);

export function loadStore() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  try { state = { ...defaults, ...JSON.parse(fs.readFileSync(dbFile, 'utf8')) }; }
  catch (error) { if (error.code !== 'ENOENT') console.error('Database recovery:', error.message); }
}

function save() {
  const tmp = `${dbFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, dbFile);
}

export const store = {
  getGroup(jid) {
    state.groups[jid] ||= { welcome: false, goodbye: false, antilink: false, antibadwords: false, warnings: {}, rules: '' };
    return state.groups[jid];
  },
  updateGroup(jid, patch) { Object.assign(this.getGroup(jid), patch); save(); },
  balance(jid) { state.economy[jid] ??= 100; return state.economy[jid]; },
  addCoins(jid, amount) { state.economy[jid] = this.balance(jid) + amount; save(); return state.economy[jid]; },
  stats() { return { users: Object.keys(state.users).length, groups: Object.keys(state.groups).length }; },
  see(jid) { state.users[jid] = Date.now(); save(); }
};
