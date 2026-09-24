// Files beginning with _ are ignored. Copy this file to hello.js, then remove
// the leading underscore from its filename. No central command list is needed.
export default {
  name: 'hello',
  aliases: ['hi'],
  category: 'CUSTOM',
  description: 'A minimal custom command',
  ownerOnly: false,
  groupOnly: false,
  adminOnly: false,
  async run({ reply, pushName }) {
    await reply(`Hello ${pushName}!`);
  }
};
