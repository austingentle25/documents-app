/* Walkthrough for new users, in three short parts: Home, a document, and reading mode. Each step spotlights one control
   and says what it's for. It plays by itself only for a brand-new account (an empty library the first time the app
   opens), each part once, and Skip turns it off for good. That's remembered in the account, so another device doesn't
   replay it. Otherwise it plays only from "Take the tour" in the account menu, for wherever you are. */
(function(){
'use strict';
const KEY='documents-app:tour';
let state=null, ref=null; /* {auto, off, home, doc, read}: synced in the account at data/users/<id>/tour */
const local=()=>{ try{ return JSON.parse(localStorage.getItem(KEY)||'null'); }catch(e){ return null; } };
function save(){ try{ localStorage.setItem(KEY,JSON.stringify(state)); }catch(e){} if(ref) ref.set(state).catch(()=>{}); }
async function loadState(){
  try{ const u=await window.claude.use('user'); const id=await u.id(); ref=window.documentsLocal.db.doc('data/users/'+id+'/tour'); const s=await ref.get(); if(s.exists) state=s.data(); }catch(e){}
  if(!state) state=local();
  if(!state){ /* first time here: plays by itself only if the library is empty, i.e. a new user */
    let n=1; try{ n=(await window.documentsLocal.db.collection('docs').get()).size; }catch(e){}
    state={auto:n===0, decided:Date.now()}; save();
  }
}
const done=()=>state||{};
const mark=(part,v)=>{ if(!state) state={}; if(v) state[part]=Date.now(); else delete state[part]; save(); };
const isMac=/Mac|iP/.test(navigator.platform);

const PARTS={
  home:{ when:()=>document.body.classList.contains('at-home'), steps:[
    {title:'Welcome to Documents', text:'A place to read, write and study. Sign in and your library follows you to every device. This quick tour takes about a minute. You can replay it any time from the account button at the bottom left.'},
    {el:'.home-acts [data-new]', title:'Write something', text:'Start a new document. It saves as you type.'},
    {el:'.home-acts [data-imp]', title:'Bring in your reading', text:'Import PDFs, several at once or a whole folder (its subfolders come along). You can also drop PDFs anywhere on this page.'},
    {el:'.home-seg', title:'Three ways to browse', text:'Folders shows each folder with its documents. Recent shows what you worked on last. List is a table you can sort by name, folder or date.'},
    {el:'.home-find', title:'Find anything', text:'Search titles, text and folder names. Press Enter to open the first match.'},
    {el:'.hf .hf-more-btn', title:'Organize', text:'Each folder’s ⋯ menu adds a document or subfolder, renames, or deletes. A document’s ⋯ moves it to another folder.'},
    {el:'.lr-btn', title:'Your account', text:'Shows whether everything is synced. From here: back up, restore, sign out, or Connect Claude to turn on the grammar check, definitions, summaries and replies to comments.'},
    {el:'.fbk-btn', title:'Tell us what to change', text:'Point at any part of the app and say what should be different. Notes collect here until you send them.'},
    {title:'That’s Home', text:'Open any document and the tour continues with writing and reading.'}]},
  doc:{ when:()=>!document.body.classList.contains('at-home') && !document.body.classList.contains('reading') && !document.querySelector('.home'), steps:[
    {el:'#docTitle', title:'Name it', text:'Click the title to rename the document. Changes save on their own.'},
    {el:'#wordCount', title:'Word count', text:'Counts the words in this tab as you write. Select some text to count just that part.'},
    {el:'.toolbar', title:'Format', text:'Headings, fonts, bold and italics, highlights, lists and links, like any word processor.'},
    {el:'#tabstrip', title:'Tabs', text:'Split long work into tabs. The + adds a blank tab, imports a PDF into this document, or adds a web article.'},
    {el:'#commentBtn', title:'Comments', text:'Select text and comment on it (or press '+(isMac?'⌘⌥M':'Ctrl+Alt+M')+'). With Claude connected, tick “Send to Claude” and the answer appears in the thread.'},
    {el:'#readBtn', title:'Reading mode', text:'A calm page for reading: one sentence highlighted at a time, notes after each paragraph, and Listen to hear it read aloud.'},
    {el:'#sideToggle', title:'Back to Home', text:'Returns to all your documents.'}]},
  read:{ when:()=>document.body.classList.contains('reading') && !document.querySelector('.spd:not([hidden])'), steps:[
    {el:'#rdModeSeg', title:'Two ways to read', text:'Academic gives you a notes box after each paragraph and reads one sentence per →. Light reads straight through with one summary at the end.'},
    {el:'#readBar', title:'Reading controls', text:'← and → move a sentence at a time. Aa changes text size and night mode. ⋯ has more.'},
    {el:'#rbListen', title:'Listen', text:'Reads aloud with each word highlighted. The voice runs on your device; the first time, it downloads (about 110 MB), then it’s instant.'},
    {el:'#rdSpdTop', title:'Guided reading', text:'A speed reader that starts at 400 words a minute and gently speeds up. Press S any time.'},
    {el:'#qnFab', title:'Quick note', text:'Jot a thought without leaving the page. Notes collect in your Quick Notes document.'},
    {el:'#readProg', title:'Your progress', text:'How far through you are, and a reading timer. The app remembers where you left off.'},
    {title:'You’re set', text:'Happy reading. Replay this tour any time from the account button.'}]}
};

let active=null;
function visible(sel){ if(!sel) return null; const el=document.querySelector(sel); if(!el) return null; const r=el.getBoundingClientRect(); return (r.width && r.height && getComputedStyle(el).visibility!=='hidden') ? el : null; }
function stop(part,skipped){ if(!active) return; active.ui.remove(); removeEventListener('resize',active.place); removeEventListener('scroll',active.place,true); removeEventListener('keydown',active.key,true); active=null; if(part){ if(skipped && state) state.off=Date.now(); mark(part,true); } }
function start(part){
  if(active) stop(null);
  const P=PARTS[part]; if(!P) return;
  const steps=P.steps.filter(s=>!s.el || visible(s.el)); if(!steps.length) return;
  const ui=document.createElement('div'); ui.className='lr-ui tour';
  ui.innerHTML='<div class="tour-block"></div><div class="tour-spot"></div><div class="tour-card" role="dialog" aria-live="polite"><div class="tour-t"></div><div class="tour-x"></div><div class="tour-foot"><span class="tour-n"></span><button data-skip>Skip</button><button data-back>Back</button><button class="pri" data-next>Next</button></div></div>';
  document.body.appendChild(ui);
  const spot=ui.querySelector('.tour-spot'), card=ui.querySelector('.tour-card');
  let i=0;
  const place=()=>{
    const s=steps[i], el=visible(s.el);
    if(el){ el.scrollIntoView({block:'nearest',inline:'nearest'}); const r=el.getBoundingClientRect(), pad=6;
      Object.assign(spot.style,{display:'block',left:r.left-pad+'px',top:r.top-pad+'px',width:r.width+pad*2+'px',height:r.height+pad*2+'px'});
      const cw=card.offsetWidth, ch=card.offsetHeight, vw=innerWidth, vh=innerHeight;
      let top=r.bottom+14; if(top+ch>vh-12) top=r.top-ch-14; if(top<12) top=Math.max(12,Math.min(vh-ch-12,r.top+r.height/2-ch/2));
      let left=Math.min(Math.max(12,r.left+r.width/2-cw/2),vw-cw-12);
      if(top<r.bottom && top+ch>r.top){ left = r.right+14+cw<vw ? r.right+14 : Math.max(12,r.left-cw-14); }
      Object.assign(card.style,{left:left+'px',top:top+'px',transform:'none'});
    } else { spot.style.display='none'; Object.assign(card.style,{left:'50%',top:'50%',transform:'translate(-50%,-50%)'}); }
  };
  const show=()=>{
    const s=steps[i];
    card.querySelector('.tour-t').textContent=s.title; card.querySelector('.tour-x').textContent=s.text;
    card.querySelector('.tour-n').textContent=(i+1)+' of '+steps.length;
    card.querySelector('[data-back]').hidden=i===0;
    card.querySelector('[data-next]').textContent=i===steps.length-1?'Done':'Next';
    ui.classList.toggle('dim',!visible(s.el));
    place(); card.querySelector('[data-next]').focus();
  };
  const next=()=>{ if(i<steps.length-1){ i++; show(); } else stop(part,false); };
  const back=()=>{ if(i>0){ i--; show(); } };
  const key=e=>{ if(e.key==='Escape'){ e.preventDefault(); e.stopImmediatePropagation(); stop(part,true); } else if(e.key==='ArrowRight'||e.key==='Enter'){ e.preventDefault(); e.stopImmediatePropagation(); next(); } else if(e.key==='ArrowLeft'){ e.preventDefault(); e.stopImmediatePropagation(); back(); } };
  card.querySelector('[data-next]').onclick=next; card.querySelector('[data-back]').onclick=back; card.querySelector('[data-skip]').onclick=()=>stop(part,true);
  active={ui,place,key,part};
  addEventListener('resize',place); addEventListener('scroll',place,true); addEventListener('keydown',key,true);
  show();
}
/* Start a part the first time its place is reached, once nothing else (sign-in, a dialog) is in the way. */
function current(){ return ['read','home','doc'].find(p=>PARTS[p].when()); }
let loading=null;
setInterval(()=>{
  if(active || document.querySelector('.lr-gate,.lr-cc,.fbk-panel,.learn,.pop,.menu') || !document.querySelector('.lr-btn')) return;
  if(!state){ if(!loading && document.querySelector('.home,#doc,.page')) loading=loadState(); return; }
  if(!state.auto || state.off) return;
  const p=current(); if(!p || done()[p]) return;
  clearTimeout(window.__tourT); window.__tourT=setTimeout(()=>{ if(!active && current()===p && !done()[p]) start(p); },900);
},1500);

const css=document.createElement('style');
css.textContent=`
.tour{position:fixed;inset:0;z-index:2147483400;font:14px/1.5 Roboto,system-ui,-apple-system,sans-serif}
.tour-block{position:absolute;inset:0;background:transparent}.tour.dim .tour-block{background:rgba(32,33,36,.45)}
.tour-spot{position:fixed;border-radius:10px;box-shadow:0 0 0 9999px rgba(32,33,36,.45),0 0 0 2px #fff,0 0 0 5px #0b57d0;pointer-events:none;transition:all .2s ease}
.tour-card{position:fixed;width:min(320px,calc(100vw - 24px));background:#fff;color:#1f1f1f;border-radius:14px;padding:16px 16px 12px;box-shadow:0 8px 28px rgba(0,0,0,.28);transition:left .2s ease,top .2s ease}
.tour-t{font-weight:600;font-size:15px;margin-bottom:4px}.tour-x{color:#444746}
.tour-foot{display:flex;align-items:center;gap:6px;margin-top:14px}.tour-n{font-size:12px;color:#80868b;margin-right:auto}
.tour-foot button{height:32px;padding:0 14px;border-radius:16px;border:1px solid #dadce0;background:#fff;font:500 13px Roboto,system-ui,sans-serif;cursor:pointer;color:#0b57d0}
.tour-foot button.pri{background:#0b57d0;border-color:#0b57d0;color:#fff}.tour-foot [data-skip]{border:0;color:#5f6368;padding:0 8px}
@media (prefers-reduced-motion:reduce){.tour-spot,.tour-card{transition:none}}`;
document.head.appendChild(css);

window.documentsTour={ start:()=>{ start(current()||'home'); } };
})();
