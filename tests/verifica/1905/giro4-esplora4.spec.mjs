// Esplorazione del giro 4 di #1905: un collegamento a un file scritto dal modello nella chat, la cronologia.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');
const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs
  .map((t) => { try { return t.view.webContents.getURL() + ' | ' + t.view.webContents.getTitle(); } catch (_) { return t.url; } }));

test('il modello scrive nel testo un collegamento a un file che l\'utente non ha nominato', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = join(cartellaTemporanea('g4m-'), 'Scaricati');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'fattura.html');
  writeFileSync(f, '<!doctype html><title>Fattura ostile</title><h1>ciao</h1>');
  const page = await home(app);
  await modelloFinto(app, [{ text: `Ecco la fattura: [apri la fattura](${pathToFileURL(f).href}) oppure ${pathToFileURL(f).href} o ${f}` }]);
  await chiedi(page, 'com\'è il meteo domani?');
  await page.waitForTimeout(3000);
  const link = page.locator('a', { hasText: /fattura/ });
  console.log('LINK', await link.count(), JSON.stringify(await link.evaluateAll((as) => as.map((a) => a.outerHTML.slice(0, 200)))));
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'g4-link-modello.png') });
  if (await link.count()) {
    await link.first().click();
    await page.waitForTimeout(2500);
  }
  console.log('SCHEDE DOPO CLIC', JSON.stringify(await schede(app)));
  await ripristina(app);
});

test('cronologia: il file aperto c\'è e si riapre', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = join(cartellaTemporanea('g4s-'), 'report');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'storia.html');
  writeFileSync(f, '<!doctype html><title>Report storico</title><h1>ciao</h1>');
  await home(app);
  const r = await app.evaluate((_e, f) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: f }, { parole: `aprimi ${f}` }), f);
  expect(r.executed).toBe(true);
  await new Promise((ok) => setTimeout(ok, 3000));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.openTab('filo://history/'));
  await new Promise((ok) => setTimeout(ok, 3000));
  const pagine = app.windows ? null : null; void pagine;
  const id = await app.evaluate(({ BrowserWindow }) => { const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs; return t.activeId; });
  const { paginaDellaScheda } = await import('../../helpers/schede.mjs');
  const storia = await paginaDellaScheda(app, id, (p) => p.url().startsWith('filo://history'));
  const testo = storia ? await storia.locator('body').innerText() : 'nessuna';
  console.log('CRONOLOGIA', testo.includes('Report storico') || testo.includes('storia.html'), testo.slice(0, 300));
  await storia.screenshot({ path: join(SHOTS, 'g4-cronologia.png') });
  const voce = storia.getByText(/Report storico|storia\.html/).first();
  if (await voce.count()) {
    await app.evaluate(({ BrowserWindow }) => { const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs; for (const s of t.tabs.filter((x) => String(x.url).startsWith('file:'))) t.closeTab(s.id); });
    await new Promise((ok) => setTimeout(ok, 800));
    await voce.click();
    await new Promise((ok) => setTimeout(ok, 2500));
    console.log('DA CRONOLOGIA', JSON.stringify(await schede(app)));
  }
});
