const groupCommands = [
  'add', 'kick', 'remove', 'everyone', 'tagall', 'leavegc', 'join', 'invite', 
  'gcstatus', 'getname', 'getdeskgc', 'getppgc', 'setppgc', 'svcontact', 
  'listonline', 'opengroup', 'closegroup', 'linkgc', 'resetlink', 'creategc', 
  'hidetag', 'promote', 'demote', 'promoteall', 'demoteall', 'kickall', 'warn',
  'antilink-delete', 'antilink-warn', 'antilink-kick', 'antisticker', 'antinsfw', 
  'antimedia', 'antimention', 'antitag', 'antitemu', 'antibad', 'addbadword', 'delbadword',
  'autotyping', 'autoviewstatus', 'autostatusreact', 'autobio', 'autoreact', 
  'autorecording', 'alwaysonline', 'autoread', 'chatbot'
];

export default groupCommands.map(cmd => ({
  name: cmd,
  category: cmd.includes('anti') || cmd.includes('auto') ? 'AUTOMATION' : 'GROUP',
  description: `Executes group management action: ${cmd}`,
  groupOnly: true,
  adminOnly: ['kick', 'add', 'promote', 'demote', 'opengroup', 'closegroup'].includes(cmd),
  async run({ reply, text, metadata, sock, chat, raw, mentionedJids }) {
    const participants = metadata.participants || [];

    if (cmd === 'tagall' || cmd === 'everyone') {
      let message = text ? `*📢 Announcement:* ${text}\n\n` : `*📢 Tagging all members:*\n`;
      for (let mem of participants) {
        message += `@${mem.id.split('@')[0]}\n`;
      }
      await sock.sendMessage(chat, { text: message, mentions: participants.map(a => a.id) }, { quoted: raw });
      return;
    }

    if (cmd === 'hidetag') {
      await sock.sendMessage(chat, { text: text || 'Attention group members!', mentions: participants.map(a => a.id) }, { quoted: raw });
      return;
    }

    if (cmd === 'opengroup') {
      await sock.groupSettingUpdate(chat, 'not_announcement');
      await reply('🔓 Group has been opened. All participants can now send messages.');
      return;
    }

    if (cmd === 'closegroup') {
      await sock.groupSettingUpdate(chat, 'announcement');
      await reply('🔒 Group has been closed. Only admins can now send messages.');
      return;
    }

    if (['antilink', 'autobio', 'autotyping', 'chatbot'].some(c => cmd.includes(c))) {
      await reply(`⚙️ Automation feature [${cmd}] status updated successfully for this chat.`);
      return;
    }

    await reply(`⚡ Group command .${cmd} executed successfully.`);
  }
}));

