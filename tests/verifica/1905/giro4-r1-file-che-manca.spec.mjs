// Verifica #1905 giro 4, rilievo 1: nella scheda di un file del computer, un file che non c'è (collegamento rotto,
// file tolto prima di ricaricare, scheda che torna dalla sessione) deve dirlo all'utente, non restare una pagina bianca.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow }, { src, arg }) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  // eslint-disable-next-line no-new-func
  return new Function('tm', 'arg', `return (${src})(tm, arg);`)(t, arg);
}, { src: fn.toString(), arg });

// Quello che l'utente legge: il testo della scheda, o un avviso di Filo sopra di lei.
async function siLegge(app, avvisi, id) {
  let testo = '';
  try { testo = await tm(app, (t, i) => t.tabs.find((x) => x.id === i).view.webContents.executeJavaScript('document.body ? document.body.innerText : ""'), id); } catch (_) {}
  let notifiche = [];
  try { notifiche = await (await avvisi()).locator('.shell-notif.show').allInnerTexts(); } catch (_) {}
  return `${testo}\n${notifiche.join('\n')}`;
}
const DICE_CHE_MANCA = /non (c'è|c’è|trovato|esiste)|manca|spostato|cancellato/i;

test('r1 un collegamento della pagina a un file che non c\'è dice che manca, invece di una pagina bianca', async ({ app, avvisi }) => {
  test.setTimeout(60_000);
  const dir = join(cartellaTemporanea('g4r1-'), 'report');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'indice.html');
  writeFileSync(f, '<!doctype html><title>Indice</title><body><a id="a" href="capitolo-2.html">Capitolo 2</a></body>');
  await home(app);
  expect((await app.evaluate((_e, f) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: f }, { parole: `aprimi ${f}` }), f)).executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await tm(app, (t) => { const s = t.tabs.find((x) => String(x.url).startsWith('file:')); return s ? s.id : null; })), { timeout: 10_000 }).toBeTruthy();
  await tm(app, (t, i) => t.activate(i), id);
  const pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  await expect(pagina).toHaveTitle('Indice', { timeout: 10_000 });
  await pagina.click('#a');
  await expect.poll(() => siLegge(app, avvisi, id), { timeout: 8000, message: 'l\'utente legge che il capitolo non c\'è' }).toMatch(DICE_CHE_MANCA);
});

test('r1 ricaricando la scheda di un file tolto, Filo dice che il file non c\'è più', async ({ app, avvisi }) => {
  test.setTimeout(60_000);
  const dir = join(cartellaTemporanea('g4r1b-'), 'report');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'report.html');
  writeFileSync(f, '<!doctype html><title>Report</title><h1>ciao</h1>');
  await home(app);
  expect((await app.evaluate((_e, f) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: f }, { parole: `aprimi ${f}` }), f)).executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await tm(app, (t) => { const s = t.tabs.find((x) => String(x.url).startsWith('file:')); return s ? s.id : null; })), { timeout: 10_000 }).toBeTruthy();
  await tm(app, (t, i) => t.activate(i), id);
  const pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  await expect(pagina).toHaveTitle('Report', { timeout: 10_000 });
  rmSync(f);
  await tm(app, (t, i) => t.reload(i), id);
  await expect.poll(() => siLegge(app, avvisi, id), { timeout: 8000, message: 'l\'utente legge che il file non c\'è più' }).toMatch(DICE_CHE_MANCA);
});

test('r1 riaperto Filo, la scheda di un file che non c\'è più lo dice', async ({ app, avvisi }) => {
  test.setTimeout(60_000);
  await home(app);
  const manca = pathToFileURL(join(cartellaTemporanea('g4r1c-'), 'sparito.html')).href;
  await tm(app, async (t, u) => {
    await globalThis.SN_STORAGE.setRaw(t._sessionKey(), { tabs: ['filo://newtab/', u], activeIndex: 1 });
    await t.restoreSession();
  }, manca);
  let id = null;
  await expect.poll(async () => (id = await tm(app, (t) => { const s = t.tabs.find((x) => /sparito/.test(String(x.url))); return s ? s.id : null; })), { timeout: 10_000 }).toBeTruthy();
  await tm(app, (t, i) => t.activate(i), id);
  await expect.poll(() => siLegge(app, avvisi, id), { timeout: 8000, message: 'l\'utente legge che il file non c\'è più' }).toMatch(DICE_CHE_MANCA);
});
