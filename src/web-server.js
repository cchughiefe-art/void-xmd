import http from 'node:http';
import crypto from 'node:crypto';
import { config } from './config.js';
import { connectionState, pairingState, requestPairing } from './bot.js';
import { approveFeature, listFeatureDrafts } from './feature-builder.js';

const page=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VOID XMD Control</title><style>
:root{color-scheme:dark;--bg:#07090f;--card:#111522;--line:#252b3d;--green:#36e39a;--text:#f4f7fb;--muted:#9ca7bd}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#172038,var(--bg) 45%);color:var(--text);font:15px system-ui,sans-serif;min-height:100vh}.wrap{width:min(920px,92%);margin:40px auto}.brand{font-size:30px;font-weight:900;letter-spacing:.04em}.tag{color:var(--green);margin:5px 0 25px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:18px}.card{background:rgba(17,21,34,.94);border:1px solid var(--line);border-radius:18px;padding:20px;box-shadow:0 20px 50px #0006}h2{margin:0 0 8px}p{color:var(--muted);line-height:1.5}input,button{width:100%;padding:13px 14px;border-radius:11px;border:1px solid var(--line);font:inherit;margin-top:10px}input{background:#090c14;color:var(--text)}button{background:var(--green);color:#04120c;font-weight:800;cursor:pointer}.code{font-size:32px;letter-spacing:.18em;text-align:center;color:var(--green);font-weight:900;padding:18px 0}.status{display:inline-block;padding:6px 10px;border-radius:999px;background:#243044;color:#dbe7ff}.draft{border-top:1px solid var(--line);padding-top:14px;margin-top:14px}.draft pre{white-space:pre-wrap;max-height:260px;overflow:auto;background:#080b12;padding:12px;border-radius:9px;font-size:12px}.msg{min-height:20px;color:#ffbf69}</style></head><body><main class="wrap"><div class="brand">👑 VOID XMD</div><div class="tag">PAIRING & FEATURE CONTROL</div><div class="grid"><section class="card"><h2>WhatsApp pairing</h2><p id="state" class="status">Checking…</p><input id="key" type="password" placeholder="Web admin key"><input id="phone" inputmode="numeric" placeholder="2348012345678"><button onclick="pair()">Generate pairing code</button><div id="code" class="code"></div><p>WhatsApp → Linked devices → Link a device → Link with phone number.</p></section><section class="card"><h2>Feature drafts</h2><p>Use <b>.feature your request</b> in WhatsApp. Review the generated code here before approving it.</p><button onclick="drafts()">Load pending drafts</button><div id="drafts"></div></section></div><p id="msg" class="msg"></p></main><script>
const key=()=>document.getElementById('key').value;const msg=t=>document.getElementById('msg').textContent=t;
async function api(url,options={}){const r=await fetch(url,{...options,headers:{'content-type':'application/json','x-admin-key':key(),...(options.headers||{})}});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d}
async function status(){try{const d=await api('/api/status');document.getElementById('state').textContent=d.connected?'Connected':'Waiting for pairing';if(d.code)document.getElementById('code').textContent=d.code}catch(e){msg(e.message)}}
async function pair(){try{msg('Generating code…');const d=await api('/api/pair',{method:'POST',body:JSON.stringify({phone:document.getElementById('phone').value})});document.getElementById('code').textContent=d.code;msg('Pairing code ready.')}catch(e){msg(e.message)}}
async function drafts(){try{const d=await api('/api/features');const root=document.getElementById('drafts');root.innerHTML=d.drafts.length?'':'<p>No drafts yet.</p>';for(const x of d.drafts){const el=document.createElement('div');el.className='draft';el.innerHTML='<b>'+escapeHtml(x.description)+'</b><p>Status: '+escapeHtml(x.status)+'</p><pre>'+escapeHtml(x.code)+'</pre>'+(x.status==='pending'?'<button>Approve and activate</button>':'');if(x.status==='pending')el.querySelector('button').onclick=()=>approve(x.id);root.appendChild(el)}}catch(e){msg(e.message)}}
async function approve(id){try{const d=await api('/api/features/approve',{method:'POST',body:JSON.stringify({id})});msg('Activated .'+d.name);drafts()}catch(e){msg(e.message)}}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}status();setInterval(status,5000);
</script></body></html>`;

function json(res,status,data){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));}
function authorized(req){const supplied=String(req.headers['x-admin-key']||'');if(!supplied||supplied.length!==config.webAdminKey.length)return false;return crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(config.webAdminKey));}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000)throw new Error('Request too large.');}return raw?JSON.parse(raw):{};}

export function startWebServer(){
  return http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/pair')){res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",'x-frame-options':'DENY'});return res.end(page);}
      if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{name:config.name,status:'running',whatsapp:connectionState()?'connected':'connecting',uptime:Math.floor(process.uptime())});
      if(req.method==='GET'&&url.pathname==='/api/status')return json(res,200,{...pairingState()});
      if(!authorized(req))return json(res,401,{error:'Invalid web admin key.'});
      if(req.method==='POST'&&url.pathname==='/api/pair'){const data=await body(req);return json(res,200,{code:await requestPairing(data.phone)});}
      if(req.method==='GET'&&url.pathname==='/api/features')return json(res,200,{drafts:listFeatureDrafts()});
      if(req.method==='POST'&&url.pathname==='/api/features/approve'){const data=await body(req);return json(res,200,await approveFeature(String(data.id||'')));}
      return json(res,404,{error:'Not found'});
    }catch(error){return json(res,400,{error:error.message||'Request failed'});}
  }).listen(config.port,'0.0.0.0',()=>console.log(`${config.name} dashboard on port ${config.port}`));
}
