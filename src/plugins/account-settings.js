import { config } from '../config.js';
import { store } from '../store.js';
import { jidNumber } from '../utils.js';

const state = value => value ? 'ON' : 'OFF';

export default [
  {
    name: 'accountstatus',
    aliases: ['sessionstatus','mybotsettings'],
    category: 'ACCOUNT',
    sessionOwnerOnly: true,
    description: 'Show settings that belong only to the current linked WhatsApp account',
    async run(ctx) {
      const sid = String(ctx.sessionId || 'primary');
      const account = jidNumber(ctx.sock?.user?.id) || 'unknown';
      const settings = store.getSession(sid);
      const business = store.getBusiness(sid);

      await ctx.reply([
        '*VOID XMD account settings*',
        `WhatsApp: ${account}`,
        `Session: ${sid}`,
        `Mode: ${String(store.getSessionSetting(sid, 'mode', config.mode)).toUpperCase()}`,
        `Anti-call: ${state(settings.anticall)}`,
        `Auto-view status: ${state(settings.autoviewstatus)}`,
        `Auto-react status: ${state(settings.autostatusreact)}`,
        `Auto-bio: ${state(settings.autobio)}`,
        `Always online: ${state(settings.alwaysonline)}`,
        `Hybrid AI: ${state(business.enabled)}`,
        '',
        'These settings affect only this WhatsApp account.'
      ].join('\n'));
    }
  },
  {
    name: 'accounthelp',
    aliases: ['sessionhelp'],
    category: 'ACCOUNT',
    sessionOwnerOnly: true,
    description: 'Explain what the owner of this linked WhatsApp account can control',
    async run(ctx) {
      await ctx.reply([
        '*VOID XMD — THIS WHATSAPP ACCOUNT*',
        '',
        'Commands sent from this linked WhatsApp account itself are treated as session-owner actions. The main VOID XMD owner still controls the whole installation.',
        '',
        '*Account-only controls*',
        '.public / .private',
        '.anticall on|off',
        '.autoviewstatus on|off',
        '.autostatusreact on|off',
        '.autobio on|off',
        '.alwaysonline on|off',
        '.block / .unblock',
        '.join / .leavegc / .creategc',
        '.businesshelp',
        '.businessstatus',
        '.businessai on|off',
        '.setaipersonality ...',
        '.setbusinessname ...',
        '.setbusinessinfo ...',
        '.setbusinessrules ...',
        '.setbusinesshours ...',
        '.setbusinesslocation ...',
        '.setbusinesstone ...',
        '.pauseai NUMBER',
        '.resumeai NUMBER',
        '',
        '*Main VOID XMD owner only*',
        'Adding/removing linked WhatsApp sessions, API keys, process/server restart, panel controls, GitHub administration and installation-wide diagnostics.',
        '',
        'Tip: use WhatsApp “Message yourself” for setup commands so command replies stay out of customer conversations.'
      ].join('\n'));
    }
  }
];
