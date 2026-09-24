import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { loadPlugins } from './plugin-loader.js';
import { run } from './utils.js';

const draftsDir=path.join(config.dataDir,'feature-drafts');
const pluginsDir=path.join(config.dataDir,'plugins');
const forbidden=/\b(?:import|require|process|child_process|exec|spawn|eval|Function|fs\.|writeFile|unlink|rmSync|constructor|__proto__|globalThis|Deno|Bun)\b/;
const safeName=value=>String(value||'').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,40);

function ensureDirs(){fs.mkdirSync(draftsDir,{recursive:true});fs.mkdirSync(pluginsDir,{recursive:true});}
function extractCode(value){return String(value||'').replace(/^```(?:javascript|js)?\s*/i,'').replace(/\s*```$/,'').trim();}
function validateCode(code){
  if(code.length<50||code.length>12000) throw new Error('Generated plugin size is invalid.');
  if(forbidden.test(code)) throw new Error('Generated plugin requested a blocked capability.');
  if(!/^export default\s*{/m.test(code)) throw new Error('Generated response is not a plugin module.');
  if(!/\bname\s*:\s*['"][a-z0-9-]+['"]/i.test(code)||!/\brun\s*\(/.test(code)) throw new Error('Generated plugin is missing name or run().');
}

export async function createFeatureDraft(description){
  if(!config.aiKey) throw new Error('Configure AI_API_KEY before using the feature builder.');
  if(String(description).trim().length<8) throw new Error('Describe the feature in more detail.');
  const prompt=`Create one safe VOID XMD WhatsApp command plugin from this request: ${description}\nReturn JavaScript only, no markdown. Export default exactly one object with name, aliases, category, description, ownerOnly, groupOnly, adminOnly, and async run(ctx). Use only values already in ctx: reply, args, text, pushName, sender, chat, metadata, config. Do not import anything, access files, environment variables, processes, shells, credentials, network URLs, eval, constructors, or global objects. Keep it below 150 lines. If the request needs forbidden access, create a command that explains the limitation instead.`;
  const response=await fetch(`${config.aiBaseUrl}/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.aiKey}`},body:JSON.stringify({model:config.aiModel,messages:[{role:'system',content:'You write small, defensive JavaScript command plugins.'},{role:'user',content:prompt}],temperature:0.2}),signal:AbortSignal.timeout(60000)});
  if(!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const data=await response.json(); const code=extractCode(data.choices?.[0]?.message?.content); validateCode(code);
  const id=crypto.randomBytes(5).toString('hex'); ensureDirs();
  const draft={id,description:String(description).trim(),code,status:'pending',createdAt:new Date().toISOString()};
  fs.writeFileSync(path.join(draftsDir,`${id}.json`),JSON.stringify(draft,null,2)); return draft;
}

export function listFeatureDrafts(){ensureDirs();return fs.readdirSync(draftsDir).filter(x=>x.endsWith('.json')).map(file=>{try{return JSON.parse(fs.readFileSync(path.join(draftsDir,file),'utf8'));}catch{return null;}}).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
export async function approveFeature(id){
  if(!/^[a-f0-9]{10}$/.test(id)) throw new Error('Invalid draft ID.'); ensureDirs();
  const file=path.join(draftsDir,`${id}.json`); const draft=JSON.parse(fs.readFileSync(file,'utf8')); validateCode(draft.code);
  const name=safeName(draft.code.match(/\bname\s*:\s*['"]([a-z0-9-]+)['"]/i)?.[1]); if(!name) throw new Error('Could not determine plugin name.');
  const target=path.join(pluginsDir,`${name}.mjs`), candidate=path.join(pluginsDir,`${name}.pending.mjs`);
  fs.writeFileSync(candidate,draft.code); await run(process.execPath,['--check',candidate],10000); fs.renameSync(candidate,target);
  draft.status='approved';draft.approvedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(draft,null,2));
  await loadPlugins(); return {id,name};
}
