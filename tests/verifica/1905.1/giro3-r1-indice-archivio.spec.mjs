// Verifica #1905.1 giro 3: il titolo di una scheda di un file del computer, chiusa, non parte verso il modello dell'archivio.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const schedaFile = (app, fine) => app.evaluate(({ BrowserWindow }, fine) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => { try { const u = x.view.webContents.getURL() || x.url; return /^file:/.test(u) && u.endsWith(fine); } catch (_) { return false; } });
  return t ? t.id : null;
}, fine);

async function preparaModelli(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__versoIlModello = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
      globalThis.__versoIlModello.push(...texts);
      return { vectors: texts.map((t) => (/referto/i.test(t) ? [1, 0] : [0, 1])) };
    };
    const prima = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async (...a) => {
      globalThis.__versoIlModello.push(JSON.stringify(a[0] && (a[0].messages || a[0].prompt || a[0])));
      return { text: '', provider: 'openrouter', model: 'stub', usage: {} };
    };
    globalThis.__primaCompl = prima;
  });
}

test('r1 chiusa la scheda di un file, il suo titolo non va al modello che indicizza l\'archivio, e la ricerca per parole la trova', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await preparaModelli(app);
  const dir = join(cartellaTemporanea('referto-'), 'Documenti');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'referto.html');
  writeFileSync(file, '<!doctype html><meta charset="utf-8"><title>Referto esami del sangue di Mario Rossi</title><p>emoglobina</p>');
  await home(app);
  expect((await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` })).executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, 'referto.html')), { timeout: 10_000 }).toBeTruthy();
  await expect.poll(() => app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.id === i).title, id), { timeout: 10_000 }).toMatch(/Referto/);
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.closeTab(i), id);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.listMeta()).some((x) => /^file:/.test(x.url || ''))), { message: 'la scheda del file è nell\'archivio' }).toBe(true);
  // Una pagina web chiusa dopo: la prova che l'indice è passato.
  await app.evaluate(() => globalThis.SN_ARCHIVED_TABS.archive({ url: 'https://controllo.test/', title: 'Pagina web di controllo' }));
  await expect.poll(() => app.evaluate(() => globalThis.__versoIlModello.join(' | ')), { timeout: 20_000, message: 'l\'indice è passato' }).toMatch(/Pagina web di controllo/);
  expect.soft(await app.evaluate(() => globalThis.__versoIlModello.join(' | ')), 'il titolo del file resta sul computer').not.toMatch(/Referto|Mario Rossi/);

  // La ricerca nell'archivio la trova per parole, senza mandare il titolo al modello.
  const page = await openTab('filo://newtab/');
  await app.evaluate(() => { globalThis.__versoIlModello = []; });
  const r = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'referto esami' }));
  expect((r.results || []).map((x) => x.title), 'la ricerca la trova').toContain('Referto esami del sangue di Mario Rossi');
  expect(await app.evaluate(() => globalThis.__versoIlModello.filter((t) => t !== 'referto esami').join(' | ')), 'nemmeno la ricerca manda il titolo al modello').not.toMatch(/Mario Rossi/);
});
