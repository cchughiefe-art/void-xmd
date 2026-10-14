import { config } from './config.js';
import { store } from './store.js';
import { executePlugin, pluginDetails } from './plugin-loader.js';
import { askAi, aiProviderStatus, providerCatalog } from './ai-provider.js';
import { naturalChatStyle } from './chat-style.js';

export async function execute(ctx) {
  const { command, args, text, reply, isOwner, isSessionOwner, isGroup } = ctx;
  const admin = () => { if (!isOwner) throw new Error('Main owner only.'); };
  const accountOwner = () => { if (!isOwner && !isSessionOwner) throw new Error('Linked account owner only.'); };
  if (['menu', 'help', 'commands', 'menufull', 'fullmenu'].includes(command)) return reply(
    'VOID XMD V2\n.ai MESSAGE\n.aistatus\n.businesshelp\n.businessai on|off\n.setaipersonality TEXT\n.pauseai NUMBER\n.resumeai NUMBER\n.devices\n.adddevice NUMBER\n.removedevice NUMBER CONFIRM\n.providers\n.setaimodel PROVIDER MODEL\n.stats\n\nAccount settings and conversation memory are separate for each linked account.'
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
