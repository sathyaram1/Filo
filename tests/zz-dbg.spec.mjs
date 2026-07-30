import { test, expect } from './fixtures/electron.mjs';
const NEWTAB = 'filo://newtab/';
const mk = (t,c)=>`<!doctype html><html><head><title>${t}</title><meta name="theme-color" content="${c}"></head><body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;
test('dbg', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, mk('Blu','rgb(40,80,200)'));
  await testServer.openReady(openTab, mk('Verde','rgb(40,200,80)'));
  await testServer.openReady(openTab, mk('Rosso','rgb(200,40,40)'));
  const dash = await openTab(NEWTAB);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 8000 });
  await new Promise(r=>setTimeout(r,3000));
  const snap = await shell.evaluate(async ()=>{ const s= await window.filoShell.tabs.snapshot(); return s.tabs.map(t=>({title:t.title,url:t.url,ic:t.identityColor})); });
  console.log('SNAP', JSON.stringify(snap,null,1));
});
