import { store } from '../store.js';
import { getAiSettings } from '../ai-provider.js';
import { businessMemoryCount, clearBusinessMemory } from '../business-assistant.js';
import { jidNumber } from '../utils.js';

const onOff = value => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['on','true','1','enable','enabled'].includes(normalized)) return true;
  if (['off','false','0','disable','disabled'].includes(normalized)) return false;
  throw new Error('Use on or off.');
};

const sessionIdOf = ctx => String(ctx.sessionId || 'primary');
const customerFrom = value => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) throw new Error('Add the customer number, including country code.');
  return digits;
};

const setText = (name, field, usage) => ({
  name,
  category: 'BUSINESS AI',
  ownerOnly: true,
  description: `Set this WhatsApp session's ${field} for the business AI`,
  async run(ctx) {
    const value = String(ctx.text || '').trim();
    if (!value) throw new Error(`Usage: ${usage}`);
    const sid = sessionIdOf(ctx);
    store.updateBusiness(sid, { [field]: value });
    await ctx.reply(`${field} saved for this WhatsApp session only.`);
  }
});

export default [
  {
    name: 'businessai',
    category: 'BUSINESS AI',
    ownerOnly: true,
    description: 'Turn the private-chat AI business assistant on or off for only this WhatsApp session',
    async run(ctx) {
      if (!ctx.args[0]) throw new Error('Usage: .businessai on|off');
      const enabled = onOff(ctx.args[0]);
      if (enabled) getAiSettings();
      const sid = sessionIdOf(ctx);
      store.updateBusiness(sid, { enabled });
      await ctx.reply(`Business AI: ${enabled ? 'ON' : 'OFF'}\nSession: ${sid}\nThis does not affect your other linked WhatsApp sessions.`);
    }
  },
  {
    name: 'businessstatus',
    category: 'BUSINESS AI',
    ownerOnly: true,
    description: 'Show isolated business AI settings for the current WhatsApp session',
    async run(ctx) {
      const sid = sessionIdOf(ctx);
      const b = store.getBusiness(sid);
      const account = jidNumber(ctx.sock?.user?.id) || 'unknown';
      await ctx.reply([
        '*Business AI status*',
        `Account: ${account}`,
        `Session: ${sid}`,
        `Enabled: ${b.enabled ? 'YES' : 'NO'}`,
        `Business: ${b.name || 'not set'}`,
        `Location: ${b.location || 'not set'}`,
        `Hours: ${b.hours || 'not set'}`,
        `Tone: ${b.tone || 'not set'}`,
        `Business info: ${b.info ? `${b.info.length} characters saved` : 'not set'}`,
        `Rules: ${b.rules ? `${b.rules.length} characters saved` : 'not set'}`,
        `Paused customers: ${Object.keys(b.pausedChats || {}).length}`,
        `In-memory customer histories: ${businessMemoryCount(sid)}`,
        '',
        'Settings and chat memory are isolated by WhatsApp session.'
      ].join('\n'));
    }
  },
  {
    name: 'businesshelp',
    category: 'BUSINESS AI',
    ownerOnly: true,
    description: 'Show business AI setup commands',
    async run(ctx) {
      await ctx.reply([
        '*Business AI commands*',
        '.businessai on|off',
        '.businessstatus',
        '.setbusinessname NAME',
        '.setbusinessinfo DETAILS',
        '.setbusinessrules RULES',
        '.setbusinesshours HOURS',
        '.setbusinesslocation LOCATION',
        '.setbusinesstone TONE',
        '.pauseai CUSTOMER_NUMBER',
        '.resumeai CUSTOMER_NUMBER',
        '.clearbusinessmemory [CUSTOMER_NUMBER]',
        '',
        'Run setup on each linked bot account separately.'
      ].join('\n'));
    }
  },
  setText('setbusinessname', 'name', '.setbusinessname Bright Accessories'),
  setText('setbusinessinfo', 'info', '.setbusinessinfo Describe products, prices, delivery and payment rules here'),
  setText('setbusinessrules', 'rules', '.setbusinessrules Add the instructions the assistant must follow'),
  setText('setbusinesshours', 'hours', '.setbusinesshours Monday-Saturday 8AM-7PM'),
  setText('setbusinesslocation', 'location', '.setbusinesslocation Your business location'),
  setText('setbusinesstone', 'tone', '.setbusinesstone friendly, human, concise'),
  {
    name: 'pauseai',
    category: 'BUSINESS AI',
    ownerOnly: true,
    description: 'Pause AI replies to one customer on this WhatsApp session',
    async run(ctx) {
      const sid = sessionIdOf(ctx);
      const customer = customerFrom(ctx.args[0]);
      store.setBusinessChatPaused(sid, customer, true);
      await ctx.reply(`Business AI paused for ${customer} on session ${sid}.`);
    }
  },
  {
    name: 'resumeai',
    category: 'BUSINESS AI',
    ownerOnly: true,
    description: 'Resume AI replies to one customer on this WhatsApp session',
    async run(ctx) {
      const sid = sessionIdOf(ctx);
      const customer = customerFrom(ctx.args[0]);
      store.setBusinessChatPaused(sid, customer, false);
      await ctx.reply(`Business AI resumed for ${customer} on session ${sid}.`);
    }
  },
  {
    name: 'clearbusinessmemory',
    category: 'BUSINESS AI',
    ownerOnly: true,
    description: 'Clear temporary AI conversation history for one customer or this session',
    async run(ctx) {
      const sid = sessionIdOf(ctx);
      const customer = ctx.args[0] ? customerFrom(ctx.args[0]) : '';
      const removed = clearBusinessMemory(sid, customer);
      await ctx.reply(customer
        ? `Cleared business AI memory for ${customer} on session ${sid}.`
        : `Cleared ${removed} business AI histories from session ${sid}.`);
    }
  }
];
