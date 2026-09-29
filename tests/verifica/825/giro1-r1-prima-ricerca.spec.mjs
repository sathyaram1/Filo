// Verifica #825 giro 1, rilievo 1: dopo l'aggiornamento, la PRIMA ricerca per contenuto in Cronologia non trova le schede
// vecchie che il tetto di prima aveva lasciato senza vettore; le trova solo una ricerca successiva, a indicizzazione finita.

import { test, expect, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EM = 'qwen/qwen3-embedding-8b';
const N = 5000;
const CON_VETTORE = 2000;
const BERSAGLIO = 4500;

test('dopo la migrazione la prima ricerca per contenuto trova una scheda vecchia rimasta senza vettore', async () => {
  test.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-v825-');
  const base = Date.UTC(2026, 8, 1);
  const vecchio = [];
  for (let i = 0; i < N; i++) {
    vecchio.push({
      id: `t${i}`, url: `https://sito-${i}.test/p`,
      title: i === BERSAGLIO ? 'La balena azzurra' : `Scheda ${i}`,
      closedAt: new Date(base - i * 3600e3).toISOString(), reason: 'manual', coOpenUrls: [],
      summary: i === BERSAGLIO ? 'Documentario sulle balene azzurre del Pacifico.' : `Riassunto ${i}`,
      ...(i < CON_VETTORE ? { embedding: [0, 127, 0, 0], embedModel: EM } : {}),
    });
  }
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ archivedTabs: vecchio }), 'utf8');
  const app = await electron.launch({
    args: [...argomentiScala, '.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    await app.evaluate(async () => {
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false,
        apiKeys: { openrouter: 'test-key', tavily: '' },
        models: { ...globalThis.SN_TEST_MODELS.models },
        modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
      });
      // Un fornitore vero risponde in qualche centinaio di millisecondi per blocco.
      globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
        await new Promise((r) => setTimeout(r, 300));
        return { vectors: texts.map((t) => (/balen/i.test(t) ? [1, 0, 0, 0] : [0, 1, 0, 0])) };
      };
      globalThis.SN_PROVIDERS.completeWithFallback = async () => ({ text: '', provider: 'openrouter', model: 'stub', usage: {} });
    });
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://archive/archive.html'));
    let page = null;
    await expect.poll(() => {
      page = app.windows().find((w) => w.url().startsWith('filo://archive'));
      return !!page;
    }).toBe(true);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.arc-tab').first()).toBeVisible({ timeout: 20_000 });

    await page.locator('#search').fill('balena');
    await page.locator('#search').press('Enter');
    await expect(page.locator('#searchNote')).toContainText('per pertinenza', { timeout: 20_000 });
    await expect(page.locator('.arc-results .arc-tab').first()).toContainText('La balena azzurra');
  } finally {
    await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});
