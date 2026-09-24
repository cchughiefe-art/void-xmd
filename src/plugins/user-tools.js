import { jidNumber } from '../utils.js';

export default [
  {
    name: 'myjid', aliases: ['jid'], category: 'USER TOOLS', description: 'Show your WhatsApp JID',
    run: ({ sender, reply }) => reply(sender)
  },
  {
    name: 'mentionme', category: 'USER TOOLS', description: 'Mention yourself',
    run: ({ sender, reply }) => reply(`Hello @${jidNumber(sender)}`, [sender])
  },
  {
    name: 'getpp', aliases: ['avatar'], category: 'USER TOOLS', description: 'Get profile picture',
    run: async ({ sock, chat, sender, mentions, quoted, raw }) => {
      const target=mentions?.[0]||quoted?.participant||sender;
      const url=await sock.profilePictureUrl(target,'image').catch(()=>null); if(!url) throw new Error('Profile picture is unavailable.');
      await sock.sendMessage(chat,{image:{url},caption:`Profile picture: @${jidNumber(target)}`,mentions:[target]},{quoted:raw});
    }
  },
  {
    name: 'groupcount', category: 'USER TOOLS', groupOnly: true, description: 'Count group members',
    run: ({ metadata, reply }) => reply(`Members: ${metadata.participants.length}`)
  }
];
