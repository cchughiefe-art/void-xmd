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

const pauseReasonOf = value => {
  if (!value) return '';
  if (typeof value === 'object') return String(value.reason || 'legacy');
  return 'legacy';
};

const setText = (name, field, usage, description) => ({
  name,
  category: 'AI ASSISTANT',
  sessionOwnerOnly: true,
  description,
  async run(ctx) {
    const value = String(ctx.text || '').trim();
    if (!value) throw new Error(`Usage: ${usage}`);
    const sid = sessionIdOf(ctx);
    store.updateBusiness(sid, { [field]: value });
    await ctx.reply(`${field} saved for this WhatsApp account only.`);
  }
});

export default [
  {
    name: 'businessai',
    aliases: ['chatai','assistantai'],
    category: 'AI ASSISTANT',
    sessionOwnerOnly: true,
    description: 'Turn hybrid normal-chat + business AI on or off for this WhatsApp account',
    async run(ctx) {
      if (!ctx.args[0]) throw new Error('Usage: .businessai on|off');
      const enabled = onOff(ctx.args[0]);

      if (enabled) {
        const ai = getAiSettings({ required: false });
        if (!ai.key) {
          throw new Error('No AI provider is configured yet. Ask the main VOID XMD owner to configure Gemini or Groq.');
        }
        if (store.getSessionSetting(sessionIdOf(ctx), 'mode', 'public') === 'private') {
          throw new Error('This account is in PRIVATE mode. Send .public first so Business AI can reply to customers.');
        }
      }

      const sid = sessionIdOf(ctx);
      store.updateBusiness(sid, { enabled });
      await ctx.reply(
        `Hybrid AI assistant: ${enabled ? 'ON' : 'OFF'}\n` +
        `Session: ${sid}\n` +
        'Normal chat + business chat are controlled only for this WhatsApp account.'
      );
    }
  },
  {
    name: 'businessstatus',
    aliases: ['aichatstatus'],
    category: 'AI ASSISTANT',
    sessionOwnerOnly: true,
    description: 'Show this WhatsApp account’s isolated AI assistant settings',
    async run(ctx) {
      const sid = sessionIdOf(ctx);
      const b = store.getBusiness(sid);
      const account = jidNumber(ctx.sock?.user?.id) || 'unknown';
      const mode = store.getSessionSetting(sid, 'mode', 'public');

      await ctx.reply([
        '*Hybrid AI assistant status*',
        `Account: ${account}`,
        `Session: ${sid}`,
        `Mode: ${String(mode).toUpperCase()}`,
        `Enabled: ${b.enabled ? 'YES' : 'NO'}`,
        `Business: ${b.name || 'not set'}`,
        `Location: ${b.location || 'not set'}`,
        `Hours: ${b.hours || 'not set'}`,
        `Personality: ${b.personality || 'friendly, natural and concise'}`,
        `Business tone: ${b.tone || 'friendly, professional and concise'}`,
        `Business info: ${b.info ? `${b.info.length} characters saved` : 'not set'}`,
        `Rules: ${b.rules ? `${b.rules.length} characters saved` : 'not set'}`,
        `Paused chats: ${Object.keys(b.pausedChats || {}).length}`,
        `AI handoffs waiting: ${Object.values(b.pausedChats || {}).filter(value => pauseReasonOf(value) === 'handoff').length}`,
        `Human takeover chats: ${Object.values(b.pausedChats || {}).filter(value => pauseReasonOf(value) === 'human').length}`,
        `Manually hard-paused: ${Object.values(b.pausedChats || {}).filter(value => ['manual-command','legacy'].includes(pauseReasonOf(value))).length}`,
        `Active in-memory chats: ${businessMemoryCount(sid)}`,
        '',
        'These settings belong only to this linked WhatsApp account.'
      ].join('\n'));
    }
  },
  {
    name: 'businesshelp',
    aliases: ['chathelp','businessguide'],
    category: 'AI ASSISTANT',
    sessionOwnerOnly: true,
    description: 'Detailed startup and daily-use guide for the hybrid business AI',
    async run(ctx) {
      const sid = sessionIdOf(ctx);
      const account = jidNumber(ctx.sock?.user?.id) || 'this account';

      await ctx.reply([
        '*VOID XMD BUSINESS AI — STARTUP GUIDE (1/3)*',
        `Account: ${account}`,
        `Session: ${sid}`,
        '',
        '*What this does*',
        'This WhatsApp account has its own AI personality, business information, paused chats and account settings. Other linked WhatsApp sessions are not changed.',
        '',
        '*Where to set it up*',
        'Use WhatsApp “Message yourself” on this linked account whenever possible. Commands you send from this account are treated as SESSION-OWNER commands.',
        '',
        '*Step 1 — Make the account public*',
        '.public',
        '',
        'Business AI only auto-replies to customers while this account is PUBLIC.',
        '',
        '*Step 2 — Check the AI provider*',
        '.aistatus',
        '',
        'Gemini is primary when configured and Groq can be fallback. If no AI provider is configured, contact the main VOID XMD owner. API keys remain main-owner/server settings.',
        '',
        '*Step 3 — Set the chat personality*',
        '.setaipersonality Talk naturally like me. If someone speaks English, reply in natural English. If they use Nigerian Pidgin or broken English, reply in natural Nigerian Pidgin. If they mix both, mix naturally too. Match their energy, slang and formality. Keep replies short and human. Do not force Pidgin when they speak English. Do not sound robotic or like customer support in casual chats.'
      ].join('\n'));

      await ctx.reply([
        '*VOID XMD BUSINESS AI — STARTUP GUIDE (2/3)*',
        '',
        '*Step 4 — Add the business identity*',
        '.setbusinessname YOUR BUSINESS NAME',
        '.setbusinesslocation YOUR LOCATION',
        '.setbusinesshours YOUR OPENING HOURS',
        '.setbusinesstone Friendly, natural and professional. Match English/Pidgin with the customer.',
        '',
        '*Step 5 — Teach it the business*',
        'Use .setbusinessinfo followed by facts the AI may use: products, prices, stock information, delivery areas, payment methods, ordering process, policies and FAQs.',
        '',
        'Example:',
        '.setbusinessinfo We sell phone accessories. Oraimo power bank is ₦18,000. Lagos delivery and nationwide shipping are available. Customers should provide their name, item, quantity and delivery location when ordering.',
        '',
        '*Step 6 — Set strict rules*',
        '.setbusinessrules Never invent prices, stock, discounts, payment confirmation, delivery dates, refunds or order status. If information is missing, say it needs human confirmation. Never confirm payment without human verification. If the customer asks for a human, hand the conversation over.',
        '',
        '*Step 7 — Review everything*',
        '.businessstatus'
      ].join('\n'));

      await ctx.reply([
        '*VOID XMD BUSINESS AI — STARTUP GUIDE (3/3)*',
        '',
        '*Step 8 — Turn AI on*',
        '.businessai on',
        '',
        '*Step 9 — Test from another WhatsApp number*',
        'Test proper English, Nigerian Pidgin, mixed English/Pidgin, normal casual chat and a real business question.',
        '',
        '*Daily operation*',
        '• Customers just message normally; they do not need commands.',
        '• English customer → natural English.',
        '• Pidgin/broken English → natural Nigerian Pidgin.',
        '• Mixed language → naturally mixed reply.',
        '• Casual conversation stays casual.',
        '• Business questions use the saved business information and rules.',
        '• If you manually reply, AI enters human-takeover mode for that customer.',
        '• When that customer replies again, you have 60 seconds to answer.',
        '• If you do not answer within 60 seconds, AI resumes automatically.',
        '• Every new customer message resets the 60-second window.',
        '• AI handoff and .pauseai are hard pauses, not automatic 60-second resumes.',
        '',
        '*Take over / return to AI*',
        '.pauseai CUSTOMER_NUMBER',
        '.resumeai CUSTOMER_NUMBER',
        '',
        '*When prices, stock, policies or delivery details change*',
        'Update .setbusinessinfo or the relevant setting immediately.',
        '',
        '*Stop AI for the whole account*',
        '.businessai off',
        '',
        '*Useful commands*',
        '.businessstatus',
        '.accountstatus',
        '.accounthelp',
        '',
        'Everything above is account-specific. It does not alter another linked WhatsApp session.'
      ].join('\n'));
    }
  },

  setText('setaipersonality','personality','.setaipersonality Friendly, natural and human.','Set the normal-chat personality for this WhatsApp account'),
  setText('setaiexamples','styleExamples','.setaiexamples Paste a few example chats here','Teach the phrasing and rhythm of this account using example replies'),
  setText('setbusinessname','name','.setbusinessname Bright Accessories','Set the business name for this WhatsApp account'),
  setText('setbusinessinfo','info','.setbusinessinfo Describe products, prices, delivery, ordering and payment rules here','Set the business knowledge for this WhatsApp account'),
  setText('setbusinessrules','rules','.setbusinessrules Add the business instructions the assistant must follow','Set business rules for this WhatsApp account'),
  setText('setbusinesshours','hours','.setbusinesshours Monday-Saturday 8AM-7PM','Set business hours for this WhatsApp account'),
  setText('setbusinesslocation','location','.setbusinesslocation Your business location','Set business location for this WhatsApp account'),
  setText('setbusinesstone','tone','.setbusinesstone friendly, human and concise','Set the business-response tone for this WhatsApp account'),

  {
    name: 'pauseai',
    category: 'AI ASSISTANT',
    sessionOwnerOnly: true,
    description: 'Pause AI replies to one person on this WhatsApp account',
    async run(ctx) {
      const sid = sessionIdOf(ctx);
      const customer = customerFrom(ctx.args[0]);
      store.setBusinessChatPaused(sid, customer, true, 'manual-command');
      await ctx.reply(`AI HARD-paused for ${customer} on session ${sid}. It will not auto-resume until .resumeai is used.`);
    }
  },
  {
    name: 'resumeai',
    category: 'AI ASSISTANT',
    sessionOwnerOnly: true,
    description: 'Resume AI replies to one person on this WhatsApp account',
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
    sessionOwnerOnly: true,
    description: 'Clear temporary AI conversation memory for one person or this WhatsApp account',
    async run(ctx) {
      const sid = sessionIdOf(ctx);
      const customer = ctx.args[0] ? customerFrom(ctx.args[0]) : '';
      const removed = clearBusinessMemory(sid, customer);
      await ctx.reply(
        customer
          ? `Cleared AI conversation memory for ${customer} on session ${sid}.`
          : `Cleared ${removed} AI conversation histories from session ${sid}.`
      );
    }
  }
];
