// Esplorazione 6 del giro 3 di #1905: collegamenti a una scheda nuova da un file aperto, e il web dentro la scheda del file.
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const execAction = (app, action, opts) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const pausa = (app, ms) => app.evaluate((_e, ms) => new Promise((r) => setTimeout(r, ms)), ms);
const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => ({ url: t.view.webContents.getURL(), title: t.view.webContents.getTitle(), attiva: t.id === tm.activeId }));
});
const clicVero = (app, sel, { button = 'left', modifiers = [] } = {}) => app.evaluate(async ({ BrowserWindow }, { sel, button, modifiers }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => (x.view.webContents.getURL() || '').endsWith('/a.html'));
  const wc = t.view.webContents;
  const r = await wc.executeJavaScript(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + 3, y: b.y + 3 }; })()`);
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(r.x), y: Math.round(r.y), button, clickCount: 1, modifiers });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(r.x), y: Math.round(r.y), button, clickCount: 1, modifiers });
}, { sel, button, modifiers });

test.beforeEach(async ({ app, shell }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoPronta);
});

test('collegamenti verso una scheda nuova', async ({ app }) => {
  const dir = cartellaInCasa('filo-1905 schede');
  const html = join(dir, 'a.html');
  writeFileSync(html, '<title>A</title><p><a id="blank" target="_blank" href="b.html">b nuova</a></p><p><a id="plain" href="c.html">c</a></p><p><button id="wo" onclick="window.open(\'d.html\')">d</button></p>');
  for (const n of ['b', 'c', 'd']) writeFileSync(join(dir, `${n}.html`), `<title>${n.toUpperCase()}</title><p>${n}</p>`);
  await execAction(app, { type: 'NAVIGA', url: html }, { parole: [html] });
  await pausa(app, 1500);
  await clicVero(app, '#blank');
  await pausa(app, 1500);
  console.log('BLANK', JSON.stringify(await schede(app)));
  await clicVero(app, '#plain', { modifiers: ['control'] });
  await pausa(app, 1500);
  console.log('CTRL', JSON.stringify(await schede(app)));
  await clicVero(app, '#plain', { button: 'middle' });
  await pausa(app, 1500);
  console.log('MIDDLE', JSON.stringify(await schede(app)));
  await clicVero(app, '#wo');
  await pausa(app, 1500);
  console.log('WOPEN', JSON.stringify(await schede(app)));
  const notifs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs).webContents.executeJavaScript('[...document.querySelectorAll("#shell-notifs > .shell-notif")].map((c) => c.textContent)'));
  console.log('NOTIF', JSON.stringify(notifs));
});

test('un sito aperto dentro la scheda del file non legge i file della cartella', async ({ app, testServer }) => {
  const dir = cartellaInCasa('filo-1905 web nel file');
  const html = join(dir, 'a.html');
  writeFileSync(join(dir, 'segreto.txt'), 'SEGRETO-123');
  writeFileSync(join(dir, 'f.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const seg = pathToFileURL(join(dir, 'segreto.txt')).href;
  const png = pathToFileURL(join(dir, 'f.png')).href;
  const sito = testServer.html(`<title>Sito</title><script>
    window.__esiti = {};
    fetch(${JSON.stringify(seg)}).then(r => r.text()).then(t => __esiti.fetch = t, e => __esiti.fetch = 'ERR ' + e.message);
    const i = new Image(); i.onload = () => __esiti.img = 'ok ' + i.naturalWidth; i.onerror = () => __esiti.img = 'err'; i.src = ${JSON.stringify(png)};
    const f = document.createElement('iframe'); f.src = ${JSON.stringify(seg)}; f.onload = () => { try { __esiti.iframe = f.contentDocument && f.contentDocument.body.innerText; } catch (e) { __esiti.iframe = 'cross ' + e.message; } }; document.documentElement.appendChild(f);
  </script>`);
  writeFileSync(html, `<title>A</title><a id="w" href="${sito}">web</a>`);
  await execAction(app, { type: 'NAVIGA', url: html }, { parole: [html] });
  await pausa(app, 1500);
  await clicVero(app, '#w');
  await pausa(app, 2500);
  const r = await app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return Promise.all(tm.tabs.map(async (t) => ({ url: t.view.webContents.getURL(), part: t.partition, esiti: await t.view.webContents.executeJavaScript('JSON.stringify(window.__esiti || null)').catch((e) => 'x ' + e.message) })));
  });
  console.log('WEBNELFILE', JSON.stringify(r));
});
