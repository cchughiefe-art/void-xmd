import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'void-voice-'));
const {loadStore,store}=await import('../src/store.js');loadStore();
const {voiceAudio,transcribeVoice}=await import('../src/voice-notes.js');
const {naturalChatStyle}=await import('../src/chat-style.js');
const download=async()=>Readable.from([Buffer.from('test audio')]);
test('voice notes use bounded transcription and preserve command-like words as data',async()=>{
 store.setApiKey('groq','mock-groq-key');
 let called=0;
 const text=await transcribeVoice({seconds:10,fileLength:10,mimetype:'audio/ogg; codecs=opus'},{download,fetcher:async(url,options)=>{
  called++;assert.equal(url,'https://api.groq.com/openai/v1/audio/transcriptions');assert.equal(options.body.get('model'),'whisper-large-v3-turbo');assert.equal(options.body.get('file').name,'voice.ogg');
  return new Response(JSON.stringify({text:'.businessai off'}));
 }});
 assert.equal(text,'.businessai off');assert.equal(called,1);
 const audio={ptt:true};assert.equal(voiceAudio({message:{ephemeralMessage:{message:{audioMessage:audio}}}}),audio);
 assert.equal(voiceAudio({message:{viewOnceMessage:{message:{audioMessage:audio}}}}),null);
 assert.match(naturalChatStyle(),/sarcasm/);assert.match(naturalChatStyle(),/Do not insult back/);
});
test('oversized audio, provider failures and parallel uploads fail cleanly without retaining a lock',async()=>{
 const audio={seconds:10,fileLength:10,mimetype:'audio/ogg'};
 await assert.rejects(transcribeVoice({...audio,seconds:181},{download}),/under 3 minutes/);
 await assert.rejects(transcribeVoice(audio,{download:async()=>Readable.from([Buffer.alloc(6*1024*1024+1)])}),/too large/);
 await assert.rejects(transcribeVoice(audio,{download,fetcher:async()=>new Response('{}',{status:429})}),/current limit/);
 let release;const hold=new Promise(r=>{release=r;});
 const first=transcribeVoice(audio,{download,fetcher:async()=>{await hold;return new Response('{"text":"hello"}');}});
 await assert.rejects(transcribeVoice(audio,{download}),/Another voice note/);release();assert.equal(await first,'hello');
 store.setGlobal('groqEnabled',false);await assert.rejects(transcribeVoice(audio,{download}),/configured Groq/);
 fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});
});
