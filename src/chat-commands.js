import { config } from './config.js';
import { store } from './store.js';
import { executePlugin, pluginDetails } from './plugin-loader.js';
import { askAi, aiProviderStatus, providerCatalog } from './ai-provider.js';
import { clearBusinessMemory, businessMemoryCount } from './business-assistant.js';
import { naturalChatStyle } from './chat-style.js';

export async function execute(ctx) {
  const { command, args, text, reply, isOwner, isSessionOwner, isGroup } = ctx;
  const admin = () => { if (!isOwner) throw new Error('Main owner only.'); };
  const accountOwner = () => { if (!isOwner && !isSessionOwner) throw new Error('Linked account owner only.'); };
  if (command === 'start') {
    const lines = [
      '*VOID XMD V2 | WhatsApp control guide*',
      'Manage your linked account directly in WhatsApp. No website login is needed for these commands.',
      '', '*Normal chatting*',
      'Other people send normal private messages to your linked number. No dot, keyword or command is needed. Groups and your own outgoing messages do not trigger AI replies.',
      '', '*Linking a new account*',
      'Ask the server owner to generate a pairing code for your number. On your WhatsApp go to Linked devices → Link a device → Link with phone number, then enter that code. Linking once lets you manage that session from Message yourself.',
      '', '*Who can change settings?*',
      'Send control commands from the linked account’s Message yourself chat. WhatsApp identifies that session owner. Customers chatting with the bot cannot change its settings.',
      '', '*If replies stop*',
      'Check the account is connected, AI replies are enabled, mode is Public, and an AI provider is Ready. A paused or human-handoff chat needs to be resumed.',
      '', '*Optional website*',
      'The existing dashboard is optional. Public website signup is not needed to use WhatsApp controls.'
    ];
    if (isOwner || isSessionOwner) lines.push(
      '', '*1. Start and check*',
      '.setup — set Public mode and enable AI replies for this account',
      '.settings — view this account’s settings and command list',
      '.businessai on|off — enable or stop automatic replies',
      '.public or .private — change account mode',
      '.aistatus — check AI provider availability',
      '.ai Hello — test a direct AI reply',
      '', '*2. Customize your account*',
      '.set personality TEXT', '.set tone TEXT', '.set examples TEXT',
      '.set name TEXT', '.set knowledge TEXT', '.set rules TEXT',
      '.set location TEXT', '.set hours TEXT',
      'Example: .set personality Keep replies short, warm and relaxed. Match the language of each conversation.',
      '.clearsetting FIELD — remove one saved setting',
      'Older .setaipersonality and .setbusinessinfo commands still work.',
      '', '*3. Learn your tone*',
      '.learntone on|off|clear',
      'Uses limited outgoing samples WhatsApp makes available, not the entire chat archive. Samples are shared with the configured AI provider when replying. Learning is optional.',
      '', '*4. Contacts and memory*',
      '.paused — list paused contacts for this account',
      '.pauseai NUMBER — pause one contact', '.resumeai NUMBER — resume one contact',
      '.clearmemory CONFIRM — clear this account’s conversation memory',
      'Use full numbers with country code, such as 2348012345678. Settings and memory are separate for every session.'
    );
    if (isOwner) lines.push('', '*Server owner controls*',
      '.devices — list sessions', '.adddevice NUMBER — generate a pairing code',
      '.removedevice NUMBER CONFIRM — disconnect a secondary session',
      '.providers — list AI providers', '.provider NAME on|off — control fallback providers',
      '.setaimodel PROVIDER MODEL — change a model',
      '.addapikey PROVIDER KEY — save a provider key in a private chat',
      '.removeapikey PROVIDER — remove a saved key',
      '.cloudflareaccount ID — set the Cloudflare account ID',
      'Environment keys are managed in the server .env. Restart the server to check GitHub updates. Keep provider keys private.'
    );
    return reply(lines.join('\n'));
  }
  if (['setup', 'settings', 'paused', 'set', 'clearsetting', 'clearmemory'].includes(command)) {
    accountOwner();
    const sid = ctx.sessionId || 'primary', settings = store.getBusiness(sid);
    const fields = { personality: 'personality', tone: 'tone', examples: 'styleExamples', name: 'name', knowledge: 'info', rules: 'rules', location: 'location', hours: 'hours' };
    if (command === 'setup') {
      if (!aiProviderStatus().some(x => x.configured)) throw new Error('No AI provider is ready. Ask the server owner to configure one.');
      store.setSessionSetting(sid, 'mode', 'public'); store.updateBusiness(sid, { enabled: true });
      return reply('Ready: this account is Public and automatic AI replies are ON. Test from another WhatsApp number. Use .settings to customize or .businessai off to stop.');
    }
    if (command === 'settings') return reply([
      '*This WhatsApp account*', `AI replies: ${settings.enabled ? 'ON' : 'OFF'}`,
      `Mode: ${store.getSessionSetting(sid, 'mode', config.mode)}`,
      `Tone learning: ${settings.learnTone === false ? 'OFF' : 'ON'} (${(settings.learnedTone || []).length} samples)`,
      `Memory: ${businessMemoryCount(sid)} chats`, `Paused: ${Object.keys(settings.pausedChats || {}).length}`,
      ...Object.entries(fields).map(([label, field]) => `${label}: ${String(settings[field] || 'not set').slice(0, 500)}`),
      '', 'Change: .set FIELD VALUE', 'Fields: ' + Object.keys(fields).join(', '),
      '.clearsetting FIELD', '.setup', '.businessai on|off', '.learntone on|off|clear',
      '.paused', '.pauseai NUMBER', '.resumeai NUMBER', '.clearmemory CONFIRM', '.start — full guide'
    ].join('\n'));
    if (command === 'paused') return reply(Object.entries(settings.pausedChats || {}).map(([number, pause]) => `${number}: ${pause?.reason || 'paused'}`).join('\n') || 'No paused contacts for this account.');
    if (command === 'clearmemory') {
      if (args[0] !== 'CONFIRM') throw new Error('Use .clearmemory CONFIRM to erase this account’s AI conversation memory.');
      return reply(`Cleared ${clearBusinessMemory(sid)} conversation histories for this account. Settings and learned tone were kept.`);
    }
    const field = fields[String(args[0] || '').toLowerCase()];
    if (!field) throw new Error('Choose a field: ' + Object.keys(fields).join(', '));
    const value = command === 'clearsetting' ? '' : text.slice(String(args[0]).length).trim();
    if (command === 'set' && !value) throw new Error('Usage: .set FIELD VALUE');
    if (value.length > (field === 'styleExamples' ? 6000 : 10000)) throw new Error('That setting is too long. Shorten it first.');
    store.updateBusiness(sid, { [field]: value }); return reply(`${args[0]} ${value ? 'saved' : 'cleared'} for this account only.`);
  }
  if (command === 'provider') {
    admin(); const item = providerCatalog.find(x => x.name === args[0]);
    if (!item || !['on', 'off'].includes(args[1])) throw new Error('Usage: .provider NAME on|off');
    store.setGlobal(`${item.name}Enabled`, args[1] === 'on'); return reply(`${item.name}: ${args[1]}`);
  }
  if (command === 'cloudflareaccount') {
    admin(); if (!/^[a-zA-Z0-9]{1,100}$/.test(args[0] || '')) throw new Error('Usage: .cloudflareaccount ACCOUNT_ID');
    store.setGlobal('cloudflareAccountId', args[0]); return reply('Cloudflare account ID saved.');
  }
  if (command === 'mode') {
    accountOwner(); const value = String(args[0] || '').toLowerCase();
    if (!['public', 'private'].includes(value)) throw new Error('Usage: .mode public|private');
    store.setSessionSetting(ctx.sessionId || 'primary', 'mode', value); return reply(`This account is now ${value}.`);
  }
  if (['menu', 'help', 'commands', 'menufull', 'fullmenu'].includes(command)) return reply(
    'VOID XMD V2\n.start — detailed setup and usage guide\n.setup — enable this account\n.settings — account controls\n.ai MESSAGE\n.aistatus\n.businesshelp\n.businessai on|off\n.setaipersonality TEXT\n.pauseai NUMBER\n.resumeai NUMBER\n.devices\n.adddevice NUMBER\n.removedevice NUMBER CONFIRM\n.providers\n.setaimodel PROVIDER MODEL\n.stats\n\nAccount settings and conversation memory are separate for each linked account.'
  );
  if (['ping', 'health'].includes(command)) return reply('AI chat bot is running.');
  if (command === 'stats') { accountOwner(); return reply(`Memory: ${Math.round(process.memoryUsage().rss / 1048576)} MB\nSessions: ${ctx.deviceManager.list().length}/${ctx.deviceManager.max()}`); }
  if (['public', 'private'].includes(command)) { accountOwner(); store.setSessionSetting(ctx.sessionId || 'primary', 'mode', command); return reply(`This account is now ${command}.`); }
  if (command === 'devices') { admin(); return reply(ctx.deviceManager.list().map(x => `${x.primary ? 'PRIMARY' : 'ACCOUNT'} ${x.phone || x.id}: ${x.status}`).join('\n')); }
  if (command === 'adddevice') {
    admin(); const phone = String(args[0] || '').replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(phone)) throw new Error('Usage: .adddevice 2348012345678');
    const result = await ctx.deviceManager.add(phone);
    return reply(`Pairing code for ${phone}: ${result.code}\nWhatsApp → Linked devices → Link with phone number.`);
  }
  if (command === 'removedevice') { admin(); if (!args[0] || args[1] !== 'CONFIRM') throw new Error('Usage: .removedevice NUMBER CONFIRM'); await ctx.deviceManager.remove(args[0]); return reply('Account removed and logged out.'); }
  if (['providers', 'aistatus'].includes(command)) { accountOwner(); return reply(aiProviderStatus().map(x => `${x.name}: ${x.configured ? 'ready' : 'not configured'}${x.cooldownSeconds ? ` (cooldown ${x.cooldownSeconds}s)` : ''}\n${x.allowance}`).join('\n\n')); }
  if (command === 'setaimodel') {
    admin(); const provider = providerCatalog.find(x => x.name === args[0]); const model = args[1];
    if (!provider || !model) throw new Error('Usage: .setaimodel PROVIDER MODEL');
    if (provider.name === 'openrouter' && model !== 'openrouter/free' && !model.endsWith(':free')) throw new Error('OpenRouter must use openrouter/free or a :free model.');
    store.setGlobal(`${provider.name}Model`, model); return reply(`Model saved for ${provider.name}.`);
  }
  if (command === 'addapikey') {
    admin(); if (isGroup) throw new Error('Configure keys only in a private chat or server environment.');
    const name = String(args[0] || '').toLowerCase(); const key = text.slice((args[0] || '').length).trim();
    if (!providerCatalog.some(x => x.name === name) || !key) throw new Error('Usage: .addapikey PROVIDER KEY');
    store.setApiKey(name, key); await ctx.sock.sendMessage(ctx.chat, { delete: ctx.raw.key }).catch(() => {});
    return ctx.sock.sendMessage(ctx.chat, { text: `Key saved for ${name}.` });
  }
  if (command === 'removeapikey') { admin(); store.removeApiKey(args[0]); return reply('Saved key removed. Environment keys must be removed from the server.'); }
  if (command === 'listapikeys') { admin(); return reply(store.listApiKeys().join('\n') || 'No saved keys.'); }
  if (['ai', 'gpt', 'explain', 'rewrite', 'summarize'].includes(command)) {
    accountOwner(); if (!text) throw new Error('Add a message after the command.');
    return reply(await askAi(command === 'ai' || command === 'gpt' ? text : `${command}: ${text}`, { system: naturalChatStyle(store.getBusiness(ctx.sessionId || 'primary')) }));
  }
  if (await executePlugin({ ...ctx, config })) return;
  if (isOwner || isSessionOwner) return reply('Chat-only mode: use .help for available commands.');
}
