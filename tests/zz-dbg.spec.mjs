import { test } from '/home/user/Filo/tests/fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('errori', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'dbg-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: [{type:'text',text:'ciao',ts:1}] }), 'utf8');
  const app = await electron.launch({ args: ['.'], cwd: '/home/user/Filo', env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'filo://security/security.html');
  let page = null;
  for (let i=0;i<100 && !page;i++){ page = app.windows().find((p)=>{try{return new URL(p.url()).hostname==='security'}catch(_){return false}}); await new Promise(r=>setTimeout(r,100)); }
  page.on('console', (m) => console.log('CONSOLE', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR', e.stack || e.message));
  await page.reload();
  await page.waitForTimeout(2000);
  console.log('righe', await page.locator('#sec-clip-list .sn-clip-item').count());
  await app.close(); rmSync(userData,{recursive:true,force:true});
});
