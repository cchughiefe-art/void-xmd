import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { store } from '../store.js';
import { jidNumber } from '../utils.js';
import { askAi } from '../ai-provider.js';

const ua = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36 VOID-XMD/1.0';
const need = (value, usage) => {
  const text = String(value || '').trim();
  if (!text) throw new Error(usage);
  return text;
};
const trim = (value, max = 3500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const apiKey = name => store.getApiKey(name) || process.env[`${name.toUpperCase().replace(/-/g, '_')}_API_KEY`] || '';

async function request(url, options = {}, timeout = 20000) {
  const response = await fetch(url, {
    ...options,
    headers: { 'user-agent': ua, ...(options.headers || {}) },
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}${body ? `: ${trim(body, 250)}` : ''}`);
  }
  return response;
}

async function json(url, options = {}, timeout = 20000) {
  return (await request(url, options, timeout)).json();
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>|<\/h\d>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const isPrivateIp = ip => {
  if (net.isIP(ip) === 4) {
    return /^10\./.test(ip) ||
      /^127\./.test(ip) ||
      /^169\.254\./.test(ip) ||
      /^192\.168\./.test(ip) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
      ip === '0.0.0.0';
  }
  if (net.isIP(ip) === 6) {
    const value = ip.toLowerCase();
    return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
  }
  return false;
};

async function publicUrl(value) {
  const url = new URL(need(value, 'A URL is required.'));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP/HTTPS URLs are allowed.');
  if (['localhost', '0.0.0.0'].includes(url.hostname.toLowerCase())) throw new Error('Local/private targets are not allowed.');
  const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (addresses.some(x => isPrivateIp(x.address))) throw new Error('Local/private targets are not allowed.');
  return url;
}

function meta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return stripHtml(match[1]);
  }
  return '';
}

async function publicProfile(url) {
  const safe = await publicUrl(url);
  const html = await (await request(safe.href)).text();
  return {
    title: meta(html, 'og:title') || meta(html, 'twitter:title') || stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
    description: meta(html, 'og:description') || meta(html, 'description') || meta(html, 'twitter:description'),
    image: meta(html, 'og:image') || meta(html, 'twitter:image'),
    url: safe.href
  };
}

function boldText(input) {
  return [...String(input)].map(ch => {
    const cp = ch.codePointAt(0);
    if (cp >= 65 && cp <= 90) return String.fromCodePoint(0x1D400 + cp - 65);
    if (cp >= 97 && cp <= 122) return String.fromCodePoint(0x1D41A + cp - 97);
    if (cp >= 48 && cp <= 57) return String.fromCodePoint(0x1D7CE + cp - 48);
    return ch;
  }).join('');
}

function luhn(number) {
  const digits = String(number).replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt && (n *= 2) > 9) n -= 9;
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function fakeIdentity() {
  const first = ['Ari', 'Mika', 'Noah', 'Zuri', 'Kai', 'Lena', 'Tobi', 'Maya'];
  const last = ['Vale', 'Stone', 'Reed', 'Nova', 'Lane', 'Quill', 'West', 'Hart'];
  const pick = items => items[Math.floor(Math.random() * items.length)];
  const n = Math.floor(Math.random() * 9000) + 1000;
  return {
    name: `${pick(first)} ${pick(last)}`,
    email: `fictional${n}@example.invalid`,
    city: pick(['Northbridge', 'Lakeview', 'Westhaven', 'Riverside']),
    note: 'Fictional test profile — not a real identity or document.'
  };
}

async function aiText(prompt) {
  return askAi(prompt, {
    temperature: 0.2,
    maxTokens: 400,
    timeout: 45000
  });
}

async function football(pathname) {
  const key = apiKey('football');
  if (!key) throw new Error('Football API key missing. Use .addapikey football YOUR_FOOTBALL_DATA_KEY');
  return json(`https://api.football-data.org/v4${pathname}`, {
    headers: { 'X-Auth-Token': key }
  });
}

const fmtMatch = m => {
  const home = m.homeTeam?.name || '?';
  const away = m.awayTeam?.name || '?';
  const score = m.score?.fullTime;
  const result = score && (score.home != null || score.away != null) ? ` ${score.home ?? '-'}-${score.away ?? '-'}` : '';
  return `${m.id}: ${home} vs ${away}${result} • ${m.status || ''} • ${m.utcDate || ''}`;
};

async function coin(query) {
  const search = await json(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
  const found = search.coins?.[0];
  if (!found) throw new Error(`No crypto found for "${query}".`);
  return found;
}

async function github(pathname, options = {}) {
  const token = apiKey('github') || process.env.GITHUB_TOKEN || '';
  if (!token) throw new Error('GitHub token missing. Prefer GITHUB_TOKEN on the server, or use .addapikey github TOKEN.');
  return json(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(options.headers || {})
    }
  }, 30000);
}

async function githubRaw(pathname, options = {}) {
  const token = apiKey('github') || process.env.GITHUB_TOKEN || '';
  if (!token) throw new Error('GitHub token missing.');
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`GitHub ${response.status}: ${trim(body, 400)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

const currentRepo = () => {
  const value = store.getGlobal('githubRepo', '');
  if (!value || !/^[\w.-]+\/[\w.-]+$/.test(value)) throw new Error('Set a default repository first: .setgithub owner/repo');
  return value;
};

async function upsertGitHubFile(repo, filePath, content, message) {
  let sha;
  try {
    const current = await github(`/repos/${repo}/contents/${encodeURI(filePath)}`);
    sha = current.sha;
  } catch (error) {
    if (!String(error.message).includes('404')) throw error;
  }
  return github(`/repos/${repo}/contents/${encodeURI(filePath)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString('base64'),
      ...(sha ? { sha } : {})
    })
  });
}

function panelDomain() {
  const raw = store.getGlobal('panelDomain', process.env.PANEL_URL || '');
  if (!raw) throw new Error('Panel domain missing. Use .setdomain https://panel.example.com');
  return raw.replace(/\/$/, '');
}

async function panelApplication(pathname, options = {}) {
  const key = apiKey('panel') || process.env.PANEL_API_KEY || '';
  if (!key) throw new Error('Panel application API key missing. Use .addapikey panel KEY');
  return json(`${panelDomain()}/api/application${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${key}`,
      accept: 'Application/vnd.pterodactyl.v1+json',
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  }, 30000);
}

