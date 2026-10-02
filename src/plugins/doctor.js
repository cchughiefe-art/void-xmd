import fs from 'node:fs';
import path from 'node:path';
import { run } from '../utils.js';
import { config } from '../config.js';
import { store } from '../store.js';
import { getAiSettings } from '../ai-provider.js';
import { pluginDetails } from '../plugin-loader.js';

const ok = (name, detail = '') => ({ name, status: 'OK', detail });
const warn = (name, detail = '') => ({ name, status: 'NEEDS SETUP', detail });
const fail = (name, detail = '') => ({ name, status: 'FAIL', detail });

async function timed(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    return ok(name, `${detail || 'ready'} • ${Date.now() - started}ms`);
  } catch (error) {
    return fail(name, String(error?.message || error).slice(0, 220));
  }
}

async function fetchOk(url, options = {}, timeout = 12000) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

async function binaryTest(name, args = ['--version']) {
  const out = await run(name, args, 10000);
  return String(out).split('\n')[0].slice(0, 100);
}

function key(name, envName) {
  return store.getApiKey(name) || (envName ? process.env[envName] : '') || '';
}

async function quickTests() {
  const rows = [];

  rows.push(await timed('Data directory', async () => {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const p = path.join(config.dataDir, '.doctor-write-test');
    fs.writeFileSync(p, 'ok');
    fs.rmSync(p, { force: true });
    return 'read/write works';
  }));

  const authFile = path.join(config.dataDir, 'auth', 'creds.json');
  rows.push(
    fs.existsSync(authFile)
      ? ok('WhatsApp auth files', 'creds.json exists')
      : fail('WhatsApp auth files', 'data/auth/creds.json is missing')
  );

  rows.push(await timed('ffmpeg', () => binaryTest('ffmpeg', ['-version'])));
  rows.push(await timed('yt-dlp', () => binaryTest('yt-dlp', ['--version'])));

  const plugins = pluginDetails();
  rows.push(ok('Plugin registry', `${plugins.length} modular commands loaded`));

  const ai = getAiSettings({ required: false });
  rows.push(ai.key ? ok('AI key', `${ai.model} via ${ai.source}`) : warn('AI key', 'use .addapikey gemini KEY'));

  rows.push(key('football', 'FOOTBALL_API_KEY') ? ok('Football API key', 'configured') : warn('Football API key', '.addapikey football KEY'));
  rows.push(key('youtube', 'YOUTUBE_API_KEY') ? ok('YouTube API key', 'configured') : warn('YouTube API key', '.addapikey youtube KEY'));
  rows.push(key('audd', 'AUDD_API_TOKEN') ? ok('AudD API key', 'configured') : warn('AudD API key', '.addapikey audd KEY'));
  rows.push(key('xbox', 'XBOX_API_KEY') ? ok('Xbox API key', 'configured') : warn('Xbox API key', '.addapikey xbox KEY'));
  rows.push(key('steam', 'STEAM_API_KEY') ? ok('Steam API key', 'configured') : warn('Steam API key', '.addapikey steam KEY'));
  rows.push((key('github', 'GITHUB_TOKEN')) ? ok('GitHub token', 'configured') : warn('GitHub token', '.addapikey github TOKEN'));

  const panelUrl = store.getGlobal('panelDomain', process.env.PANEL_URL || '');
  rows.push(panelUrl ? ok('Panel domain', panelUrl) : warn('Panel domain', '.setdomain https://panel.example.com'));
  rows.push(key('panel', 'PANEL_API_KEY') ? ok('Panel application key', 'configured') : warn('Panel application key', '.addapikey panel KEY'));
  rows.push(key('panel-client', 'PANEL_CLIENT_API_KEY') ? ok('Panel client key', 'configured') : warn('Panel client key', '.addapikey panel-client KEY'));

  return rows;
}

