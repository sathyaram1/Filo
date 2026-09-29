// Verifica #825 giro 3, rilievo 1: un backup fatto con la versione di prima (vettori solo sulle 2000 schede più recenti)
// reimportato da Opzioni a Filo già acceso. Mezzo minuto dopo la prima ricerca per contenuto in Cronologia deve trovare
// subito la scheda vecchia, come dopo la migrazione: l'indice delle schede importate non deve aspettare la ricerca.

import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { buildExportZip } = require('../../../src/main/services/exportData.js');

test('dopo l\'importazione di un backup vecchio la prima ricerca trova la scheda vecchia senza farsi aspettare', async ({ app, shell, openTab }) => {
  test.setTimeout(180_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
      await new Promise((ok) => setTimeout(ok, texts.length > 1 ? 1500 : 300));
      return { vectors: texts.map((t) => (/gattopardo|nobilt/i.test(t) ? [1, 0, 0] : [0, 1, 0.3])) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async () => ({ text: '', provider: 'openrouter', model: 'stub', usage: {} });
  });
  const EM = await app.evaluate(() => globalThis.SN_TEST_MODELS.registry['qwen-embed'].model);

  const vecchio = [];
  for (let i = 0; i < 5000; i++) {
    vecchio.push({
      id: `b${i}`, url: `https://dal-backup-${i}.test/`,
      title: i === 4500 ? 'Il Gattopardo' : `Pagina ${i}`,
      favicon: '', identityColor: null, openedAt: null,
      closedAt: new Date(Date.UTC(2026, 8, 1) - i * 3600e3).toISOString(),
      reason: 'manual', coOpenUrls: [], scrollPosition: null, proxy: null,
      summary: i === 4500 ? 'Romanzo di Tomasi di Lampedusa: la nobiltà siciliana davanti all\'Unità.' : `Riassunto qualunque ${i}`,
      snippet: '',
      ...(i < 2000 ? { embedding: [0, 127, 40], embedModel: EM } : {}),
    });
  }
  const dati = await app.evaluate(() => process.env.FILO_USER_DATA);
  const zip = join(dati, 'backup-vecchio-825.zip');
  writeFileSync(zip, buildExportZip({ archivedTabs: vecchio }));

  // Filo è acceso da un po': l'indicizzazione dell'avvio e quella del cambio di modello sono già passate.
  await shell.waitForTimeout(15_000);

  await app.evaluate(({ dialog }, z) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [z] });
  }, zip);
  const opzioni = await openTab('filo://newtab/');
  const anteprima = await opzioni.evaluate(async () => chrome.runtime.sendMessage({ type: 'import_data_preview' }));
  expect(anteprima.ok).toBe(true);
  const esito = await opzioni.evaluate(async (t) => chrome.runtime.sendMessage({ type: 'import_data_apply', token: t }), anteprima.token);
  expect(esito.ok).toBe(true);
  expect(await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length)).toBe(5000);

  const page = await openTab('filo://archive/archive.html');
  await expect(page.locator('.arc-tab').first()).toBeVisible({ timeout: 30_000 });
  // L'utente guarda la Cronologia, fa altro, e mezzo minuto dopo cerca.
  await page.waitForTimeout(30_000);
  await page.locator('#search').fill('libro sulla nobiltà in Sicilia');
  const t0 = Date.now();
  await page.locator('#search').press('Enter');
  await expect(page.locator('#searchNote')).toContainText(/per pertinenza|Nessun risultato/, { timeout: 60_000 });
  const attesa = Date.now() - t0;
  const primo = await page.locator('.arc-results .arc-tab').first().textContent();
  console.log(`[verifica #825 giro 3] attesa della prima ricerca: ${attesa} ms, primo risultato: ${primo}`);
  expect(primo).toContain('Il Gattopardo');
  expect(attesa).toBeLessThan(5000);
});
