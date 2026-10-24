/* Runtime for the Documents app.
   The app was written for claude.ai, where window.claude.use(name) hands it a database, a sign-in and a downloads
   helper. This file provides the same calls on a plain web page.
   - Every record lives in this browser's IndexedDB first, so the app is fast and works offline.
   - When js/config.js names a Supabase project, people sign in and their records sync through it: local changes go
     into an outbox that is pushed to the "records" table, and changes from other devices arrive live (and on every
     return to the page). The newest change to a record wins.
   - Without config, or with "Use on this device only", it is storage on this device alone.
   Capabilities with no free equivalent here (comments to Claude, in-page AI, Google Drive) resolve to null, and the
   app hides their buttons on its own. The Data/Account button at the bottom left handles sign-out and backups. */
(function(){
'use strict';
const CFG=window.DOCUMENTS_CONFIG||{}, CLOUD=!!(CFG.supabaseUrl && CFG.supabaseAnonKey);
const SB_JS='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js';
const ANON_DB='documents-app', LS='documents-app:';
const mem=new Map();            // full doc path -> data object
const times=new Map();          // path -> ms of the last change (kept after deletes, so older changes can't revive it)
const outbox=new Set();         // paths changed here and not yet confirmed by the server
const listeners=new Set();      // {type:'doc'|'query', ...}
let idb=null, dbName=ANON_DB, mode='local', uid='local', email='', sb=null, started=null, status='local';
let bc=null;
const lsGet=k=>{ try{ return localStorage.getItem(LS+k); }catch(e){ return null; } };
const lsSet=(k,v)=>{ try{ if(v==null) localStorage.removeItem(LS+k); else localStorage.setItem(LS+k,String(v)); }catch(e){} };

/* Keep the app's page-wide shortcuts (Space, arrows, letters in reading mode) away from the add-on panels below and
   in feedback.js: listeners on window/document/body skip events that start inside an element marked .fbk-ui/.lr-ui.
   This loads before the app, so every app listener is covered. */
const ADDON='.fbk-ui,.lr-ui';
const rawAdd=EventTarget.prototype.addEventListener, rawRemove=EventTarget.prototype.removeEventListener, wrapped=new WeakMap();
const isPageTarget=t=>t===window||t===document||t===document.documentElement||t===document.body;
EventTarget.prototype.addEventListener=function(type,fn,opts){
  if(!fn || !isPageTarget(this) || fn.__addon) return rawAdd.call(this,type,fn,opts);
  let w=wrapped.get(fn);
  if(!w){ w=function(e){ const t=e.target; if(t && t.closest && t.closest(ADDON)) return; return typeof fn==='function'?fn.call(this,e):fn.handleEvent(e); }; wrapped.set(fn,w); }
  return rawAdd.call(this,type,w,opts);
};
EventTarget.prototype.removeEventListener=function(type,fn,opts){ return rawRemove.call(this,type,(fn&&wrapped.get(fn))||fn,opts); };

/* ---------- IndexedDB: records, times, outbox ---------- */
function openIdb(name){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(name,2);
    r.onupgradeneeded=()=>{ ['records','times','outbox'].forEach(s=>{ if(!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); }); };
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
  });
}
function readAll(d,store){
  return new Promise((res,rej)=>{
    const out=[]; const c=d.transaction(store,'readonly').objectStore(store).openCursor();
    c.onsuccess=()=>{ const cur=c.result; if(cur){ out.push([cur.key,cur.value]); cur.continue(); } else res(out); };
    c.onerror=()=>rej(c.error);
  });
}
function idbWrite(recs,ts,obAdd,obDel){
  return new Promise((res,rej)=>{
    const tx=idb.transaction(['records','times','outbox'],'readwrite');
    const r=tx.objectStore('records'), t=tx.objectStore('times'), o=tx.objectStore('outbox');
    recs.forEach(([k,v])=>{ if(v==null) r.delete(k); else r.put(v,k); });
    ts.forEach(([k,v])=>t.put(v,k));
    (obAdd||[]).forEach(k=>o.put(1,k)); (obDel||[]).forEach(k=>o.delete(k));
    tx.oncomplete=()=>res(); tx.onabort=tx.onerror=()=>rej(tx.error);
  });
}
async function load(){
  idb=await openIdb(dbName);
  (await readAll(idb,'records')).forEach(([k,v])=>mem.set(k,v));
  (await readAll(idb,'times')).forEach(([k,v])=>times.set(k,v));
  (await readAll(idb,'outbox')).forEach(([k])=>outbox.add(k));
  try{ if(navigator.storage && navigator.storage.persist) await navigator.storage.persist(); }catch(e){}
  bc=('BroadcastChannel' in window) ? new BroadcastChannel('documents-sync:'+dbName) : null;
  if(bc) bc.onmessage=onOtherTab;
}

