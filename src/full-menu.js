import { config } from './config.js';
import { categories } from './menu.js';
import { pluginDetails } from './plugin-loader.js';

const builtin = {
  menu: 'Show the compact VOID XMD command list grouped by category.',
  menufull: 'Show this detailed multi-part guide explaining what every loaded command does, its aliases, access level, usage and external requirements.',
  ping: 'Measure command-response latency between the incoming WhatsApp message timestamp and the bot response.',
  runtime: 'Show how long the current bot process has been running.',
  botinfo: 'Show bot name, operating mode, Node.js version, platform architecture and process uptime.',
  owner: 'Show the configured owner WhatsApp number.',
  repo: 'Show the repository/build identification message for VOID XMD.',
  public: 'Owner command that explains how to switch the deployment into public mode. The persistent mode still comes from the MODE environment variable.',
  private: 'Owner command that explains how to switch the deployment into private/owner-only mode. The persistent mode still comes from the MODE environment variable.',
  health: 'Confirm that the bot process and WhatsApp connection handler are alive.',
  stats: 'Show tracked user count, tracked group count and current process memory usage.',
  ai: 'Send a prompt to the configured OpenAI-compatible AI provider and return its answer.',
  gpt: 'Alias-style AI chat command that sends a prompt to the configured OpenAI-compatible provider.',
  explain: 'Ask the configured AI provider to explain supplied text or a topic in simpler terms.',
  rewrite: 'Ask the configured AI provider to rewrite supplied text clearly and naturally.',
  summarize: 'Ask the configured AI provider for a concise summary of supplied text.',
  aistatus: 'Show whether the AI provider is configured and which model VOID XMD will use.',
  weather: 'Fetch current weather information for a place, including condition, temperature, feels-like temperature and humidity.',
  wikipedia: 'Search Wikipedia and return the first matching article summary plus its mobile article link.',
  translate: 'Translate supplied text using the configured AI provider. If no target language is stated, it defaults to English.',
  define: 'Return a short dictionary-style definition and an example using the configured AI provider.',
  play: 'Search for music and send the result as audio. The modular music downloader handles this command first.',
  ytmp3: 'Download/search audio and send it as an audio file. The modular music downloader handles this command first.',
  yt: 'Download or stream a YouTube URL/search result as video using yt-dlp.',
  tiktok: 'Download supported TikTok media using yt-dlp.',
  instagram: 'Download supported Instagram media using yt-dlp.',
  twitter: 'Download supported X/Twitter media using yt-dlp.',
  facebook: 'Download supported Facebook media using yt-dlp.',
  socialdl: 'Generic yt-dlp-backed social-media downloader for supported URLs.',
  sticker: 'Turn a replied or attached image into a WhatsApp WebP sticker.',
  calc: 'Evaluate a basic arithmetic expression containing numbers, brackets and normal arithmetic operators.',
  qr: 'Generate a QR-code image containing the supplied text or URL.',
  base64: 'Encode supplied text into Base64.',
  base64decode: 'Decode Base64 input back into UTF-8 text.',
  hash: 'Generate a SHA-256 hash of supplied text.',
  uuid: 'Generate a random UUID.',
  short: 'Shorten a URL using TinyURL.',
  uppercase: 'Convert supplied text to uppercase.',
  lowercase: 'Convert supplied text to lowercase.',
  reverse: 'Reverse supplied text character-by-character.',
  wordcount: 'Count whitespace-separated words in supplied text.',
  charcount: 'Count characters in supplied text.',
  jsonpretty: 'Parse JSON text and return a human-readable indented version.',
  password: 'Generate a cryptographically random URL-safe password. You may provide a length from 6 to 64.',
  timestamp: 'Show the current Unix time in milliseconds and the current ISO timestamp.',
  admins: 'List all administrators in the current WhatsApp group and mention them.',
  groupinfo: 'Show group name, member count, owner and description.',
  groupid: 'Show the current WhatsApp group JID.',
  link: 'Generate the current group invite link. The bot must be a group admin.',
  revokeinvite: 'Invalidate the current group invite link and create a new invite-code state. The bot must be admin.',
  promote: 'Promote a mentioned/replied member to group admin.',
  demote: 'Remove group-admin status from a mentioned/replied member.',
  kick: 'Remove a mentioned/replied member from the group.',
  mute: 'Switch the group to announcement mode so only admins can send messages.',
  unmute: 'Switch the group back so normal participants can send messages.',
  tagall: 'Mention every participant in the group with a visible list.',
  hidetag: 'Mention every participant while showing only the supplied message text.',
  warn: 'Add one persistent warning to a mentioned/replied group member.',
  warnings: 'Show the stored warning count for a mentioned/replied member.',
  clearwarn: 'Clear all stored warnings for a mentioned/replied member.',
  setwelcome: 'Enable or disable automatic welcome messages when members join.',
  setgoodbye: 'Enable or disable automatic goodbye messages when members leave.',
  setrules: 'Store the group rules text in VOID XMD persistent data.',
  rules: 'Show the rules currently saved for the group.',
  antilink: 'Enable or disable the original invite-link protection that removes WhatsApp group links from non-admin messages when the bot is admin.',
  antibadwords: 'Enable or disable the original bad-word protection setting for the group.',
  coinflip: 'Randomly return Heads or Tails.',
  dice: 'Roll a virtual six-sided die.',
  rps: 'Play a simple rock-paper-scissors round against the bot.',
  '8ball': 'Return a random Magic-8-Ball style answer.',
  choose: 'Randomly choose one option from values separated with the | character.',
  rate: 'Return a random percentage from 0 to 100.',
  ship: 'Return a random compatibility percentage for fun.',
  joke: 'Return a random built-in programming joke.',
  quote: 'Return a random built-in motivational quote.',
  truth: 'Return a random truth-question prompt.',
  dare: 'Return a random dare prompt.',
  balance: 'Show the sender’s persistent VOID XMD virtual-coin balance.',
  daily: 'Add the current daily reward amount to the sender’s virtual-coin balance.',
  pay: 'Transfer virtual coins from the sender to a mentioned/replied user.',
  block: 'Owner-only command to block a WhatsApp user through the linked account.',
  unblock: 'Owner-only command to unblock a WhatsApp user through the linked account.',
  restart: 'Owner-only command that exits the Node.js process so the hosting platform can restart the bot.'
};

