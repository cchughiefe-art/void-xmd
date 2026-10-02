import { store } from '../store.js';
import { jidNumber, sleep } from '../utils.js';

const onOff = value => ['on', 'true', '1', 'enable', 'enabled'].includes(String(value || '').toLowerCase());
const phoneJid = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
};

const groupToggle = (name, key = name) => ({
  name,
  category: 'AUTOMATION',
  groupOnly: true,
  adminOnly: true,
  description: `Toggle ${name} for this group`,
  async run({ args, reply, chat }) {
    if (!args[0]) throw new Error(`Usage: .${name} on|off`);
    const enabled = onOff(args[0]);
    store.updateGroup(chat, { [key]: enabled });
    await reply(`${name}: ${enabled ? 'ON' : 'OFF'}`);
  }
});

const globalToggle = name => ({
  name,
  category: 'AUTOMATION',
  ownerOnly: true,
  description: `Toggle account-wide ${name}`,
  async run({ args, reply }) {
    if (!args[0]) throw new Error(`Usage: .${name} on|off`);
    const enabled = onOff(args[0]);
    store.setGlobal(name, enabled);
    await reply(`${name}: ${enabled ? 'ON' : 'OFF'}`);
  }
});

export default [
  {
    name: 'add',
    category: 'GROUP',
    groupOnly: true,
    adminOnly: true,
    description: 'Add a member by international phone number',
    async run({ args, reply, sock, chat, isBotAdmin }) {
      if (!isBotAdmin) throw new Error('Make the bot a group admin first.');
      const jid = phoneJid(args[0]);
      if (!jid) throw new Error('Usage: .add 2348012345678');
      const result = await sock.groupParticipantsUpdate(chat, [jid], 'add');
      await reply(`Add request sent for @${jidNumber(jid)}.\n${JSON.stringify(result)}`, [jid]);
    }
  },
  {
    name: 'leavegc',
    category: 'GROUP',
    groupOnly: true,
    ownerOnly: true,
    description: 'Make the bot leave the current group',
    async run({ reply, sock, chat }) {
      await reply('Leaving this group.');
      await sock.groupLeave(chat);
    }
  },
  {
    name: 'join',
    category: 'GROUP',
    ownerOnly: true,
    description: 'Join a group from an invite link or code',
    async run({ text, reply, sock }) {
      const code = String(text || '').match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i)?.[1] ||
        String(text || '').trim();
      if (!code) throw new Error('Usage: .join https://chat.whatsapp.com/INVITECODE');
      const jid = await sock.groupAcceptInvite(code);
      await reply(`Joined group: ${jid}`);
    }
  },
  {
    name: 'gcstatus',
    category: 'GROUP',
    groupOnly: true,
    description: 'Show current group settings',
    async run({ reply, chat }) {
      const g = store.getGroup(chat);
      const rows = [
        ['antilink', g.antiLinkMode || (g.antilink ? 'delete' : 'off')],
        ['antibad', g.antibadwords],
        ['antidelete', g.antidelete],
        ['antiviewonce', g.antiviewonce],
        ['antisticker', g.antisticker],
        ['antinsfw', g.antinsfw],
        ['antimedia', g.antimedia],
        ['antimention', g.antimention],
        ['antitag', g.antitag],
        ['antitemu', g.antitemu],
        ['autotyping', g.autotyping],
        ['autorecording', g.autorecording],
        ['autoread', g.autoread],
        ['autoreact', g.autoreact],
        ['chatbot', g.chatbot]
      ];
      await reply(rows.map(([k, v]) => `${k}: ${typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : v}`).join('\n'));
    }
  },
  {
    name: 'getname',
    category: 'GROUP',
    groupOnly: true,
    description: 'Show the group name',
    run: ({ reply, metadata }) => reply(metadata.subject || 'Unnamed group')
  },
  {
    name: 'getdeskgc',
    category: 'GROUP',
    groupOnly: true,
    description: 'Show the group description',
    run: ({ reply, metadata }) => reply(metadata.desc || 'No group description.')
  },
  {
    name: 'getppgc',
    category: 'GROUP',
    groupOnly: true,
    description: 'Get the group profile picture',
    async run({ sock, chat, raw }) {
      const url = await sock.profilePictureUrl(chat, 'image').catch(() => null);
      if (!url) throw new Error('This group has no accessible profile picture.');
      await sock.sendMessage(chat, { image: { url }, caption: 'Group profile picture' }, { quoted: raw });
    }
  },
  {
    name: 'setppgc',
    category: 'GROUP',
    groupOnly: true,
    adminOnly: true,
    description: 'Set the group profile picture from a replied image',
    async run({ sock, chat, downloadMedia, reply, isBotAdmin }) {
      if (!isBotAdmin) throw new Error('Make the bot a group admin first.');
      const image = await downloadMedia();
      await sock.updateProfilePicture(chat, image);
      await reply('Group profile picture updated.');
    }
  },
  {
    name: 'svcontact',
    category: 'GROUP',
    description: 'Create a vCard contact from a phone number and name',
    async run({ args, text, sock, chat, raw }) {
      const digits = String(args[0] || '').replace(/\D/g, '');
      if (!digits) throw new Error('Usage: .svcontact 2348012345678 Name');
      const name = text.slice(args[0].length).trim() || digits;
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${name.replace(/\n/g, ' ')}\nTEL;TYPE=CELL:+${digits}\nEND:VCARD`;
      await sock.sendMessage(chat, {
        contacts: { displayName: name, contacts: [{ displayName: name, vcard }] }
      }, { quoted: raw });
    }
  },
  {
    name: 'listonline',
    category: 'GROUP',
    groupOnly: true,
    description: 'Check recent online presence for group members',
    async run({ sock, chat, metadata, reply }) {
      const seen = new Map();
      const handler = update => {
        if (update.id !== chat) return;
        for (const [jid, value] of Object.entries(update.presences || {})) {
          if (value?.lastKnownPresence === 'available' || value?.lastKnownPresence === 'composing' || value?.lastKnownPresence === 'recording') {
            seen.set(jid, value.lastKnownPresence);
          }
        }
      };
      sock.ev.on('presence.update', handler);
      try {
        for (const p of metadata.participants.slice(0, 100)) {
          await sock.presenceSubscribe(p.id).catch(() => {});
        }
        await sleep(2500);
      } finally {
        sock.ev.off?.('presence.update', handler);
      }
      if (!seen.size) return reply('No online presence was reported in the last few seconds.');
      const ids = [...seen.keys()];
      await reply(`*Recently online*\n${ids.map(id => `• @${jidNumber(id)} (${seen.get(id)})`).join('\n')}`, ids);
    }
  },
  {
    name: 'creategc',
    category: 'GROUP',
    ownerOnly: true,
    description: 'Create a group: .creategc Name | number1 number2',
    async run({ text, reply, sock }) {
      const [subjectRaw, membersRaw = ''] = String(text || '').split('|');
      const subject = subjectRaw?.trim();
      if (!subject) throw new Error('Usage: .creategc Group Name | 23480... 23481...');
      const participants = membersRaw.split(/\s+/).map(phoneJid).filter(Boolean);
      const result = await sock.groupCreate(subject, participants);
      await reply(`Created *${subject}*\n${result.id}`);
    }
  },
  {
    name: 'promoteall',
    category: 'GROUP',
    groupOnly: true,
    adminOnly: true,
    description: 'Promote all non-admin members',
    async run({ sock, chat, metadata, reply, isBotAdmin }) {
      if (!isBotAdmin) throw new Error('Make the bot a group admin first.');
      const ids = metadata.participants.filter(p => !p.admin).map(p => p.id);
      if (!ids.length) return reply('Everyone is already an admin.');
      for (let i = 0; i < ids.length; i += 20) {
        await sock.groupParticipantsUpdate(chat, ids.slice(i, i + 20), 'promote');
        await sleep(700);
      }
      await reply(`Promoted ${ids.length} member(s).`);
    }
  },
  {
    name: 'demoteall',
    category: 'GROUP',
    groupOnly: true,
    ownerOnly: true,
    description: 'Demote all admins except the bot/group owner',
    async run({ sock, chat, metadata, reply, isBotAdmin }) {
      if (!isBotAdmin) throw new Error('Make the bot a group admin first.');
      const me = jidNumber(sock.user?.id);
      const owner = jidNumber(metadata.owner);
      const ids = metadata.participants
        .filter(p => p.admin && jidNumber(p.id) !== me && jidNumber(p.id) !== owner)
        .map(p => p.id);
      for (let i = 0; i < ids.length; i += 20) {
        await sock.groupParticipantsUpdate(chat, ids.slice(i, i + 20), 'demote');
        await sleep(700);
      }
      await reply(`Demoted ${ids.length} admin(s).`);
    }
  },
  {
    name: 'kickall',
    category: 'GROUP',
    groupOnly: true,
    ownerOnly: true,
    description: 'Remove all non-admin members (requires CONFIRM)',
    async run({ args, sock, chat, metadata, reply, isBotAdmin }) {
      if (String(args[0] || '').toUpperCase() !== 'CONFIRM') {
        throw new Error('Destructive command. Use .kickall CONFIRM');
      }
      if (!isBotAdmin) throw new Error('Make the bot a group admin first.');
      const ids = metadata.participants.filter(p => !p.admin).map(p => p.id);
      for (let i = 0; i < ids.length; i += 10) {
        await sock.groupParticipantsUpdate(chat, ids.slice(i, i + 10), 'remove');
        await sleep(1000);
      }
      await reply(`Removed ${ids.length} non-admin member(s).`);
    }
  },
  {
    name: 'antilink-delete',
    category: 'AUTOMATION',
    groupOnly: true,
    adminOnly: true,
    description: 'Delete group invite links',
    async run({ args, reply, chat }) {
      const enabled = onOff(args[0]);
      store.updateGroup(chat, { antiLinkMode: enabled ? 'delete' : 'off', antilink: enabled });
      await reply(`antilink-delete: ${enabled ? 'ON' : 'OFF'}`);
    }
  },
  {
    name: 'antilink-warn',
    category: 'AUTOMATION',
    groupOnly: true,
    adminOnly: true,
    description: 'Delete invite links and warn senders',
    async run({ args, reply, chat }) {
      const enabled = onOff(args[0]);
      store.updateGroup(chat, { antiLinkMode: enabled ? 'warn' : 'off', antilink: enabled });
      await reply(`antilink-warn: ${enabled ? 'ON' : 'OFF'}`);
    }
  },
  {
    name: 'antilink-kick',
    category: 'AUTOMATION',
    groupOnly: true,
    adminOnly: true,
    description: 'Delete invite links and remove senders',
    async run({ args, reply, chat }) {
      const enabled = onOff(args[0]);
      store.updateGroup(chat, { antiLinkMode: enabled ? 'kick' : 'off', antilink: enabled });
      await reply(`antilink-kick: ${enabled ? 'ON' : 'OFF'}`);
    }
  },
  groupToggle('antidelete'),
  groupToggle('antiviewonce'),
  groupToggle('antisticker'),
  groupToggle('antinsfw'),
  groupToggle('antimedia'),
  groupToggle('antimention'),
  groupToggle('antitag'),
  groupToggle('antitemu'),
  {
    name: 'addbadword',
    category: 'AUTOMATION',
    groupOnly: true,
    adminOnly: true,
    description: 'Add a blocked word',
    async run({ text, reply, chat }) {
      const word = String(text || '').trim().toLowerCase();
      if (!word) throw new Error('Usage: .addbadword word');
      const g = store.getGroup(chat);
      const badwords = [...new Set([...(g.badwords || []), word])];
      store.updateGroup(chat, { badwords, antibadwords: true });
      await reply(`Blocked word added. Total: ${badwords.length}`);
    }
  },
  {
    name: 'delbadword',
    category: 'AUTOMATION',
    groupOnly: true,
    adminOnly: true,
    description: 'Remove a blocked word',
    async run({ text, reply, chat }) {
      const word = String(text || '').trim().toLowerCase();
      if (!word) throw new Error('Usage: .delbadword word');
      const g = store.getGroup(chat);
      const badwords = (g.badwords || []).filter(x => x !== word);
      store.updateGroup(chat, { badwords });
      await reply(`Blocked word removed. Total: ${badwords.length}`);
    }
  },
  groupToggle('autotyping'),
  groupToggle('autorecording'),
  groupToggle('autoread'),
  groupToggle('autoreact'),
  groupToggle('chatbot'),
  globalToggle('anticall'),
  globalToggle('autostatus'),
  globalToggle('autoviewstatus'),
  globalToggle('autostatusreact'),
  globalToggle('autobio'),
  globalToggle('alwaysonline')
];