/* ---------- helpers ---------- */
const clone=v=>v==null?v:(typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v)));
const norm=p=>String(p).replace(/^\/+|\/+$/g,'').replace(/\/+/g,'/');
const collOf=p=>{ const i=p.lastIndexOf('/'); return i<0?'':p.slice(0,i); };
const idOf=p=>{ const i=p.lastIndexOf('/'); return i<0?p:p.slice(i+1); };
function newId(){ const a='abcdefghijklmnopqrstuvwxyz0123456789'; const b=new Uint8Array(20); crypto.getRandomValues(b); return [...b].map(x=>a[x%36]).join(''); }
function err(code,msg){ const e=new Error(msg||code); e.code=code; return e; }

function docSnap(path){
  const has=mem.has(path), data=has?mem.get(path):undefined;
  return { id:idOf(path), ref:new DocRef(path), exists:has, metadata:{hasPendingWrites:false}, data:()=>has?clone(data):undefined, get:f=>has&&data?clone(data[f]):undefined };
}
function cmp(a,b){ if(a===b) return 0; if(a==null) return -1; if(b==null) return 1; return a<b?-1:1; }
function match(v,op,x){
  switch(op){
    case '==': return v===x; case '!=': return v!==x;
    case '<': return v<x; case '<=': return v<=x; case '>': return v>x; case '>=': return v>=x;
    case 'in': return Array.isArray(x)&&x.includes(v); case 'not-in': return Array.isArray(x)&&!x.includes(v);
    case 'array-contains': return Array.isArray(v)&&v.includes(x);
    case 'array-contains-any': return Array.isArray(v)&&Array.isArray(x)&&x.some(y=>v.includes(y));
  }
  return false;
}
function runQuery(q){
  let rows=[];
  mem.forEach((data,path)=>{ if(collOf(path)===q.coll) rows.push(path); });
  rows=rows.filter(p=>q.filters.every(([f,op,x])=>match((mem.get(p)||{})[f],op,x)));
  if(q.order.length) rows.sort((a,b)=>{ for(const [f,dir] of q.order){ const c=cmp((mem.get(a)||{})[f],(mem.get(b)||{})[f]); if(c) return dir==='desc'?-c:c; } return 0; });
  if(q.lim!=null) rows=rows.slice(0,q.lim);
  const docs=rows.map(docSnap);
  return { docs, size:docs.length, empty:!docs.length, forEach:fn=>docs.forEach(fn) };
}

/* ---------- change notification ---------- */
let pendingPaths=new Set(), notifyQueued=false;
function touched(paths, fromOtherTab){
  paths.forEach(p=>pendingPaths.add(p));
  if(!fromOtherTab && bc) try{ bc.postMessage({paths}); }catch(e){}
  if(notifyQueued) return; notifyQueued=true;
  setTimeout(()=>{
    notifyQueued=false; const ps=pendingPaths; pendingPaths=new Set();
    listeners.forEach(l=>{
      try{
        if(l.type==='doc'){ if(ps.has(l.path)) l.cb(docSnap(l.path)); }
        else if([...ps].some(p=>collOf(p)===l.q.coll)) l.cb(runQuery(l.q));
      }catch(e){ console.error(e); }
    });
  },0);
}
async function onOtherTab(e){
  const paths=(e.data&&e.data.paths)||[]; if(!paths.length||!idb) return;
  const tx=idb.transaction(['records','times','outbox'],'readonly');
  const get=(s,p)=>new Promise(r=>{ const g=tx.objectStore(s).get(p); g.onsuccess=()=>r(g.result); g.onerror=()=>r(undefined); });
  for(const p of paths){
    const [v,t,o]=await Promise.all([get('records',p),get('times',p),get('outbox',p)]);
    if(v===undefined) mem.delete(p); else mem.set(p,v);
    if(t!==undefined) times.set(p,t);
    if(o) outbox.add(p); else outbox.delete(p);
  }
  touched(paths,true);
}

