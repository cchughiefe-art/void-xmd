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
    name: 'groupcount', category: 'USER TOOLS', groupOnly: true, description: 'Count group members',
    run: ({ metadata, reply }) => reply(`Members: ${metadata.participants.length}`)
  }
];
