import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config } from '../config.js';
import { pluginDetails } from '../plugin-loader.js';
import {
  run,
  ytDlpAuthStatus
} from '../utils.js';

const CORE_COMMANDS = [
  'menu','menufull','ping','runtime','botinfo','owner','repo','public','private',
  'weather','wikipedia','define','translate','ai','gpt','explain','rewrite',
  'summarize','aistatus','play','ytmp3','yt','tiktok','instagram','twitter',
  'facebook','socialdl','sticker','calc','qr','base64','base64decode','hash',
  'uuid','short','uppercase','lowercase','reverse','wordcount','charcount',
  'jsonpretty','password','timestamp','admins','groupinfo','groupid','link',
  'revokeinvite','promote','demote','kick','mute','unmute','tagall','hidetag',
  'warn','warnings','clearwarn','setwelcome','setgoodbye','setrules','rules',
  'antilink','antibadwords','coinflip','dice','rps','8ball','choose','rate',
  'ship','joke','quote','truth','dare','balance','daily','pay','block','unblock',
  'restart','health','stats','devices','adddevice','removedevice'
];

const YTDLP_COMMANDS = new Set([
  'play','ytmp3','yt','tiktok','instagram','twitter','facebook','socialdl',
  'music','play2','playdoc','playch','video','video2','videodoc','fbdl','igdl',
  'pinterestdl','douyin','aio','snackvideo','soundcloud','spotify','videy',
  'xnxxdl','xxxdl','dlanime','animedl','dlmovie','dlseries','savetube','ytmp4'
]);

const DESTRUCTIVE = new Map([
  ['public', 'changes global bot mode'],
  ['private', 'changes global bot mode'],
  ['daily', 'changes economy balance/cooldown'],
  ['pay', 'moves economy balance'],
  ['block', 'blocks a real WhatsApp user'],
  ['unblock', 'unblocks a real WhatsApp user'],
  ['restart', 'terminates the bot process'],
  ['adddevice', 'creates a real WhatsApp session'],
  ['removedevice', 'logs out/removes a real WhatsApp session'],
  ['link', 'requires a real group admin context'],
  ['revokeinvite', 'changes a real group invite'],
  ['promote', 'changes a real member role'],
  ['demote', 'changes a real member role'],
  ['kick', 'removes a real group member'],
  ['mute', 'changes real group permissions'],
  ['unmute', 'changes real group permissions'],
  ['tagall', 'would ping every real group member'],
  ['hidetag', 'would ping every real group member'],
  ['warn', 'changes stored warnings'],
  ['clearwarn', 'changes stored warnings'],
  ['setwelcome', 'changes group automation'],
  ['setgoodbye', 'changes group automation'],
  ['setrules', 'changes stored group rules'],
  ['antilink', 'changes protection settings'],
  ['antibadwords', 'changes protection settings'],
  ['ghcreate', 'creates a real GitHub repository'],
  ['ghpush', 'writes to a real GitHub repository'],
  ['ghpushall', 'writes to a real GitHub repository'],
  ['ghdelete', 'deletes a real GitHub repository'],
  ['ghdeletefile', 'deletes a real GitHub file'],
  ['ghcommit', 'creates a real GitHub commit'],
  ['ghcreatebranch', 'creates a real GitHub branch'],
  ['ghfork', 'creates a real GitHub fork'],
  ['deletepanel', 'deletes a real panel server'],
  ['restartpanel', 'restarts a real panel server'],
  ['restartserver', 'restarts a real panel server'],
  ['creategc', 'creates a real WhatsApp group'],
  ['leavegc', 'leaves a real WhatsApp group'],
  ['join', 'joins a real WhatsApp group'],
  ['promoteall', 'changes multiple real member roles'],
  ['demoteall', 'changes multiple real member roles'],
  ['kickall', 'removes multiple real group members'],
  ['setppgc', 'changes a real group picture'],
  ['setgcs', 'posts a real group status'],
  ['svcontact', 'writes a real contact'],
  ['add', 'adds a real group participant']
]);

