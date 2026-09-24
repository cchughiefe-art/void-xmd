import fs from 'node:fs';
import path from 'node:path';
import makeWASocket, { Browsers, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, getContentType, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { config } from './config.js';
import { execute } from './commands.js';
import { store } from './store.js';
import { jidNumber, sleep } from './utils.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
let activeSocket;
let latestPairingCode = '';
const bodyOf = message => {
  const m = message?.message; if (!m) return '';
  const type = getContentType(m); const content = m[type];
  return m.conversation || content?.text || content?.caption || content?.selectedButtonId || content?.singleSelectReply?.selectedRowId || '';
};

export function connectionState() { return Boolean(activeSocket?.user); }
export function pairingState() { return { connected: connectionState(), code: latestPairingCode }; }

export async function requestPairing(number) {
  const phone=String(number||'').replace(/\D/g,'');
  if(phone.length<8||phone.length>15) throw new Error('Enter a valid international number without + or spaces.');
  if(!activeSocket) throw new Error('WhatsApp connection is still starting. Try again in a few seconds.');
  if(activeSocket.authState?.creds?.registered || connectionState()) throw new Error('A WhatsApp account is already connected.');
  const code=await activeSocket.requestPairingCode(phone);
  latestPairingCode=code.match(/.{1,4}/g)?.join('-')||code;
  console.log(`${config.name} pairing code: ${latestPairingCode}`);
  return latestPairingCode;
}

export async function startBot() {
  const authDir = path.join(config.dataDir, 'auth'); fs.mkdirSync(authDir,{recursive:true});
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, logger, browser: Browsers.ubuntu(config.name), markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: true });
  activeSocket = sock;
  sock.authState = state;
  if (!state.creds.registered) {
    if(config.pairingNumber){
      await sleep(1500);
      const code = await requestPairing(config.pairingNumber);
      console.log(`\n================================\n${config.name} PAIRING CODE: ${code}\nWhatsApp > Linked devices > Link with phone number\n================================\n`);
    } else console.log('No WhatsApp session. Open /pair to generate a pairing code.');
  }
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async update => {
    if (update.connection === 'open') { latestPairingCode=''; logger.info({ jid: sock.user?.id }, `${config.name} connected`); }
    if (update.connection === 'close') {
      activeSocket = undefined;
      const status = new Boom(update.lastDisconnect?.error).output?.statusCode;
      if (status === DisconnectReason.loggedOut) logger.error('Logged out. Delete /data/auth and pair again.');
      else { logger.warn({ status }, 'Disconnected; reconnecting'); await sleep(3000); startBot().catch(err=>logger.error(err)); }
    }
  });
  sock.ev.on('group-participants.update', async event => {
    const settings=store.getGroup(event.id); const meta=await sock.groupMetadata(event.id).catch(()=>null); if(!meta)return;
    for(const member of event.participants){
      const mention=`@${jidNumber(member)}`;
      if(event.action==='add'&&settings.welcome) await sock.sendMessage(event.id,{text:`Welcome ${mention} to *${meta.subject}*`,mentions:[member]});
      if(event.action==='remove'&&settings.goodbye) await sock.sendMessage(event.id,{text:`Goodbye ${mention}`,mentions:[member]});
    }
  });
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if(type!=='notify') return;
    for(const raw of messages){
      try {
        if(!raw.message || raw.key.fromMe || raw.key.remoteJid==='status@broadcast') continue;
        const body=bodyOf(raw).trim(), chat=raw.key.remoteJid, isGroup=chat.endsWith('@g.us');
        const sender=isGroup?(raw.key.participant||raw.participant):chat; store.see(sender);
        let metadata=null, isAdmin=false, isBotAdmin=false;
        if(isGroup){
          metadata=await sock.groupMetadata(chat); const admins=metadata.participants.filter(p=>p.admin).map(p=>jidNumber(p.id));
          isAdmin=admins.includes(jidNumber(sender)); isBotAdmin=admins.includes(jidNumber(sock.user.id));
          const settings=store.getGroup(chat);
          if(settings.antilink && /chat\.whatsapp\.com\//i.test(body) && !isAdmin){ if(isBotAdmin) await sock.sendMessage(chat,{delete:raw.key}); continue; }
        }
        if(!body.startsWith(config.prefix)) continue;
        const [head,...args]=body.slice(config.prefix.length).trim().split(/\s+/); if(!head)continue;
        const command=head.toLowerCase(), text=args.join(' '), isOwner=jidNumber(sender)===config.owner;
        if(config.mode==='private'&&!isOwner) continue;
        const contextInfo=raw.message?.extendedTextMessage?.contextInfo || raw.message?.imageMessage?.contextInfo || {};
        const reply=(message,mentions=[])=>sock.sendMessage(chat,{text:String(message),mentions},{quoted:raw});
        const quoted=contextInfo.quotedMessage?{participant:contextInfo.participant,message:contextInfo.quotedMessage,stanzaId:contextInfo.stanzaId}:null;
        const downloadMedia=async()=>{
          const target=quoted?{key:{remoteJid:chat,id:quoted.stanzaId,participant:quoted.participant},message:quoted.message}:raw;
          if(!target.message || !['imageMessage','audioMessage','videoMessage'].some(type=>target.message[type])) throw new Error('Reply to an image, audio, or video message first.');
          return downloadMediaMessage(target,'buffer',{}, {logger,reuploadRequest:sock.updateMediaMessage});
        };
        await execute({ command,args,text,reply,sock,chat,sender,isOwner,isGroup,isAdmin,isBotAdmin,metadata,mentions:contextInfo.mentionedJid||[],quoted,downloadMedia,raw,pushName:raw.pushName||'User',timestamp:Number(raw.messageTimestamp)*1000||Date.now() });
      } catch(error) { logger.error(error); await sock.sendMessage(raw.key.remoteJid,{text:`❌ ${error.message || 'Command failed.'}`},{quoted:raw}).catch(()=>{}); }
    }
  });
  return sock;
}
