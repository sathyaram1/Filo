// Esplorazione del giro 4 di #1905: tasto destro e ricerca nella scheda di un file; sessione con un file sparito.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');

test('tasto destro sulla scheda di un file', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = join(cartellaTemporanea('g4d-'), 'report');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'menu.html');
  writeFileSync(f, '<!doctype html><title>Report menu</title><body style="font:20px sans-serif"><p id="p">Fatturato trimestrale della ditta</p><a id="a" href="altro.html">altro</a></body>');
  writeFileSync(join(dir, 'altro.html'), '<!doctype html><title>Altro</title>');
  await home(app);
  const r = await app.evaluate((_e, f) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: f }, { parole: `aprimi ${f}` }), f);
  expect(r.executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await app.evaluate(({ BrowserWindow }) => { const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs; const s = t.tabs.find((x) => String(x.url).startsWith('file:')); return s ? s.id : null; })), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  const pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  await pagina.waitForTimeout(1500);
  await pagina.locator('#p').click({ button: 'right' });
  await pagina.waitForTimeout(1500);
  const m = menuDi(pagina);
  const voci = await m.voci.evaluateAll((vs) => vs.map((v) => v.textContent.trim())).catch((e) => ['errore ' + e.message]);
  console.log('MENU TESTO', JSON.stringify(voci));
  mkdirSync(SHOTS, { recursive: true });
  await (m.superficie.screenshot ? m.superficie.screenshot({ path: join(SHOTS, 'g4-menu-file.png') }) : null);
  await pagina.keyboard.press('Escape');
  await pagina.locator('#a').click({ button: 'right' });
  await pagina.waitForTimeout(1500);
  const voci2 = await menuDi(pagina).voci.evaluateAll((vs) => vs.map((v) => v.textContent.trim())).catch((e) => ['errore ' + e.message]);
  console.log('MENU LINK', JSON.stringify(voci2));
});

test('sessione salvata con un file che non c\'è più', async ({ app }) => {
  test.setTimeout(60_000);
  await home(app);
  const manca = pathToFileURL(join(cartellaTemporanea('g4x-'), 'sparito.html')).href;
  await app.evaluate(async ({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    await globalThis.SN_STORAGE.setRaw(tm._sessionKey(), { tabs: ['filo://newtab/', u], activeIndex: 1 });
    await tm.restoreSession();
  }, manca);
  await new Promise((ok) => setTimeout(ok, 4000));
  const stato = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs
    .map((t) => { try { return t.url + ' | ' + t.view.webContents.getURL() + ' | ' + t.view.webContents.getTitle(); } catch (_) { return t.url; } }));
  console.log('SPARITO', JSON.stringify(stato));
  const id = await app.evaluate(({ BrowserWindow }) => { const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs; const s = t.tabs.find((x) => /sparito/.test(String(x.url))); if (s) t.activate(s.id); return s ? s.id : null; });
  if (id) {
    await new Promise((ok) => setTimeout(ok, 1500));
    const png = await app.evaluate(async ({ BrowserWindow }, i) => {
      const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.id === i);
      return (await t.view.webContents.capturePage()).toPNG().toString('base64');
    }, id);
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, 'g4-sparito.png'), Buffer.from(png, 'base64'));
  }
});
