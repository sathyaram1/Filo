// Verifica #1905.1 giro 5, rilievo 2: riaprire la scheda chiusa di un file che intanto è stato cancellato lo dice,
// come il collegamento in chat, invece di lasciare una scheda bianca senza titolo.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const schedeFile = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs
  .filter((t) => /^file:/.test(t.url || '')).map((t) => t.id));
const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('r2 Ctrl+Shift+T sulla scheda di un file cancellato intanto dice che il file non c\'è e non apre una scheda bianca', async ({ app, avvisi }) => {
  test.setTimeout(60_000);
  const dir = join(cartellaTemporanea('sparito-'), 'Report');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'referto.html');
  writeFileSync(file, '<!doctype html><title>Referto</title><p>valori</p>');
  await home(app);
  expect((await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` })).executed).toBe(true);
  let ids = [];
  await expect.poll(async () => (ids = await schedeFile(app)).length, { timeout: 10_000 }).toBe(1);
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.closeTab(i), ids[0]);
  await expect.poll(async () => (await schedeFile(app)).length).toBe(0);
  rmSync(file);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.riapriChiusa({ tasto: 'ctrl_shift_t' }));
  await expect((await avvisi()).locator('.shell-notif.show', { hasText: /File non trovato: .*referto\.html/ })).toBeVisible({ timeout: 8000 });
  expect((await schedeFile(app)).length, 'nessuna scheda bianca al posto del file').toBe(0);
});