const NEEDS_CONTEXT = new Map([
  ['sticker', 'needs a real replied image'],
  ['vv1', 'needs a real replied view-once message'],
  ['vv2', 'needs a real replied view-once message'],
  ['voice', 'needs a real replied audio message'],
  ['shazam', 'needs a real audio/video sample'],
  ['groupid', 'needs a group chat'],
  ['groupinfo', 'needs a group chat'],
  ['admins', 'needs a group chat'],
  ['warnings', 'needs a real group member target'],
  ['rules', 'needs a group chat'],
  ['groupcount', 'needs a group chat'],
  ['getppgc', 'needs a group chat'],
  ['getdeskgc', 'needs a group chat'],
  ['listonline', 'needs a real group/presence context']
]);

const SAFE_CORE_SPECS = [
  ['menu', [], ''],
  ['menufull', [], ''],
  ['ping', [], ''],
  ['runtime', [], ''],
  ['botinfo', [], ''],
  ['owner', [], ''],
  ['repo', [], ''],
  ['health', [], ''],
  ['stats', [], ''],
  ['aistatus', [], ''],
  ['calc', ['12*(4+2)'], '12*(4+2)'],
  ['qr', ['https://example.com'], 'https://example.com'],
  ['base64', ['VOID','XMD'], 'VOID XMD'],
  ['base64decode', ['Vk9JRCBYTUQ='], 'Vk9JRCBYTUQ='],
  ['hash', ['VOID','XMD'], 'VOID XMD'],
  ['uuid', [], ''],
  ['uppercase', ['void','xmd'], 'void xmd'],
  ['lowercase', ['VOID','XMD'], 'VOID XMD'],
  ['reverse', ['VOID'], 'VOID'],
  ['wordcount', ['one','two','three'], 'one two three'],
  ['charcount', ['VOID'], 'VOID'],
  ['jsonpretty', ['{"ok":true}'], '{"ok":true}'],
  ['password', ['12'], '12'],
  ['timestamp', [], ''],
  ['coinflip', [], ''],
  ['dice', [], ''],
  ['rps', ['rock'], 'rock'],
  ['8ball', [], ''],
  ['choose', ['one','|','two'], 'one | two'],
  ['rate', [], ''],
  ['ship', [], ''],
  ['joke', [], ''],
  ['quote', [], ''],
  ['truth', [], ''],
  ['dare', [], ''],
  ['balance', [], ''],
  ['devices', [], '']
];

function shorten(value, max = 700) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

async function timed(fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    return {
      ok: true,
      ms: Date.now() - started,
      detail: shorten(detail || 'ok')
    };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      detail: shorten(error?.message || error, 1200)
    };
  }
}

function makeInventory() {
  const details = pluginDetails();
  const names = new Set(CORE_COMMANDS);
  for (const item of details) names.add(item.name);

  const result = new Map();
  for (const name of [...names].sort()) {
    result.set(name, {
      command: name,
      status: 'LOADED',
      kind: 'inventory',
      detail: details.find(x => x.name === name)?.description || 'Built-in command registered.'
    });
  }

  return result;
}

function safeFakeSocket(actualSock, chat) {
  return {
    user: actualSock.user,
    authState: actualSock.authState,
    sendMessage: async () => ({
      key: {
        id: `test-${Date.now()}`,
        remoteJid: chat,
        fromMe: true
      },
      messageTimestamp: Math.floor(Date.now() / 1000)
    })
  };
}

