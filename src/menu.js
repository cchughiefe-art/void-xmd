import { config } from './config.js';
import { formatRuntime } from './utils.js';
import { pluginMenu } from './plugin-loader.js';

export const categories = {
  'GENERAL': ['menu','ping','runtime','botinfo','owner','repo','public','private','weather','wikipedia','define','translate'],
  'AI & CHAT': ['ai','gpt','explain','rewrite','summarize','aistatus'],
  'DOWNLOADERS': ['play','ytmp3','yt','tiktok','instagram','twitter','facebook','socialdl'],
  'MEDIA & TOOLS': ['sticker','toimage','toaudio','calc','qr','base64','base64decode','hash','uuid','short','uppercase','lowercase','reverse','wordcount','charcount','jsonpretty','password','timestamp'],
  'GROUP MANAGEMENT': ['admins','groupinfo','groupid','link','revokeinvite','promote','demote','kick','mute','unmute','tagall','hidetag','warn','warnings','clearwarn','setwelcome','setgoodbye','setrules','rules'],
  'PROTECTION': ['antilink','antibadwords','anticall','antidelete','antiviewonce'],
  'AUTOMATION & SETTINGS': ['autoreact','autostatus','setprefix','setmode'],
  'GAMES & FUN': ['coinflip','dice','rps','8ball','choose','rate','ship','joke','quote','truth','dare','numberguess'],
  'ECONOMY': ['balance','daily','pay','leaderboard'],
  'OWNER': ['block','unblock','broadcast','restart','health','stats']
};

export function renderMenu(senderName = 'User') {
  const allCategories = Object.fromEntries(Object.entries(categories).map(([name,commands])=>[name,[...commands]]));
  for(const [name,commands] of Object.entries(pluginMenu())) allCategories[name]=[...new Set([...(allCategories[name]||[]),...commands])];
  const count = Object.values(allCategories).flat().length;
  let text = `╭─〔 👑 ${config.name} 〕─╮\n│ ⚡ *COMMAND MENU*\n│ 👤 ${senderName}  •  📦 ${count} commands\n│ 🔤 ${config.prefix}  •  ⚙️ ${config.mode.toUpperCase()} 🌐  •  ⏱️ ${formatRuntime(process.uptime())}\n╰─〔 FAST • STABLE • POWERFUL 〕─╯\n`;
  for (const [name, commands] of Object.entries(allCategories)) {
    text += `\n╭─〔 ✦ ${name} · ${commands.length} 〕─╮\n`;
    text += commands.map(command => `│ ${config.prefix}${command}`).join('\n');
    text += `\n╰─〔 ${name} 〕─╯\n`;
  }
  return `${text}\n╭─〔 👑 ${config.name} 〕─╮\n│ ⚡ ${count} safe commands loaded\n│ 💚 One menu • All commands\n╰─〔 SMART • FAST • POWERFUL 〕─╯`;
}
