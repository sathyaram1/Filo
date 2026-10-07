// Esplorazione del giro 9 (#592.6): finestre del sito che non passano dall'apertura dei popup, e aspetto vero.
import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo, confirmState } from '../../helpers/confirm.mjs';
import { execFileSync } from 'node:child_process';

test.setTimeout(90_000);

const PAGINA = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
<h1>Video</h1>
<button id="b" style="font-size:30px">Guarda</button>
<video id="v" muted playsinline width="320" height="180"></video>
<canvas id="c" width="440" height="100"></canvas>
<script>
  window.__log = [];
  window.__haDoc = 'documentPictureInPicture' in window;
  const c = document.getElementById('c');
  const g = c.getContext('2d');
  setInterval(() => { g.fillStyle = '#fff'; g.fillRect(0, 0, 440, 100); g.fillStyle = '#000'; g.font = '18px sans-serif'; g.fillText('Filo vuole impostare: Tema -> Scuro', 10, 50); }, 50);
  const v = document.getElementById('v');
  v.srcObject = c.captureStream(20);
  v.play().catch((e) => __log.push('play ' + e.message));
  document.getElementById('b').addEventListener('click', async () => {
    if (window.__haDoc && location.hash === '#doc') {
      try {
        const w = await documentPictureInPicture.requestWindow({ width: 900, height: 700 });
        w.document.body.innerHTML = '<p style="font:20px sans-serif">Filo chiede conferma. Filo vuole impostare: Tema → Scuro.</p>';
        __log.push('doc ok ' + w.innerWidth + 'x' + w.innerHeight);
      } catch (e) { __log.push('doc ' + e.message); }
    }
    try { await v.requestPictureInPicture(); __log.push('pip ok'); } catch (e) { __log.push('pip ' + e.message); }
  });
</script></body></html>`;

test('picture in picture: esiste una finestra del sito sopra la domanda?', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  if (process.env.DOC) await page.evaluate(() => { location.hash = '#doc'; });
  const host = new URL(page.url()).hostname;
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const box = await page.locator('#b').boundingBox();
  await page.mouse.click(box.x + 10, box.y + 10);
  await new Promise((r) => setTimeout(r, 2500));
  console.log('LOG', JSON.stringify(await page.evaluate(() => ({ log: window.__log, doc: window.__haDoc, pipEl: !!document.pictureInPictureElement }))));
  const finestre = () => app.evaluate(({ BrowserWindow, webContents }) => ({
    win: BrowserWindow.getAllWindows().map((w) => ({ url: (() => { try { return w.webContents.getURL(); } catch (_) { return '?'; } })(), vis: w.isVisible(), b: w.getBounds(), top: w.isAlwaysOnTop() })),
    wc: webContents.getAllWebContents().map((w) => ({ t: w.getType(), url: w.getURL() })),
  }));
  console.log('PRIMA', JSON.stringify(await finestre()));
  await nelMondoDiFilo(app, host, `(() => { SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Invio agli sviluppatori: testo vero' }); return 1; })()`);
  await new Promise((r) => setTimeout(r, 1500));
  console.log('DIAG', JSON.stringify(await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs; const c = tm.conferme;
    let s = null; try { s = c.sotto(); } catch (_) {}
    return { coda: c.coda.length, codaUrl: c.coda.map((v) => v.wc.getURL()), sotto: s && s.getURL(), area: c.area(), vista: !!c.vista, pronta: c.pronta, mostrata: c.mostrata, active: tm.activeId, tabs: tm.tabs.map((t) => t.view.webContents.getURL()) };
  })));
  console.log('DURANTE', JSON.stringify(await finestre()));
  try { execFileSync('import', ['-window', 'root', 'tests/.shots/giro9-pip.png']); } catch (e) { console.log('import', e.message); }
});

test('aspetto vero, chiaro e scuro', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><body style="font:16px sans-serif;padding:30px"><h1>Negozio</h1><p>Testo della pagina sotto la domanda.</p><input id="i"></body>');
  const host = new URL(page.url()).hostname;
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  for (const tema of ['light', 'dark']) {
    await app.evaluate(async (_e, tema) => { await globalThis.SN_STORAGE.updateSettings({ theme: tema }); }, tema).catch((e) => console.log('tema', e.message));
    await nelMondoDiFilo(app, host, `(() => { globalThis.__e = 'attesa'; SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Filo vuole impostare: Tema → ${tema}. Questo cambia i colori di tutte le pagine.' }).then((ok) => { globalThis.__e = ok; }); return 1; })()`);
    const sopra = await confermaSopraPagina(app);
    await new Promise((r) => setTimeout(r, 800));
    console.log(tema, JSON.stringify(await confirmState(sopra)), await sopra.evaluate(() => document.documentElement.dataset.snTheme));
    try { execFileSync('import', ['-window', 'root', `tests/.shots/giro9-${tema}.png`]); } catch (e) { console.log('import', e.message); }
    await sopra.keyboard.press('Escape');
    await expect.poll(() => nelMondoDiFilo(app, host, 'globalThis.__e')).toBe(false);
  }
});
