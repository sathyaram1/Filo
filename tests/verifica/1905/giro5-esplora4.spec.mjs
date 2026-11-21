// #1905 giro 5: esplorazione 4.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');
const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs
  .map((t) => { let u = ''; try { u = t.view.webContents.getURL(); } catch (_) {} return { id: t.id, url: t.url, vero: u }; }));
const schedaFile = async (app, fine) => (await schede(app)).find((t) => /^file:/.test(t.vero || t.url) && (t.vero || t.url).endsWith(fine))?.id || null;
const log = (k, v) => console.log(`### ${k}: ${JSON.stringify(v)}`);

async function apri(app, file) {
  await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` });
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, file.split('/').pop())), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  let p = null;
  await expect.poll(async () => Boolean(p = await paginaDellaScheda(app, id, (x) => x.url().startsWith('file:'))), { timeout: 10_000 }).toBe(true);
  return { id, p };
}

test('esplora 4', async ({ app, shell }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS, { recursive: true });
  const dir = join(cartellaTemporanea('g5d-'), 'Documenti', 'appunti');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'note.html'), `<!doctype html><title>Le mie note</title><textarea id="t"></textarea>
    <script>const t = document.getElementById('t'); t.value = localStorage.getItem('note') || '';
    t.addEventListener('input', () => localStorage.setItem('note', t.value));</script>`);
  copyFileSync(join(process.cwd(), 'tests', 'fixtures', 'documenti', 'documento-con-testo.pdf'), join(dir, 'conto.pdf'));
  await home(app);
  const file = join(dir, 'note.html');
  let { id, p } = await apri(app, file);
  await p.locator('#t').fill('comprare il latte');
  log('salvato', await p.evaluate(() => localStorage.getItem('note')));
  await shell.screenshot({ path: join(SHOTS, 'g5-shell-file.png') });
  await apri(app, join(dir, 'conto.pdf'));
  await new Promise((r) => setTimeout(r, 1500));
  await shell.screenshot({ path: join(SHOTS, 'g5-shell-pdf.png') });

  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.closeTab(id), id);
  await expect.poll(async () => schedaFile(app, 'note.html')).toBeNull();
  ({ id, p } = await apri(app, file));
  log('riaperto da chat', await p.evaluate(() => [localStorage.getItem('note'), document.getElementById('t').value]));
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.closeTab(id), id);
  await expect.poll(async () => schedaFile(app, 'note.html')).toBeNull();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.riapriChiusa());
  await expect.poll(async () => (id = await schedaFile(app, 'note.html')), { timeout: 10_000 }).toBeTruthy();
  p = null;
  await expect.poll(async () => Boolean(p = await paginaDellaScheda(app, id, (x) => x.url().startsWith('file:'))), { timeout: 10_000 }).toBe(true);
  await p.waitForLoadState('load');
  log('riaperto ctrl+shift+t', await p.evaluate(() => [localStorage.getItem('note'), document.getElementById('t').value]));
});
