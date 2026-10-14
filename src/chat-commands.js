import { config } from './config.js';
import { store } from './store.js';
import { executePlugin, pluginDetails } from './plugin-loader.js';
import { askAi, aiProviderStatus, providerCatalog } from './ai-provider.js';
import { naturalChatStyle } from './chat-style.js';

export async function execute(ctx) {
  const { command, args, text, reply, isOwner, isSessionOwner, isGroup } = ctx;
  const admin = () => { if (!isOwner) throw new Error('Main owner only.'); };
  const accountOwner = () => { if (!isOwner && !isSessionOwner) throw new Error('Linked account owner only.'); };
  if (command === 'start') {
    const lines = [
      '*VOID XMD V2 | Getting started*',
      'A WhatsApp AI chat assistant with a website for managing each linked account.',
      '', '*1. Normal conversations*',
      'Send a normal private message to the linked number. No dot, keyword or command is needed. The account owner must enable automatic replies first. Group chats are not supported in this edition.',
      '', '*2. Create your own account*',
      'Open the bot website shared by the server owner. Choose Create a customer account, enter your own WhatsApp number with country code (Nigeria: 234), and choose a password of at least 12 characters.',
      'Sign in with that number as Account ID and your password. Registration is available only when the owner enables it over HTTPS and the server has a free session slot.',
      '', '*3. Link WhatsApp*',
      'In the website open Overview and generate a pairing code for your number. On that WhatsApp account go to Linked devices → Link a device → Link with phone number, then enter the code. Wait until the website shows Connected.',
      '', '*4. Your website controls*',
      'Select your account under WhatsApp accounts. Set personality, useful facts, reply tone and writing examples. You can pause/resume a contact, clear AI memory, and choose whether to learn tone from your own outgoing replies.',
      'Each customer can access only their own session. AI provider keys and models are managed by the server owner.',
      '', '*5. Tone learning*',
      'Learning uses limited outgoing samples available through WhatsApp sync, not your entire chat archive. Samples are included in requests to the selected AI provider. It is optional. New customer accounts start with learning and AI replies off.',
      '', '*6. If replies stop*',
      'Check Connected status, automatic replies, Public mode and at least one Ready AI provider. If a chat was handed to a human or paused, resume that contact. Your own outgoing messages do not trigger automatic replies.',
      '', '*7. Account access*',
      'Use only your own WhatsApp number. Keep your dashboard password private. For a lost password or an unavailable signup slot, contact the server owner.'
    ];
    if (isOwner || isSessionOwner) lines.push(
      '', '*Linked account owner commands*',
      'Send these from the linked account’s Message yourself chat:',
      '.public  — allow incoming AI chats',
      '.businessai on  — enable automatic AI replies',
      '.businessai off  — stop automatic replies',
      '.aistatus  — check AI providers',
      '.ai Hello  — test the AI directly',
      '.setaipersonality TEXT  — change personality',
      '.setaiexamples TEXT  — supply your writing examples',
      '.learntone on|off|clear  — control learned tone',
      '.pauseai NUMBER  — pause one contact',
      '.resumeai NUMBER  — resume one contact',
      'Use full numbers with country code. Commands and settings apply to this linked account.'
    );
    if (isOwner) lines.push('', '*Server owner controls*', '.devices — list sessions', '.adddevice NUMBER — link another number', '.providers — check AI options', 'Use the owner website login to configure provider keys and create, reset or revoke session-user logins. Never share WEB_ADMIN_KEY with customers.');
    return reply(lines.join('\n'));
  }
  if (command === 'mode') {
    accountOwner(); const value = String(args[0] || '').toLowerCase();
    if (!['public', 'private'].includes(value)) throw new Error('Usage: .mode public|private');
    store.setSessionSetting(ctx.sessionId || 'primary', 'mode', value); return reply(`This account is now ${value}.`);
  }
  if (['menu', 'help', 'commands', 'menufull', 'fullmenu'].includes(command)) return reply(
    'VOID XMD V2\n.start — detailed setup and usage guide\n.ai MESSAGE\n.aistatus\n.businesshelp\n.businessai on|off\n.setaipersonality TEXT\n.pauseai NUMBER\n.resumeai NUMBER\n.devices\n.adddevice NUMBER\n.removedevice NUMBER CONFIRM\n.providers\n.setaimodel PROVIDER MODEL\n.stats\n\nAccount settings and conversation memory are separate for each linked account.'
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