/* A change made here: stamped with a time later than any before it, and queued for the server when signed in. */
async function commit(ops){
  const before=ops.map(([k])=>[k,mem.get(k),times.get(k)]);
  const now=Date.now();
  const ts=ops.map(([k])=>[k,Math.max(now,(times.get(k)||0)+1)]);
  ops.forEach(([k,v])=>{ if(v==null) mem.delete(k); else mem.set(k,v); });
  ts.forEach(([k,t])=>times.set(k,t));
  const queue=mode==='cloud'?ops.map(([k])=>k):[];
  try{ await idbWrite(ops.map(([k,v])=>[k,clone(v)]),ts,queue); }
  catch(e){
    before.forEach(([k,v,t])=>{ if(v===undefined) mem.delete(k); else mem.set(k,v); if(t===undefined) times.delete(k); else times.set(k,t); });
    throw err(e&&e.name==='QuotaExceededError'?'quota_exceeded':'write_failed', e&&e.message);
  }
  queue.forEach(k=>outbox.add(k));
  touched(ops.map(([k])=>k));
  if(queue.length) scheduleFlush();
}

/* ---------- Firestore-style API the app uses ---------- */
class DocRef{
  constructor(path){ this.path=norm(path); this.id=idOf(this.path); }
  get parent(){ return new CollRef(collOf(this.path)); }
  collection(sub){ return new CollRef(this.path+'/'+sub); }
  async get(){ await start(); return docSnap(this.path); }
  async set(data,opts){ await start(); const cur=mem.get(this.path); const next=(opts&&opts.merge&&cur)?Object.assign(clone(cur),clone(data)):clone(data); await commit([[this.path,next]]); }
  async update(patch){ await start(); const cur=mem.get(this.path); await commit([[this.path,Object.assign(cur?clone(cur):{},clone(patch))]]); }
  async delete(){ await start(); await commit([[this.path,null]]); }
  onSnapshot(cb,onErr){
    const l={type:'doc',path:this.path,cb}; listeners.add(l);
    start().then(()=>{ if(listeners.has(l)) cb(docSnap(this.path)); },e=>onErr&&onErr(e));
    return ()=>listeners.delete(l);
  }
}
class Query{
  constructor(coll,filters,order,lim){ this.q={coll:norm(coll),filters:filters||[],order:order||[],lim:lim==null?null:lim}; }
  where(f,op,x){ return new Query(this.q.coll,[...this.q.filters,[f,op,x]],this.q.order,this.q.lim); }
  orderBy(f,dir){ return new Query(this.q.coll,this.q.filters,[...this.q.order,[f,dir||'asc']],this.q.lim); }
  limit(n){ return new Query(this.q.coll,this.q.filters,this.q.order,n); }
  async get(){ await start(); return runQuery(this.q); }
  onSnapshot(cb,onErr){
    const l={type:'query',q:this.q,cb}; listeners.add(l);
    start().then(()=>{ if(listeners.has(l)) cb(runQuery(this.q)); },e=>onErr&&onErr(e));
    return ()=>listeners.delete(l);
  }
}
class CollRef extends Query{
  constructor(path){ super(path); this.path=this.q.coll; this.id=idOf(this.path); }
  doc(id){ return new DocRef(this.path+'/'+(id||newId())); }
  async add(data){ const r=this.doc(); await r.set(data); return r; }
}
const db={
  doc:p=>new DocRef(p),
  collection:p=>new CollRef(p),
  batch(){ const ops=[]; return {
    set(ref,data){ ops.push(()=>ref.set(data)); return this; },
    update(ref,data){ ops.push(()=>ref.update(data)); return this; },
    delete(ref){ ops.push(()=>ref.delete()); return this; },
    async commit(){ for(const o of ops) await o(); } }; }
};

