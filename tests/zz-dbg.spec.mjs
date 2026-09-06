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
  await page.waitForTimeout(1500);
  const out = await page.evaluate(() => {
    try {
      const e = { type: 'text', text: 'ciao' };
      const k = window.SN_CLIPBOARD.chiave(e);
      const l = window.SN_CLIPBOARD.etichetta(e);
      const c = window.SN_CLIPBOARD.testoConferma(3, 3);
      return { k, l, c };
    } catch (err) { return { errore: String(err && err.stack || err) }; }
  });
  console.log('OUT', JSON.stringify(out));
  await app.close(); rmSync(userData,{recursive:true,force:true});
});