const builtinAliases = {
  menu: ['help', 'commands'],
  menufull: ['fullmenu', 'helpfull'],
  ai: ['gpt']
};

const explicitUsage = {
  menu: '.menu',
  menufull: '.menufull',
  ping: '.ping',
  runtime: '.runtime',
  botinfo: '.botinfo',
  owner: '.owner',
  repo: '.repo',
  public: '.public',
  private: '.private',
  health: '.health',
  stats: '.stats',
  ai: '.ai <question>',
  gpt: '.gpt <question>',
  explain: '.explain <topic or text>',
  rewrite: '.rewrite <text>',
  summarize: '.summarize <text>',
  aistatus: '.aistatus',
  weather: '.weather <place>',
  wikipedia: '.wikipedia <topic>',
  translate: '.translate <target language + text>',
  define: '.define <word or phrase>',
  play: '.play <artist/song or URL>',
  ytmp3: '.ytmp3 <artist/song or URL>',
  yt: '.yt <URL or search>',
  tiktok: '.tiktok <URL>',
  instagram: '.instagram <URL>',
  twitter: '.twitter <URL>',
  facebook: '.facebook <URL>',
  socialdl: '.socialdl <URL>',
  sticker: 'Reply to an image with .sticker',
  calc: '.calc 12*(4+2)',
  qr: '.qr <text or URL>',
  base64: '.base64 <text>',
  base64decode: '.base64decode <base64>',
  hash: '.hash <text>',
  uuid: '.uuid',
  short: '.short <URL>',
  uppercase: '.uppercase <text>',
  lowercase: '.lowercase <text>',
  reverse: '.reverse <text>',
  wordcount: '.wordcount <text>',
  charcount: '.charcount <text>',
  jsonpretty: '.jsonpretty <JSON>',
  password: '.password [6-64]',
  timestamp: '.timestamp',
  admins: '.admins',
  groupinfo: '.groupinfo',
  groupid: '.groupid',
  link: '.link',
  revokeinvite: '.revokeinvite',
  promote: 'Mention/reply to a member with .promote',
  demote: 'Mention/reply to a member with .demote',
  kick: 'Mention/reply to a member with .kick',
  mute: '.mute',
  unmute: '.unmute',
  tagall: '.tagall [message]',
  hidetag: '.hidetag <message>',
  warn: 'Mention/reply to a member with .warn',
  warnings: 'Mention/reply to a member with .warnings',
  clearwarn: 'Mention/reply to a member with .clearwarn',
  setwelcome: '.setwelcome on|off',
  setgoodbye: '.setgoodbye on|off',
  setrules: '.setrules <rules text>',
  rules: '.rules',
  antilink: '.antilink on|off',
  antibadwords: '.antibadwords on|off',
  choose: '.choose option 1 | option 2 | option 3',
  rps: '.rps rock|paper|scissors',
  pay: 'Mention/reply to a user with .pay <amount>',
  block: 'Mention/reply to a user with .block',
  unblock: 'Mention/reply to a user with .unblock',
  restart: '.restart'
};

