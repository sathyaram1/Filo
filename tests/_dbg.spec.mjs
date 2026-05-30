import { test, expect } from './fixtures/electron.mjs';
async function newtabPage(app){const d=Date.now()+10000;let w=null;while(Date.now()<d){w=app.windows().find(x=>x.url().startsWith('filo://newtab'));if(w)break;await new Promise(r=>setTimeout(r,100));}await w.waitForLoadState('domcontentloaded');return w;}
test('dbg', async ({ app }) => {
  const page = await newtabPage(app);
  page.on('console', m=>console.log('PAGE>', m.text()));
  page.on('pageerror', e=>console.log('PAGEERR>', e.message));
  await page.waitForFunction(()=>document.documentElement.dataset.filoContentScripts==='1'&&typeof globalThis.SN_SPELLCHECK?.getInputWordAt==='function',null,{timeout:8000});
  const info = await page.evaluate(()=>{
    const input=document.getElementById('input');
    input.value='ciiao come stai'; input.focus();
    const r=input.getBoundingClientRect(); const cs=getComputedStyle(input);
    const x=r.left+parseFloat(cs.paddingLeft||0)+parseFloat(cs.borderLeftWidth||0)+8;
    const y=r.top+r.height/2;
    // expose settings + SpellCheck presence from content world is not directly reachable; log via a probe
    return {x,y, sc: typeof window.SN_SPELLCHECK, isTextProbe: (()=>{ const el=input; const t=(el.getAttribute('type')||'text').toLowerCase(); return {t, sc: el.getAttribute('spellcheck'), ro: el.readOnly, dis: el.disabled};})() };
  });
  console.log('INFO', JSON.stringify(info));
  await page.evaluate(({x,y})=>{
    const input=document.getElementById('input');
    const listeners=globalThis.chrome.runtime.onMessage._listeners;
    for(const fn of listeners){try{fn({type:'_spell:native',word:'ciiao',suggestions:['ciao','chiao']});}catch(_){}}
    // native check
    window.__nat = globalThis.SN_SPELLCHECK.getNativeSuggestions('ciiao');
    input.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:2}));
  },info);
  await page.waitForTimeout(1500);
  const dump = await page.evaluate(()=>{
    const m=document.querySelector('.sn-menu');
    const kids = m? Array.from(m.children).map(c=>c.className): [];
    return {hasMenu:!!m, kids, nat: window.__nat };
  });
  console.log('DUMP', JSON.stringify(dump));
});
