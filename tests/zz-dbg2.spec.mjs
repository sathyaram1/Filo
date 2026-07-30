import { test, expect } from './fixtures/electron.mjs';
const NEWTAB = 'filo://newtab/';
const mk=(t,c)=>`<!doctype html><html><head><title>${t}</title><meta name="theme-color" content="${c}"></head><body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;
async function submit(page, cmd){ await page.evaluate((c)=>{const i=document.getElementById('input');const f=document.getElementById('inputForm');i.value=c;f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));},cmd);}
test('dbg2', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, mk('Blu','rgb(40,80,200)'));
  await testServer.openReady(openTab, mk('Verde','rgb(40,200,80)'));
  await testServer.openReady(openTab, mk('Rosso','rgb(200,40,40)'));
  const dash = await openTab(NEWTAB);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 8000 });
  await expect.poll(async()=>shell.evaluate(async()=>{const s=await window.filoShell.tabs.snapshot();const w=s.tabs.filter(t=>/127\.0\.0\.1/.test(t.url||''));const ti=w.map(t=>t.title).sort();return w.length===3&&w.every(t=>!!t.identityColor)&&JSON.stringify(ti)===JSON.stringify(['Blu','Rosso','Verde']);}),{timeout:12000}).toBe(true);
  const r = await dash.evaluate(()=>({ hasMsg: !!(window.SN_MSG && window.SN_MSG.MSG && window.SN_MSG.MSG.REORDER_TABS) }));
  console.log('DASH MSG', JSON.stringify(r));
  await submit(dash, '/riordina');
  await new Promise(res=>setTimeout(res,2500));
  const after = await shell.evaluate(async()=>{const s=await window.filoShell.tabs.snapshot();return s.tabs.filter(t=>/127\.0\.0\.1/.test(t.url||'')).map(t=>t.title);});
  console.log('AFTER', JSON.stringify(after));
});