const pluginUsage = {
  music: '.music <artist/song or URL>',
  percentage: '.percentage <percent> <value>',
  average: '.average <number> <number> ...',
  randomnumber: '.randomnumber [min] [max]',
  sqrt: '.sqrt <number>',
  factorial: '.factorial <0-100>',
  today: '.today',
  daysleft: '.daysleft YYYY-MM-DD',
  epoch: '.epoch <date or Unix timestamp>',
  feature: '.feature <describe the command you want>',
  voice: 'Reply to audio with .voice deep|chipmunk|robot|echo|slow|fast|reverse',
  titlecase: '.titlecase <text>',
  unique: '.unique <multiline text>',
  lines: '.lines <multiline text>',
  wordsort: '.wordsort <text>',
  urlencode: '.urlencode <text>',
  urldecode: '.urldecode <encoded text>',
  rot13: '.rot13 <text>',
  myjid: '.myjid',
  mentionme: '.mentionme',
  getpp: 'Use .getpp, or mention/reply to a user',
  groupcount: '.groupcount',
  websearch: '.websearch <search query>',
  vv1: 'Reply to a view-once image/video/audio with .vv1',
  play2: '.play2 <artist/song or URL>',
  playdoc: '.playdoc <artist/song or URL>',
  playch: '.playch <artist/song or URL>',
  video: '.video <URL or search query>',
  video2: '.video2 <URL or search query>',
  videodoc: '.videodoc <URL or search query>',
  gdrive: '.gdrive <public Google Drive file URL>',
  mediafire: '.mediafire <MediaFire URL>',
  webdl: '.webdl <direct file URL>',
  apk: '.apk <direct APK URL>',
  spotify: '.spotify <song name or Spotify URL>',
  savetube: '.savetube <YouTube/video URL or search>',
  add: '.add <international phone number>',
  leavegc: '.leavegc',
  join: '.join <WhatsApp invite link/code>',
  gcstatus: '.gcstatus',
  setgcs: '.setgcs <text>, or reply to image/video/audio with .setgcs [caption]',
  getname: '.getname',
  getdeskgc: '.getdeskgc',
  getppgc: '.getppgc',
  setppgc: 'Reply to an image with .setppgc',
  svcontact: '.svcontact <phone number> | <name>',
  listonline: '.listonline',
  creategc: '.creategc Group Name | number1 number2',
  promoteall: '.promoteall',
  demoteall: '.demoteall',
  kickall: '.kickall CONFIRM',
  'antilink-delete': '.antilink-delete on|off',
  'antilink-warn': '.antilink-warn on|off',
  'antilink-kick': '.antilink-kick on|off',
  addbadword: '.addbadword <word or phrase>',
  delbadword: '.delbadword <word or phrase>',
  tts: '.tts [language-code] <text>',
  shazam: 'Reply to audio/video with .shazam',
  catholic: '.catholic [YYYY-MM-DD]',
  ngl: '.ngl <username>',
  get: '.get <public URL>',
  fetch: '.fetch <public URL>',
  styletext: '.styletext <text>',
  languages: '.languages',
  readmore: '.readmore visible text | hidden text',
  ss: '.ss <public webpage URL>',
  imdb: '.imdb <movie/series title>',
  bin: '.bin <first 6-8 card digits>',
  fakeid: '.fakeid',
  cc: '.cc <card number to checksum-validate>',
  emojimix: '.emojimix <emoji1> <emoji2>',
  robloxstalk: '.robloxstalk <username>',
  gitstalk: '.gitstalk <GitHub username>',
  npmstalk: '.npmstalk <package>',
  wastalk: '.wastalk [mention/reply]',
  minecraft: '.minecraft <username>',
  xbox: '.xbox <gamertag>',
  steam: '.steam <Steam ID or profile URL>',
  'ai-detect': '.ai-detect <text>',
  nsfwcheck: '.nsfwcheck <text>',
  subdomain: '.subdomain <domain>',
  'yt-monetize': '.yt-monetize <channel ID>',
  netinfo: '.netinfo',
  speedtest: '.speedtest',
  pinghost: '.pinghost <hostname>',
  ipinfo: '.ipinfo <IP address>',
  portscan: '.portscan <public host> <ports, e.g. 80,443,8080>',
  whois: '.whois <domain>',
  dnslookup: '.dnslookup <domain> [A|AAAA|MX|TXT|NS|CNAME]',
  'crypto-price': '.crypto-price <coin name/symbol>',
  'top-crypto': '.top-crypto [count]',
  'crypto-index': '.crypto-index',
  'crypto-convert': '.crypto-convert <amount> <from coin> <to coin>',
  'crypto-news': '.crypto-news',
  livescores: '.livescores',
  sureodds: '.sureodds',
  competitions: '.competitions',
  matches: '.matches [competition code]',
  standings: '.standings <competition code>',
  team: '.team <team ID>',
  areas: '.areas',
  teammatches: '.teammatches <team ID>',
  person: '.person <person/player ID>',
  matchlist: '.matchlist YYYY-MM-DD',
  head2head: '.head2head <match ID>',
  teamlist: '.teamlist <competition code>',
  ghlogin: '.ghlogin',
  setgithub: '.setgithub owner/repo',
  ghcreate: '.ghcreate <repo name> [public|private]',
  ghpush: '.ghpush path | content | commit message',
  ghpushall: '.ghpushall [commit message]',
  ghdelete: '.ghdelete owner/repo CONFIRM',
  ghlist: '.ghlist',
  ghbranches: '.ghbranches',
  ghdeletefile: '.ghdeletefile <path> | <commit message>',
  ghcommit: '.ghcommit <message>',
  ghcreatebranch: '.ghcreatebranch <branch name>',
  ghfork: '.ghfork owner/repo',
  ghlogout: '.ghlogout',
  setdomain: '.setdomain https://panel.example.com',
  getdomain: '.getdomain',
  addapikey: '.addapikey <name> <key>',
  removeapikey: '.removeapikey <name>',
  listapikeys: '.listapikeys',
  setcurrentkey: '.setcurrentkey <name>',
  listpanels: '.listpanels',
  panelinfo: '.panelinfo <server ID>',
  deletepanel: '.deletepanel <server ID> CONFIRM',
  restartpanel: '.restartpanel <client server ID>',
  panelstats: '.panelstats <client server ID>'
};

