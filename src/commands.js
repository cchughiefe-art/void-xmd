import crypto from 'node:crypto';
import os from 'node:os';
import { config } from './config.js';
import { renderMenu } from './menu.js';
import { renderFullMenu } from './full-menu.js';
import { store } from './store.js';
import { fetchJson, formatRuntime, jidNumber, run } from './utils.js';
import { executePlugin } from './plugin-loader.js';
import { askAi, getAiSettings } from './ai-provider.js';

const onOff = value => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['on','true','1','enable','enabled'].includes(normalized)) return true;
  if (['off','false','0','disable','disabled'].includes(normalized)) return false;
  throw new Error('Use on or off.');
};
const effectiveMode = () => store.getGlobal('mode', config.mode);
const pick = items => items[Math.floor(Math.random() * items.length)];

async function ai(prompt) {
  return askAi(prompt, { temperature: 0.7, maxTokens: 1200 });
}

export async function execute(ctx) {
  const { command, args, text, reply, sock, chat, sender, isOwner, isGroup, isAdmin, isBotAdmin, quoted } = ctx;
  const need = value => { if (!value) throw new Error('Add the required text after the command.'); return value; };
  const adminOnly = () => { if (!isGroup || (!isAdmin && !isOwner)) throw new Error('This command is for group admins.'); };
  const botAdmin = () => { adminOnly(); if (!isBotAdmin) throw new Error('Make the bot a group admin first.'); };
  const target = ctx.mentions?.[0] || quoted?.participant || (args[0]?.replace(/\D/g,'') ? `${args[0].replace(/\D/g,'')}@s.whatsapp.net` : null);

  if (command === 'devices') {
    if (!isOwner) throw new Error('Owner only.');
    if (!ctx.deviceManager) throw new Error('Multi-device manager is unavailable.');
    const rows = ctx.deviceManager.list();
    const lines = rows.map((device, index) => {
      const icon = device.connected ? '✅' : device.loggedOut ? '⛔' : device.status === 'waiting-for-pair' ? '🟡' : '⚪';
      const label = device.primary ? 'PRIMARY' : 'DEVICE';
      const number = device.phone || jidNumber(device.jid) || device.id;
      return `${index + 1}. ${icon} ${label} • ${number} • ${device.status}`;
    });
    return reply(`*${config.name} devices*\nConfigured: ${rows.length}/${ctx.deviceManager.max()}\n\n${lines.join('\n') || 'No WhatsApp sessions found.'}`);
  }

  if (command === 'adddevice') {
    if (!isOwner) throw new Error('Owner only.');
    if (!ctx.deviceManager) throw new Error('Multi-device manager is unavailable.');
    const phone = String(args[0] || '').replace(/\D/g, '');
    if (phone.length < 8) throw new Error('Usage: .adddevice 2348012345678');
    await reply(`Creating an additional WhatsApp session for ${phone}…`);
    const result = await ctx.deviceManager.add(phone);
    return reply(`*Pairing code for ${result.phone}*\n*${result.code}*\n\nOn that WhatsApp account:\nLinked devices → Link a device → Link with phone number.\n\nThe code is temporary. Run .devices after pairing.`);
  }

  if (command === 'removedevice') {
    if (!isOwner) throw new Error('Owner only.');
    if (!ctx.deviceManager) throw new Error('Multi-device manager is unavailable.');
    const id = String(args[0] || '').trim();
    if (!id || String(args[1] || '').toUpperCase() !== 'CONFIRM') throw new Error('Usage: .removedevice NUMBER_OR_ID CONFIRM');
    const removed = await ctx.deviceManager.remove(id);
    return reply(`Removed and logged out WhatsApp device ${removed.phone || removed.id}.`);
  }

  if (await executePlugin({ ...ctx, config })) return;

  if (['menu','help','commands'].includes(command)) return reply(renderMenu(ctx.pushName));
  if (['menufull','fullmenu','helpfull'].includes(command)) {
    for (const page of renderFullMenu(ctx.pushName)) await reply(page);
    return;
  }
  if (command === 'ping') return reply(`🏓 Pong: ${Date.now() - ctx.timestamp}ms`);
  if (command === 'runtime') return reply(`⏱️ ${formatRuntime(process.uptime())}`);
  if (command === 'botinfo') return reply(`*${config.name}*\nMode: ${effectiveMode()}\nNode: ${process.version}\nPlatform: ${os.platform()} ${os.arch()}\nUptime: ${formatRuntime(process.uptime())}`);
  if (command === 'owner') return reply(`Owner: wa.me/${config.owner}`);
  if (command === 'repo') return reply('VOID XMD\nhttps://github.com/cchughiefe-art/void-xmd');
  if (['public','private'].includes(command)) {
    if (!isOwner) throw new Error('Owner only.');
    store.setGlobal('mode', command);
    return reply(`Bot mode switched to ${command.toUpperCase()} immediately and saved persistently.`);
  }
  if (command === 'health') return reply('💚 Bot process and WhatsApp connection are active.');
  if (command === 'stats') { const s = store.stats(); return reply(`Users: ${s.users}\nGroups: ${s.groups}\nMemory: ${Math.round(process.memoryUsage().rss/1048576)} MB`); }

  if (['ai','gpt'].includes(command)) return reply(await ai(need(text)));
  if (command === 'explain') return reply(await ai(`Explain simply:\n${need(text)}`));
  if (command === 'rewrite') return reply(await ai(`Rewrite clearly and naturally:\n${need(text)}`));
  if (command === 'summarize') return reply(await ai(`Summarize concisely:\n${need(text)}`));
  if (command === 'aistatus') {
    const current = getAiSettings({ required: false });
    return reply(current.key ? `AI ready: ${current.model}\nSource: ${current.source}` : 'AI is disabled. Owner: use .addapikey gemini YOUR_KEY in a private chat.');
  }

  if (command === 'weather') {
    const place = encodeURIComponent(need(text));
    const data = await fetchJson(`https://wttr.in/${place}?format=j1`);
    const now = data.current_condition?.[0];
    return reply(`*Weather: ${data.nearest_area?.[0]?.areaName?.[0]?.value || text}*\n${now?.weatherDesc?.[0]?.value}\nTemperature: ${now?.temp_C}°C\nFeels like: ${now?.FeelsLikeC}°C\nHumidity: ${now?.humidity}%`);
  }
  if (command === 'wikipedia') {
    const q = encodeURIComponent(need(text));
    const search = await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&format=json&origin=*`);
    const title = search.query?.search?.[0]?.title; if (!title) throw new Error('No Wikipedia result found.');
    const page = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    return reply(`*${page.title}*\n${page.extract}\n${page.content_urls?.mobile?.page || ''}`);
  }
  if (command === 'translate') return reply(await ai(`Translate this appropriately. If no target language is stated, translate to English:\n${need(text)}`));
  if (command === 'define') return reply(await ai(`Give a brief dictionary definition with one example:\n${need(text)}`));

  if (['play','ytmp3','yt','tiktok','instagram','twitter','facebook','socialdl'].includes(command)) {
    const query = need(text); const url = /^https?:\/\//i.test(query) ? query : `ytsearch1:${query}`;
    const audio = ['play','ytmp3'].includes(command);
    const direct = await run('yt-dlp', ['--no-playlist','--no-warnings','--print', audio ? '%(url)s\n%(title)s' : '%(url)s\n%(title)s', audio ? '-f' : '-f', audio ? 'bestaudio[ext=m4a]/bestaudio' : 'best[ext=mp4]/best', url]);
    const lines = direct.split('\n'); const mediaUrl = lines[0], title = lines.slice(1).join(' ') || 'Media';
    return sock.sendMessage(chat, audio ? { audio: { url: mediaUrl }, mimetype: 'audio/mp4', fileName: `${title}.m4a` } : { video: { url: mediaUrl }, caption: title }, { quoted: ctx.raw });
  }

  if (command === 'uppercase') return reply(need(text).toUpperCase());
  if (command === 'lowercase') return reply(need(text).toLowerCase());
  if (command === 'reverse') return reply([...need(text)].reverse().join(''));
  if (command === 'wordcount') return reply(String(need(text).trim().split(/\s+/).length));
  if (command === 'charcount') return reply(String(need(text).length));
  if (command === 'base64') return reply(Buffer.from(need(text)).toString('base64'));
  if (command === 'base64decode') return reply(Buffer.from(need(text), 'base64').toString('utf8'));
  if (command === 'hash') return reply(crypto.createHash('sha256').update(need(text)).digest('hex'));
  if (command === 'uuid') return reply(crypto.randomUUID());
  if (command === 'password') return reply(crypto.randomBytes(Number(args[0]) > 5 && Number(args[0]) < 65 ? Number(args[0]) : 12).toString('base64url'));
  if (command === 'timestamp') return reply(`${Date.now()}\n${new Date().toISOString()}`);
  if (command === 'jsonpretty') return reply('```'+JSON.stringify(JSON.parse(need(text)), null, 2)+'```');
  if (command === 'calc') { if (!/^[\d\s()+\-*/%.]+$/.test(text)) throw new Error('Only arithmetic expressions are allowed.'); return reply(String(Function(`"use strict"; return (${text})`)())); }
  if (command === 'qr') return sock.sendMessage(chat, { image: { url: `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(need(text))}` }, caption: 'QR code' }, { quoted: ctx.raw });
  if (command === 'short') {
    const result = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(need(text))}`, { signal: AbortSignal.timeout(15000) });
    if (!result.ok) throw new Error(`URL shortener returned ${result.status}`);
    return reply(await result.text());
  }

  if (command === 'groupid') { if (!isGroup) throw new Error('Group only.'); return reply(chat); }
  if (command === 'groupinfo') { if (!isGroup) throw new Error('Group only.'); const m = ctx.metadata; return reply(`*${m.subject}*\nMembers: ${m.participants.length}\nOwner: ${m.owner ? jidNumber(m.owner) : 'Unknown'}\nDescription: ${m.desc || 'None'}`); }
  if (command === 'admins') { if (!isGroup) throw new Error('Group only.'); return reply(`*Admins*\n${ctx.metadata.participants.filter(p=>p.admin).map(p=>`• @${jidNumber(p.id)}`).join('\n')}`, ctx.metadata.participants.filter(p=>p.admin).map(p=>p.id)); }
  if (command === 'link') { botAdmin(); return reply(`https://chat.whatsapp.com/${await sock.groupInviteCode(chat)}`); }
  if (command === 'revokeinvite') { botAdmin(); await sock.groupRevokeInvite(chat); return reply('Group invite link revoked.'); }
  if (['promote','demote','kick'].includes(command)) { botAdmin(); if (!target) throw new Error('Mention or reply to a member.'); await sock.groupParticipantsUpdate(chat,[target],command === 'kick' ? 'remove' : command); return reply('Done.'); }
  if (command === 'mute' || command === 'unmute') { botAdmin(); await sock.groupSettingUpdate(chat, command === 'mute' ? 'announcement' : 'not_announcement'); return reply(`Group ${command}d.`); }
  if (command === 'tagall' || command === 'hidetag') { adminOnly(); const ids = ctx.metadata.participants.map(p=>p.id); return reply(command === 'tagall' ? `*Attention everyone*\n${ids.map(id=>`@${jidNumber(id)}`).join(' ')}` : (text || 'Attention'), ids); }
  if (['setwelcome','setgoodbye','setrules'].includes(command)) {
    adminOnly();
    const key = command.replace('set','');
    const value = key === 'rules' ? need(text) : onOff(args[0]);
    store.updateGroup(chat, { [key]: value });
    return reply(`${key} updated.`);
  }
  if (command === 'rules') {
    if (!isGroup) throw new Error('Group only.');
    return reply(store.getGroup(chat).rules || 'No rules have been set.');
  }
  if (command === 'antilink') {
    adminOnly();
    const enabled = onOff(args[0]);
    store.updateGroup(chat, {
      antilink: enabled,
      antiLinkMode: enabled ? 'delete' : 'off'
    });
    return reply(`antilink: ${enabled ? 'ON' : 'OFF'}`);
  }
  if (command === 'antibadwords') {
    adminOnly();
    const enabled = onOff(args[0]);
    store.updateGroup(chat, { antibadwords: enabled });
    return reply(`antibadwords: ${enabled ? 'ON' : 'OFF'}`);
  }
  if (command === 'warn') { adminOnly(); if (!target) throw new Error('Mention or reply to a member.'); const g=store.getGroup(chat); g.warnings[target]=(g.warnings[target]||0)+1; store.updateGroup(chat,{warnings:g.warnings}); return reply(`Warning ${g.warnings[target]}/3 for @${jidNumber(target)}`,[target]); }
  if (command === 'warnings') { if (!isGroup) throw new Error('Group only.'); if (!target) throw new Error('Mention or reply to a member.'); return reply(`Warnings: ${store.getGroup(chat).warnings[target]||0}/3`); }
  if (command === 'clearwarn') { adminOnly(); if (!target) throw new Error('Mention or reply to a member.'); const g=store.getGroup(chat); delete g.warnings[target]; store.updateGroup(chat,{warnings:g.warnings}); return reply('Warnings cleared.'); }

  if (command === 'coinflip') return reply(pick(['Heads','Tails']));
  if (command === 'dice') return reply(`🎲 ${1+Math.floor(Math.random()*6)}`);
  if (command === 'rps') {
    const yours = String(args[0] || '').toLowerCase();
    if (!['rock','paper','scissors'].includes(yours)) throw new Error('Usage: .rps rock|paper|scissors');
    const mine = pick(['rock','paper','scissors']);
    const win = (yours === 'rock' && mine === 'scissors') || (yours === 'paper' && mine === 'rock') || (yours === 'scissors' && mine === 'paper');
    const result = yours === mine ? 'Draw.' : win ? 'You win.' : 'I win.';
    return reply(`You: ${yours}\nVOID XMD: ${mine}\n${result}`);
  }
  if (command === '8ball') return reply(pick(['Yes','No','Probably','Unlikely','Ask again later']));
  if (command === 'choose') return reply(pick(need(text).split('|').map(x=>x.trim()).filter(Boolean)));
  if (command === 'rate') return reply(`${Math.floor(Math.random()*101)}%`);
  if (command === 'ship') return reply(`Compatibility: ${Math.floor(Math.random()*101)}% ❤️`);
  if (command === 'joke') return reply(pick(['Why did the developer go broke? Because they used up all their cache.','There are 10 kinds of people: those who understand binary and those who do not.']));
  if (command === 'quote') return reply(pick(['Small progress is still progress.','Consistency beats intensity when intensity cannot be sustained.']));
  if (command === 'truth') return reply(pick(['What is something you pretend not to care about?','What is your biggest unfinished goal?']));
  if (command === 'dare') return reply(pick(['Send a voice note singing for ten seconds.','Compliment the last person who messaged you.']));
  if (command === 'balance') return reply(`🪙 ${store.balance(sender)} coins`);
  if (command === 'daily') {
    const claims = store.getGlobal('dailyClaims', {});
    const now = Date.now();
    const last = Number(claims[sender] || 0);
    const remaining = 86400000 - (now - last);
    if (last && remaining > 0) {
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.ceil((remaining % 3600000) / 60000);
      return reply(`Daily reward already claimed. Try again in ${hours}h ${minutes}m.`);
    }
    claims[sender] = now;
    store.setGlobal('dailyClaims', claims);
    return reply(`Daily reward claimed: +100 coins\nBalance: ${store.addCoins(sender,100)} coins`);
  }
  if (command === 'pay') { if (!target || !Number.isFinite(Number(args.at(-1)))) throw new Error('Mention someone and add an amount.'); const amount=Math.max(1,Math.floor(Number(args.at(-1)))); if(store.balance(sender)<amount) throw new Error('Insufficient balance.'); store.addCoins(sender,-amount); store.addCoins(target,amount); return reply(`Transferred ${amount} coins.`); }

  if (command === 'block' || command === 'unblock') { if (!isOwner) throw new Error('Owner only.'); if (!target) throw new Error('Mention or reply to a user.'); await sock.updateBlockStatus(target, command === 'block'?'block':'unblock'); return reply('Done.'); }
  if (command === 'restart') { if (!isOwner) throw new Error('Owner only.'); await reply('Restarting…'); setTimeout(()=>process.exit(0),500); return; }
  throw new Error(`Unknown command. Use ${config.prefix}menu`);
}