async function panelApplicationRaw(pathname, options = {}) {
  const key = apiKey('panel') || process.env.PANEL_API_KEY || '';
  if (!key) throw new Error('Panel application API key missing.');
  const response = await fetch(`${panelDomain()}/api/application${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${key}`,
      accept: 'Application/vnd.pterodactyl.v1+json',
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Panel returned ${response.status}: ${trim(await response.text(), 400)}`);
  if (response.status === 204) return null;
  return response.json();
}

async function panelClient(pathname, options = {}) {
  const key = apiKey('panel-client') || process.env.PANEL_CLIENT_API_KEY || '';
  if (!key) throw new Error('Panel client API key missing. Use .addapikey panel-client KEY');
  const response = await fetch(`${panelDomain()}/api/client${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${key}`,
      accept: 'Application/vnd.pterodactyl.v1+json',
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Panel returned ${response.status}: ${trim(await response.text(), 400)}`);
  if (response.status === 204) return {};
  return response.json();
}

async function scanPort(host, port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port: Number(port) });
    const done = open => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(900);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

const stalkCommand = (name, buildUrl) => ({
  name,
  category: 'PUBLIC PROFILE',
  description: `Show public profile metadata for ${name.replace('stalk', '')}`,
  async run({ text, reply, sock, chat, raw }) {
    const value = need(text, `Usage: .${name} <username or profile URL>`);
    const target = /^https?:\/\//i.test(value) ? value : buildUrl(value.replace(/^@/, ''));
    const info = await publicProfile(target);
    const message = `*${info.title || name}*\n${info.description || 'No public description found.'}\n${info.url}`;
    if (info.image) {
      await sock.sendMessage(chat, { image: { url: info.image }, caption: message }, { quoted: raw }).catch(() => reply(message));
    } else {
      await reply(message);
    }
  }
});

const sports = [
  {
    name: 'livescores',
    category: 'SPORTS',
    description: 'Show live football matches',
    async run({ reply }) {
      const data = await football('/matches?status=LIVE');
      const rows = (data.matches || []).slice(0, 20).map(fmtMatch);
      await reply(rows.length ? `*Live matches*\n${rows.join('\n')}` : 'No live matches returned by the provider.');
    }
  },
  {
    name: 'sureodds',
    category: 'SPORTS',
    description: 'Show provider-supplied football odds when available',
    async run({ reply }) {
      const data = await football('/matches?status=SCHEDULED');
      const rows = (data.matches || []).filter(m => m.odds && Object.values(m.odds).some(v => v != null)).slice(0, 15);
      if (!rows.length) return reply('The football provider returned no odds for upcoming matches. This command does not generate betting predictions.');
      await reply(rows.map(m => `${fmtMatch(m)}\nOdds: ${JSON.stringify(m.odds)}`).join('\n\n'));
    }
  },
  {
    name: 'competitions',
    category: 'SPORTS',
    description: 'List football competitions',
    async run({ reply }) {
      const data = await football('/competitions');
      await reply((data.competitions || []).slice(0, 30).map(c => `${c.code || c.id}: ${c.name} (${c.area?.name || ''})`).join('\n'));
    }
  },
  {
    name: 'matches',
    category: 'SPORTS',
    description: 'List football matches, optionally for a competition code',
    async run({ text, reply }) {
      const code = String(text || '').trim().toUpperCase();
      const data = await football(code ? `/competitions/${encodeURIComponent(code)}/matches` : '/matches');
      await reply((data.matches || []).slice(0, 25).map(fmtMatch).join('\n') || 'No matches found.');
    }
  },
  {
    name: 'standings',
    category: 'SPORTS',
    description: 'Show standings for a competition code',
    async run({ text, reply }) {
      const code = need(text, 'Usage: .standings PL').toUpperCase();
      const data = await football(`/competitions/${encodeURIComponent(code)}/standings`);
      const table = data.standings?.find(x => x.type === 'TOTAL')?.table || data.standings?.[0]?.table || [];
      await reply(table.slice(0, 25).map(x => `${x.position}. ${x.team?.name} • P${x.playedGames} W${x.won} D${x.draw} L${x.lost} • ${x.points}pts`).join('\n') || 'No standings found.');
    }
  },
  {
    name: 'team',
    category: 'SPORTS',
    description: 'Show a football team by numeric ID',
    async run({ text, reply }) {
      const id = need(text, 'Usage: .team TEAM_ID');
      const t = await football(`/teams/${encodeURIComponent(id)}`);
      await reply(`*${t.name}*\nShort name: ${t.shortName || '-'}\nFounded: ${t.founded || '-'}\nVenue: ${t.venue || '-'}\nWebsite: ${t.website || '-'}`);
    }
  },
  {
    name: 'areas',
    category: 'SPORTS',
    description: 'List football areas/countries',
    async run({ reply }) {
      const data = await football('/areas');
      await reply((data.areas || []).slice(0, 60).map(a => `${a.id}: ${a.name}`).join('\n'));
    }
  },
  {
    name: 'teammatches',
    category: 'SPORTS',
    description: 'List matches for a football team ID',
    async run({ text, reply }) {
      const id = need(text, 'Usage: .teammatches TEAM_ID');
      const data = await football(`/teams/${encodeURIComponent(id)}/matches?limit=20`);
      await reply((data.matches || []).map(fmtMatch).join('\n') || 'No matches found.');
    }
  },
  {
    name: 'person',
    category: 'SPORTS',
    description: 'Show football person/player details by ID',
    async run({ text, reply }) {
      const id = need(text, 'Usage: .person PERSON_ID');
      const p = await football(`/persons/${encodeURIComponent(id)}`);
      await reply(`*${p.name || 'Person'}*\nDOB: ${p.dateOfBirth || '-'}\nNationality: ${p.nationality || '-'}\nPosition: ${p.position || '-'}\nTeam: ${p.currentTeam?.name || '-'}`);
    }
  },
  {
    name: 'matchlist',
    category: 'SPORTS',
    description: 'List matches for a date: YYYY-MM-DD',
    async run({ text, reply }) {
      const date = need(text, 'Usage: .matchlist YYYY-MM-DD');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use YYYY-MM-DD.');
      const data = await football(`/matches?dateFrom=${date}&dateTo=${date}`);
      await reply((data.matches || []).slice(0, 30).map(fmtMatch).join('\n') || 'No matches found.');
    }
  },
  {
    name: 'head2head',
    category: 'SPORTS',
    description: 'Show head-to-head history for a match ID',
    async run({ text, reply }) {
      const id = need(text, 'Usage: .head2head MATCH_ID');
      const data = await football(`/matches/${encodeURIComponent(id)}/head2head?limit=10`);
      await reply((data.matches || []).map(fmtMatch).join('\n') || 'No head-to-head data found.');
    }
  },
  {
    name: 'teamlist',
    category: 'SPORTS',
    description: 'List teams in a competition',
    async run({ text, reply }) {
      const code = need(text, 'Usage: .teamlist PL').toUpperCase();
      const data = await football(`/competitions/${encodeURIComponent(code)}/teams`);
      await reply((data.teams || []).slice(0, 50).map(t => `${t.id}: ${t.name}`).join('\n') || 'No teams found.');
    }
  }
];

