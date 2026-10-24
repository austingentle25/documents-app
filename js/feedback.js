/* Batch feedback for fixing the app.
   Click "Feedback", then "Point at something" (or press Ctrl+Alt+F) and click any part of the app. Each note
   records a breadcrumb of where it was made (mode › document › tab › section › panel › control), a CSS selector
   and a short markup excerpt, so a fix prompt can find the exact spot in index.html. "Copy all" puts every open
   note on the clipboard as one numbered prompt; "Mark sent" files them under Sent so the next batch starts fresh.
   Notes are kept in this browser's localStorage. */
(function(){
'use strict';
const KEY='documents-app:feedback', APP_FILE='index.html';
let items=load(), picking=false, panel=null, hoverBox=null, lastPicked=null;

function load(){ try{ return JSON.parse(localStorage.getItem(KEY)||'[]'); }catch(e){ return []; } }
function persist(){ try{ localStorage.setItem(KEY, JSON.stringify(items)); }catch(e){} badge(); }
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clip=(s,n)=>{ s=String(s||'').replace(/\s+/g,' ').trim(); return s.length>n?s.slice(0,n-1)+'…':s; };
const isOurs=el=>!!(el && el.closest && el.closest('.fbk-ui'));
function text(el){ if(!el) return ''; const c=el.cloneNode(true); c.querySelectorAll('.ms,kbd,script,style').forEach(x=>x.remove()); return clip(c.textContent,60); }

/* ---------- breadcrumb ---------- */
function mode(){
  const b=document.body.classList, m=[];
  const spd=document.querySelector('.spd:not([hidden])');
  if(spd) m.push('Guided reading'); else if(b.contains('reading')) m.push('Reading mode'); else m.push('Editing');
  if(b.contains('zoom-mode')) m.push('Notes mode');
  if(b.contains('full-doc')) m.push('Full screen');
  if(b.contains('night')) m.push('Night');
  return m.join(' + ');
}
function docContext(el){
  const out={};
  const t=document.getElementById('docTitle'); if(t && t.value) out.doc=t.value.trim();
  const tab=document.querySelector('#tabstrip [aria-selected="true"], #tabstrip .tab.active');
  if(tab) out.tab=text(tab);
  const page=document.querySelector('.page');
  const root=(el && page && page.contains(el)) ? el : null;
  if(root){
    let blk=root; while(blk.parentElement && blk.parentElement!==page) blk=blk.parentElement;
    for(let n=blk; n; n=n.previousElementSibling){ if(n.tagName==='H2'){ out.section=clip(n.textContent,80); break; } }
    if(blk!==page) out.block=clip(blk.textContent,140);
  }
  return out;
}
function label(el){
  if(!el || el===document.body) return '';
  const a=el.getAttribute('aria-label')||el.getAttribute('title');
  if(a) return clip(a,50);
  const head=el.querySelector && el.querySelector(':scope > .gpanel-head h3, :scope > .ln-box .ln-head, :scope > .spd-sum-box .spd-sum-h');
  if(head && head.textContent.trim()) return clip(head.textContent,50);
  if(el.id) return '#'+el.id;
  return '';
}
function role(el){
  const t=el.tagName.toLowerCase(), r=el.getAttribute('role');
  if(r) return r; if(t==='button'||t==='a') return 'button'; if(t==='input'||t==='textarea'||t==='select') return 'field';
  return '';
}
function uiPath(el){
  const crumbs=[];
  for(let n=el.parentElement; n && n!==document.body; n=n.parentElement){
    const tag=n.tagName.toLowerCase(), r=n.getAttribute('role');
    const landmark=n.id || r==='dialog' || r==='toolbar' || r==='tablist' || tag==='header' || tag==='aside' || tag==='nav' || n.getAttribute('aria-label');
    if(!landmark) continue;
    const l=label(n); if(l && crumbs[0]!==l) crumbs.unshift(l);
  }
  return crumbs.slice(-4);
}
function selector(el){
  const parts=[];
  for(let n=el; n && n.nodeType===1 && n!==document.body; n=n.parentElement){
    if(n.id){ parts.unshift('#'+CSS.escape(n.id)); break; }
    let s=n.tagName.toLowerCase();
    const cls=[...n.classList].filter(c=>!/^(active|on|hover|focus|open|sel|is-)/.test(c)).slice(0,2);
    if(cls.length) s+='.'+cls.map(c=>CSS.escape(c)).join('.');
    const sib=n.parentElement ? [...n.parentElement.children].filter(x=>x.tagName===n.tagName) : [];
    if(sib.length>1) s+=':nth-of-type('+(sib.indexOf(n)+1)+')';
    parts.unshift(s);
    if(parts.length>=5) break;
  }
  return parts.join(' > ');
}
function excerpt(el){
  const c=el.cloneNode(false); let h=c.outerHTML; const txt=text(el);
  h=h.replace(/\sdata-b="[^"]*"/g,'');
  return clip(h.replace(/><\/[a-z0-9-]+>$/i,'>')+(txt?txt+'…':''),200);
}
/* Prefer the control the person meant: the nearest button/link/field, else the small labeled or texted thing under
   the pointer, never a whole panel. Inside the document page, the paragraph or heading. */
function target(el){
  const page=document.querySelector('.page');
  if(page && page.contains(el)){ let b=el; while(b.parentElement && b.parentElement!==page) b=b.parentElement; return b===page?el:b; }
  const ctl=el.closest('button,a,input,select,textarea,label,[role="button"],[role="tab"],[role="option"],[role="menuitem"],[contenteditable="true"]');
  if(ctl) return ctl;
  for(let n=el, k=0; n && n!==document.body && k<3; n=n.parentElement, k++){
    const r=n.getBoundingClientRect();
    if((n.getAttribute('aria-label')||n.getAttribute('title')||text(n)) && r.width*r.height < innerWidth*innerHeight*0.15) return n;
  }
  return el;
}
function capture(el){
  const ctx=docContext(el), path=uiPath(el), r=role(el), name=label(el)||text(el)||el.tagName.toLowerCase();
  const crumbs=[mode()];
  if(ctx.doc) crumbs.push('“'+ctx.doc+'”');
  if(ctx.tab && ctx.tab!==ctx.doc) crumbs.push('tab “'+ctx.tab+'”');
  if(ctx.section) crumbs.push('section “'+ctx.section+'”');
  path.forEach(p=>crumbs.push(p));
  crumbs.push((r?r+' ':'')+'“'+name+'”');
  const pg=document.querySelector('.page'), inDoc=!!(pg && pg.contains(el));
  return {
    crumb:crumbs.join(' › '),
    selector:inDoc?'':selector(el),
    html:inDoc?'':excerpt(el),
    quote:inDoc?(ctx.block||''):'',
    screen:innerWidth+'×'+innerHeight+(/iPhone|iPad/.test(navigator.userAgent)?' iOS':/Mac/.test(navigator.platform)?' Mac':'')
  };
}
function selectionCapture(){
  const s=getSelection(); if(!s || s.isCollapsed || !s.rangeCount) return null;
  const txt=clip(s.toString(),300); if(!txt) return null;
  const n=s.getRangeAt(0).commonAncestorContainer; const el=n.nodeType===1?n:n.parentElement;
  if(isOurs(el)) return null;
  const c=capture(el); c.quote=txt; return c;
}

/* ---------- pick mode ----------
   A transparent layer covers the page while pointing, so the click never reaches the app; the element underneath is
   found with elementsFromPoint. */
function under(x,y){ return document.elementsFromPoint(x,y).find(e=>!isOurs(e))||null; }
function startPick(){
  if(picking) return; picking=true; closePanel();
  const layer=document.createElement('div'); layer.className='fbk-ui fbk-layer'; layer.tabIndex=-1;
  hoverBox=document.createElement('div'); hoverBox.className='fbk-ui fbk-hover';
  const tip=document.createElement('div'); tip.className='fbk-ui fbk-tip'; tip.innerHTML='Click the part of the app this note is about. <b>Esc</b> to cancel.';
  document.body.append(layer,hoverBox,tip); layer.focus();
  const show=(x,y)=>{ const el=under(x,y); if(!el){ hoverBox.style.display='none'; return; } const r=target(el).getBoundingClientRect(); Object.assign(hoverBox.style,{display:'block',left:r.left-3+'px',top:r.top-3+'px',width:r.width+6+'px',height:r.height+6+'px'}); };
  layer.addEventListener('pointermove',e=>show(e.clientX,e.clientY));
  layer.addEventListener('click',e=>{ e.preventDefault(); const el=under(e.clientX,e.clientY); stop(); if(!el) return; lastPicked=capture(target(el)); openPanel(true); });
  layer.addEventListener('keydown',e=>{ if(e.key==='Escape'){ e.preventDefault(); stop(); } });
  function stop(){ picking=false; layer.remove(); hoverBox.remove(); tip.remove(); }
}

/* ---------- prompt ---------- */
function promptText(list){
  const lines=['Fixes for my Documents app ('+APP_FILE+' in the documents-app repo, plus js/ for the local runtime and this feedback tool).',
    'Each item says where in the app I was (breadcrumb), the element I pointed at (CSS selector and a markup excerpt to search for), and what I want. Make every change, test it, and reply with one line per number saying what you changed.',''];
  list.forEach((it,i)=>{
    lines.push((i+1)+'. ['+it.kind+'] '+(it.note||'(no note)').trim());
    if(it.crumb) lines.push('   Where: '+it.crumb);
    if(it.selector) lines.push('   Element: '+it.selector);
    if(it.html) lines.push('   Markup: '+it.html);
    if(it.quote) lines.push('   Text: "'+it.quote+'"');
    if(it.screen) lines.push('   Screen: '+it.screen);
    lines.push('');
  });
  return lines.join('\n').trim()+'\n';
}
async function copy(text){
  try{ await navigator.clipboard.writeText(text); return true; }catch(e){}
  const t=document.createElement('textarea'); t.value=text; t.className='fbk-ui'; t.style.cssText='position:fixed;left:-9999px;top:0';
  document.body.appendChild(t); t.select(); let ok=false; try{ ok=document.execCommand('copy'); }catch(e){} t.remove(); return ok;
}

/* ---------- GitHub: send a batch as one issue; notes turn Resolved when the issue closes (e.g. a merged PR that says
   "Fixes #12"). Only on a device where a GitHub token is saved, so only the owner can do it. ---------- */
const GH_KEY='documents-app:github';
function gh(){ try{ return JSON.parse(localStorage.getItem(GH_KEY)||'null'); }catch(e){ return null; } }
function guessRepo(){ const m=/^([^.]+)\.github\.io$/.exec(location.hostname); const seg=location.pathname.split('/').filter(Boolean)[0]; return m&&seg?m[1]+'/'+seg:''; }
async function ghApi(path, opts, cfg){
  cfg=cfg||gh(); if(!cfg) throw new Error('GitHub isn’t connected.');
  const r=await fetch('https://api.github.com/repos/'+cfg.repo+path,Object.assign({},opts,{headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+cfg.token,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'}}));
  if(!r.ok){ const e=new Error('GitHub said '+r.status+(r.status===401?' (token not accepted)':r.status===403||r.status===404?' (token can’t reach this repo’s issues)':'')); e.status=r.status; throw e; }
  return r.status===204?null:r.json();
}
async function sendToGitHub(list){
  const cfg=gh(); const day=new Date().toLocaleDateString(undefined,{month:'short',day:'numeric'});
  await ghApi('/labels',{method:'POST',body:JSON.stringify({name:'feedback',color:'1a73e8',description:'From the Documents app Feedback panel'})}).catch(()=>{});
  const issue=await ghApi('/issues',{method:'POST',body:JSON.stringify({
    title:'Feedback: '+list.length+' note'+(list.length===1?'':'s')+' ('+day+')',
    body:promptText(list)+'\n---\nSent from the Documents app Feedback panel. Close this issue (or merge a PR that says “Fixes #this”) to mark these notes resolved.',
    labels:['feedback']})},cfg);
  const t=Date.now(); list.forEach(x=>{ x.sent=t; x.issue=issue.number; x.url=issue.html_url; }); persist();
  return issue;
}
/* Ask GitHub which sent batches are closed now. */
let checking=false;
async function refreshResolved(){
  if(checking || !gh()) return; checking=true;
  try{
    const nums=[...new Set(items.filter(x=>x.issue && !x.resolved).map(x=>x.issue))];
    let changed=false;
    for(const n of nums){ try{ const i=await ghApi('/issues/'+n); if(i.state==='closed'){ const t=Date.parse(i.closed_at)||Date.now(); items.forEach(x=>{ if(x.issue===n && !x.resolved){ x.resolved=t; changed=true; } }); } }catch(e){} }
    if(changed){ persist(); if(panel && !panel.dataset.view) render(false); else if(panel) showSent(); }
  }finally{ checking=false; }
}
function connectGitHub(){
  const cfg=gh()||{repo:guessRepo(),token:''};
  panel.dataset.view='gh';
  panel.querySelector('.fbk-body').innerHTML='<p class="fbk-empty"><b>Send feedback straight to GitHub</b> (just for you). Each send becomes one issue in your repo; when the issue closes, for example by merging a pull request that says “Fixes #N”, those notes move to Resolved.</p>'
    +'<p class="fbk-empty">Make a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>: only this repository, permission <b>Issues: Read and write</b>, nothing else. It’s kept on this device only.</p>'
    +'<label class="fbk-lbl">Repository<input data-repo spellcheck="false" placeholder="owner/repo"></label><label class="fbk-lbl">Token<input data-tok type="password" autocomplete="off" spellcheck="false" placeholder="'+(cfg.token?'Saved. Paste a new one to replace it':'github_pat_…')+'"></label><p class="fbk-empty" data-msg></p>';
  panel.querySelector('[data-repo]').value=cfg.repo;
  panel.querySelector('.fbk-foot').innerHTML='<button data-back>Back</button>'+(cfg.token?'<button data-off>Disconnect</button>':'')+'<button class="pri" data-save>Save and test</button>';
  const msg=panel.querySelector('[data-msg]');
  panel.querySelector('[data-back]').onclick=()=>{ delete panel.dataset.view; render(false); };
  const off=panel.querySelector('[data-off]'); if(off) off.onclick=()=>{ try{ localStorage.removeItem(GH_KEY); }catch(e){} delete panel.dataset.view; render(false); };
  panel.querySelector('[data-save]').onclick=async()=>{
    const repo=panel.querySelector('[data-repo]').value.trim().replace(/^https:\/\/github\.com\//,'').replace(/\/$/,''), token=panel.querySelector('[data-tok]').value.trim()||cfg.token;
    if(!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token){ msg.textContent='Enter the repository (owner/repo) and a token.'; return; }
    msg.textContent='Checking…';
    try{ await ghApi('/issues?per_page=1',{},{repo,token}); }catch(e){ msg.textContent=e.message; return; }
    try{ localStorage.setItem(GH_KEY,JSON.stringify({repo,token})); }catch(e){ msg.textContent='This browser blocked saving it.'; return; }
    delete panel.dataset.view; render(false); flash('GitHub connected. Use “Send to GitHub”.');
  };
}

/* ---------- panel ---------- */
const KINDS=['Fix','Change','Idea'];
function closePanel(){ if(panel){ panel.remove(); panel=null; } }
function openPanel(withDraft){
  closePanel();
  panel=document.createElement('div'); panel.className='fbk-ui fbk-panel'; panel.setAttribute('role','dialog'); panel.setAttribute('aria-label','Feedback');
  panel.addEventListener('keydown',e=>{ if(e.key==='Escape'){ e.preventDefault(); closePanel(); } });
  document.body.appendChild(panel); render(withDraft); refreshResolved();
}
function render(withDraft){
  if(!panel) return;
  if(panel) delete panel.dataset.view;
  const open=items.filter(x=>!x.sent), sent=items.filter(x=>x.sent && !x.resolved), done=items.filter(x=>x.resolved), linked=!!gh();
  const draft=withDraft && lastPicked;
  panel.innerHTML=
    '<div class="fbk-head"><b>Feedback</b><span class="fbk-count">'+open.length+' open</span><button class="fbk-gh" data-gh title="'+(linked?'GitHub connected: '+esc(gh().repo):'Connect GitHub to send feedback as issues')+'">'+(linked?'GitHub ✓':'GitHub')+'</button><button class="fbk-x" data-close title="Close (Esc)" aria-label="Close">×</button></div>'
   +'<div class="fbk-body">'
   +(draft
      ? '<div class="fbk-draft"><div class="fbk-crumb">'+esc(lastPicked.crumb)+'</div>'
        +(lastPicked.quote?'<div class="fbk-quote">“'+esc(clip(lastPicked.quote,160))+'”</div>':'')
        +'<div class="fbk-kinds">'+KINDS.map((k,i)=>'<button data-kind="'+k+'" aria-pressed="'+(i===0)+'">'+k+'</button>').join('')+'</div>'
        +'<textarea data-note rows="3" placeholder="What should change here?"></textarea>'
        +'<div class="fbk-row"><button data-cancel>Cancel</button><button class="pri" data-add>Add note <kbd>⌘↵</kbd></button></div></div>'
      : '<div class="fbk-row fbk-start"><button class="pri" data-pick>◎ Point at something</button><button data-sel title="Select text in the document first">“ Selected text</button><button data-general>+ General note</button></div>')
   +(open.length?'<ol class="fbk-list">'+open.map(it=>'<li data-id="'+it.id+'"><div class="fbk-crumb">'+esc(it.crumb||'General')+'</div>'
        +(it.quote?'<div class="fbk-quote">“'+esc(clip(it.quote,120))+'”</div>':'')
        +'<div class="fbk-line"><span class="fbk-kind">'+esc(it.kind)+'</span><span class="fbk-note" contenteditable="true" data-edit spellcheck="true">'+esc(it.note)+'</span><button class="fbk-del" data-del title="Delete" aria-label="Delete">×</button></div></li>').join('')+'</ol>'
      : (draft?'':'<p class="fbk-empty">No notes yet. Point at a button, panel or paragraph and say what should change. Collect as many as you like, then copy them all as one prompt.</p>'))
   +'</div>'
   +'<div class="fbk-foot">'+(linked
       ? '<button class="pri" data-gh-send '+(open.length?'':'disabled')+' title="File these notes as one GitHub issue">Send to GitHub ('+open.length+')</button><button data-copy '+(open.length?'':'disabled')+'>Copy all</button>'
       : '<button class="pri" data-copy '+(open.length?'':'disabled')+'>Copy all ('+open.length+')</button><button data-sent '+(open.length?'':'disabled')+' title="Move these to Sent so the next batch starts empty">Mark sent</button>')
   +((sent.length||done.length)?'<button data-showsent>'+(sent.length?'Sent ('+sent.length+')':'')+(sent.length&&done.length?' · ':'')+(done.length?'Resolved ('+done.length+')':'')+'</button>':'')+'</div>';
  panel.querySelector('[data-close]').onclick=closePanel;
  const q=s=>panel.querySelector(s);
  if(draft){
    let kind='Fix';
    panel.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{ kind=b.dataset.kind; panel.querySelectorAll('[data-kind]').forEach(x=>x.setAttribute('aria-pressed',String(x===b))); });
    const ta=q('[data-note]'); setTimeout(()=>ta.focus(),0);
    const add=()=>{ const note=ta.value.trim(); if(!note){ ta.focus(); return; } items.push(Object.assign({id:Date.now().toString(36),kind,note,at:Date.now()},lastPicked)); lastPicked=null; persist(); render(false); };
    q('[data-add]').onclick=add; q('[data-cancel]').onclick=()=>{ lastPicked=null; render(false); };
    ta.addEventListener('keydown',e=>{ if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){ e.preventDefault(); add(); } e.stopPropagation(); });
  } else {
    q('[data-pick]').onclick=startPick;
    q('[data-sel]').onclick=()=>{ const c=pendingSel||selectionCapture(); pendingSel=null; if(!c){ flash('Select some text in the document first, then press this.'); return; } lastPicked=c; render(true); };
    q('[data-general]').onclick=()=>{ lastPicked={crumb:mode()+' › General',selector:'',html:'',quote:'',screen:innerWidth+'×'+innerHeight}; render(true); };
  }
  panel.querySelectorAll('[data-edit]').forEach(n=>{
    n.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); n.blur(); } });
    n.addEventListener('blur',()=>{ const it=items.find(x=>x.id===n.closest('li').dataset.id); if(it){ it.note=n.textContent.trim(); persist(); } });
  });
  panel.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ const id=b.closest('li').dataset.id; items=items.filter(x=>x.id!==id); persist(); render(false); });
  const cp=q('[data-copy]'); if(cp) cp.onclick=async()=>{ const ok=await copy(promptText(open)); flash(ok?'Copied '+open.length+' note'+(open.length===1?'':'s')+' as one prompt.':'Couldn’t copy. Try again.'); };
  const ms=q('[data-sent]'); if(ms) ms.onclick=()=>{ const t=Date.now(); open.forEach(x=>{ x.sent=t; }); persist(); render(false); flash('Moved to Sent.'); };
  const ss=q('[data-showsent]'); if(ss) ss.onclick=()=>showSent();
  q('[data-gh]').onclick=connectGitHub;
  const gs=q('[data-gh-send]'); if(gs) gs.onclick=async()=>{ gs.disabled=true; gs.textContent='Sending…';
    try{ const i=await sendToGitHub(open); render(false); flash('Sent as issue #'+i.number+'.'); }catch(e){ flash(e.message); render(false); } };
}
function showSent(){
  panel.dataset.view='sent';
  const sent=items.filter(x=>x.sent && !x.resolved).sort((a,b)=>b.sent-a.sent), done=items.filter(x=>x.resolved).sort((a,b)=>b.resolved-a.resolved);
  const li=(it,act)=>'<li data-id="'+it.id+'"><div class="fbk-crumb">'+esc(it.crumb||'General')+'</div><div class="fbk-line"><span class="fbk-kind">'+esc(it.kind)+'</span><span class="fbk-note">'+esc(it.note)+'</span>'+act+'</div></li>';
  const tag=it=>it.issue?'<a href="'+esc(it.url)+'" target="_blank" rel="noopener">#'+it.issue+'</a>':'copied';
  const groups=list=>{ const by=new Map(); list.forEach(it=>{ const k=it.issue?'#'+it.issue:new Date(it.sent).toLocaleDateString(); if(!by.has(k)) by.set(k,[]); by.get(k).push(it); }); return by; };
  let html='';
  if(sent.length){ html+='<h4 class="fbk-h">Sent, waiting for a fix</h4>'; groups(sent).forEach(list=>{ html+='<div class="fbk-grp">'+tag(list[0])+' · '+new Date(list[0].sent).toLocaleDateString()+'</div><ol class="fbk-list">'+list.map(it=>li(it,(it.issue?'':'<button class="fbk-del" data-res title="Mark resolved">✓</button>')+'<button class="fbk-del" data-reopen title="Reopen">↺</button>')).join('')+'</ol>'; }); }
  if(done.length){ html+='<h4 class="fbk-h">Resolved</h4><ol class="fbk-list fbk-done">'+done.map(it=>li(it,'<span class="fbk-when">'+(it.issue?tag(it)+' · ':'')+new Date(it.resolved).toLocaleDateString()+'</span>')).join('')+'</ol>'; }
  if(!html) html='<p class="fbk-empty">Nothing sent yet.</p>';
  panel.querySelector('.fbk-body').innerHTML=html;
  panel.querySelector('.fbk-foot').innerHTML='<button data-back>Back</button>'+(sent.length?'<button data-copysent>Copy waiting</button>':'')+(done.length?'<button data-clear>Clear resolved</button>':'');
  panel.querySelectorAll('[data-reopen]').forEach(b=>b.onclick=()=>{ const it=items.find(x=>x.id===b.closest('li').dataset.id); if(it){ delete it.sent; delete it.issue; delete it.url; persist(); showSent(); } });
  panel.querySelectorAll('[data-res]').forEach(b=>b.onclick=()=>{ const it=items.find(x=>x.id===b.closest('li').dataset.id); if(it){ it.resolved=Date.now(); persist(); showSent(); } });
  panel.querySelector('[data-back]').onclick=()=>render(false);
  const cs=panel.querySelector('[data-copysent]'); if(cs) cs.onclick=async()=>{ const ok=await copy(promptText(sent)); flash(ok?'Copied.':'Couldn’t copy.'); };
  const cl=panel.querySelector('[data-clear]'); if(cl) cl.onclick=()=>{ if(!confirm('Delete all resolved notes?')) return; items=items.filter(x=>!x.resolved); persist(); showSent(); };
}
function flash(msg){ const t=document.createElement('div'); t.className='fbk-ui fbk-toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2600); }

/* ---------- button, keys, styles ---------- */
let btn, pendingSel=null;
function badge(){ if(!btn) return; const n=items.filter(x=>!x.sent).length; const b=btn.querySelector('.fbk-badge'); b.textContent=n; b.hidden=!n; }
function init(){
  const css=document.createElement('style');
  css.textContent=`
  .fbk-btn{position:fixed;z-index:46;left:92px;bottom:calc(16px + env(safe-area-inset-bottom,0px));height:32px;padding:0 12px 0 10px;border-radius:16px;border:1px solid #c7c7c7;background:#fff;color:#444746;font:500 13px/1 Roboto,system-ui,-apple-system,sans-serif;display:flex;align-items:center;gap:6px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.12)}
  .fbk-btn:hover{background:#f1f3f4}.fbk-btn .ms{font-size:18px}
  .fbk-badge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#0b57d0;color:#fff;font-size:11px;display:grid;place-items:center}
  body.reading .fbk-btn,body.full-doc .fbk-btn,body.zoom-mode .fbk-btn{opacity:.35}
  body.reading .fbk-btn:hover,body.full-doc .fbk-btn:hover,body.zoom-mode .fbk-btn:hover{opacity:1}
  .lr-dock .fbk-btn,body.reading .lr-dock .fbk-btn{opacity:1}
  .fbk-panel{position:fixed;z-index:2147483000;left:16px;bottom:calc(56px + env(safe-area-inset-bottom,0px));width:min(380px,calc(100vw - 32px));max-height:min(70vh,620px);display:flex;flex-direction:column;background:#fff;border:1px solid #dadce0;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.2);font:14px/1.45 Roboto,system-ui,-apple-system,sans-serif;color:#1f1f1f}
  .fbk-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #eee}
  .fbk-count{color:#5f6368;font-size:12px}.fbk-x{margin-left:auto;border:0;background:none;font-size:22px;line-height:1;cursor:pointer;color:#5f6368}
  .fbk-body{overflow:auto;padding:10px 14px;flex:1}
  .fbk-foot{display:flex;gap:6px;padding:10px 14px;border-top:1px solid #eee;flex-wrap:wrap}
  .fbk-panel :where(button:not(.fbk-x):not(.fbk-del)){padding:7px 12px;border-radius:8px;border:1px solid #dadce0;background:#fff;font:inherit;font-size:13px;cursor:pointer}
  .fbk-panel :where(button:not(.fbk-x):not(.fbk-del):not(.pri)):hover{background:#f1f3f4}
  .fbk-panel button.pri{background:#0b57d0;border-color:#0b57d0;color:#fff}.fbk-panel button.pri:hover{background:#0842a0}
  .fbk-panel button:disabled{opacity:.45;cursor:default}
  .fbk-panel kbd{font:11px system-ui;opacity:.75;margin-left:4px}
  .fbk-row{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-top:8px}.fbk-start{justify-content:flex-start;margin:2px 0 10px}
  .fbk-draft{background:#f8fafd;border:1px solid #d3e3fd;border-radius:10px;padding:10px;margin-bottom:10px}
  .fbk-draft textarea{width:100%;box-sizing:border-box;margin-top:8px;border:1px solid #c7c7c7;border-radius:8px;padding:8px;font:inherit;resize:vertical}
  .fbk-kinds{display:flex;gap:4px;margin-top:8px}.fbk-kinds button{padding:4px 10px!important;border-radius:14px!important}
  .fbk-kinds button[aria-pressed="true"]{background:#d3e3fd!important;border-color:#a8c7fa!important}
  .fbk-crumb{font-size:12px;color:#0b57d0;line-height:1.35;word-break:break-word}
  .fbk-quote{font-size:12px;color:#5f6368;font-style:italic;margin-top:3px}
  .fbk-list{margin:0;padding:0 0 0 20px}.fbk-list li{padding:8px 0;border-bottom:1px solid #f1f3f4}
  .fbk-line{display:flex;gap:6px;align-items:flex-start;margin-top:3px}
  .fbk-kind{font-size:11px;font-weight:500;background:#f1f3f4;border-radius:4px;padding:1px 6px;margin-top:2px;flex:none}
  .fbk-note{flex:1;outline:none;border-radius:4px;padding:0 2px}.fbk-note[contenteditable="true"]:focus{background:#f8fafd;box-shadow:0 0 0 1px #a8c7fa}
  .fbk-del{border:0;background:none;color:#80868b;cursor:pointer;font-size:16px;line-height:1;padding:2px 4px}.fbk-del:hover{color:#b3261e}
  .fbk-empty{color:#5f6368;font-size:13px;margin:4px 0 8px}.fbk-empty a,.fbk-grp a,.fbk-when a{color:#0b57d0}
  .fbk-gh{margin-left:auto;border:1px solid #dadce0;background:#fff;border-radius:12px;padding:2px 9px;font:500 12px Roboto,system-ui,sans-serif;color:#444746;cursor:pointer}.fbk-gh+.fbk-x{margin-left:6px}
  .fbk-h{margin:10px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#5f6368}.fbk-grp{font-size:12px;color:#5f6368;margin:8px 0 0}
  .fbk-done .fbk-note{color:#5f6368}.fbk-when{font-size:11px;color:#80868b;white-space:nowrap}
  .fbk-lbl{display:block;font-size:12px;color:#444746;margin:8px 0}.fbk-lbl input{display:block;width:100%;box-sizing:border-box;margin-top:4px;height:34px;border:1px solid #c7c7c7;border-radius:8px;padding:0 10px;font:inherit}
  .fbk-hover{position:fixed;z-index:2147483001;pointer-events:none;border:2px solid #0b57d0;background:rgba(11,87,208,.08);border-radius:6px;display:none}
  .fbk-tip{position:fixed;z-index:2147483002;top:12px;left:50%;transform:translateX(-50%);background:#1f1f1f;color:#fff;padding:8px 14px;border-radius:10px;font:13px/1.4 Roboto,system-ui,sans-serif;pointer-events:none;max-width:90vw}
  .fbk-layer{position:fixed;inset:0;z-index:2147483000;cursor:crosshair;outline:none;background:transparent}
  .fbk-toast{position:fixed;z-index:2147483003;left:50%;bottom:24px;transform:translateX(-50%);background:#1f1f1f;color:#fff;padding:9px 16px;border-radius:10px;font:13px Roboto,system-ui,sans-serif}`;
  document.head.appendChild(css);
  btn=document.createElement('button'); btn.type='button'; btn.className='fbk-ui fbk-btn'; btn.title='Feedback: collect fixes and copy them as one prompt (Ctrl+Alt+F to point at something)';
  btn.innerHTML='<span class="ms">rate_review</span><span>Feedback</span><span class="fbk-badge" hidden>0</span>';
  /* Grab any text selection before the click clears it, so "Selected text" can use it. */
  btn.addEventListener('pointerdown',()=>{ pendingSel=selectionCapture(); });
  btn.onclick=()=>{ if(panel) closePanel(); else openPanel(false); };
  (document.querySelector('.lr-dock')||document.body).appendChild(btn); badge();
  addEventListener('keydown',e=>{
    if(e.ctrlKey && e.altKey && e.code==='KeyF'){ e.preventDefault(); e.stopImmediatePropagation(); picking?null:startPick(); return; }
    if(e.key==='Escape' && panel && !picking){ closePanel(); }
  },true);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
