import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.CHAT_ONLY='true';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'void-handover-'));process.env.OWNER_NUMBER='2348000000001';
const {store,loadStore}=await import('../src/store.js');loadStore();
const {handleBusinessMessage,sendHandoverSetup,resumeBusinessChat,pinHandoffChat}=await import('../src/business-assistant.js');
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
 const sent=[];const sock={chatModify:async(body,jid)=>{sent.push({jid,body});},user:{id:'2348000000002@s.whatsapp.net'},sendMessage:async(jid,body)=>{sent.push({jid,body});return {key:{id:'out'+sent.length}};}};
 const customer='2348000000003',chat=customer+'@s.whatsapp.net';
 const event={sock,chat,sender:sock.user.id,body:'I will check this myself',isGroup:false,sessionId:'manual',raw:{key:{id:'human1',remoteJid:chat,fromMe:true}}};
 store.updateBusiness('manual',{enabled:true,handoverMode:'manual'});
 store.setBusinessChatPaused('manual',customer,true,'handoff',{handoffChat:chat,handoffChatPinned:true});
 await handleBusinessMessage(event);assert.equal(store.getBusinessChatPause('manual',customer).reason,'human-manual');assert.equal(sent[0].body.pin,false);
 await handleBusinessMessage({...event,sender:chat,body:'Any update?',raw:{key:{id:'incoming',remoteJid:chat,fromMe:false}}});assert.equal(store.getBusinessChatPause('manual',customer).reason,'human-manual');
 store.updateBusiness('auto',{enabled:true,handoverMode:'auto'});await handleBusinessMessage({...event,sessionId:'auto'});assert.equal(store.getBusinessChatPause('auto',customer).reason,'human');
 store.setBusinessChatPaused('auto',customer,true,'manual-command');await handleBusinessMessage({...event,sessionId:'auto'});assert.equal(store.getBusinessChatPause('auto',customer).reason,'manual-command');
 store.setBusinessChatPaused('manual',customer,true,'handoff',{handoffChat:chat,handoffChatPinned:true});
 await resumeBusinessChat(sock,'manual',customer);assert.equal(store.getBusinessChatPause('manual',customer),null);assert.equal(sent.at(-1).body.pin,false);
 fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});
});

test('handover pins the chat through app-state and never sends a pinned message',async()=>{
 const {chatModificationToAppPatch}=await import('@whiskeysockets/baileys');
 const chat='2348000000003@s.whatsapp.net', calls=[];
 const sock={chatModify:async(mod,jid)=>{calls.push({mod,jid});},sendMessage:async()=>{throw new Error('Must not send a message pin');}};
 assert.equal(await pinHandoffChat(sock,chat),true);
 assert.deepEqual(calls[0],{mod:{pin:true},jid:chat});
 const patch=chatModificationToAppPatch(calls[0].mod,chat);
 assert.equal(patch.syncAction.pinAction.pinned,true);assert.deepEqual(patch.index,['pin_v1',chat]);
 store.setBusinessChatPaused('chatpin','2348000000003',true,'handoff',{handoffChat:chat,handoffChatPinned:true});
 await resumeBusinessChat(sock,'chatpin','2348000000003');
 assert.deepEqual(calls.at(-1),{mod:{pin:false},jid:chat});
 assert.equal(chatModificationToAppPatch(calls.at(-1).mod,chat).syncAction.pinAction.pinned,false);
 assert.equal(await pinHandoffChat({chatModify:async()=>{throw new Error('pin limit');}},chat),false);
});

test('closing acknowledgments respect pending questions and handoff excerpts stay bounded', async () => {
 const {shouldSkipClosingReply,handoffContext}=await import('../src/business-assistant.js');
 assert.equal(shouldSkipClosingReply('Thanks!', [{role:'assistant',text:'That is all set.'}]),true);
 assert.equal(shouldSkipClosingReply('Okay', [{role:'assistant',text:'Which model do you want?'}]),false);
 assert.equal(shouldSkipClosingReply('Thanks, what is the price?', [{role:'assistant',text:'You are welcome.'}]),false);
 assert.equal(shouldSkipClosingReply('Hey', []),false);
 const excerpt=handoffContext(Array.from({length:10},(_,i)=>({role:'user',text:`request-${i} `+'x'.repeat(800)})));
 assert.ok(!excerpt.includes('request-0'));assert.ok(excerpt.includes('request-9'));assert.ok(excerpt.length<2000);
});

test('burst messages get one reply and a human takeover cancels waiting replies', async () => {
 process.env.GROQ_API_KEY='test-groq';process.env.AI_PROVIDER_ORDER='groq';
 const originalFetch=globalThis.fetch, sent=[], requests=[];
 globalThis.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return Response.json({choices:[{message:{content:'Hello, what do you need?'},finish_reason:'stop'}]});};
 const sock={sendPresenceUpdate:async()=>{},sendMessage:async(jid,body)=>{sent.push({jid,body});return {key:{id:'batch-out-'+sent.length}};}};
 const chat='2348000000099@s.whatsapp.net';
 const event=(body,sid='burst',fromMe=false)=>({sock,chat,sender:chat,body,isGroup:false,sessionId:sid,raw:{key:{id:body,remoteJid:chat,fromMe}}});
 try {
  store.updateBusiness('burst',{enabled:true});store.setSessionSetting('burst','mode','public');
  await handleBusinessMessage(event('Hey'));await handleBusinessMessage(event('I need something'));
  await new Promise(resolve=>setTimeout(resolve,2100));
  assert.equal(sent.length,1);assert.equal(requests.length,1);
  assert.match(requests[0].messages.at(-1).content,/Hey\nI need something/);
  store.updateBusiness('cancelled',{enabled:true});store.setSessionSetting('cancelled','mode','public');
  await handleBusinessMessage(event('Hello','cancelled'));await handleBusinessMessage(event('I will handle this','cancelled',true));
  await new Promise(resolve=>setTimeout(resolve,2100));assert.equal(sent.length,1);
 } finally {globalThis.fetch=originalFetch;}
});
