// Esplorazione del giro 3 di #1905: aprire in una scheda un file del computer di cui l'utente dà il percorso.
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa, cartellaTemporanea } from '../../helpers/percorsi.mjs';
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
    return { id: t.id, url, title, testo, tUrl: t.url };
  }));
});

const PULITO = {};
const DOPO_UNA_RICERCA = { contesto: [{ type: 'CERCA_WEB', query: 'x', _output: { results: [{ url: 'https://esempio.test/' }] } }] };

test.beforeEach(async ({ app, shell }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoPronta);
});

function scrivi(dir, nome, contenuto) {
  const p = join(dir, nome);
  writeFileSync(p, contenuto);
  return p;
}

test('casi vari', async ({ app }) => {
  const dir = cartellaInCasa('filo-1905 report');
  mkdirSync(join(dir, 'sotto cartella'), { recursive: true });
  const html = scrivi(dir, '2026-10-30-riquadro conferma.html', '<title>Riquadro</title><h1>Ciao resa</h1>');
  const accenti = scrivi(dir, 'perché è così #1 & più.html', '<title>Accenti</title><h1>Accenti resi</h1>');
  const pdf = scrivi(dir, 'doc.pdf', '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  const png = scrivi(dir, 'foto.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const htm = scrivi(join(dir, 'sotto cartella'), 'vecchio.HTM', '<title>Maiuscolo</title><p>htm</p>');
  const txt = scrivi(dir, 'note.txt', 'testo semplice');
  const tmp = cartellaTemporanea('filo-1905 fuori');
  const fuori = scrivi(tmp, 'fuori.html', '<title>Fuori</title><p>fuori casa</p>');

  const casi = [
    ['url %20 pulito', pathToFileURL(html).href, PULITO],
    ['percorso grezzo pulito', html, PULITO],
    ['percorso grezzo dopo ricerca', html, DOPO_UNA_RICERCA],
    ['accenti url', pathToFileURL(accenti).href, PULITO],
    ['accenti grezzo', accenti, PULITO],
    ['pdf', pdf, PULITO],
    ['png', png, PULITO],
    ['HTM maiuscolo', htm, PULITO],
    ['txt', txt, PULITO],
    ['cartella', dir, PULITO],
    ['inesistente', join(dir, 'non-esiste.html'), PULITO],
    ['fuori casa', fuori, PULITO],
    ['tilde', '~/' + html.split('/').slice(3).join('/'), PULITO],
    ['virgolette', `"${html}"`, PULITO],
    ['file:// con host localhost', 'file://localhost' + pathToFileURL(html).pathname, PULITO],
  ];
  for (const [nome, url, opts] of casi) {
    const prima = (await schede(app)).length;
    let r;
    try { r = await execAction(app, { type: 'NAVIGA', url }, opts); } catch (e) { r = { eccezione: e.message }; }
    await app.evaluate(() => new Promise((res) => setTimeout(res, 1500)));
    const dopo = await schede(app);
    console.log(`\n### ${nome}: ${url}\nR=${JSON.stringify(r).slice(0, 600)}\nnuove=${dopo.length - prima} ultima=${JSON.stringify(dopo[dopo.length - 1])}`);
  }
});