/* ---------- sync with Supabase ---------- */
function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=()=>rej(new Error('Couldn’t load the sign-in library. Check your connection.')); document.head.appendChild(s); }); }
async function client(){
  if(sb) return sb;
  if(!window.supabase) await loadScript(SB_JS);
  sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'documents-app-auth'}});
  return sb;
}
function setStatus(s){ status=s; renderDock(); }

/* Apply rows from the server that are newer than what this device has. */
async function applyRemote(rows){
  const ops=[], ts=[], obDel=[];
  rows.forEach(r=>{
    const p=r.path, t=Number(r.t)||0; if(!p || t<=(times.get(p)||0)) return;
    ops.push([p, r.deleted ? null : r.data]); ts.push([p,t]); if(outbox.has(p)) obDel.push(p);
  });
  if(!ops.length) return;
  ops.forEach(([k,v])=>{ if(v==null) mem.delete(k); else mem.set(k,v); });
  ts.forEach(([k,t])=>times.set(k,t)); obDel.forEach(k=>outbox.delete(k));
  try{ await idbWrite(ops.map(([k,v])=>[k,clone(v)]),ts,[],obDel); }catch(e){ console.error(e); }
  touched(ops.map(([k])=>k));
}
let pulling=null;
function pull(){
  if(mode!=='cloud') return Promise.resolve();
  if(pulling) return pulling;
  pulling=(async()=>{
    let cursor=lsGet('cursor:'+uid)||'1970-01-01T00:00:00Z';
    for(let guard=0; guard<200; guard++){
      const {data,error}=await sb.from('records').select('path,data,t,deleted,updated_at').gte('updated_at',cursor).order('updated_at',{ascending:true}).limit(1000);
      if(error) throw error;
      await applyRemote(data);
      if(data.length){ cursor=data[data.length-1].updated_at; lsSet('cursor:'+uid,cursor); }
      if(data.length<1000) break;
    }
  })().finally(()=>{ pulling=null; });
  return pulling;
}
let flushTimer=null, flushing=false, backoff=2000;
function scheduleFlush(ms){ if(mode!=='cloud') return; clearTimeout(flushTimer); flushTimer=setTimeout(flush, ms==null?700:ms); if(status!=='offline') setStatus('syncing'); }
async function flush(){
  if(mode!=='cloud' || flushing) return;
  if(!outbox.size){ setStatus('synced'); return; }
  if(!navigator.onLine){ setStatus('offline'); return; }
  flushing=true; setStatus('syncing');
  try{
    while(outbox.size){
      /* Send up to ~1 MB at a time (article bodies can be a few hundred KB each). */
      const rows=[]; let size=0;
      for(const p of outbox){
        const has=mem.has(p), row={user_id:uid, path:p, data:has?mem.get(p):null, t:times.get(p)||Date.now(), deleted:!has};
        const n=has?JSON.stringify(row.data).length:10;
        if(rows.length && (size+n>1e6 || rows.length>=100)) break;
        rows.push(row); size+=n;
      }
      const {error}=await sb.from('records').upsert(rows,{onConflict:'user_id,path',returning:'minimal'});
      if(error) throw error;
      const done=rows.filter(r=>times.get(r.path)===r.t).map(r=>r.path);
      done.forEach(p=>outbox.delete(p));
      await idbWrite([],[],[],done);
      if(!done.length) break;
    }
    backoff=2000; setStatus(outbox.size?'syncing':'synced');
  }catch(e){
    console.warn('sync',e); setStatus(navigator.onLine?'error':'offline');
    clearTimeout(flushTimer); flushTimer=setTimeout(flush,backoff); backoff=Math.min(backoff*2,60000);
  }finally{ flushing=false; }
  if(outbox.size && !flushTimer) scheduleFlush();
}
function live(){
  sb.channel('records:'+uid)
    .on('postgres_changes',{event:'*',schema:'public',table:'records',filter:'user_id=eq.'+uid},p=>{ if(p.new && p.new.path) applyRemote([p.new]); })
    .subscribe(s=>{ if(s==='SUBSCRIBED') pull().catch(()=>{}); });
  const catchUp=()=>{ if(document.visibilityState==='visible'){ pull().then(()=>scheduleFlush(0),()=>{}); } };
  document.addEventListener('visibilitychange',catchUp);
  addEventListener('online',()=>{ setStatus('syncing'); catchUp(); });
  addEventListener('offline',()=>setStatus('offline'));
  setInterval(catchUp,60000);
}
/* First sign-in on this browser: bring along anything saved here before accounts existed (once, to one account). */
async function adoptDeviceDocs(){
  if(lsGet('adopted')) return;
  lsSet('adopted',uid);
  let anon; try{ anon=await openIdb(ANON_DB); }catch(e){ return; }
  const rows=await readAll(anon,'records'); anon.close();
  const ops=rows.map(([k,v])=>[k.replace(/^data\/users\/local\//,'data/users/'+uid+'/'),v]).filter(([k])=>!mem.has(k));
  for(let i=0;i<ops.length;i+=200) await commit(ops.slice(i,i+200));
}

/* ---------- start-up: who is this, and which store ---------- */
function start(){
  if(started) return started;
  started=(async()=>{
    if(CLOUD && lsGet('deviceOnly')!=='1'){
      let session=null;
      try{ await client(); session=(await sb.auth.getSession()).data.session; }catch(e){ console.warn(e); }
      if(!session && sb) session=await signInGate();
      if(session){
        mode='cloud'; uid=session.user.id; email=session.user.email||''; dbName=ANON_DB+':'+uid;
        await load();
        await adoptDeviceDocs();
        setStatus('syncing');
        try{ await Promise.race([pull(), new Promise(r=>setTimeout(r,8000))]); }catch(e){ console.warn('pull',e); }
        live(); scheduleFlush(0);
        sb.auth.onAuthStateChange(ev=>{ if(ev==='SIGNED_OUT') location.reload(); });
        return;
      }
    }
    mode='local'; await load(); setStatus('local');
  })();
  return started;
}

/* ---------- sign-in screen ---------- */
function signInGate(){
  return new Promise(resolve=>{
    const w=document.createElement('div'); w.className='lr-ui lr-gate'; w.setAttribute('role','dialog'); w.setAttribute('aria-label','Sign in');
    w.innerHTML='<form class="lr-card" novalidate><div class="lr-logo"><span class="ms">description</span></div><h2>Documents</h2>'
      +'<p class="lr-sub">Sign in to keep your documents in sync on all your devices.</p>'
      +'<label>Email<input type="email" name="email" autocomplete="username" required></label>'
      +'<label>Password<input type="password" name="pw" autocomplete="current-password" minlength="6" required></label>'
      +'<p class="lr-msg" role="status"></p>'
      +'<div class="lr-acts"><button type="submit" class="pri" data-in>Sign in</button><button type="button" data-up>Create account</button></div>'
      +'<div class="lr-links"><button type="button" class="lnk" data-forgot>Forgot password?</button><button type="button" class="lnk" data-local>Use on this device only</button></div></form>';
    document.body.appendChild(w);
    const f=w.querySelector('form'), msg=w.querySelector('.lr-msg'), em=f.email, pw=f.pw;
    setTimeout(()=>em.focus(),50);
    const say=(t,bad)=>{ msg.textContent=t; msg.classList.toggle('bad',!!bad); };
    const busy=on=>w.querySelectorAll('button,input').forEach(x=>x.disabled=on);
    const done=s=>{ w.remove(); resolve(s); };
    const check=()=>{ if(!/\S+@\S+\.\S+/.test(em.value)){ say('Enter your email address.',true); em.focus(); return false; } if(pw.value.length<6){ say('Passwords are at least 6 characters.',true); pw.focus(); return false; } return true; };
    f.addEventListener('submit',async e=>{ e.preventDefault(); if(!check()) return; busy(true); say('Signing in…');
      const {data,error}=await sb.auth.signInWithPassword({email:em.value.trim(),password:pw.value}); busy(false);
      if(error){ say(/confirm/i.test(error.message)?'Confirm your email first: open the link we sent you, then sign in here.':error.message==='Invalid login credentials'?'That email and password don’t match an account.':error.message,true); return; }
      done(data.session); });
    w.querySelector('[data-up]').onclick=async()=>{ if(!check()) return; busy(true); say('Creating your account…');
      const {data,error}=await sb.auth.signUp({email:em.value.trim(),password:pw.value,options:{emailRedirectTo:location.href.split('#')[0]}}); busy(false);
      if(error){ say(error.message,true); return; }
      if(data.session) done(data.session); else say('Check your email and open the confirmation link, then sign in here.'); };
    w.querySelector('[data-forgot]').onclick=async()=>{ if(!/\S+@\S+\.\S+/.test(em.value)){ say('Enter your email above first.',true); em.focus(); return; }
      busy(true); const {error}=await sb.auth.resetPasswordForEmail(em.value.trim(),{redirectTo:location.href.split('#')[0]}); busy(false);
      say(error?error.message:'Check your email for a link to set a new password.',!!error); };
    w.querySelector('[data-local]').onclick=()=>{ lsSet('deviceOnly','1'); done(null); };
  });
}
/* Arriving from a password-reset email: ask for the new password. */
function watchRecovery(){
  if(!sb) return;
  sb.auth.onAuthStateChange(async ev=>{
    if(ev!=='PASSWORD_RECOVERY') return;
    const p=prompt('Choose a new password (at least 6 characters):'); if(!p) return;
    const {error}=await sb.auth.updateUser({password:p}); alert(error?error.message:'Password updated.');
  });
}

/* ---------- user, downloads ---------- */
const user={
  id:async()=>{ await start(); return uid; },
  me:async()=>{ await start(); return {id:uid,name:email?email.split('@')[0]:'Me'}; },
  profiles:async ids=>{ const n=(await user.me()).name; const o={}; (ids||[]).forEach(i=>{ o[i]={name:n}; }); return o; }
};
function saveFile(filename,data){
  const blob=data instanceof Blob?data:new Blob([data],{type:/\.html?$/i.test(filename)?'text/html':'text/plain'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const downloads={ save:async({filename,data})=>{ saveFile(filename||'download',data); return {ok:true}; } };

window.claude={
  use:async name=>{
    if(name==='db'){ try{ await start(); watchRecovery(); return db; }catch(e){ console.error(e); return null; } }
    if(name==='user') return user;
    if(name==='downloads') return downloads;
    return null; // comments, mcp, assets, sample: not available here
  }
};

/* ---------- backups ---------- */
async function exportAll(){
  await start(); const records={}; mem.forEach((v,k)=>{ records[k]=v; });
  const stamp=new Date().toISOString().slice(0,10);
  saveFile('documents-backup-'+stamp+'.json', JSON.stringify({app:'documents',version:1,exported:new Date().toISOString(),records}));
  lsSet('lastBackup',Date.now());
}
/* Accepts this app's backups, and the older claude.ai backup shape {docs:{id:rec}, folders:{...}, bodies:{...}},
   where a record may wrap its fields in .data. */
function recordsFrom(obj){
  if(obj && obj.records && typeof obj.records==='object') return obj.records;
  const out={};
  Object.keys(obj||{}).forEach(coll=>{
    const v=obj[coll]; if(!v || typeof v!=='object' || ['exported','app','version'].includes(coll)) return;
    const list=Array.isArray(v)?v.map(r=>[r.id||r.doc_id,r]):Object.entries(v);
    list.forEach(([id,r])=>{ if(!id||!r) return; const d=(r.data&&typeof r.data==='object')?r.data:r; out[coll+'/'+id]=d; });
  });
  return out;
}
async function importFile(file){
  const obj=JSON.parse(await file.text()); const recs=recordsFrom(obj); const keys=Object.keys(recs);
  if(!keys.length) throw new Error('No records found in that file.');
  await start(); const ops=keys.map(k=>[norm(k).replace(/^data\/users\/[^/]+\//,'data/users/'+uid+'/'),recs[k]]);
  for(let i=0;i<ops.length;i+=200) await commit(ops.slice(i,i+200));
  return keys.length;
}
async function signOut(){
  if(outbox.size && !confirm(outbox.size+' change'+(outbox.size===1?' hasn’t':'s haven’t')+' reached your account yet (you may be offline). Sign out anyway and lose '+(outbox.size===1?'it':'them')+'?')) return;
  try{ await sb.auth.signOut(); }catch(e){}
  lsSet('cursor:'+uid,null);
  try{ idb.close(); }catch(e){}
  /* Remove this account's copy from the browser, so the next person here can't read it. */
  await new Promise(r=>{ const d=indexedDB.deleteDatabase(dbName); d.onsuccess=d.onerror=d.onblocked=()=>r(); });
  location.reload();
}

/* ---------- bottom-left dock: account/sync status + Data menu (feedback.js adds its button here too) ---------- */
let dock=null, mainBtn=null;
const STATUS={
  local:['save','Data'], synced:['cloud_done','Synced'], syncing:['sync','Syncing…'],
  offline:['cloud_off','Offline'], error:['sync_problem','Retrying…']
};
function renderDock(){
  if(!mainBtn) return;
  const [ic,lbl]=STATUS[status]||STATUS.local;
  const waiting=(status==='offline'||status==='error') && outbox.size ? ' · '+outbox.size+' waiting' : '';
  mainBtn.innerHTML='<span class="ms">'+ic+'</span><span>'+lbl+waiting+'</span>';
  const last=+lsGet('lastBackup')||0;
  mainBtn.dataset.due=(mode==='local' && mem.size && Date.now()-last>7*864e5)?'1':'0';
  mainBtn.title=mode==='cloud'?'Signed in as '+email+'. Your documents sync to your account.':'Back up or restore your documents';
}
function dataUi(){
  const css=document.createElement('style');
  css.textContent=`
  .lr-dock{position:fixed;z-index:46;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));display:flex;gap:8px;align-items:center}
  .lr-btn,.lr-dock .fbk-btn{position:static;height:32px;padding:0 12px 0 10px;border-radius:16px;border:1px solid #c7c7c7;background:#fff;color:#444746;font:500 13px/1 Roboto,system-ui,-apple-system,sans-serif;display:flex;align-items:center;gap:6px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.12);white-space:nowrap}
  .lr-btn:hover{background:#f1f3f4}.lr-btn .ms{font-size:18px}
  .lr-btn[data-due="1"]::after{content:"";width:7px;height:7px;border-radius:50%;background:#b3261e}
  .lr-pop{position:fixed;z-index:47;left:16px;bottom:calc(56px + env(safe-area-inset-bottom,0px));width:min(300px,calc(100vw - 32px));background:#fff;border:1px solid #dadce0;border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.18);padding:14px;font:14px/1.45 Roboto,system-ui,-apple-system,sans-serif;color:#1f1f1f}
  .lr-pop h4{margin:0 0 4px;font-size:14px}.lr-pop p{margin:0 0 10px;color:#5f6368;font-size:13px;overflow-wrap:anywhere}
  .lr-pop button{display:block;width:100%;text-align:left;margin:4px 0;padding:8px 10px;border-radius:8px;border:1px solid #dadce0;background:#fff;font:inherit;cursor:pointer;color:inherit}
  .lr-pop button:hover{background:#f1f3f4}
  #sidebar{padding-bottom:56px}
  body.reading .lr-dock,body.full-doc .lr-dock,body.zoom-mode .lr-dock{opacity:.35}
  body.reading .lr-dock:hover,body.full-doc .lr-dock:hover,body.zoom-mode .lr-dock:hover{opacity:1}
  .lr-gate{position:fixed;inset:0;z-index:2147483600;background:#f8fafd;display:grid;place-items:center;padding:16px;font:14px/1.45 Roboto,system-ui,-apple-system,sans-serif;color:#1f1f1f}
  .lr-card{width:min(380px,100%);background:#fff;border:1px solid #dadce0;border-radius:16px;padding:28px 24px;box-shadow:0 2px 12px rgba(60,64,67,.12)}
  .lr-logo{width:40px;height:40px;border-radius:10px;background:#4285f4;color:#fff;display:grid;place-items:center;margin-bottom:12px}.lr-logo .ms{font-size:24px}
  .lr-card h2{margin:0 0 4px;font-size:22px;font-weight:500}.lr-sub{margin:0 0 18px;color:#5f6368}
  .lr-card label{display:block;font-size:13px;color:#444746;margin:0 0 12px}
  .lr-card input{display:block;width:100%;margin-top:4px;height:42px;padding:0 12px;border:1px solid #c7c7c7;border-radius:8px;font:inherit;font-size:16px;background:#fff;color:inherit}
  .lr-card input:focus{outline:2px solid #0b57d0;outline-offset:-1px;border-color:transparent}
  .lr-msg{min-height:20px;margin:0 0 8px;font-size:13px;color:#444746}.lr-msg.bad{color:#b3261e}
  .lr-acts{display:flex;gap:8px}.lr-acts button{flex:1;height:40px;border-radius:20px;border:1px solid #c7c7c7;background:#fff;font:500 14px Roboto,system-ui,sans-serif;cursor:pointer;color:#0b57d0}
  .lr-acts button.pri{background:#0b57d0;border-color:#0b57d0;color:#fff}
  .lr-acts button:disabled{opacity:.6;cursor:default}
  .lr-links{display:flex;justify-content:space-between;gap:8px;margin-top:14px;flex-wrap:wrap}
  .lr-links .lnk{border:0;background:none;padding:4px 0;color:#0b57d0;font:inherit;font-size:13px;cursor:pointer}`;
  document.head.appendChild(css);
  dock=document.createElement('div'); dock.className='lr-ui lr-dock';
  mainBtn=document.createElement('button'); mainBtn.className='lr-btn'; mainBtn.type='button';
  dock.appendChild(mainBtn); document.body.appendChild(dock); renderDock();
  let pop=null;
  const close=()=>{ if(pop){ pop.remove(); pop=null; } };
  mainBtn.onclick=()=>{
    if(pop){ close(); return; }
    pop=document.createElement('div'); pop.className='lr-ui lr-pop'; pop.setAttribute('role','dialog'); pop.setAttribute('aria-label','Your data');
    const l=+lsGet('lastBackup')||0, lastTxt=l?' Last backup: '+new Date(l).toLocaleDateString()+'.':' No backup yet.';
    if(mode==='cloud'){
      pop.innerHTML='<h4>Your account</h4><p>Signed in as <b></b>. Your documents sync to your account and appear on every device where you sign in.'
        +(outbox.size?' '+outbox.size+' change'+(outbox.size===1?' is':'s are')+' waiting to sync.':'')+'</p>'
        +'<button data-sync>⟳ Sync now</button><button data-x>⬇︎ Download a backup (.json)</button><button data-i>⬆︎ Restore from a backup…</button><button data-out>Sign out</button>';
      pop.querySelector('b').textContent=email;
      pop.querySelector('[data-sync]').onclick=()=>{ close(); pull().then(()=>scheduleFlush(0),()=>setStatus('error')); };
      pop.querySelector('[data-out]').onclick=()=>{ close(); signOut(); };
    } else {
      pop.innerHTML='<h4>Your data</h4><p>Everything is saved in this browser only. Back up weekly; Safari can clear site data you haven’t opened in a while.'+lastTxt+'</p>'
        +(CLOUD?'<button data-acct>☁︎ Sign in to sync across devices</button>':'')
        +'<button data-x>⬇︎ Download a backup (.json)</button><button data-i>⬆︎ Restore from a backup…</button>';
      const a=pop.querySelector('[data-acct]'); if(a) a.onclick=()=>{ lsSet('deviceOnly',null); location.reload(); };
    }
    pop.querySelector('[data-x]').onclick=async()=>{ await exportAll(); renderDock(); close(); };
    pop.querySelector('[data-i]').onclick=()=>{
      const inp=document.createElement('input'); inp.type='file'; inp.accept='application/json,.json';
      inp.onchange=async()=>{ const f=inp.files[0]; if(!f) return; try{ const n=await importFile(f); alert('Restored '+n+' records.'); }catch(e){ alert('Couldn’t restore: '+(e.message||e)); } close(); };
      inp.click();
    };
    document.body.appendChild(pop);
  };
  addEventListener('pointerdown',e=>{ if(pop && !pop.contains(e.target) && !mainBtn.contains(e.target)) close(); },true);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',dataUi); else dataUi();

window.documentsLocal={ exportAll, importFile, db, status:()=>({mode,status,uid,email,waiting:outbox.size}) };
})();
