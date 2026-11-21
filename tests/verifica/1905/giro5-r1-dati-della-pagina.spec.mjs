// #1905 giro 5, rilievo 1: quello che una pagina del computer salva per sé (le note di un HTML che usa la memoria del
// browser) deve ritrovarlo quando l'utente la riapre, come in un browser.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const tm = (app, codice, arg) => app.evaluate(({ BrowserWindow }, { codice, arg }) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return new Function('tm', 'arg', codice)(t, arg);
}, { codice, arg });
const schedaNote = (app) => tm(app, `const s = tm.tabs.find((t) => { try { return /note\\.html$/.test(t.view.webContents.getURL() || t.url); } catch (_) { return false; } });
  return s ? s.id : null;`);

function preparaNote() {
  const dir = join(cartellaTemporanea('g5r1-'), 'Documenti', 'appunti');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'note.html');
  writeFileSync(file, `<!doctype html><title>Le mie note</title><textarea id="t"></textarea>
    <script>const t = document.getElementById('t'); t.value = localStorage.getItem('note') || '';
    t.addEventListener('input', () => localStorage.setItem('note', t.value));</script>`);
  return file;
}

async function paginaNote(app) {
  let id = null;
  await expect.poll(async () => (id = await schedaNote(app)), { timeout: 10_000 }).toBeTruthy();
  await tm(app, 'tm.activate(arg)', id);
  let p = null;
  await expect.poll(async () => Boolean(p = await paginaDellaScheda(app, id, (x) => x.url().startsWith('file:'))), { timeout: 10_000 }).toBe(true);
  await p.waitForLoadState('load');
  return { id, p };
}

async function scriviEChiudi(app, file) {
  expect((await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` })).executed).toBe(true);
  const { id, p } = await paginaNote(app);
  await p.locator('#t').fill('comprare il latte');
  await expect.poll(() => p.evaluate(() => localStorage.getItem('note'))).toBe('comprare il latte');
  await tm(app, 'tm.closeTab(arg)', id);
  await expect.poll(() => schedaNote(app)).toBeNull();
}

test('r1 le note scritte in una pagina del computer ci sono ancora quando l\'utente la riapre dalla chat', async ({ app }) => {
  const file = preparaNote();
  await home(app);
  await scriviEChiudi(app, file);
  expect((await execAction(app, { type: 'NAVIGA', url: file }, { parole: `riaprimi ${file}` })).executed).toBe(true);
  const { p } = await paginaNote(app);
  await expect(p.locator('#t')).toHaveValue('comprare il latte', { timeout: 5000 });
});

test('r1 le note scritte in una pagina del computer ci sono ancora dopo Ctrl+Shift+T', async ({ app }) => {
  const file = preparaNote();
  await home(app);
  await scriviEChiudi(app, file);
  await tm(app, 'return tm.riapriChiusa()');
  const { p } = await paginaNote(app);
  await expect(p.locator('#t')).toHaveValue('comprare il latte', { timeout: 5000 });
});

test('r1 le note scritte in una pagina del computer ci sono ancora quando la scheda torna con la sessione salvata', async ({ app }) => {
  const file = preparaNote();
  await home(app);
  await scriviEChiudi(app, file);
  await tm(app, `return (async () => {
    await globalThis.SN_STORAGE.setRaw(tm._sessionKey(), { tabs: ['filo://newtab/', arg], activeIndex: 1 });
    await tm.restoreSession();
  })()`, pathToFileURL(file).href);
  const { p } = await paginaNote(app);
  await expect(p.locator('#t')).toHaveValue('comprare il latte', { timeout: 5000 });
});
