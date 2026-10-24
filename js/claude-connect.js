/* Connect Claude with your own Anthropic API key.
   With a key saved on this device, the app's Claude features turn on: grammar check, definitions, practice questions
   and summaries (claude.use('sample')), and comments sent to Claude get a reply in their thread (claude.use('comments')).
   Calls go straight from this browser to Anthropic with the official SDK; the key never goes anywhere else and is not
   synced to your account. Usage is billed to the key's Anthropic account. Loads after local-runtime.js, before the app. */
(function(){
'use strict';
const KEY='documents-app:anthropicKey', USE='documents-app:claudeUse';
const SDK='https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';
const MODEL='claude-opus-5-5', DAILY_CAP=300;
const getKey=()=>{ try{ return localStorage.getItem(KEY)||''; }catch(e){ return ''; } };
function err(code,msg){ const e=new Error(msg||code); e.code=code; return e; }

let sdk=null;
function client(key){
  if(!sdk) sdk=import(SDK).then(m=>m.default||m.Anthropic);
  return sdk.then(A=>({A, c:new A({apiKey:key||getKey(), dangerouslyAllowBrowser:true})}));
}
/* A small guard against runaway use: at most DAILY_CAP calls per day from this device. */
function countCall(){
  const d=new Date().toISOString().slice(0,10); let u={};
  try{ u=JSON.parse(localStorage.getItem(USE)||'{}'); }catch(e){}
  if(u.d!==d) u={d,n:0};
  u.n++; try{ localStorage.setItem(USE,JSON.stringify(u)); }catch(e){}
  return u.n;
}
async function ask({system, messages, effort, signal}){
  if(!getKey()) throw err('not_granted','Connect Claude first (Account → Connect Claude).');
  if(countCall()>DAILY_CAP) throw err('rate_limited','Today’s Claude limit for this device is used up. It resets tomorrow.');
  const {A,c}=await client();
  let res;
  try{
    res=await c.beta.messages.create({
      model:MODEL, max_tokens:16000, system, messages,
      output_config:{effort:effort||'low'},
      fallbacks:'default', betas:['server-side-fallback-2026-07-01']
    },{signal});
  }catch(e){
    if((signal && signal.aborted) || (A.APIUserAbortError && e instanceof A.APIUserAbortError)) throw err('cancelled');
    if(e instanceof A.AuthenticationError) throw err('not_granted','Claude didn’t accept the saved API key. Check it under Account → Connect Claude.');
    if(e instanceof A.PermissionDeniedError) throw err('not_granted','That API key can’t use this model.');
    if(e instanceof A.RateLimitError) throw err('rate_limited','Claude is busy right now. Try again in a minute.');
    if(e instanceof A.APIError) throw err('claude_unavailable','Claude returned an error ('+(e.status||'network')+').');
    throw err('claude_unavailable','Couldn’t reach Claude. Check your connection.');
  }
  if(res.stop_reason==='refusal') throw err('declined','Claude declined this request.');
  return res.content.filter(b=>b.type==='text').map(b=>b.text).join('').trim();
}
function parseJson(t){
  t=t.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim();
  try{ return JSON.parse(t); }catch(e){}
  const a=t.search(/[\[{]/), z=Math.max(t.lastIndexOf(']'),t.lastIndexOf('}'));
  if(a>=0 && z>a){ try{ return JSON.parse(t.slice(a,z+1)); }catch(e){} }
  throw err('claude_unavailable','Claude’s answer wasn’t in the expected format. Try again.');
}

/* In-page AI: the app writes each prompt and says what JSON it wants back. */
const sample={ json: async (prompt, opts)=>parseJson(await ask({
  system:'Reply with only valid JSON, exactly in the shape the request asks for: no prose, no code fences.',
  messages:[{role:'user',content:prompt}], signal:opts&&opts.signal })) };

/* Comments sent to Claude: answer in the comment's own thread, as a reply from "claude". */
function db(){ return window.documentsLocal && window.documentsLocal.db; }
async function replyInThread(cid, header, paragraph){
  const ref=db().doc('comments/'+cid);
  let c=null;
  for(let i=0;i<20 && !c;i++){ const s=await ref.get(); if(s.exists) c=s.data(); else await new Promise(r=>setTimeout(r,250)); }
  if(!c) return;
  const name=a=>a==='claude'?'Claude':'Reader';
  const thread=[{author:c.author,text:c.text},...(c.replies||[])].map(m=>name(m.author)+': '+m.text).join('\n');
  let text;
  try{
    text=await ask({ effort:'medium',
      system:'You answer comments in a reader’s document app (a reading and note-taking tool used by a pre-law student). Reply to the latest comment in the thread directly and helpfully, in plain text, usually under 150 words. Base what you say about the document on the paragraph given; if you need more of the document than that, say what you’d need.',
      messages:[{role:'user',content:(header?header+'\n':'')+(c.quote?'Highlighted text: “'+c.quote+'”\n':'')+(paragraph?'Paragraph: '+paragraph+'\n':'')+'\nThread:\n'+thread}] });
  }catch(e){ text='(Couldn’t answer: '+e.message+')'; }
  const fresh=(await ref.get()).data()||c;
  await ref.update({replies:[...(fresh.replies||[]), {author:'claude', text, at:Date.now()}]});
}
const comments={
  canSendToClaude: async()=>getKey()?'available':'no_session',
  anchorFor: async el=>({text:(el && el.textContent || '').replace(/\s+/g,' ').trim().slice(0,4000)}),
  customAnchors: async()=>({placed(){}, exitMode(){}}),
  resolve: async()=>{},
  sendToClaude: async ({anchor, threadId, text})=>{
    const m=/^\[comment ([A-Za-z0-9_-]+)\]\s*([^\n]*)/.exec(text||'');
    const cid=m?m[1]:threadId;
    /* Other request types (research, reading requests) need a Claude session, which an API key alone doesn't give. */
    if(!cid) throw err('unsupported','That needs a Claude session.');
    replyInThread(cid, m?'Where: '+m[2]:'', anchor&&anchor.text).catch(e=>console.warn('comment reply',e));
    return {threadId:cid};
  }
};

const base=window.claude.use;
window.claude.use=async name=>{
  if(getKey()){ if(name==='sample') return sample; if(name==='comments') return comments; }
  return base(name);
};

/* ---------- the Connect Claude dialog (opened from the account/Data menu) ---------- */
function open(){
  const css='.lr-cc{position:fixed;inset:0;z-index:2147483500;background:rgba(32,33,36,.45);display:grid;place-items:center;padding:16px;font:14px/1.5 Roboto,system-ui,-apple-system,sans-serif;color:#1f1f1f}'
   +'.lr-cc .box{width:min(460px,100%);background:#fff;border-radius:16px;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,.25)}'
   +'.lr-cc h3{margin:0 0 8px;font-size:18px;font-weight:500}.lr-cc p{margin:0 0 10px;color:#444746}.lr-cc ul{margin:0 0 12px;padding-left:20px;color:#444746}'
   +'.lr-cc input{width:100%;height:40px;border:1px solid #c7c7c7;border-radius:8px;padding:0 12px;font:inherit;font-size:15px;box-sizing:border-box}'
   +'.lr-cc .row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}.lr-cc button{height:36px;padding:0 16px;border-radius:18px;border:1px solid #c7c7c7;background:#fff;font:500 14px Roboto,system-ui,sans-serif;cursor:pointer;color:#0b57d0}'
   +'.lr-cc button.pri{background:#0b57d0;border-color:#0b57d0;color:#fff}.lr-cc button.danger{color:#b3261e;margin-right:auto}.lr-cc .msg{min-height:20px;font-size:13px;margin-top:8px}.lr-cc .msg.bad{color:#b3261e}.lr-cc a{color:#0b57d0}';
  if(!document.getElementById('lr-cc-css')){ const s=document.createElement('style'); s.id='lr-cc-css'; s.textContent=css; document.head.appendChild(s); }
  const has=!!getKey();
  const w=document.createElement('div'); w.className='lr-ui lr-cc'; w.setAttribute('role','dialog'); w.setAttribute('aria-label','Connect Claude');
  w.innerHTML='<div class="box"><h3>'+(has?'Claude is connected':'Connect Claude')+'</h3>'
    +'<p>Add your own Anthropic API key to turn on:</p><ul><li>Grammar check, definitions and summaries</li><li>Practice questions in Learn mode</li><li>Replies to comments you send to Claude</li></ul>'
    +'<p>Usage is billed to your Anthropic account, pay as you go. That’s separate from a Claude Pro or Max plan. Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.</p>'
    +'<p>The key is kept in this browser on this device only and is sent only to Anthropic.</p>'
    +'<input type="password" autocomplete="off" spellcheck="false" placeholder="'+(has?'Saved. Paste a new key to replace it':'sk-ant-…')+'" aria-label="Anthropic API key">'
    +'<div class="msg" role="status"></div>'
    +'<div class="row">'+(has?'<button data-rm class="danger">Disconnect</button>':'')+'<button data-x>Cancel</button><button class="pri" data-save>Save and test</button></div></div>';
  document.body.appendChild(w);
  const inp=w.querySelector('input'), msg=w.querySelector('.msg');
  const close=()=>w.remove();
  setTimeout(()=>inp.focus(),50);
  w.addEventListener('click',e=>{ if(e.target===w) close(); });
  w.addEventListener('keydown',e=>{ if(e.key==='Escape') close(); if(e.key==='Enter') w.querySelector('[data-save]').click(); });
  w.querySelector('[data-x]').onclick=close;
  const rm=w.querySelector('[data-rm]'); if(rm) rm.onclick=()=>{ try{ localStorage.removeItem(KEY); }catch(e){} location.reload(); };
  w.querySelector('[data-save]').onclick=async()=>{
    const k=inp.value.trim();
    if(!k){ msg.textContent='Paste your API key first.'; msg.className='msg bad'; return; }
    msg.textContent='Checking the key…'; msg.className='msg';
    try{ const {c}=await client(k); await c.models.retrieve(MODEL); }
    catch(e){ msg.textContent=(e && e.status===401)?'Anthropic didn’t accept that key.':'Couldn’t check the key ('+((e&&e.status)||'network')+').'; msg.className='msg bad'; return; }
    try{ localStorage.setItem(KEY,k); }catch(e){ msg.textContent='This browser blocked saving the key.'; msg.className='msg bad'; return; }
    msg.textContent='Connected. Reloading…'; setTimeout(()=>location.reload(),600);
  };
}
/* Requests that need a live Claude Code session (the old Ask Claude chat) aren't available here; the Feedback button replaces it. */
const hide=document.createElement('style'); hide.textContent='#chatFab{display:none!important}'; document.head.appendChild(hide);

window.documentsClaude={ open, connected:()=>!!getKey() };
})();
