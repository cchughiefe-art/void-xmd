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

const setText = (name, field, usage, description) => ({
  name,
  category: 'AI ASSISTANT',
  ownerOnly: true,
  description,
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
    aliases: ['chatai','assistantai'],
    category: 'AI ASSISTANT',
    ownerOnly: true,
    description: 'Turn hybrid normal-chat + business AI on or off for this WhatsApp session',
    async run(ctx) {
      if (!ctx.args[0]) throw new Error('Usage: .businessai on|off');
      const enabled = onOff(ctx.args[0]);
      if (enabled) getAiSettings();
      const sid = sessionIdOf(ctx);
      store.updateBusiness(sid, { enabled });
      await ctx.reply(`Hybrid AI assistant: ${enabled ? 'ON' : 'OFF'}\nSession: ${sid}\nNormal chat + business chat are enabled together.\nYour other WhatsApp sessions are unaffected.`);
    }
  },
  {
    name: 'businessstatus',
    aliases: ['aichatstatus'],
    category: 'AI ASSISTANT',
    ownerOnly: true,
    description: 'Show this WhatsApp session’s isolated AI assistant settings',
    async run(ctx) {
      const sid = sessionIdOf(ctx);
      const b = store.getBusiness(sid);
      const account = jidNumber(ctx.sock?.user?.id) || 'unknown';
      await ctx.reply([
        '*Hybrid AI assistant status*',
        `Account: ${account}`,
        `Session: ${sid}`,
        `Enabled: ${b.enabled ? 'YES' : 'NO'}`,
        `Business: ${b.name || 'not set'}`,
        `Location: ${b.location || 'not set'}`,
        `Hours: ${b.hours || 'not set'}`,
        `Personality: ${b.personality || 'friendly, natural and concise'}`,
        `Business tone: ${b.tone || 'friendly, professional and concise'}`,
        `Business info: ${b.info ? `${b.info.length} characters saved` : 'not set'}`,
        `Rules: ${b.rules ? `${b.rules.length} characters saved` : 'not set'}`,
        `Paused chats: ${Object.keys(b.pausedChats || {}).length}`,
        `Active in-memory chats: ${businessMemoryCount(sid)}`,
        '',
        'Normal chats, business settings and customer histories are isolated by WhatsApp session.'
      ].join('\n'));
    }
  },
  {
    name: 'businesshelp',
    aliases: ['chathelp'],
    category: 'AI ASSISTANT',
    ownerOnly: true,
    description: 'Show hybrid AI assistant setup commands',
    async run(ctx) {
      await ctx.reply([
        '*Hybrid AI assistant commands*',
        '.businessai on|off',
        '.businessstatus',
        '.setaipersonality TEXT',
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
        'Normal conversation and business conversation are handled automatically.',
        'Configure each linked WhatsApp account separately.'
      ].join('\n'));
    }
  },
  setText('setaipersonality','personality','.setaipersonality Friendly, casual Nigerian tone. Speak naturally and do not sound robotic.','Set the normal-chat personality for this WhatsApp session'),
  setText('setbusinessname','name','.setbusinessname Bright Accessories','Set the business name for this WhatsApp session'),
  setText('setbusinessinfo','info','.setbusinessinfo Describe products, prices, delivery and payment rules here','Set the business knowledge for this WhatsApp session'),
  setText('setbusinessrules','rules','.setbusinessrules Add the business instructions the assistant must follow','Set business rules for this WhatsApp session'),
  setText('setbusinesshours','hours','.setbusinesshours Monday-Saturday 8AM-7PM','Set business hours for this WhatsApp session'),
  setText('setbusinesslocation','location','.setbusinesslocation Your business location','Set business location for this WhatsApp session'),
  setText('setbusinesstone','tone','.setbusinesstone friendly, human, concise','Set the business-response tone for this WhatsApp session'),
  {
    name: 'pauseai',
    category: 'AI ASSISTANT',
    ownerOnly: true,
    description: 'Pause AI replies to one person on this WhatsApp session',
    async run(ctx) {
      const sid = sessionIdOf(ctx);
      const customer = customerFrom(ctx.args[0]);
      store.setBusinessChatPaused(sid, customer, true);
      await ctx.reply(`AI paused for ${customer} on session ${sid}.`);
    }
  },
  {
    name: 'resumeai',
    category: 'AI ASSISTANT',
    ownerOnly: true,
    description: 'Resume AI replies to one person on this WhatsApp session',
    async run(ctx) {
      const sid = sessionIdOf(ctx);
      const customer = customerFrom(ctx.args[0]);
      store.setBusinessChatPaused(sid, customer, false);
      await ctx.reply(`AI resumed for ${customer} on session ${sid}.`);
    }
  },
  {
    name: 'clearbusinessmemory',
    aliases: ['clearchatmemory'],
    category: 'AI ASSISTANT',
    ownerOnly: true,
    description: 'Clear temporary AI conversation memory for one person or this entire session',
    async run(ctx) {
      const sid = sessionIdOf(ctx);
      const customer = ctx.args[0] ? customerFrom(ctx.args[0]) : '';
      const removed = clearBusinessMemory(sid, customer);
      await ctx.reply(customer
        ? `Cleared AI conversation memory for ${customer} on session ${sid}.`
        : `Cleared ${removed} AI conversation histories from session ${sid}.`);
    }
  }
];