async function runCoreDispatchTests(ctx, rows) {
  const { execute } = await import('../commands.js');
  const fakeSock = safeFakeSocket(ctx.sock, ctx.chat);

  for (const [command, args, text] of SAFE_CORE_SPECS) {
    if (!rows.has(command)) continue;

    const captured = [];
    const probe = await timed(async () => {
      await execute({
        ...ctx,
        command,
        args,
        text,
        sock: fakeSock,
        reply: async value => {
          captured.push(String(value));
          return {
            key: { id: `reply-${Date.now()}`, remoteJid: ctx.chat, fromMe: true },
            messageTimestamp: Math.floor(Date.now() / 1000)
          };
        },
        raw: {
          key: { id: 'TESTALL', remoteJid: ctx.chat, fromMe: true },
          messageTimestamp: Math.floor(Date.now() / 1000),
          message: { conversation: `${config.prefix}${command}` }
        },
        quoted: null,
        mentions: [],
        timestamp: Date.now() - 5
      });

      return captured.length
        ? `dispatch returned ${captured.length} reply/replies`
        : 'dispatch completed';
    });

    rows.set(command, {
      command,
      status: probe.ok ? 'PASS' : 'FAIL',
      kind: 'exact command dispatch',
      ms: probe.ms,
      detail: probe.detail
    });
  }
}

