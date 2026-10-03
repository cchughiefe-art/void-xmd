import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from '../config.js';
import { run } from '../utils.js';

const searches = new Map();
const SEARCH_TTL = 20 * 60 * 1000;
const MAX_RESULTS = 15;
const UA = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/154 Mobile Safari/537.36';

function keyFor(sender, sessionId) {
  return `${sessionId || 'primary'}:${sender}`;
}

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeName(value) {
  return cleanText(value)
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 80) || 'download';
}

function isPrivateIp(ip) {
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
    return value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      value.startsWith('fe80:');
  }

  return false;
}

async function publicUrl(input) {
  let value = String(input || '').trim();
  if (!value) value = 'xvideos.com';
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP/HTTPS websites are supported.');
  }

  const host = url.hostname.toLowerCase();
  if (['localhost', '0.0.0.0'].includes(host)) {
    throw new Error('Local/private targets are not allowed.');
  }

  const addresses = await dns.lookup(host, { all: true }).catch(() => []);
  if (addresses.some(item => isPrivateIp(item.address))) {
    throw new Error('Local/private targets are not allowed.');
  }

  return url;
}

function buildSearchUrl(base, term) {
  const q = encodeURIComponent(term);

  if (/xvideos\./i.test(base.hostname)) {
    const url = new URL(base.origin);
    url.pathname = '/';
    url.search = `?k=${q}`;
    return url;
  }

  const url = new URL(base.origin);
  url.pathname = '/search';
  url.search = `?q=${q}`;
  return url;
}

function parseAnchors(html, baseUrl, term) {
  const results = [];
  const seen = new Set();
  const lowerTerm = String(term || '').toLowerCase();

  const anchorRe = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRe.exec(html)) && results.length < 80) {
    const attrs = `${match[1]} ${match[3]}`;
    const href = match[2].trim();
    const titleMatch = attrs.match(/\btitle\s*=\s*["']([^"']+)["']/i);
    const title = cleanText(titleMatch?.[1] || match[4]);

    if (!href || /^javascript:|^mailto:|^#/i.test(href)) continue;

    let full;
    try {
      full = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    if (/xvideos\./i.test(baseUrl.hostname)) {
      const pathname = new URL(full).pathname;
      if (!/^\/video/i.test(pathname)) continue;
    } else if (lowerTerm && title && !title.toLowerCase().includes(lowerTerm)) {
      continue;
    }

    if (!title || seen.has(full)) continue;
    seen.add(full);
    results.push({ title, url: full });
  }

  return results.slice(0, MAX_RESULTS);
}

async function crawl(site, term) {
  const base = await publicUrl(site);
  const searchUrl = buildSearchUrl(base, term);

  const response = await fetch(searchUrl, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000)
  });

  if (!response.ok) {
    throw new Error(`Website returned HTTP ${response.status}.`);
  }

  const html = await response.text();
  const results = parseAnchors(html, searchUrl, term);

  if (!results.length) {
    throw new Error(
      'No results could be parsed automatically. The site may use JavaScript rendering or a different search layout.'
    );
  }

  return { searchUrl: searchUrl.href, results };
}

function parseSearchInput(text) {
  const raw = String(text || '').trim();
  const split = raw.split('|').map(v => v.trim());

  if (split.length >= 2) {
    return {
      site: split.shift() || 'xvideos.com',
      term: split.join('|').trim()
    };
  }

  const parts = raw.split(/\s+/);
  if (parts.length >= 2 && /[./]/.test(parts[0])) {
    return {
      site: parts.shift(),
      term: parts.join(' ')
    };
  }

  return {
    site: 'xvideos.com',
    term: raw
  };
}

async function downloadSelected(item) {
  const dir = fs.mkdtempSync(path.join(config.dataDir, 'dl55-'));
  const template = path.join(dir, '%(title).80s.%(ext)s');

  try {
    const output = await run(
      'yt-dlp',
      [
        '--no-playlist',
        '--no-warnings',
        '--restrict-filenames',
        '--print', 'after_move:filepath',
        '-f', 'best[ext=mp4]/best',
        '-o', template,
        item.url
      ],
      180000
    );

    const lines = String(output || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
    let file = lines.at(-1);

    if (!file || !fs.existsSync(file)) {
      const files = fs.readdirSync(dir).map(name => path.join(dir, name));
      file = files.find(p => fs.statSync(p).isFile());
    }

    if (!file || !fs.existsSync(file)) {
      throw new Error('yt-dlp completed but no media file was produced.');
    }

    return { dir, file };
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function extension(file) {
  return path.extname(file).toLowerCase();
}

const plugin = {
  name: 'dl55',
  aliases: ['crawlerdl'],
  category: 'DOWNLOADERS',
  description: 'Search a website, list up to 15 parsed results, then download a selected result with yt-dlp.',
  ownerOnly: false,

  async run({ text, sender, sessionId, reply, sock, chat }) {
    const value = String(text || '').trim();
    const sessionKey = keyFor(sender, sessionId);

    if (!value) {
      throw new Error(
        'Usage:\n' +
        '.dl55 xvideos.com | search term\n' +
        '.dl55 example.com | search term\n\n' +
        'Then choose with: .dl55 1'
      );
    }

    if (/^\d+$/.test(value)) {
      const saved = searches.get(sessionKey);

      if (!saved || Date.now() - saved.at > SEARCH_TTL) {
        searches.delete(sessionKey);
        throw new Error('Your last DL55 search expired. Run a new .dl55 search.');
      }

      const index = Number(value) - 1;
      const item = saved.results[index];

      if (!item) {
        throw new Error(`Choose a number from 1 to ${saved.results.length}.`);
      }

      await reply(`Downloading ${index + 1}/${saved.results.length}…`);

      const { dir, file } = await downloadSelected(item);

      try {
        const ext = extension(file);
        const name = safeName(path.basename(file));

        if (['.mp4', '.m4v', '.mov', '.webm'].includes(ext)) {
          await sock.sendMessage(
            chat,
            {
              video: { url: file },
              caption: '',
              fileName: name
            }
          );
        } else {
          await sock.sendMessage(
            chat,
            {
              document: { url: file },
              mimetype: 'application/octet-stream',
              fileName: name
            }
          );
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }

      return;
    }

    if (value.toLowerCase() === 'clear') {
      searches.delete(sessionKey);
      await reply('DL55 search cleared.');
      return;
    }

    const { site, term } = parseSearchInput(value);
    if (!term) throw new Error('Add a search term.');

    const found = await crawl(site, term);
    searches.set(sessionKey, {
      at: Date.now(),
      results: found.results
    });

    const lines = found.results.map(
      (item, index) => `${index + 1}) ${item.title}`
    );

    await reply(
      `*DL55 Search Results*\n\n${lines.join('\n')}\n\n` +
      `Reply with .dl55 NUMBER to download.\n` +
      `Example: .dl55 1`
    );
  }
};

setInterval(() => {
  const cutoff = Date.now() - SEARCH_TTL;
  for (const [key, value] of searches.entries()) {
    if (value.at < cutoff) searches.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

export default plugin;
