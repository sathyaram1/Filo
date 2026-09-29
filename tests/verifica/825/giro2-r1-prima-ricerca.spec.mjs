// Verifica #825 giro 2, rilievo 1: dopo l'aggiornamento, con 3000 schede migrate senza vettore e un fornitore che
// indicizza un blocco in un secondo e mezzo, la prima ricerca in Cronologia fatta mezzo minuto dopo deve trovare
// subito la scheda vecchia anche con parole che nel titolo non ci sono.

import { expect } from '@playwright/test';
import { test as base, _electron as electron } from '@playwright/test';
import { chiudiApp } from '../../fixtures/electron.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

base('la prima ricerca dopo la migrazione trova la scheda vecchia per contenuto, senza farsi aspettare', async () => {
  base.setTimeout(150_000);
  const userData = cartellaTemporanea('filo-v825g2-');
  const vecchio = [];
  for (let i = 0; i < 5000; i++) {
    vecchio.push({
      id: `m${i}`, url: `https://migrata-${i}.test/`,
      title: i === 4500 ? 'Il Gattopardo' : `Pagina ${i}`,
      favicon: '', identityColor: null, openedAt: null,
      closedAt: new Date(Date.UTC(2026, 8, 1) - i * 3600e3).toISOString(),
      reason: 'manual', coOpenUrls: [], scrollPosition: null, proxy: null,
      summary: i === 4500 ? 'Romanzo di Tomasi di Lampedusa: la nobiltà siciliana davanti all\'Unità.' : `Riassunto qualunque ${i}`,
      snippet: '',
    });
  }
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ archivedTabs: vecchio }), 'utf8');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
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
    // Le più recenti 2000 hanno il vettore del modello in uso, come le lasciava il tetto di prima.
    await app.evaluate(async () => {
      const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
      const s = await chrome.storage.local.get('archivedTabs');
      const a = s.archivedTabs;
      for (let i = 0; i < 2000; i++) { a[i].embedding = [0, 127, 40]; a[i].embedModel = EM; }
      await chrome.storage.local.set({ archivedTabs: a });
    });

    await shell.evaluate(() => window.filoShell.tabs.open('filo://archive/archive.html'));
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://archive')); return !!page; }).toBe(true);
    await expect(page.locator('.arc-tab').first()).toBeVisible({ timeout: 30_000 });

    // L'utente guarda la Cronologia, fa altro, e mezzo minuto dopo cerca.
    await page.waitForTimeout(30_000);
    await page.locator('#search').fill('libro sulla nobiltà in Sicilia');
    const t0 = Date.now();
    await page.locator('#search').press('Enter');
    await expect(page.locator('#searchNote')).toContainText(/per pertinenza|Nessun risultato/, { timeout: 60_000 });
    const attesa = Date.now() - t0;
    await expect(page.locator('.arc-results .arc-tab').first()).toContainText('Il Gattopardo');
    expect(attesa).toBeLessThan(5000);
  } finally {
    await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});