const requirements = {
  ai: 'Gemini key via .addapikey gemini KEY (AI_API_KEY environment fallback is also supported)',
  gpt: 'Gemini key via .addapikey gemini KEY (AI_API_KEY environment fallback is also supported)',
  explain: 'Gemini key via .addapikey gemini KEY (AI_API_KEY environment fallback is also supported)',
  rewrite: 'Gemini key via .addapikey gemini KEY (AI_API_KEY environment fallback is also supported)',
  summarize: 'Gemini key via .addapikey gemini KEY (AI_API_KEY environment fallback is also supported)',
  translate: 'Gemini key via .addapikey gemini KEY (AI_API_KEY environment fallback is also supported)',
  define: 'Gemini key via .addapikey gemini KEY (AI_API_KEY environment fallback is also supported)',
  feature: 'Gemini key via .addapikey gemini KEY (AI_API_KEY environment fallback is also supported)',
  shazam: 'AudD API key: .addapikey audd KEY',
  xbox: 'OpenXBL key: .addapikey xbox KEY',
  steam: 'Steam Web API key: .addapikey steam KEY',
  'yt-monetize': 'YouTube Data API key: .addapikey youtube KEY',
  livescores: 'football-data.org key: .addapikey football KEY',
  sureodds: 'football-data.org key; odds availability depends on provider response',
  competitions: 'football-data.org key: .addapikey football KEY',
  matches: 'football-data.org key: .addapikey football KEY',
  standings: 'football-data.org key: .addapikey football KEY',
  team: 'football-data.org key: .addapikey football KEY',
  areas: 'football-data.org key: .addapikey football KEY',
  teammatches: 'football-data.org key: .addapikey football KEY',
  person: 'football-data.org key: .addapikey football KEY',
  matchlist: 'football-data.org key: .addapikey football KEY',
  head2head: 'football-data.org key: .addapikey football KEY',
  teamlist: 'football-data.org key: .addapikey football KEY'
};

function access(detail) {
  const tags = [];
  if (detail.ownerOnly) tags.push('Owner only');
  if (detail.groupOnly) tags.push('Group only');
  if (detail.adminOnly) tags.push('Group admin');
  return tags.length ? tags.join(' • ') : 'Everyone (subject to bot MODE)';
}

