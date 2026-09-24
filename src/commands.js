import crypto from 'node:crypto';
import os from 'node:os';
import { config } from './config.js';
import { renderMenu } from './menu.js';
import { store } from './store.js';
import { fetchJson, formatRuntime, jidNumber, run } from './utils.js';
import { executePlugin } from './plugin-loader.js';

const onOff = value => ['on','true','1','enable'].includes(String(value).toLowerCase());
const pick = items => items[Math.floor(Math.random() * items.length)];

async function ai(prompt) {
  if (!config.aiKey) throw new Error('AI_API_KEY has not been configured.');
  const data = await fetchJson(`${config.aiBaseUrl}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.aiKey}` },
    body: JSON.stringify({ model: config.aiModel, messages: [{ role: 'user', content: prompt }], temperature: 0.7 })
  }, 45000);
  return data.choices?.[0]?.message?.content || 'The AI provider returned no answer.';
}

export async function execute(ctx) {
  const { command, args, text, reply, sock, chat, sender, isOwner, isGroup, isAdmin, isBotAdmin, quoted } = ctx;
  const need = value => { if (!value) throw new Error('Add the required text after the command.'); return value; };
  const adminOnly = () => { if (!isGroup || (!isAdmin && !isOwner)) throw new Error('This command is for group admins.'); };
  const botAdmin = () => { adminOnly(); if (!isBotAdmin) throw new Error('Make the bot a group admin first.'); };
  const target = ctx.mentions?.[0] || quoted?.participant || (args[0]?.replace(/\D/g,'') ? `${args[0].replace(/\D/g,'')}@s.whatsapp.net` : null);

  if (await executePlugin({ ...ctx, config })) return;

  if (['menu','help','commands'].includes(command)) return reply(renderMenu(ctx.pushName));
  if (command === 'ping') return reply(`🏓 Pong: ${Date.now() - ctx.timestamp}ms`);
  if (command === 'runtime') return reply(`⏱️ ${formatRuntime(process.uptime())}`);
  if (command === 'botinfo') return reply(`*${config.name}*\nMode: ${config.mode}\nNode: ${process.version}\nPlatform: ${os.platform()} ${os.arch()}\nUptime: ${formatRuntime(process.uptime())}`);
  if (command === 'owner') return reply(`Owner: wa.me/${config.owner}`);
  if (command === 'repo') return reply('VOID XMD private deployment build.');
  if (['public','private'].includes(command)) { if (!isOwner) throw new Error('Owner only.'); return reply(`Set MODE=${command} in Raven and restart to keep this change.`); }
  if (command === 'health') return reply('💚 Bot process and WhatsApp connection are active.');
  if (command === 'stats') { const s = store.stats(); return reply(`Users: ${s.users}\nGroups: ${s.groups}\nMemory: ${Math.round(process.memoryUsage().rss/1048576)} MB`); }

  if (['ai','gpt'].includes(command)) return reply(await ai(need(text)));
  if (command === 'explain') return reply(await ai(`Explain simply:\n${need(text)}`));
  if (command === 'rewrite') return reply(await ai(`Rewrite clearly and naturally:\n${need(text)}`));
  if (command === 'summarize') return reply(await ai(`Summarize concisely:\n${need(text)}`));
  if (command === 'aistatus') return reply(config.aiKey ? `AI ready: ${config.aiModel}` : 'AI is disabled. Add AI_API_KEY.');

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
  if (command === 'short') { const result = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(need(text))}`, { signal: AbortSignal.timeout(15000) }); return reply(await result.text()); }

  if (command === 'groupid') { if (!isGroup) throw new Error('Group only.'); return reply(chat); }
  if (command === 'groupinfo') { if (!isGroup) throw new Error('Group only.'); const m = ctx.metadata; return reply(`*${m.subject}*\nMembers: ${m.participants.length}\nOwner: ${m.owner ? jidNumber(m.owner) : 'Unknown'}\nDescription: ${m.desc || 'None'}`); }
  if (command === 'admins') { if (!isGroup) throw new Error('Group only.'); return reply(`*Admins*\n${ctx.metadata.participants.filter(p=>p.admin).map(p=>`• @${jidNumber(p.id)}`).join('\n')}`, ctx.metadata.participants.filter(p=>p.admin).map(p=>p.id)); }
  if (command === 'link') { botAdmin(); return reply(`https://chat.whatsapp.com/${await sock.groupInviteCode(chat)}`); }
  if (command === 'revokeinvite') { botAdmin(); await sock.groupRevokeInvite(chat); return reply('Group invite link revoked.'); }
  if (['promote','demote','kick'].includes(command)) { botAdmin(); if (!target) throw new Error('Mention or reply to a member.'); await sock.groupParticipantsUpdate(chat,[target],command === 'kick' ? 'remove' : command); return reply('Done.'); }
  if (command === 'mute' || command === 'unmute') { botAdmin(); await sock.groupSettingUpdate(chat, command === 'mute' ? 'announcement' : 'not_announcement'); return reply(`Group ${command}d.`); }
  if (command === 'tagall' || command === 'hidetag') { adminOnly(); const ids = ctx.metadata.participants.map(p=>p.id); return reply(command === 'tagall' ? `*Attention everyone*\n${ids.map(id=>`@${jidNumber(id)}`).join(' ')}` : (text || 'Attention'), ids); }
  if (['setwelcome','setgoodbye','setrules'].includes(command)) { adminOnly(); const key = command.replace('set',''); store.updateGroup(chat,{[key]: key === 'rules' ? need(text) : onOff(args[0])}); return reply(`${key} updated.`); }
  if (command === 'rules') return reply(store.getGroup(chat).rules || 'No rules have been set.');
  if (['antilink','antibadwords'].includes(command)) { adminOnly(); store.updateGroup(chat,{[command]:onOff(args[0])}); return reply(`${command}: ${onOff(args[0])?'ON':'OFF'}`); }
  if (['anticall','antidelete','antiviewonce','autoreact','autostatus'].includes(command)) return reply('This protection is listed but disabled in the safe build until its behavior is configured.');
  if (command === 'warn') { adminOnly(); if (!target) throw new Error('Mention or reply to a member.'); const g=store.getGroup(chat); g.warnings[target]=(g.warnings[target]||0)+1; store.updateGroup(chat,{warnings:g.warnings}); return reply(`Warning ${g.warnings[target]}/3 for @${jidNumber(target)}`,[target]); }
  if (command === 'warnings') { if (!target) throw new Error('Mention or reply to a member.'); return reply(`Warnings: ${store.getGroup(chat).warnings[target]||0}/3`); }
  if (command === 'clearwarn') { adminOnly(); if (!target) throw new Error('Mention or reply to a member.'); const g=store.getGroup(chat); delete g.warnings[target]; store.updateGroup(chat,{warnings:g.warnings}); return reply('Warnings cleared.'); }

  if (command === 'coinflip') return reply(pick(['Heads','Tails']));
  if (command === 'dice') return reply(`🎲 ${1+Math.floor(Math.random()*6)}`);
  if (command === 'rps') { const mine=pick(['rock','paper','scissors']); return reply(`I chose ${mine}. You chose ${args[0]||'nothing'}.`); }
  if (command === '8ball') return reply(pick(['Yes','No','Probably','Unlikely','Ask again later']));
  if (command === 'choose') return reply(pick(need(text).split('|').map(x=>x.trim()).filter(Boolean)));
  if (command === 'rate') return reply(`${Math.floor(Math.random()*101)}%`);
  if (command === 'ship') return reply(`Compatibility: ${Math.floor(Math.random()*101)}% ❤️`);
  if (command === 'joke') return reply(pick(['Why did the developer go broke? Because they used up all their cache.','There are 10 kinds of people: those who understand binary and those who do not.']));
  if (command === 'quote') return reply(pick(['Small progress is still progress.','Consistency beats intensity when intensity cannot be sustained.']));
  if (command === 'truth') return reply(pick(['What is something you pretend not to care about?','What is your biggest unfinished goal?']));
  if (command === 'dare') return reply(pick(['Send a voice note singing for ten seconds.','Compliment the last person who messaged you.']));
  if (command === 'balance') return reply(`🪙 ${store.balance(sender)} coins`);
  if (command === 'daily') return reply(`Daily reward claimed. Balance: ${store.addCoins(sender,100)} coins`);
  if (command === 'pay') { if (!target || !Number.isFinite(Number(args.at(-1)))) throw new Error('Mention someone and add an amount.'); const amount=Math.max(1,Math.floor(Number(args.at(-1)))); if(store.balance(sender)<amount) throw new Error('Insufficient balance.'); store.addCoins(sender,-amount); store.addCoins(target,amount); return reply(`Transferred ${amount} coins.`); }

  if (command === 'block' || command === 'unblock') { if (!isOwner) throw new Error('Owner only.'); if (!target) throw new Error('Mention or reply to a user.'); await sock.updateBlockStatus(target, command === 'block'?'block':'unblock'); return reply('Done.'); }
  if (command === 'restart') { if (!isOwner) throw new Error('Owner only.'); await reply('Restarting…'); setTimeout(()=>process.exit(0),500); return; }
  throw new Error(`Unknown command. Use ${config.prefix}menu`);
}