const githubCommands = [
  {
    name: 'ghlogin', category: 'GITHUB', ownerOnly: true, description: 'Check the configured GitHub token',
    async run({ reply }) {
      const me = await github('/user');
      await reply(`GitHub authenticated as @${me.login}`);
    }
  },
  {
    name: 'setgithub', category: 'GITHUB', ownerOnly: true, description: 'Set default GitHub repo: owner/repo',
    async run({ text, reply }) {
      const repo = need(text, 'Usage: .setgithub owner/repo');
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Use owner/repo.');
      const info = await github(`/repos/${repo}`);
      store.setGlobal('githubRepo', info.full_name);
      await reply(`Default GitHub repo: ${info.full_name}`);
    }
  },
  {
    name: 'ghcreate', category: 'GITHUB', ownerOnly: true, description: 'Create a GitHub repository',
    async run({ text, reply }) {
      const [name, visibility = 'private'] = need(text, 'Usage: .ghcreate repo-name | private|public').split('|').map(x => x.trim());
      const data = await github('/user/repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, private: visibility.toLowerCase() !== 'public', auto_init: true })
      });
      await reply(`Created ${data.full_name}\n${data.html_url}`);
    }
  },
  {
    name: 'ghpush', category: 'GITHUB', ownerOnly: true, description: 'Create/update one text file: path | content | message',
    async run({ text, reply }) {
      const [filePath, content, message = 'Update from VOID XMD'] = String(text || '').split('|').map(x => x.trim());
      if (!filePath || content == null) throw new Error('Usage: .ghpush path/file.txt | file content | commit message');
      const repo = currentRepo();
      const result = await upsertGitHubFile(repo, filePath, content, message);
      await reply(`Pushed ${filePath}\nCommit: ${result.commit?.sha || 'created'}`);
    }
  },
  {
    name: 'ghpushall', category: 'GITHUB', ownerOnly: true, description: 'Push safe project source files to the default repo',
    async run({ args, reply }) {
      if (String(args[0] || '').toUpperCase() !== 'CONFIRM') throw new Error('Use .ghpushall CONFIRM');
      const repo = currentRepo();
      const root = process.cwd();
      const allowedTop = new Set(['package.json', 'README.md', 'Dockerfile', '.gitignore', '.env.example']);
      const files = [];
      const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (['node_modules', '.git', 'data', 'downloads'].includes(entry.name)) continue;
          const full = path.join(dir, entry.name);
          const rel = path.relative(root, full).replace(/\\/g, '/');
          if (entry.isDirectory()) {
            if (rel === 'src' || rel.startsWith('src/')) walk(full);
          } else if (allowedTop.has(rel) || rel.startsWith('src/')) {
            files.push(rel);
          }
        }
      };
      walk(root);
      let count = 0;
      for (const file of files) {
        const content = fs.readFileSync(path.join(root, file), 'utf8');
        await upsertGitHubFile(repo, file, content, `Sync ${file} from VOID XMD`);
        count++;
      }
      await reply(`Pushed ${count} source file(s) to ${repo}. Secrets/data/node_modules were excluded.`);
    }
  },
  {
    name: 'ghdelete', category: 'GITHUB', ownerOnly: true, description: 'Delete a GitHub repository with confirmation',
    async run({ text, reply }) {
      const [repoRaw, confirm] = String(text || '').split(/\s+/);
      const repo = repoRaw || currentRepo();
      if (String(confirm || '').toUpperCase() !== 'CONFIRM') throw new Error(`Use .ghdelete ${repo} CONFIRM`);
      await githubRaw(`/repos/${repo}`, { method: 'DELETE' });
      await reply(`Deleted ${repo}.`);
    }
  },
  {
    name: 'ghlist', category: 'GITHUB', ownerOnly: true, description: 'List authenticated GitHub repositories',
    async run({ reply }) {
      const data = await github('/user/repos?per_page=30&sort=updated');
      await reply(data.map(r => `${r.full_name} • ${r.private ? 'private' : 'public'}`).join('\n') || 'No repositories found.');
    }
  },
  {
    name: 'ghbranches', category: 'GITHUB', ownerOnly: true, description: 'List branches in the default repository',
    async run({ reply }) {
      const repo = currentRepo();
      const data = await github(`/repos/${repo}/branches?per_page=100`);
      await reply(data.map(b => b.name).join('\n') || 'No branches found.');
    }
  },
  {
    name: 'ghdeletefile', category: 'GITHUB', ownerOnly: true, description: 'Delete a file from the default repository',
    async run({ text, reply }) {
      const [filePath, confirm] = String(text || '').split('|').map(x => x.trim());
      if (!filePath || String(confirm).toUpperCase() !== 'CONFIRM') throw new Error('Usage: .ghdeletefile path/file | CONFIRM');
      const repo = currentRepo();
      const current = await github(`/repos/${repo}/contents/${encodeURI(filePath)}`);
      await github(`/repos/${repo}/contents/${encodeURI(filePath)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: `Delete ${filePath} via VOID XMD`, sha: current.sha })
      });
      await reply(`Deleted ${filePath}.`);
    }
  },
  {
    name: 'ghcommit', category: 'GITHUB', ownerOnly: true, description: 'Create an empty commit on the default branch',
    async run({ text, reply }) {
      const message = need(text, 'Usage: .ghcommit commit message');
      const repo = currentRepo();
      const info = await github(`/repos/${repo}`);
      const branch = info.default_branch;
      const ref = await github(`/repos/${repo}/git/ref/heads/${branch}`);
      const parent = await github(`/repos/${repo}/git/commits/${ref.object.sha}`);
      const commit = await github(`/repos/${repo}/git/commits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, tree: parent.tree.sha, parents: [ref.object.sha] })
      });
      await github(`/repos/${repo}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sha: commit.sha, force: false })
      });
      await reply(`Commit created: ${commit.sha}`);
    }
  },
  {
    name: 'ghcreatebranch', category: 'GITHUB', ownerOnly: true, description: 'Create a branch in the default repository',
    async run({ text, reply }) {
      const name = need(text, 'Usage: .ghcreatebranch branch-name');
      const repo = currentRepo();
      const info = await github(`/repos/${repo}`);
      const ref = await github(`/repos/${repo}/git/ref/heads/${info.default_branch}`);
      await github(`/repos/${repo}/git/refs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${name}`, sha: ref.object.sha })
      });
      await reply(`Branch created: ${name}`);
    }
  },
  {
    name: 'ghfork', category: 'GITHUB', ownerOnly: true, description: 'Fork a GitHub repository',
    async run({ text, reply }) {
      const repo = need(text, 'Usage: .ghfork owner/repo');
      const data = await github(`/repos/${repo}/forks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      await reply(`Fork requested: ${data.full_name || repo}`);
    }
  },
  {
    name: 'ghlogout', category: 'GITHUB', ownerOnly: true, description: 'Remove a GitHub token stored by the bot',
    async run({ reply }) {
      store.removeApiKey('github');
      await reply(process.env.GITHUB_TOKEN ? 'Stored GitHub key removed. GITHUB_TOKEN environment variable is still active.' : 'GitHub key removed.');
    }
  }
];