async function networkTests() {
  const rows = [];

  rows.push(await timed('Wikipedia', async () => {
    const r = await fetchOk('https://en.wikipedia.org/api/rest_v1/page/summary/Nigeria');
    const x = await r.json();
    return x.title || 'reachable';
  }));

  rows.push(await timed('Weather provider', async () => {
    const r = await fetchOk('https://wttr.in/Lagos?format=j1');
    const x = await r.json();
    return x.current_condition?.[0] ? 'reachable' : 'unexpected response';
  }));

  rows.push(await timed('CoinGecko', async () => {
    const r = await fetchOk('https://api.coingecko.com/api/v3/ping');
    const x = await r.json();
    return x.gecko_says || 'reachable';
  }));

  rows.push(await timed('IP lookup', async () => {
    const r = await fetchOk('https://api.ipify.org?format=json');
    const x = await r.json();
    return x.ip ? 'reachable' : 'unexpected response';
  }));

  rows.push(await timed('IMDb suggestions', async () => {
    const r = await fetchOk('https://v2.sg.media-imdb.com/suggestion/b/batman.json');
    const x = await r.json();
    return Array.isArray(x.d) ? 'reachable' : 'unexpected response';
  }));

  rows.push(await timed('RDAP/WHOIS', async () => {
    const bootstrapResponse = await fetchOk('https://data.iana.org/rdap/dns.json');
    const bootstrap = await bootstrapResponse.json();
    const service = (bootstrap.services || []).find(entry => entry?.[0]?.includes('com'));
    const base = service?.[1]?.[0];
    if (!base) throw new Error('No .com RDAP service found in IANA bootstrap.');
    const r = await fetchOk(`${String(base).replace(/\/?$/, '/')}domain/example.com`, {
      headers: { accept: 'application/rdap+json, application/json' }
    });
    const x = await r.json();
    return x.ldhName || x.unicodeName || 'reachable';
  }));

  const ai = getAiSettings({ required: false });
  if (ai.key) {
    rows.push(await timed('AI provider', async () => {
      const url = `${ai.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(ai.model)}`;
      const r = await fetchOk(url, {
        headers: { authorization: `Bearer ${ai.key}` }
      }, 15000);
      const x = await r.json().catch(() => ({}));
      return x.id || x.name || ai.model;
    }));
  }

  const gh = key('github', 'GITHUB_TOKEN');
  if (gh) {
    rows.push(await timed('GitHub API', async () => {
      const r = await fetchOk('https://api.github.com/user', {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${gh}`,
          'x-github-api-version': '2022-11-28'
        }
      });
      const x = await r.json();
      return `@${x.login}`;
    }));
  }

  const football = key('football', 'FOOTBALL_API_KEY');
  if (football) {
    rows.push(await timed('Football API', async () => {
      const r = await fetchOk('https://api.football-data.org/v4/competitions', {
        headers: { 'X-Auth-Token': football }
      });
      const x = await r.json();
      return `${x.competitions?.length || 0} competitions visible`;
    }));
  }

  const youtube = key('youtube', 'YOUTUBE_API_KEY');
  if (youtube) {
    rows.push(await timed('YouTube API', async () => {
      const r = await fetchOk(
        `https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(youtube)}`
      );
      const x = await r.json();
      return x.items?.length ? 'reachable' : 'key accepted but no test item returned';
    }));
  }

  const steam = key('steam', 'STEAM_API_KEY');
  if (steam) {
    rows.push(await timed('Steam API', async () => {
      const r = await fetchOk(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(steam)}&steamids=76561197960435530`
      );
      const x = await r.json();
      return x.response?.players ? 'reachable' : 'unexpected response';
    }));
  }

  return rows;
}

function render(title, rows) {
  const icon = status => status === 'OK' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  return [
    `*${title}*`,
    ...rows.map(x => `${icon(x.status)} ${x.name}: ${x.detail}`)
  ].join('\n');
}

export default {
  name: 'doctor',
  aliases: ['selftest', 'diagnose'],
  category: 'OWNER',
  ownerOnly: true,
  description: 'Audit VOID XMD runtime dependencies, API configuration and safe external providers',

  async run({ args, reply }) {
    const full = String(args[0] || '').toLowerCase() === 'full';

    const quick = await quickTests();
    await reply(render('VOID XMD doctor — runtime', quick));

    if (!full) {
      await reply('Run *.doctor full* to safely test external providers and configured APIs.');
      return;
    }

    const network = await networkTests();
    await reply(render('VOID XMD doctor — providers', network));

    await reply(
      '*Important*\n' +
      'Doctor does not automatically execute destructive/admin actions such as deleting repositories, kicking members, creating/deleting panel servers, blocking users, or posting statuses. ' +
      'It tests their required runtime/provider prerequisites instead.'
    );
  }
};