function inferredRequirement(name, category) {
  if (requirements[name]) return requirements[name];
  if (name.startsWith('gh') || name === 'setgithub') return 'GitHub token via GITHUB_TOKEN or .addapikey github KEY';
  if (category === 'PANEL' || /^ct\d+gb3$/.test(name)) return 'Configured Pterodactyl domain/API key; some actions also require a client API key';
  if (['play','ytmp3','yt','tiktok','instagram','twitter','facebook','socialdl','music','play2','playdoc','playch','video','video2','videodoc','fbdl','igdl','pinterestdl','douyin','aio','snackvideo','soundcloud','spotify','videy','xnxxdl','xxxdl','dlanime','animedl','dlmovie','dlseries','savetube'].includes(name)) {
    return 'yt-dlp support for the target site; site changes can affect availability';
  }
  return '';
}

function usageFor(detail) {
  if (explicitUsage[detail.name]) return explicitUsage[detail.name];
  if (pluginUsage[detail.name]) return pluginUsage[detail.name];
  if (/^ct\d+gb3$/.test(detail.name)) return `.${detail.name} <name> [egg ID] [location ID]`;
  if (detail.category === 'DOWNLOADERS') return `.${detail.name} <URL or search query>`;
  return `.${detail.name}${detail.description?.match(/toggle/i) ? ' on|off' : ' [arguments]'}`;
}

function buildDetails() {
  const map = new Map();

  for (const [category, commands] of Object.entries(categories)) {
    for (const name of commands) {
      map.set(name, {
        name,
        category,
        description: builtin[name] || 'Built-in VOID XMD command.',
        aliases: builtinAliases[name] || [],
        ownerOnly: ['public','private','block','unblock','restart'].includes(name),
        groupOnly: ['admins','groupinfo','groupid','link','revokeinvite','promote','demote','kick','mute','unmute','tagall','hidetag','warn','warnings','clearwarn','setwelcome','setgoodbye','setrules','rules','antilink','antibadwords'].includes(name),
        adminOnly: ['link','revokeinvite','promote','demote','kick','mute','unmute','tagall','hidetag','warn','clearwarn','setwelcome','setgoodbye','setrules','antilink','antibadwords'].includes(name)
      });
    }
  }

  for (const plugin of pluginDetails()) {
    const existing = map.get(plugin.name);
    map.set(plugin.name, {
      ...existing,
      ...plugin,
      aliases: [...new Set([...(existing?.aliases || []), ...(plugin.aliases || [])])],
      description: plugin.description || existing?.description || 'Loaded modular VOID XMD command.'
    });
  }

  return [...map.values()];
}

function formatEntry(detail) {
  const prefix = config.prefix;
  const aliases = detail.aliases?.length
    ? detail.aliases.map(a => `${prefix}${a}`).join(', ')
    : 'None';
  const need = inferredRequirement(detail.name, detail.category);
  return [
    `*${prefix}${detail.name}*`,
    `What it does: ${detail.description}`,
    `Usage: ${usageFor(detail)}`,
    `Aliases: ${aliases}`,
    `Access: ${access(detail)}`,
    need ? `Needs: ${need}` : ''
  ].filter(Boolean).join('\n');
}

export function renderFullMenu(senderName = 'User') {
  const details = buildDetails();
  const order = [];
  for (const category of Object.keys(categories)) if (!order.includes(category)) order.push(category);
  for (const detail of details) if (!order.includes(detail.category)) order.push(detail.category);

  const sections = [];
  for (const category of order) {
    const entries = details.filter(d => d.category === category);
    if (!entries.length) continue;
    sections.push({
      category,
      text: `╭─〔 ✦ ${category} · ${entries.length} 〕─╮\n\n` +
        entries.map(formatEntry).join('\n\n') +
        `\n\n╰─〔 ${category} 〕─╯`
    });
  }

  const max = 3600;
  const parts = [];
  let current =
    `╭─〔 👑 ${config.name} FULL COMMAND GUIDE 〕─╮\n` +
    `│ 👤 ${senderName}\n` +
    `│ 📚 ${details.length} loaded commands explained\n` +
    `│ Tip: use ${config.prefix}menu for the short menu\n` +
    `╰────────────────────────╯`;

  for (const section of sections) {
    const blocks = section.text.split('\n\n');
    for (const block of blocks) {
      const addition = `\n\n${block}`;
      if ((current + addition).length > max && current.length > 0) {
        parts.push(current);
        current = `*${config.name} FULL MENU — continued*\n\n${block}`;
      } else {
        current += addition;
      }
    }
  }

  if (current.trim()) parts.push(current);
  parts.push(
    `*End of ${config.name} full guide*\n` +
    `Use ${config.prefix}menu for the compact list or ${config.prefix}menufull whenever you want the explanations again.`
  );
  return parts;
}