const panelCommands = [
  {
    name: 'setdomain', category: 'PANEL', ownerOnly: true, description: 'Set Pterodactyl panel domain',
    async run({ text, reply }) {
      const url = await publicUrl(need(text, 'Usage: .setdomain https://panel.example.com'));
      store.setGlobal('panelDomain', url.origin);
      await reply(`Panel domain set to ${url.origin}`);
    }
  },
  {
    name: 'getdomain', category: 'PANEL', ownerOnly: true, description: 'Show configured panel domain',
    run: ({ reply }) => reply(store.getGlobal('panelDomain', process.env.PANEL_URL || 'No panel domain configured.'))
  },
  {
    name: 'addapikey', category: 'SETTINGS', ownerOnly: true, description: 'Store a named API key in persistent bot data and try to delete the WhatsApp message containing the secret',
    async run({ args, text, sock, chat, raw }) {
      const name = String(args[0] || '').toLowerCase();
      const value = text.slice((args[0] || '').length).trim();
      if (!name || !value) throw new Error('Usage: .addapikey name secret-value');

      store.setApiKey(name, value);

      // Best effort: remove the command containing the secret from WhatsApp.
      // This succeeds most reliably when the command was sent by the linked bot account.
      await sock.sendMessage(chat, { delete: raw.key }).catch(() => {});

      await sock.sendMessage(chat, {
        text: `API key "${name}" stored. The secret value will not be displayed.`
      }).catch(() => {});
    }
  },
  {
    name: 'removeapikey', category: 'SETTINGS', ownerOnly: true, description: 'Remove a stored API key',
    async run({ text, reply }) {
      const name = need(text, 'Usage: .removeapikey name').toLowerCase();
      store.removeApiKey(name);
      await reply(`Removed API key "${name}".`);
    }
  },
  {
    name: 'listapikeys', category: 'SETTINGS', ownerOnly: true, description: 'List stored API key names without exposing values',
    run: ({ reply }) => {
      const keys = store.listApiKeys();
      return reply(keys.length ? keys.join('\n') : 'No API keys stored.');
    }
  },
  {
    name: 'setcurrentkey', category: 'SETTINGS', ownerOnly: true, description: 'Select the current named API key',
    async run({ text, reply }) {
      const name = store.setCurrentKey(need(text, 'Usage: .setcurrentkey name'));
      await reply(`Current API key: ${name}`);
    }
  },
  ...Array.from({ length: 10 }, (_, i) => {
    const gb = i + 1;
    return {
      name: `ct${gb}gb3`,
      category: 'PANEL',
      ownerOnly: true,
      description: `Create a ${gb} GB Pterodactyl server`,
      async run({ text, reply }) {
        const parts = String(text || '').split('|').map(x => x.trim());
        const name = parts[0];
        const user = Number(parts[1] || process.env.PANEL_USER_ID);
        const egg = Number(parts[2] || process.env.PANEL_EGG_ID);
        const location = Number(parts[3] || process.env.PANEL_LOCATION_ID);
        const image = parts[4] || process.env.PANEL_DOCKER_IMAGE;
        const startup = parts[5] || process.env.PANEL_STARTUP;
        const environment = parts[6] ? JSON.parse(parts[6]) : {};
        if (!name || !user || !egg || !location || !image || !startup) {
          throw new Error(`Usage: .ct${gb}gb3 name | userId | eggId | locationId | dockerImage | startup | {"ENV":"value"}\nYou may put IDs/image/startup in PANEL_* environment variables.`);
        }
        const data = await panelApplication('/servers', {
          method: 'POST',
          body: JSON.stringify({
            name,
            user,
            egg,
            docker_image: image,
            startup,
            environment,
            limits: { memory: gb * 1024, swap: 0, disk: Math.max(10240, gb * 5120), io: 500, cpu: 100 },
            feature_limits: { databases: 1, backups: 1, allocations: 1 },
            deploy: { locations: [location], dedicated_ip: false, port_range: [] }
          })
        });
        await reply(`Server created: ${data.attributes?.name || name}\nID: ${data.attributes?.id}\nUUID: ${data.attributes?.uuid}`);
      }
    };
  }),
  {
    name: 'listpanels', category: 'PANEL', ownerOnly: true, description: 'List servers on the configured Pterodactyl panel',
    async run({ reply }) {
      const data = await panelApplication('/servers?per_page=50');
      await reply((data.data || []).map(x => `${x.attributes.id}: ${x.attributes.name} • ${x.attributes.uuid}`).join('\n') || 'No servers found.');
    }
  },
  {
    name: 'panelinfo', category: 'PANEL', ownerOnly: true, description: 'Show Pterodactyl server information',
    async run({ text, reply }) {
      const id = need(text, 'Usage: .panelinfo SERVER_ID');
      const data = await panelApplication(`/servers/${encodeURIComponent(id)}`);
      const a = data.attributes;
      await reply(`*${a.name}*\nID: ${a.id}\nUUID: ${a.uuid}\nMemory: ${a.limits?.memory} MB\nDisk: ${a.limits?.disk} MB\nSuspended: ${a.suspended}`);
    }
  },
  {
    name: 'deletepanel', category: 'PANEL', ownerOnly: true, description: 'Delete a Pterodactyl server with confirmation',
    async run({ args, reply }) {
      const id = args[0];
      if (!id || String(args[1] || '').toUpperCase() !== 'CONFIRM') throw new Error('Usage: .deletepanel SERVER_ID CONFIRM');
      await panelApplicationRaw(`/servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await reply(`Deleted server ${id}.`);
    }
  },
  {
    name: 'restartpanel', category: 'PANEL', ownerOnly: true, description: 'Restart a Pterodactyl server by client identifier',
    async run({ text, reply }) {
      const id = need(text, 'Usage: .restartpanel SERVER_IDENTIFIER');
      await panelClient(`/servers/${encodeURIComponent(id)}/power`, {
        method: 'POST',
        body: JSON.stringify({ signal: 'restart' })
      });
      await reply(`Restart signal sent to ${id}.`);
    }
  },
  {
    name: 'panelstats', category: 'PANEL', ownerOnly: true, description: 'Show live Pterodactyl server resource usage',
    async run({ text, reply }) {
      const id = need(text, 'Usage: .panelstats SERVER_IDENTIFIER');
      const data = await panelClient(`/servers/${encodeURIComponent(id)}/resources`);
      const a = data.attributes || {};
      const r = a.resources || {};
      await reply(`State: ${a.current_state || '-'}\nCPU: ${r.cpu_absolute ?? '-'}%\nMemory: ${Math.round((r.memory_bytes || 0) / 1048576)} MB\nDisk: ${Math.round((r.disk_bytes || 0) / 1048576)} MB\nNetwork RX/TX: ${r.network_rx_bytes || 0}/${r.network_tx_bytes || 0}`);
    }
  }
];

export default [
  {
    name: 'tts',
    category: 'TOOLS',
    description: 'Convert text to speech: .tts [lang] text',
    async run({ args, text, sock, chat, raw }) {
      let lang = 'en';
      let content = String(text || '').trim();
      if (/^[a-z]{2,5}(?:-[a-z]{2})?$/i.test(args[0] || '') && args.length > 1) {
        lang = args[0];
        content = args.slice(1).join(' ');
      }
      content = need(content, 'Usage: .tts [lang] text').slice(0, 200);
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(content)}`;
      const audio = Buffer.from(await (await request(url)).arrayBuffer());
      await sock.sendMessage(chat, { audio, mimetype: 'audio/mpeg', ptt: true }, { quoted: raw });
    }
  },
  {
    name: 'shazam',
    category: 'TOOLS',
    description: 'Recognize a replied audio/video using AudD',
    async run({ downloadMedia, reply }) {
      const key = apiKey('audd') || process.env.AUDD_API_TOKEN || '';
      if (!key) throw new Error('AudD token missing. Use .addapikey audd TOKEN or AUDD_API_TOKEN.');
      const media = await downloadMedia();
      const form = new FormData();
      form.append('api_token', key);
      form.append('file', new Blob([media]), 'audio.bin');
      form.append('return', 'apple_music,spotify');
      const data = await json('https://api.audd.io/', { method: 'POST', body: form }, 45000);
      if (!data.result) return reply('No song recognized.');
      const r = data.result;
      await reply(`🎵 *${r.title || 'Unknown'}*\nArtist: ${r.artist || '-'}\nAlbum: ${r.album || '-'}\nRelease: ${r.release_date || '-'}\n${r.song_link || r.spotify?.external_urls?.spotify || ''}`);
    }
  },
  {
    name: 'catholic',
    category: 'TOOLS',
    description: 'Fetch Catholic Mass readings for today or YYYY-MM-DD',
    async run({ text, reply }) {
      const date = text ? new Date(text) : new Date();
      if (Number.isNaN(date.getTime())) throw new Error('Usage: .catholic YYYY-MM-DD');
      const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(date.getUTCDate()).padStart(2, '0');
      const yy = String(date.getUTCFullYear()).slice(-2);
      const url = `https://bible.usccb.org/bible/readings/${mm}${dd}${yy}.cfm`;
      const html = await (await request(url)).text();
      const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html;
      await reply(`*Catholic readings — ${date.toISOString().slice(0, 10)}*\n${stripHtml(main).slice(0, 6000)}\n\n${url}`);
    }
  },
  {
    name: 'ngl',
    category: 'TOOLS',
    description: 'Generate an NGL profile link',
    run: ({ text, reply }) => {
      const user = need(text, 'Usage: .ngl username').replace(/^@/, '').replace(/[^\w.-]/g, '');
      return reply(`https://ngl.link/${user}`);
    }
  },
  {
    name: 'get',
    aliases: ['fetch'],
    category: 'TOOLS',
    description: 'Fetch a public URL and show a bounded text response',
    async run({ text, reply }) {
      const url = await publicUrl(text);
      const response = await request(url.href, { headers: { accept: 'text/plain,text/html,application/json;q=0.9,*/*;q=0.5' } });
      const body = (await response.text()).slice(0, 3500);
      await reply(`HTTP ${response.status}\nContent-Type: ${response.headers.get('content-type') || '-'}\n\n${stripHtml(body)}`);
    }
  },
  {
    name: 'styletext',
    category: 'TOOLS',
    description: 'Convert text to mathematical bold Unicode',
    run: ({ text, reply }) => reply(boldText(need(text, 'Usage: .styletext text')))
  },
  {
    name: 'languages',
    category: 'TOOLS',
    description: 'Show common TTS/translation language codes',
    run: ({ reply }) => reply('en English\nfr French\nes Spanish\nde German\nit Italian\npt Portuguese\nar Arabic\nhi Hindi\nyo Yoruba\nig Igbo\nha Hausa\nsw Swahili\nzh-CN Chinese\nja Japanese\nko Korean')
  },
  {
    name: 'readmore',
    category: 'TOOLS',
    description: 'Create a WhatsApp read-more message: visible | hidden',
    run: ({ text, reply }) => {
      const [visible, hidden] = String(text || '').split('|');
      if (!visible || hidden == null) throw new Error('Usage: .readmore visible text | hidden text');
      return reply(`${visible.trim()}${'\u200e'.repeat(4000)}\n${hidden.trim()}`);
    }
  },
  {
    name: 'ss',
    category: 'TOOLS',
    description: 'Take a public webpage screenshot',
    async run({ text, sock, chat, raw }) {
      const url = await publicUrl(text);
      const shot = `https://image.thum.io/get/fullpage/${url.href}`;
      await sock.sendMessage(chat, { image: { url: shot }, caption: url.href }, { quoted: raw });
    }
  },
  {
    name: 'imdb',
    category: 'TOOLS',
    description: 'Search IMDb titles',
    async run({ text, reply }) {
      const q = need(text, 'Usage: .imdb movie title');
      const key = encodeURIComponent(q[0].toLowerCase());
      const data = await json(`https://v2.sg.media-imdb.com/suggestion/${key}/${encodeURIComponent(q)}.json`);
      const rows = (data.d || []).slice(0, 8).map(x => `${x.id}: ${x.l || x.name} ${x.y ? `(${x.y})` : ''} ${x.s ? `• ${x.s}` : ''}`);
      await reply(rows.join('\n') || 'No IMDb results found.');
    }
  },
  {
    name: 'bin',
    category: 'TOOLS',
    description: 'Look up public BIN/IIN metadata',
    async run({ text, reply }) {
      const digits = need(text, 'Usage: .bin 539983').replace(/\D/g, '').slice(0, 8);
      if (digits.length < 6) throw new Error('Enter the first 6-8 digits only.');
      const data = await json(`https://lookup.binlist.net/${digits}`, { headers: { accept: 'application/json' } });
      await reply(`Scheme: ${data.scheme || '-'}\nType: ${data.type || '-'}\nBrand: ${data.brand || '-'}\nBank: ${data.bank?.name || '-'}\nCountry: ${data.country?.name || '-'}`);
    }
  },
  {
    name: 'fakeid',
    category: 'TOOLS',
    description: 'Generate a clearly fictional test profile',
    run: ({ reply }) => {
      const x = fakeIdentity();
      return reply(`*FICTIONAL TEST PROFILE*\nName: ${x.name}\nEmail: ${x.email}\nCity: ${x.city}\n${x.note}`);
    }
  },
  {
    name: 'cc',
    category: 'TOOLS',
    description: 'Validate a card number with the Luhn checksum (does not generate cards)',
    run: ({ text, reply }) => {
      const digits = need(text, 'Usage: .cc CARD_NUMBER').replace(/\D/g, '');
      const masked = digits.length > 4 ? `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : '****';
      return reply(`${masked}: ${luhn(digits) ? 'valid Luhn checksum' : 'invalid Luhn checksum'}`);
    }
  },
  {
    name: 'emojimix',
    category: 'TOOLS',
    description: 'Mix two emojis with Emoji Kitchen',
    async run({ args, reply, sock, chat, raw }) {
      if (args.length < 2) throw new Error('Usage: .emojimix 😀 🔥');
      const response = await request('https://emoji-mix.vercel.app/api/findValidEmojiCombo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leftEmoji: args[0], rightEmoji: args[1] })
      });
      const data = await response.json();
      const url = typeof data === 'string' ? data : data.url || data.image;
      if (!url) throw new Error('That emoji pair is not available.');
      await sock.sendMessage(chat, { image: { url }, caption: `${args[0]} + ${args[1]}` }, { quoted: raw });
    }
  },
  stalkCommand('pinstalk', u => `https://www.pinterest.com/${encodeURIComponent(u)}/`),
  stalkCommand('scloudstalk', u => `https://soundcloud.com/${encodeURIComponent(u)}`),
  stalkCommand('igstalk', u => `https://www.instagram.com/${encodeURIComponent(u)}/`),
  stalkCommand('tiktokstalk', u => `https://www.tiktok.com/@${encodeURIComponent(u)}`),
  stalkCommand('xstalk', u => `https://x.com/${encodeURIComponent(u)}`),
  stalkCommand('ytstalk', u => `https://www.youtube.com/@${encodeURIComponent(u)}`),
  stalkCommand('tgstalk', u => `https://t.me/${encodeURIComponent(u)}`),
  {
    name: 'robloxstalk',
    category: 'PUBLIC PROFILE',
    description: 'Look up a public Roblox user',
    async run({ text, reply }) {
      const username = need(text, 'Usage: .robloxstalk username');
      const lookup = await json('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
      });
      const user = lookup.data?.[0];
      if (!user) throw new Error('Roblox user not found.');
      const info = await json(`https://users.roblox.com/v1/users/${user.id}`);
      await reply(`*${info.displayName} (@${info.name})*\nID: ${info.id}\nCreated: ${info.created}\nBanned: ${info.isBanned}\n${info.description || 'No description.'}`);
    }
  },
  {
    name: 'gitstalk',
    category: 'PUBLIC PROFILE',
    description: 'Look up a public GitHub user',
    async run({ text, reply }) {
      const user = need(text, 'Usage: .gitstalk username').replace(/^@/, '');
      const x = await json(`https://api.github.com/users/${encodeURIComponent(user)}`);
      await reply(`*${x.name || x.login} (@${x.login})*\nRepos: ${x.public_repos}\nFollowers: ${x.followers}\nFollowing: ${x.following}\nCreated: ${x.created_at}\n${x.bio || ''}\n${x.html_url}`);
    }
  },
  {
    name: 'npmstalk',
    category: 'PUBLIC PROFILE',
    description: 'Look up an npm package',
    async run({ text, reply }) {
      const pkg = need(text, 'Usage: .npmstalk package-name');
      const x = await json(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`);
      await reply(`*${x.name}@${x.version}*\n${x.description || ''}\nLicense: ${x.license || '-'}\nHomepage: ${x.homepage || '-'}\nRepository: ${x.repository?.url || '-'}`);
    }
  },
  {
    name: 'wastalk',
    category: 'PUBLIC PROFILE',
    description: 'Show WhatsApp profile information available to the linked account',
    async run({ text, mentions, quoted, sender, sock, reply }) {
      const raw = mentions?.[0] || quoted?.participant || (String(text || '').replace(/\D/g, '') ? `${String(text).replace(/\D/g, '')}@s.whatsapp.net` : sender);
      const exists = await sock.onWhatsApp(jidNumber(raw)).catch(() => []);
      if (!exists?.length) return reply('That number is not visible as a WhatsApp account.');
      const jid = exists[0].jid;
      const status = await sock.fetchStatus(jid).catch(() => null);
      const pp = await sock.profilePictureUrl(jid, 'image').catch(() => null);
      await reply(`JID: ${jid}\nStatus: ${status?.status || 'Unavailable'}\nProfile picture: ${pp || 'Unavailable'}`);
    }
  },
  {
    name: 'minecraft',
    category: 'PUBLIC PROFILE',
    description: 'Look up a Minecraft Java username',
    async run({ text, reply }) {
      const name = need(text, 'Usage: .minecraft username');
      const x = await json(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
      await reply(`Minecraft: ${x.name}\nUUID: ${x.id}`);
    }
  },
  {
    name: 'xbox',
    category: 'PUBLIC PROFILE',
    description: 'Look up an Xbox gamertag using OpenXBL',
    async run({ text, reply }) {
      const key = apiKey('xbox') || process.env.XBOX_API_KEY || '';
      if (!key) throw new Error('Xbox API key missing. Use .addapikey xbox OPENXBL_KEY');
      const tag = need(text, 'Usage: .xbox gamertag');
      const x = await json(`https://xbl.io/api/v2/search/${encodeURIComponent(tag)}`, {
        headers: { 'X-Authorization': key }
      });
      await reply(trim(JSON.stringify(x, null, 2), 3500));
    }
  },
  {
    name: 'steam',
    category: 'PUBLIC PROFILE',
    description: 'Look up a Steam user',
    async run({ text, reply }) {
      const key = apiKey('steam') || process.env.STEAM_API_KEY || '';
      if (!key) throw new Error('Steam API key missing. Use .addapikey steam STEAM_WEB_API_KEY');
      let id = need(text, 'Usage: .steam steamid64-or-vanity');
      if (!/^\d{17}$/.test(id)) {
        const r = await json(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(key)}&vanityurl=${encodeURIComponent(id)}`);
        id = r.response?.steamid;
        if (!id) throw new Error('Steam user not found.');
      }
      const r = await json(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${id}`);
      const p = r.response?.players?.[0];
      if (!p) throw new Error('Steam user not found.');
      await reply(`*${p.personaname}*\nSteamID: ${p.steamid}\nState: ${p.personastate}\nCountry: ${p.loccountrycode || '-'}\n${p.profileurl}`);
    }
  },
  {
    name: 'ai-detect',
    category: 'TOOLS',
    description: 'Give a rough, non-definitive AI-writing heuristic',
    async run({ text, reply }) {
      const input = need(text, 'Usage: .ai-detect text');
      const sentences = input.split(/[.!?]+/).map(x => x.trim()).filter(Boolean);
      const lengths = sentences.map(x => x.split(/\s+/).length);
      const avg = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
      const variance = lengths.reduce((a, n) => a + (n - avg) ** 2, 0) / Math.max(1, lengths.length);
      const markers = (input.match(/\b(?:furthermore|moreover|in conclusion|it is important to note|delve|comprehensive)\b/gi) || []).length;
      const score = Math.max(0, Math.min(100, Math.round(45 + markers * 8 - Math.min(20, variance / 3))));
      await reply(`AI-writing heuristic: ${score}%\nThis is only a style heuristic and cannot reliably determine who or what wrote the text.`);
    }
  },
  {
    name: 'nsfwcheck',
    category: 'TOOLS',
    description: 'Check text for common explicit-content indicators',
    run: ({ text, reply }) => {
      const input = need(text, 'Usage: .nsfwcheck text');
      const pattern = /\b(?:porn|porno|xxx|nudes?|hentai|explicit sex|onlyfans)\b/gi;
      const found = [...new Set(input.match(pattern) || [])];
      return reply(found.length ? `Possible explicit-content indicators: ${found.join(', ')}` : 'No common explicit-content indicators found in the supplied text.');
    }
  },
  {
    name: 'subdomain',
    category: 'NETWORK',
    description: 'Passively list certificate-transparency subdomains',
    async run({ text, reply }) {
      const domain = need(text, 'Usage: .subdomain example.com').replace(/^https?:\/\//, '').split('/')[0];
      const rows = await json(`https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`, {}, 30000);
      const names = [...new Set(rows.flatMap(x => String(x.name_value || '').split('\n')).map(x => x.replace(/^\*\./, '')).filter(x => x.endsWith(domain)))].sort();
      await reply(names.slice(0, 100).join('\n') || 'No certificate-transparency subdomains found.');
    }
  },
  {
    name: 'yt-monetize',
    category: 'PUBLIC PROFILE',
    description: 'Show public YouTube channel stats relevant to monetization eligibility',
    async run({ text, reply }) {
      const key = apiKey('youtube') || process.env.YOUTUBE_API_KEY || '';
      if (!key) throw new Error('YouTube API key missing. Use .addapikey youtube KEY');
      const query = need(text, 'Usage: .yt-monetize channel name');
      const search = await json(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`);
      const id = search.items?.[0]?.snippet?.channelId;
      if (!id) throw new Error('YouTube channel not found.');
      const data = await json(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${id}&key=${encodeURIComponent(key)}`);
      const c = data.items?.[0];
      if (!c) throw new Error('Channel details unavailable.');
      await reply(`*${c.snippet.title}*\nSubscribers: ${c.statistics.hiddenSubscriberCount ? 'hidden' : c.statistics.subscriberCount}\nViews: ${c.statistics.viewCount}\nVideos: ${c.statistics.videoCount}\n\nYouTube does not expose a channel's official monetization status through this public endpoint.`);
    }
  },
  {
    name: 'netinfo',
    category: 'NETWORK',
    description: 'Show the bot server network interfaces and public IP',
    async run({ reply }) {
      const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, rows]) => (rows || []).filter(x => !x.internal).map(x => `${name}: ${x.address} (${x.family})`));
      const publicIp = await (await request('https://api.ipify.org?format=json')).json().catch(() => ({}));
      await reply(`Public IP: ${publicIp.ip || 'unavailable'}\n${interfaces.join('\n') || 'No external interfaces found.'}`);
    }
  },
  {
    name: 'speedtest',
    category: 'NETWORK',
    description: 'Run a lightweight ~1 MB server download speed test',
    async run({ reply }) {
      const start = performance.now();
      const response = await request('https://speed.cloudflare.com/__down?bytes=1000000', {}, 30000);
      const bytes = (await response.arrayBuffer()).byteLength;
      const seconds = (performance.now() - start) / 1000;
      const mbps = (bytes * 8 / seconds / 1_000_000).toFixed(2);
      await reply(`Downloaded ${(bytes / 1_000_000).toFixed(2)} MB in ${seconds.toFixed(2)}s\nApprox. ${mbps} Mbps`);
    }
  },
  {
    name: 'pinghost',
    category: 'NETWORK',
    description: 'Measure DNS + HTTPS response latency to a public host',
    async run({ text, reply }) {
      const raw = need(text, 'Usage: .pinghost example.com');
      const url = await publicUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const start = performance.now();
      const response = await fetch(url.href, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000), headers: { 'user-agent': ua } });
      await reply(`${url.hostname}: HTTP ${response.status} in ${Math.round(performance.now() - start)}ms`);
    }
  },
  {
    name: 'ipinfo',
    category: 'NETWORK',
    description: 'Look up public IP information',
    async run({ text, reply }) {
      const target = need(text, 'Usage: .ipinfo 8.8.8.8');
      const x = await json(`https://ipwho.is/${encodeURIComponent(target)}`);
      if (x.success === false) throw new Error(x.message || 'IP lookup failed.');
      await reply(`IP: ${x.ip}\nCountry: ${x.country}\nRegion: ${x.region}\nCity: ${x.city}\nISP: ${x.connection?.isp || '-'}\nASN: ${x.connection?.asn || '-'}\nTimezone: ${x.timezone?.id || '-'}`);
    }
  },
  {
    name: 'portscan',
    category: 'NETWORK',
    ownerOnly: true,
    description: 'Check up to 20 TCP ports on a public host',
    async run({ text, reply }) {
      const [hostRaw, portRaw = '80,443,22,25,53,110,143,3306,5432,6379,8080'] = need(text, 'Usage: .portscan example.com 80,443').split(/\s+/, 2);
      const host = hostRaw.replace(/^https?:\/\//, '').split('/')[0];
      const addresses = await dns.lookup(host, { all: true });
      if (!addresses.length || addresses.some(x => isPrivateIp(x.address))) throw new Error('Private/local targets are not allowed.');
      const ports = [...new Set(portRaw.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 65536))].slice(0, 20);
      if (!ports.length) throw new Error('Add valid ports, for example 80,443.');
      const results = await Promise.all(ports.map(async port => [port, await scanPort(host, port)]));
      await reply(results.map(([p, open]) => `${p}: ${open ? 'OPEN' : 'closed/unreachable'}`).join('\n'));
    }
  },
  {
    name: 'whois',
    category: 'NETWORK',
    description: 'Fetch RDAP domain registration data',
    async run({ text, reply }) {
      const domain = need(text, 'Usage: .whois example.com').replace(/^https?:\/\//, '').split('/')[0];
      const x = await json(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
      const events = (x.events || []).map(e => `${e.eventAction}: ${e.eventDate}`).join('\n');
      await reply(`Domain: ${x.ldhName || domain}\nStatus: ${(x.status || []).join(', ')}\n${events}\nNameservers: ${(x.nameservers || []).map(n => n.ldhName).join(', ')}`);
    }
  },
  {
    name: 'dnslookup',
    category: 'NETWORK',
    description: 'Resolve DNS records',
    async run({ text, reply }) {
      const domain = need(text, 'Usage: .dnslookup example.com').replace(/^https?:\/\//, '').split('/')[0];
      const [a, aaaa, mx, ns] = await Promise.all([
        dns.resolve4(domain).catch(() => []),
        dns.resolve6(domain).catch(() => []),
        dns.resolveMx(domain).catch(() => []),
        dns.resolveNs(domain).catch(() => [])
      ]);
      await reply(`A: ${a.join(', ') || '-'}\nAAAA: ${aaaa.join(', ') || '-'}\nMX: ${mx.map(x => `${x.priority}:${x.exchange}`).join(', ') || '-'}\nNS: ${ns.join(', ') || '-'}`);
    }
  },
  {
    name: 'crypto-price',
    category: 'CRYPTO',
    description: 'Show a cryptocurrency price',
    async run({ text, reply }) {
      const c = await coin(need(text, 'Usage: .crypto-price bitcoin'));
      const data = await json(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(c.id)}&vs_currencies=usd,ngn&include_24hr_change=true`);
      const p = data[c.id];
      await reply(`${c.name} (${c.symbol.toUpperCase()})\nUSD: $${p.usd}\nNGN: ₦${p.ngn}\n24h: ${Number(p.usd_24h_change || 0).toFixed(2)}%`);
    }
  },
  {
    name: 'top-crypto',
    category: 'CRYPTO',
    description: 'Show top cryptocurrencies by market cap',
    async run({ reply }) {
      const rows = await json('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false');
      await reply(rows.map((x, i) => `${i + 1}. ${x.name} (${x.symbol.toUpperCase()}) $${x.current_price} • 24h ${Number(x.price_change_percentage_24h || 0).toFixed(2)}%`).join('\n'));
    }
  },
  {
    name: 'crypto-index',
    category: 'CRYPTO',
    description: 'Show global crypto market metrics',
    async run({ reply }) {
      const x = (await json('https://api.coingecko.com/api/v3/global')).data;
      await reply(`Market cap: $${Math.round(x.total_market_cap?.usd || 0).toLocaleString()}\n24h volume: $${Math.round(x.total_volume?.usd || 0).toLocaleString()}\nBTC dominance: ${Number(x.market_cap_percentage?.btc || 0).toFixed(2)}%\nETH dominance: ${Number(x.market_cap_percentage?.eth || 0).toFixed(2)}%\nActive coins: ${x.active_cryptocurrencies}`);
    }
  },
  {
    name: 'crypto-convert',
    category: 'CRYPTO',
    description: 'Convert one cryptocurrency amount to another',
    async run({ args, reply }) {
      if (args.length < 3 || !Number.isFinite(Number(args[0]))) throw new Error('Usage: .crypto-convert 1 BTC ETH');
      const amount = Number(args[0]);
      const [from, to] = await Promise.all([coin(args[1]), coin(args[2])]);
      const prices = await json(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(from.id)},${encodeURIComponent(to.id)}&vs_currencies=usd`);
      const result = amount * prices[from.id].usd / prices[to.id].usd;
      await reply(`${amount} ${from.symbol.toUpperCase()} ≈ ${result} ${to.symbol.toUpperCase()}`);
    }
  },
  {
    name: 'crypto-news',
    category: 'CRYPTO',
    description: 'Show recent cryptocurrency news headlines',
    async run({ reply }) {
      const xml = await (await request('https://www.coindesk.com/arc/outboundfeeds/rss/')).text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8);
      const titles = items.map(item => {
        const body = item[1];
        const title = body.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || 'Untitled';
        const link = body.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '';
        return `• ${stripHtml(title)}\n${trim(link)}`;
      });
      await reply(titles.join('\n\n') || 'No crypto headlines were returned.');
    }
  },
  ...sports,
  ...githubCommands,
  ...panelCommands
];
