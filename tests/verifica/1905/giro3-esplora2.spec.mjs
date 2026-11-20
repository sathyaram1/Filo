// Esplorazione 2 del giro 3 di #1905: aperture con le parole dell'utente, resa, ricarica, collegamenti, barra indirizzi.
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const execAction = (app, action, opts) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return Promise.all(tm.tabs.map(async (t) => {
    let url = '', title = '', testo = '';
    try { url = t.view.webContents.getURL(); title = t.view.webContents.getTitle(); } catch (_) {}
    try { testo = await t.view.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0,200) : ""'); } catch (e) { testo = 'ERR ' + e.message; }
    let img = null;
    try { img = await t.view.webContents.executeJavaScript('[...document.images].map(i=>i.naturalWidth)'); } catch (_) {}
    return { id: t.id, url, title, testo, img, tUrl: t.url, attiva: tm.activeId === t.id };
  }));
});
const pausa = (app, ms) => app.evaluate((_e, ms) => new Promise((r) => setTimeout(r, ms)), ms);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ app }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoPronta);
});

test('parole, resa, ricarica, link', async ({ app, shell }) => {
  const dir = cartellaInCasa('filo-1905 report');
  mkdirSync(join(dir, 'img'));
  writeFileSync(join(dir, 'img', 'a.png'), PNG);
  const html = join(dir, 'riquadro.html');
  writeFileSync(html, '<title>Riquadro</title><h1>Prima</h1><img src="img/a.png"><a id="l" href="altro.html">altro</a> <a id="w" href="http://127.0.0.1:9/x">web</a>');
  writeFileSync(join(dir, 'altro.html'), '<title>Altro</title><p>pagina sorella</p>');
  const parole = [`apri questo file ${html.replace(/\//g, '/')}`];

  let r = await execAction(app, { type: 'NAVIGA', url: pathToFileURL(html).href }, { parole });
  console.log('R con parole', JSON.stringify(r));
  await pausa(app, 1500);
  let s = await schede(app);
  console.log('S1', JSON.stringify(s));

  // ricarica dopo modifica sul disco
  writeFileSync(html, '<title>Riquadro</title><h1>Dopo</h1>');
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.tabs[tm.tabs.length - 1].view.webContents.reload();
  });
  await pausa(app, 1500);
  s = await schede(app);
  console.log('S ricarica', JSON.stringify(s[s.length - 1]));

  // reload via shell API (F5)
  writeFileSync(html, '<title>Riquadro</title><h1>Terza</h1><a id="l" href="altro.html">altro</a>');
  const id = s[s.length - 1].id;
  try { await shell.evaluate((i) => window.filoShell.tabs.reload && window.filoShell.tabs.reload(i), id); } catch (e) { console.log('reload shell err', e.message); }
  await pausa(app, 1500);
  s = await schede(app);
  console.log('S ricarica shell', JSON.stringify(s[s.length - 1]));

  // clic sul collegamento a una sorella
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.tabs[tm.tabs.length - 1].view.webContents.executeJavaScript('document.getElementById("l").click()');
  });
  await pausa(app, 1500);
  s = await schede(app);
  console.log('S link sorella', JSON.stringify(s.slice(-2)));

  // indietro
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = tm.tabs.find((t) => t.view.webContents.getURL().includes('altro'))?.view.webContents;
    if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  });
  await pausa(app, 1500);
  s = await schede(app);
  console.log('S indietro', JSON.stringify(s.slice(-2)));

  // barra indirizzi: apri e naviga col percorso
  const prima = s.length;
  const ro = await shell.evaluate((u) => window.filoShell.tabs.open(u), html);
  await pausa(app, 1500);
  s = await schede(app);
  console.log('S barra open', JSON.stringify(ro), s.length - prima, JSON.stringify(s[s.length - 1]));
  const ro2 = await shell.evaluate((u) => window.filoShell.tabs.open(u), pathToFileURL(html).href);
  await pausa(app, 1500);
  s = await schede(app);
  console.log('S barra open url', JSON.stringify(ro2), s.length - prima, JSON.stringify(s[s.length - 1]));
  const notifs = await shell.evaluate(() => [...document.querySelectorAll('#shell-notifs > .shell-notif')].map((c) => c.textContent));
  console.log('NOTIFICHE', JSON.stringify(notifs));
});

test('file in casa che nomina immagini in sottocartella, e pdf/immagine resi', async ({ app }) => {
  const dir = cartellaInCasa('filo-1905 casa');
  writeFileSync(join(dir, 'f.png'), PNG);
  const pdf = join(dir, 'doc.pdf');
  writeFileSync(pdf, '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  for (const p of [join(dir, 'f.png'), pdf, join(dir, 'perché #1 & più.html')]) {
    if (p.endsWith('.html')) writeFileSync(p, '<title>Accenti</title><p>accenti resi</p>');
    const r = await execAction(app, { type: 'NAVIGA', url: p }, { parole: [p] });
    await pausa(app, 2500);
    const s = await schede(app);
    console.log('RESA', p, JSON.stringify(r), JSON.stringify(s[s.length - 1]));
  }
});