async function externalProbes(ctx, rows, systemRows) {
  const auth = ytDlpAuthStatus();

  systemRows.push({
    name: 'YouTube cookies',
    status: auth.present ? 'PASS' : 'WARN',
    detail: auth.present
      ? `configured (${auth.size} bytes)`
      : `not configured; expected at ${auth.cookieFile}`
  });

  const version = await timed(async () => {
    return await run('yt-dlp', ['--version'], 60000);
  });
  systemRows.push({
    name: 'yt-dlp version',
    status: version.ok ? 'PASS' : 'FAIL',
    detail: version.detail,
    ms: version.ms
  });

  const directYoutube = await timed(async () => {
    return await run(
      'yt-dlp',
      [
        '--simulate',
        '--no-playlist',
        '--no-warnings',
        '--print', '%(id)s | %(title)s',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      ],
      120000
    );
  });

  systemRows.push({
    name: 'YouTube direct extraction',
    status: directYoutube.ok ? 'PASS' : 'FAIL',
    detail: directYoutube.detail,
    ms: directYoutube.ms
  });

  const searchYoutube = await timed(async () => {
    return await run(
      'yt-dlp',
      [
        '--simulate',
        '--no-playlist',
        '--no-warnings',
        '--print', '%(id)s | %(title)s',
        'ytsearch1:Rick Astley Never Gonna Give You Up'
      ],
      120000
    );
  });

  systemRows.push({
    name: 'YouTube search extraction',
    status: searchYoutube.ok ? 'PASS' : 'FAIL',
    detail: searchYoutube.detail,
    ms: searchYoutube.ms
  });

  const ytOk = directYoutube.ok && searchYoutube.ok;
  const ytDetail = ytOk
    ? 'shared yt-dlp URL + search backend passed live extraction'
    : `yt-dlp backend failed: ${directYoutube.ok ? searchYoutube.detail : directYoutube.detail}`;

  for (const command of YTDLP_COMMANDS) {
    if (!rows.has(command)) continue;
    rows.set(command, {
      command,
      status: ytOk ? 'PASS' : 'FAIL',
      kind: 'shared live downloader backend',
      detail: ytDetail
    });
  }

  const endpoints = [
    ['Wikipedia', 'https://en.wikipedia.org/api/rest_v1/page/summary/Nigeria'],
    ['Weather', 'https://wttr.in/Lagos?format=j1'],
    ['CoinGecko', 'https://api.coingecko.com/api/v3/ping'],
    ['GitHub', 'https://api.github.com/zen']
  ];

  for (const [name, url] of endpoints) {
    const probe = await timed(async () => {
      const response = await fetch(url, {
        headers: { 'user-agent': 'VOID-XMD-testall/1.0' },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return `HTTP ${response.status}`;
    });

    systemRows.push({
      name,
      status: probe.ok ? 'PASS' : 'FAIL',
      detail: probe.detail,
      ms: probe.ms
    });
  }

  // GETPP underlying live profile-picture path using the account that is
  // currently running TESTALL. Privacy/no-photo is reported as a failure for
  // this specific probe rather than hiding it.
  if (rows.has('getpp')) {
    const pp = await timed(async () => {
      const jid = ctx.sock.user?.id;
      if (!jid) throw new Error('Current WhatsApp session JID unavailable.');
      const url = await ctx.sock.profilePictureUrl(jid, 'image');
      if (!url) throw new Error('No profile picture URL returned.');
      return 'current linked account profile picture resolved';
    });

    rows.set('getpp', {
      command: 'getpp',
      status: pp.ok ? 'PASS' : 'FAIL',
      kind: 'live WhatsApp API probe',
      ms: pp.ms,
      detail: pp.detail
    });
  }
}

function applySkipReasons(rows) {
  for (const [command, reason] of DESTRUCTIVE) {
    if (!rows.has(command)) continue;
    rows.set(command, {
      command,
      status: 'SKIP',
      kind: 'safety',
      detail: `not auto-fired: ${reason}`
    });
  }

  for (const [command, reason] of NEEDS_CONTEXT) {
    if (!rows.has(command)) continue;
    const current = rows.get(command);
    if (current.status === 'PASS' || current.status === 'FAIL') continue;
    rows.set(command, {
      command,
      status: 'SKIP',
      kind: 'context',
      detail: `needs live context: ${reason}`
    });
  }
}

function duplicateAliasAudit(details) {
  const map = new Map();
  const collisions = [];

  for (const item of details) {
    for (const name of [item.name, ...(item.aliases || [])]) {
      const key = String(name).toLowerCase();
      if (map.has(key) && map.get(key) !== item.name) {
        collisions.push(`${key}: ${map.get(key)} vs ${item.name}`);
      } else {
        map.set(key, item.name);
      }
    }
  }

  return collisions;
}

function renderLog({ started, finished, rows, systemRows, collisions, sessionId }) {
  const commandRows = [...rows.values()];
  const counts = {};
  for (const row of commandRows) counts[row.status] = (counts[row.status] || 0) + 1;

  const lines = [
    'VOID XMD TESTALL',
    `Started: ${new Date(started).toISOString()}`,
    `Finished: ${new Date(finished).toISOString()}`,
    `Host: ${os.platform()} ${os.arch()} ${process.version}`,
    `Session: ${sessionId || 'primary'}`,
    `Data dir: ${config.dataDir}`,
    '',
    'SUMMARY',
    ...Object.entries(counts).sort().map(([k, v]) => `${k}: ${v}`),
    `Plugin alias collisions: ${collisions.length}`,
    '',
    'SYSTEM / PROVIDER PROBES'
  ];

  for (const row of systemRows) {
    lines.push(
      `[${row.status}] ${row.name}${row.ms != null ? ` (${row.ms}ms)` : ''}: ${row.detail}`
    );
  }

  lines.push('', 'COMMAND RESULTS');

  for (const row of commandRows) {
    lines.push(
      `[${row.status}] .${row.command}${row.ms != null ? ` (${row.ms}ms)` : ''} | ${row.kind} | ${row.detail}`
    );
  }

  if (collisions.length) {
    lines.push('', 'ALIAS COLLISIONS', ...collisions.map(x => `- ${x}`));
  }

  lines.push(
    '',
    'NOTE',
    'SKIP does not mean broken. TESTALL deliberately does not auto-execute commands that would kick/block users, mutate groups/economy, create/delete resources, restart the bot, or require a real quoted media/group target.'
  );

  return lines.join('\n');
}

export default {
  name: 'testall',
  aliases: ['fulltest', 'commandtest'],
  category: 'OWNER',
  ownerOnly: true,
  description: 'Audit every loaded command, live-test safe command paths/providers, and write a detailed failure log',

  async run(ctx) {
    const mode = String(ctx.args?.[0] || 'full').toLowerCase();
    if (!['full', 'quick'].includes(mode)) {
      throw new Error('Usage: .testall [full|quick]');
    }

    const started = Date.now();
    const details = pluginDetails();
    const rows = makeInventory();
    const systemRows = [];

    await ctx.reply(
      `TESTALL started (${mode}).\n` +
      `Loaded command inventory: ${rows.size}\n` +
      'Safe commands will be exercised; destructive commands are logged as SKIP.'
    );

    const dataProbe = await timed(async () => {
      fs.mkdirSync(config.dataDir, { recursive: true });
      const file = path.join(config.dataDir, '.testall-write');
      fs.writeFileSync(file, 'ok');
      fs.rmSync(file, { force: true });
      return 'read/write works';
    });
    systemRows.push({
      name: 'Data directory',
      status: dataProbe.ok ? 'PASS' : 'FAIL',
      detail: dataProbe.detail,
      ms: dataProbe.ms
    });

    const ffmpeg = await timed(async () => {
      return String(await run('ffmpeg', ['-version'], 10000)).split('\n')[0];
    });
    systemRows.push({
      name: 'ffmpeg',
      status: ffmpeg.ok ? 'PASS' : 'FAIL',
      detail: ffmpeg.detail,
      ms: ffmpeg.ms
    });

    const collisions = duplicateAliasAudit(details);
    systemRows.push({
      name: 'Plugin registry/aliases',
      status: collisions.length ? 'FAIL' : 'PASS',
      detail: collisions.length ? collisions.join('; ') : `${details.length} plugin commands loaded without alias collision`
    });

    await runCoreDispatchTests(ctx, rows);

    if (mode === 'full') {
      await externalProbes(ctx, rows, systemRows);
    } else {
      systemRows.push({
        name: 'External provider probes',
        status: 'SKIP',
        detail: 'quick mode'
      });
    }

    applySkipReasons(rows);

    // TESTALL tested itself by reaching this point.
    if (rows.has('testall')) {
      rows.set('testall', {
        command: 'testall',
        status: 'PASS',
        kind: 'self',
        detail: `test runner active in ${mode} mode`
      });
    }

    const finished = Date.now();
    const log = renderLog({
      started,
      finished,
      rows,
      systemRows,
      collisions,
      sessionId: ctx.sessionId
    });

    const dir = path.join(config.dataDir, 'testall');
    fs.mkdirSync(dir, { recursive: true });

    const stamp = new Date(started).toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(dir, `testall-${stamp}.log`);
    const latestPath = path.join(dir, 'latest.log');

    fs.writeFileSync(logPath, log, { mode: 0o600 });
    fs.writeFileSync(latestPath, log, { mode: 0o600 });

    const commandRows = [...rows.values()];
    const failures = commandRows.filter(x => x.status === 'FAIL');
    const systemFailures = systemRows.filter(x => x.status === 'FAIL');
    const passes = commandRows.filter(x => x.status === 'PASS').length;
    const skips = commandRows.filter(x => x.status === 'SKIP').length;
    const loaded = commandRows.filter(x => x.status === 'LOADED').length;

    const firstFailures = [...systemFailures.map(x => `${x.name}: ${x.detail}`), ...failures.map(x => `.${x.command}: ${x.detail}`)]
      .slice(0, 8)
      .map(x => `- ${shorten(x, 350)}`)
      .join('\n');

    await ctx.reply(
      `*VOID XMD TESTALL complete*\n` +
      `Commands inventoried: ${commandRows.length}\n` +
      `PASS: ${passes}\n` +
      `FAIL: ${failures.length}\n` +
      `SKIP: ${skips}\n` +
      `LOADED/not live-probed: ${loaded}\n` +
      `System/provider FAIL: ${systemFailures.length}\n` +
      (firstFailures ? `\n*First failures*\n${firstFailures}` : '\nNo live-test failures detected.')
    );

    await ctx.sock.sendMessage(ctx.chat, {
      document: { url: logPath },
      mimetype: 'text/plain',
      fileName: path.basename(logPath)
    });
  }
};
