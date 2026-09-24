import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../utils.js';

const effects = {
  deep: 'asetrate=44100*0.78,aresample=44100,atempo=1.12',
  chipmunk: 'asetrate=44100*1.35,aresample=44100,atempo=0.9',
  robot: 'afftfilt=real=\u0027hypot(re,im)\u0027:imag=\u00270\u0027,volume=1.5',
  echo: 'aecho=0.8:0.9:70:0.45',
  slow: 'atempo=0.75',
  fast: 'atempo=1.5',
  reverse: 'areverse'
};

export default [
  {
    name: 'sticker', aliases: ['s'], category: 'MEDIA & TOOLS', description: 'Turn an image into a sticker',
    async run({ downloadMedia, sock, chat, raw }) {
      const folder=fs.mkdtempSync(path.join(os.tmpdir(),'void-sticker-'));
      try {
        const input=path.join(folder,'input'), output=path.join(folder,'sticker.webp');
        fs.writeFileSync(input,await downloadMedia());
        await run('ffmpeg',['-y','-i',input,'-vf','scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000','-vcodec','libwebp','-lossless','0','-q:v','75','-preset','picture','-an','-vsync','0',output],60000);
        await sock.sendMessage(chat,{sticker:{url:output}},{quoted:raw});
      } finally { fs.rmSync(folder,{recursive:true,force:true}); }
    }
  },
  {
    name: 'voice', aliases: ['voicechanger','voicefx'], category: 'MEDIA & TOOLS', description: 'Apply a voice effect',
    async run({ args, downloadMedia, sock, chat, raw, reply }) {
      const preset=(args[0]||'').toLowerCase();
      if(!effects[preset]) return reply(`🎙️ Reply to audio with: .voice <effect>\nEffects: ${Object.keys(effects).join(', ')}`);
      const folder=fs.mkdtempSync(path.join(os.tmpdir(),'void-voice-'));
      try {
        const input=path.join(folder,'input'), output=path.join(folder,'voice.ogg');
        fs.writeFileSync(input,await downloadMedia());
        await run('ffmpeg',['-y','-i',input,'-vn','-af',effects[preset],'-c:a','libopus','-b:a','64k',output],90000);
        await sock.sendMessage(chat,{audio:{url:output},mimetype:'audio/ogg; codecs=opus',ptt:true},{quoted:raw});
      } finally { fs.rmSync(folder,{recursive:true,force:true}); }
    }
  }
];
