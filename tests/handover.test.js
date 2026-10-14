import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.CHAT_ONLY='true';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'void-handover-'));process.env.OWNER_NUMBER='2348000000001';
const {store,loadStore}=await import('../src/store.js');loadStore();
const {handleBusinessMessage,sendHandoverSetup,resumeBusinessChat,pinHandoffMessage}=await import('../src/business-assistant.js');
const {execute}=await import('../src/chat-commands.js');
test('handover preference is selected per session, prompted once, and editable by its owner',async()=>{
 const sent=[];const sock={user:{id:'2348000000002:1@s.whatsapp.net'},sendMessage:async(jid,body)=>{sent.push({jid,body});return {key:{id:'notice'+sent.length}};}};
 await sendHandoverSetup(sock,'alpha');await sendHandoverSetup(sock,'alpha');
 assert.equal(sent.length,1);assert.equal(sent[0].jid,'2348000000002@s.whatsapp.net');assert.match(sent[0].body.text,/handover manual/);
 const ctx={args:[],text:'',reply:async()=>{},isOwner:false,isSessionOwner:true,sessionId:'alpha'};
 await assert.rejects(execute({...ctx,command:'setup'}),/Choose your handover/);
 await assert.rejects(execute({...ctx,isSessionOwner:false,command:'handover',args:['auto']}),/owner/);
 await execute({...ctx,command:'handover',args:['manual']});assert.equal(store.getBusiness('alpha').handoverMode,'manual');assert.equal(store.getBusiness('beta').handoverMode,undefined);
 await execute({...ctx,command:'handover',args:['auto']});assert.equal(store.getBusiness('alpha').handoverMode,'auto');
});
test('manual takeover stays paused, auto takeover uses human grace, explicit pauses stay hard and resume unpins',async()=>{
 const sent=[];const sock={user:{id:'2348000000002@s.whatsapp.net'},sendMessage:async(jid,body)=>{sent.push({jid,body});return {key:{id:'out'+sent.length}};}};
 const customer='2348000000003',chat=customer+'@s.whatsapp.net';
 const event={sock,chat,sender:sock.user.id,body:'I will check this myself',isGroup:false,sessionId:'manual',raw:{key:{id:'human1',remoteJid:chat,fromMe:true}}};
 store.updateBusiness('manual',{enabled:true,handoverMode:'manual'});
 store.setBusinessChatPaused('manual',customer,true,'handoff',{handoffChat:chat,handoffMessageKey:{id:'customer-request',remoteJid:chat}});
 await handleBusinessMessage(event);assert.equal(store.getBusinessChatPause('manual',customer).reason,'human-manual');assert.equal(sent[0].body.type,2);
 await handleBusinessMessage({...event,sender:chat,body:'Any update?',raw:{key:{id:'incoming',remoteJid:chat,fromMe:false}}});assert.equal(store.getBusinessChatPause('manual',customer).reason,'human-manual');
 store.updateBusiness('auto',{enabled:true,handoverMode:'auto'});await handleBusinessMessage({...event,sessionId:'auto'});assert.equal(store.getBusinessChatPause('auto',customer).reason,'human');
 store.setBusinessChatPaused('auto',customer,true,'manual-command');await handleBusinessMessage({...event,sessionId:'auto'});assert.equal(store.getBusinessChatPause('auto',customer).reason,'manual-command');
 store.setBusinessChatPaused('manual',customer,true,'handoff',{handoffChat:chat,handoffMessageKey:{id:'request2',remoteJid:chat}});
 await resumeBusinessChat(sock,'manual',customer);assert.equal(store.getBusinessChatPause('manual',customer),null);assert.equal(sent.at(-1).body.type,2);
 fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});
});

test('handover pin payload serializes into a real WhatsApp pin and unpin message',async()=>{
 const {generateWAMessageContent}=await import('@whiskeysockets/baileys');
 const chat='2348000000003@s.whatsapp.net', key={id:'handoff-customer-message',remoteJid:chat,fromMe:false};
 const sent=[]; const sock={sendMessage:async(jid,body)=>{sent.push({jid,body});return {key:{id:'outgoing'}};}};
 const pinned=await pinHandoffMessage(sock,chat,{key});
 assert.equal(sent[0].body.type,1);assert.deepEqual(sent[0].body.pin,key);assert.equal(sent[0].body.time,2592000);
 const wire=await generateWAMessageContent(sent[0].body,{});
 assert.equal(wire.pinInChatMessage.key.id,key.id);assert.equal(wire.pinInChatMessage.type,1);assert.equal(wire.messageContextInfo.messageAddOnDurationInSecs,2592000);
 store.setBusinessChatPaused('serialize', '2348000000003',true,'handoff',{handoffChat:pinned.chat,handoffMessageKey:pinned.key});
 await resumeBusinessChat(sock,'serialize','2348000000003');
 const unpin=await generateWAMessageContent(sent.at(-1).body,{});
 assert.equal(unpin.pinInChatMessage.type,2);assert.equal(unpin.pinInChatMessage.key.id,key.id);assert.equal(unpin.messageContextInfo.messageAddOnDurationInSecs,0);
});
