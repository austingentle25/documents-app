/* Local runtime for the Documents app.
   The app was written for claude.ai, where window.claude.use(name) hands it a database, a sign-in and
   a downloads helper. This file provides the same calls on a plain web page, storing everything in this
   browser's IndexedDB. Capabilities with no free local equivalent (comments to Claude, in-page AI,
   Google Drive) resolve to null, and the app hides their buttons on its own.
   It also adds a small "Data" button for backups, because browser storage lives on one device only. */
(function(){
'use strict';
const IDB_NAME='documents-app', IDB_STORE='records', CHANNEL='documents-app-sync';
const mem=new Map();            // full doc path -> data object
const listeners=new Set();      // {type:'doc'|'query', ...}
let idb=null, ready=null;
const bc=('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL) : null;

/* Keep the app's page-wide shortcuts (Space, arrows, letters in reading mode) away from the add-on panels below and
   in feedback.js: listeners on window/document/body skip events that start inside an element marked .fbk-ui.
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

/* ---------- IndexedDB ---------- */
function openIdb(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(IDB_NAME,1);
    r.onupgradeneeded=()=>{ r.result.createObjectStore(IDB_STORE); };
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
  });
}
function idbAll(){
  return new Promise((res,rej)=>{
    const t=idb.transaction(IDB_STORE,'readonly'), st=t.objectStore(IDB_STORE), out=[];
    const c=st.openCursor();
    c.onsuccess=()=>{ const cur=c.result; if(cur){ out.push([cur.key, cur.value]); cur.continue(); } else res(out); };
    c.onerror=()=>rej(c.error);
  });
}
function idbWrite(ops){ // ops: [[path, data|null]]
  return new Promise((res,rej)=>{
    const t=idb.transaction(IDB_STORE,'readwrite'), st=t.objectStore(IDB_STORE);
    ops.forEach(([k,v])=>{ if(v==null) st.delete(k); else st.put(v,k); });
    t.oncomplete=()=>res(); t.onabort=t.onerror=()=>rej(t.error);
  });
}
function load(){
  if(ready) return ready;
  ready=(async()=>{
    idb=await openIdb();
    (await idbAll()).forEach(([k,v])=>mem.set(k,v));
    try{ if(navigator.storage && navigator.storage.persist) await navigator.storage.persist(); }catch(e){}
  })();
  return ready;
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
let pendingPaths=new Set(), flushQueued=false;
function touched(paths, fromOtherTab){
  paths.forEach(p=>pendingPaths.add(p));
  if(!fromOtherTab && bc) try{ bc.postMessage({paths}); }catch(e){}
  if(flushQueued) return; flushQueued=true;
  setTimeout(()=>{
    flushQueued=false; const ps=pendingPaths; pendingPaths=new Set();
    listeners.forEach(l=>{
      try{
        if(l.type==='doc'){ if(ps.has(l.path)) l.cb(docSnap(l.path)); }
        else if([...ps].some(p=>collOf(p)===l.q.coll)) l.cb(runQuery(l.q));
      }catch(e){ console.error(e); }
    });
  },0);
}
if(bc) bc.onmessage=async e=>{
  const paths=(e.data&&e.data.paths)||[]; if(!paths.length||!idb) return;
  const t=idb.transaction(IDB_STORE,'readonly'), st=t.objectStore(IDB_STORE);
  await Promise.all(paths.map(p=>new Promise(r=>{ const g=st.get(p); g.onsuccess=()=>{ if(g.result===undefined) mem.delete(p); else mem.set(p,g.result); r(); }; g.onerror=()=>r(); })));
  touched(paths,true);
};

async function commit(ops){
  const before=ops.map(([k])=>[k,mem.get(k)]);
  ops.forEach(([k,v])=>{ if(v==null) mem.delete(k); else mem.set(k,v); });
  try{ await idbWrite(ops.map(([k,v])=>[k,clone(v)])); }
  catch(e){
    before.forEach(([k,v])=>{ if(v===undefined) mem.delete(k); else mem.set(k,v); });
    throw err(e&&e.name==='QuotaExceededError'?'quota_exceeded':'write_failed', e&&e.message);
  }
  touched(ops.map(([k])=>k));
}

/* ---------- Firestore-style API the app uses ---------- */
class DocRef{
  constructor(path){ this.path=norm(path); this.id=idOf(this.path); }
  get parent(){ return new CollRef(collOf(this.path)); }
  collection(sub){ return new CollRef(this.path+'/'+sub); }
  async get(){ await load(); return docSnap(this.path); }
  async set(data,opts){ await load(); const cur=mem.get(this.path); const next=(opts&&opts.merge&&cur)?Object.assign(clone(cur),clone(data)):clone(data); await commit([[this.path,next]]); }
  async update(patch){ await load(); const cur=mem.get(this.path); await commit([[this.path,Object.assign(cur?clone(cur):{},clone(patch))]]); }
  async delete(){ await load(); await commit([[this.path,null]]); }
  onSnapshot(cb,onErr){
    const l={type:'doc',path:this.path,cb}; listeners.add(l);
    load().then(()=>{ if(listeners.has(l)) cb(docSnap(this.path)); },e=>onErr&&onErr(e));
    return ()=>listeners.delete(l);
  }
}
class Query{
  constructor(coll,filters,order,lim){ this.q={coll:norm(coll),filters:filters||[],order:order||[],lim:lim==null?null:lim}; }
  where(f,op,x){ return new Query(this.q.coll,[...this.q.filters,[f,op,x]],this.q.order,this.q.lim); }
  orderBy(f,dir){ return new Query(this.q.coll,this.q.filters,[...this.q.order,[f,dir||'asc']],this.q.lim); }
  limit(n){ return new Query(this.q.coll,this.q.filters,this.q.order,n); }
  async get(){ await load(); return runQuery(this.q); }
  onSnapshot(cb,onErr){
    const l={type:'query',q:this.q,cb}; listeners.add(l);
    load().then(()=>{ if(listeners.has(l)) cb(runQuery(this.q)); },e=>onErr&&onErr(e));
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

/* ---------- user, downloads ---------- */
const NAME_KEY='documents-app:name';
const user={
  id:async()=>'local',
  me:async()=>({id:'local',name:(()=>{ try{ return localStorage.getItem(NAME_KEY)||'Me'; }catch(e){ return 'Me'; } })()}),
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
    if(name==='db'){ try{ await load(); return db; }catch(e){ console.error(e); return null; } }
    if(name==='user') return user;
    if(name==='downloads') return downloads;
    return null; // comments, mcp, assets, sample: not available locally
  }
};

/* ---------- backups ---------- */
async function exportAll(){
  await load(); const records={}; mem.forEach((v,k)=>{ records[k]=v; });
  const stamp=new Date().toISOString().slice(0,10);
  saveFile('documents-backup-'+stamp+'.json', JSON.stringify({app:'documents',version:1,exported:new Date().toISOString(),records}));
  try{ localStorage.setItem('documents-app:lastBackup',String(Date.now())); }catch(e){}
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
  await load(); const ops=keys.map(k=>[norm(k),recs[k]]);
  for(let i=0;i<ops.length;i+=200) await commit(ops.slice(i,i+200));
  return keys.length;
}

/* The "Data" button: back up, restore, and a reminder when it's been a while. */
function dataUi(){
  const css=document.createElement('style');
  css.textContent=`
  .lr-btn{position:fixed;z-index:46;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));height:32px;padding:0 12px 0 10px;border-radius:16px;border:1px solid #c7c7c7;background:#fff;color:#444746;font:500 13px/1 Roboto,system-ui,-apple-system,sans-serif;display:flex;align-items:center;gap:6px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.12)}
  .lr-btn:hover{background:#f1f3f4}.lr-btn .ms{font-size:18px}
  .lr-btn[data-due="1"]::after{content:"";width:7px;height:7px;border-radius:50%;background:#b3261e}
  .lr-pop{position:fixed;z-index:47;left:16px;bottom:calc(56px + env(safe-area-inset-bottom,0px));width:min(300px,calc(100vw - 32px));background:#fff;border:1px solid #dadce0;border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.18);padding:14px;font:14px/1.45 Roboto,system-ui,-apple-system,sans-serif;color:#1f1f1f}
  .lr-pop h4{margin:0 0 4px;font-size:14px}.lr-pop p{margin:0 0 10px;color:#5f6368;font-size:13px}
  .lr-pop button{display:block;width:100%;text-align:left;margin:4px 0;padding:8px 10px;border-radius:8px;border:1px solid #dadce0;background:#fff;font:inherit;cursor:pointer}
  .lr-pop button:hover{background:#f1f3f4}
  #sidebar{padding-bottom:56px}
  body.reading .lr-btn,body.full-doc .lr-btn,body.zoom-mode .lr-btn{opacity:.35}
  body.reading .lr-btn:hover,body.full-doc .lr-btn:hover,body.zoom-mode .lr-btn:hover{opacity:1}`;
  document.head.appendChild(css);
  const b=document.createElement('button'); b.className='lr-ui lr-btn'; b.type='button'; b.title='Back up or restore your documents';
  b.innerHTML='<span class="ms">save</span><span>Data</span>'; document.body.appendChild(b);
  const last=()=>{ try{ return +localStorage.getItem('documents-app:lastBackup')||0; }catch(e){ return 0; } };
  const mark=()=>{ b.dataset.due=(mem.size && Date.now()-last()>7*864e5)?'1':'0'; };
  load().then(mark);
  let pop=null;
  const close=()=>{ if(pop){ pop.remove(); pop=null; } };
  b.onclick=()=>{
    if(pop){ close(); return; }
    pop=document.createElement('div'); pop.className='lr-ui lr-pop'; pop.setAttribute('role','dialog'); pop.setAttribute('aria-label','Your data');
    const l=last();
    pop.innerHTML='<h4>Your data</h4><p>Everything is saved in this browser only. Back up weekly; Safari can clear site data you haven’t opened in a while.'+(l?' Last backup: '+new Date(l).toLocaleDateString()+'.':' No backup yet.')+'</p>'
      +'<button data-x>⬇︎ Download a backup (.json)</button><button data-i>⬆︎ Restore from a backup…</button>';
    pop.querySelector('[data-x]').onclick=async()=>{ await exportAll(); mark(); close(); };
    pop.querySelector('[data-i]').onclick=()=>{
      const inp=document.createElement('input'); inp.type='file'; inp.accept='application/json,.json';
      inp.onchange=async()=>{ const f=inp.files[0]; if(!f) return; try{ const n=await importFile(f); alert('Restored '+n+' records.'); }catch(e){ alert('Couldn’t restore: '+(e.message||e)); } close(); };
      inp.click();
    };
    document.body.appendChild(pop);
  };
  addEventListener('pointerdown',e=>{ if(pop && !pop.contains(e.target) && e.target!==b && !b.contains(e.target)) close(); },true);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',dataUi); else dataUi();

window.documentsLocal={ exportAll, importFile, db };
})();
