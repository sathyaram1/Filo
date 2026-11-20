// Esplorazione 3 del giro 3 di #1905: avviso con la memoria, indietro, collegamenti dal web e dal file verso il web.
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const execAction = (app, action, opts) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => {
    let url = '', back = null, part = null;
    try { url = t.view.webContents.getURL(); back = t.view.webContents.navigationHistory.canGoBack(); part = t.view.webContents.session.storagePath ? 'persist' : String(t.partition || t._partizione || ''); } catch (_) {}
    return { id: t.id, url, back, part };
  });
});
const pausa = (app, ms) => app.evaluate((_e, ms) => new Promise((r) => setTimeout(r, ms)), ms);
const DOPO_UNA_RICERCA = { contesto: [{ type: 'CERCA_WEB', query: 'x', _output: { results: [{ url: 'https://esempio.test/' }] } }] };

test.beforeEach(async ({ app, shell }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoPronta);
});

test('memoria nel percorso', async ({ app }) => {
  const dir = cartellaInCasa('Mario Rossi Bologna');
  const html = join(dir, 'Mario Rossi bilancio Bologna.html');
  writeFileSync(html, '<title>B</title><p>b</p>');
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Mario Rossi, vive a Bologna.', PREFERENZE: 'Tema scuro.' });
  });
  for (const [nome, opts] of [
    ['scritto, pulito', { parole: [html] }],
    ['scritto, dopo ricerca', { parole: [html], ...DOPO_UNA_RICERCA }],
    ['non scritto, pulito', {}],
    ['non scritto, dopo ricerca', DOPO_UNA_RICERCA],
  ]) {
    const r = await execAction(app, { type: 'NAVIGA', url: pathToFileURL(html).href }, opts);
    console.log('MEM', nome, JSON.stringify({ ...r, parti: undefined }));
  }
});

test('indietro e link al web dal file', async ({ app, testServer }) => {
  const sito = testServer.html('<title>Sito</title><p>sito</p>');
  const dir = cartellaInCasa('filo-1905 indietro');
  const html = join(dir, 'a.html');
  writeFileSync(html, `<title>A</title><a id="l" href="b.html">b</a> <a id="w" href="${sito}">web</a>`);
  writeFileSync(join(dir, 'b.html'), '<title>B</title><p>b</p>');
  await execAction(app, { type: 'NAVIGA', url: html }, { parole: [html] });
  await pausa(app, 1500);
  const clic = (sel) => app.evaluate(({ BrowserWindow }, sel) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return t.view.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(sel)}).click()`);
  }, sel);
  await clic('#l');
  await pausa(app, 1500);
  console.log('DOPO LINK', JSON.stringify(await schede(app)));
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.tabs.find((x) => x.id === tm.activeId).view.webContents.navigationHistory.goBack();
  });
  await pausa(app, 1500);
  console.log('DOPO INDIETRO', JSON.stringify(await schede(app)));
  await clic('#w');
  await pausa(app, 2000);
  const s = await schede(app);
  console.log('DOPO WEB', JSON.stringify(s));
  // la scheda del web: in che sessione? legge i cookie della sessione normale?
  const info = await app.evaluate(({ BrowserWindow, session }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return tm.tabs.map((t) => ({ url: t.view.webContents.getURL(), stessaSessione: t.view.webContents.session === session.defaultSession, part: t.view.webContents.session.getStoragePath && t.view.webContents.session.getStoragePath() }));
  });
  console.log('SESSIONI', JSON.stringify(info));
});

test('una pagina web non apre un file del computer, nemmeno di una cartella già aperta', async ({ app, testServer, openTab }) => {
  const dir = cartellaInCasa('filo-1905 dal web');
  const html = join(dir, 'a.html');
  writeFileSync(html, '<title>A</title><p>a</p>');
  writeFileSync(join(dir, 'segreto.html'), '<title>Segreto</title><p>s</p>');
  await execAction(app, { type: 'NAVIGA', url: html }, { parole: [html] });
  await pausa(app, 1000);
  const url = pathToFileURL(join(dir, 'segreto.html')).href;
  const page = await openTab(testServer.html(`<title>Web</title><a id="l" href="${url}">x</a><a id="n" target="_blank" href="${url}">y</a>`));
  await page.click('#l');
  await pausa(app, 1000);
  await page.click('#n');
  await pausa(app, 1000);
  await page.evaluate((u) => { window.open(u); }, url);
  await pausa(app, 1000);
  await page.evaluate((u) => { location.href = u; }, url);
  await pausa(app, 1500);
  console.log('DAL WEB', JSON.stringify(await schede(app)));
});
