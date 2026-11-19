import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

test('sonda', async ({ app, shell }) => {
  const dir = mkdtempSync(join(cartellaTemporanea(), 'sonda-'));
  writeFileSync(join(dir, 'segreto.txt'), 'SEGRETO');
  copyFileSync('tests/fixtures/provenienza/c2pa-ufficiale-ai.png', join(dir, 'foto.png'));
  writeFileSync(join(dir, 'stile.css'), 'p{color:rgb(1, 2, 3)}');
  writeFileSync(join(dir, 'p.html'), '<title>P</title><link rel="stylesheet" href="stile.css"><p id="p">x</p><iframe id="f" src="segreto.txt"></iframe><img id="i" src="foto.png"><script>document.title="JS"</script>');
  const u = pathToFileURL(join(dir, 'p.html')).href;
  const s = pathToFileURL(join(dir, 'segreto.txt')).href;
  await shell.waitForFunction(() => !!window.filoShell);
  const r = await app.evaluate(async ({ BrowserWindow, net }, [u, s]) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = tm.tabs[0].view.webContents;
    const viste = [];
    wc.session.protocol.handle('file', async (req) => {
      if (req.url.includes('sonda-')) viste.push(req.url.split('/').pop() + ' ' + (req.headers.get('sec-fetch-dest') || ''));
      const r = await net.fetch(req, { bypassCustomProtocolHandlers: true });
      const h = new Headers(r.headers);
      h.set('Content-Security-Policy', "sandbox allow-scripts allow-forms allow-popups allow-modals");
      return new Response(r.body, { status: r.status, headers: h });
    });
    await wc.loadURL(u).catch((e) => String(e));
    await new Promise((ok) => setTimeout(ok, 800));
    const f = await wc.executeJavaScript(`fetch(${JSON.stringify(s)}).then(r=>r.text()).catch(e=>'ERR '+e)`);
    const x = await wc.executeJavaScript(`new Promise((ok)=>{const q=new XMLHttpRequest();q.open('GET',${JSON.stringify(s)});q.onload=()=>ok('XHR '+q.responseText);q.onerror=()=>ok('XHRERR');q.send();})`);
    const fr = await wc.executeJavaScript(`(()=>{try{return 'IFR '+document.getElementById('f').contentDocument.body.textContent}catch(e){return 'IFRERR '+e.name}})()`);
    const orig = await wc.executeJavaScript('String(location.origin)+" "+document.title+" img="+document.getElementById("i").naturalWidth+" css="+getComputedStyle(document.getElementById("p")).color+" canvas="+(()=>{try{const c=document.createElement("canvas");c.width=2;c.height=2;const g=c.getContext("2d");g.drawImage(document.getElementById("i"),0,0);g.getImageData(0,0,1,1);return "LETTO"}catch(e){return e.name}})()');
    return { url: wc.getURL(), f, x, fr, orig, viste };
  }, [u, s]);
  console.log(JSON.stringify(r));
});
