import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

test('sonda', async ({ app, shell }) => {
  const dir = mkdtempSync(join(cartellaTemporanea(), 'sonda-'));
  writeFileSync(join(dir, 'segreto.txt'), 'SEGRETO');
  writeFileSync(join(dir, 'p.html'), '<title>P</title><p>x</p>');
  const u = pathToFileURL(join(dir, 'p.html')).href;
  const s = pathToFileURL(join(dir, 'segreto.txt')).href;
  await shell.waitForFunction(() => !!window.filoShell);
  const r = await app.evaluate(async ({ BrowserWindow }, [u, s]) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = tm.tabs[0].view.webContents;
    await wc.loadURL(u).catch((e) => String(e));
    const f = await wc.executeJavaScript(`fetch(${JSON.stringify(s)}).then(r=>r.text()).catch(e=>'ERR '+e)`);
    const x = await wc.executeJavaScript(`new Promise((ok)=>{const q=new XMLHttpRequest();q.open('GET',${JSON.stringify(s)});q.onload=()=>ok('XHR '+q.responseText);q.onerror=()=>ok('XHRERR');q.send();})`);
    return { url: wc.getURL(), f, x };
  }, [u, s]);
  console.log(JSON.stringify(r));
});
