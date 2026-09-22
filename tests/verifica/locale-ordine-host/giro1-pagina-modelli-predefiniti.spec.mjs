// Verifica della pagina «Modelli predefiniti»: accanto al livello di
// ragionamento ci dev'essere la scelta del criterio con cui il router ordina
// gli host, con le quattro voci, e quella scelta deve finire nella
// configurazione salvata.
//
// La pagina vuole un amministratore, che nei test non c'è: si finge la
// conversazione col main (stessa tecnica degli altri spec della pagina) e si
// guarda COSA la pagina chiede di salvare.

import { test, expect } from '../../fixtures/electron.mjs';

const ADMIN_URL = 'filo://admin-defaults/admin-defaults.html';

async function apriEditor(openTab) {
  const page = await openTab(ADMIN_URL);
  await page.addInitScript(() => {
    const config = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: {
        veloce: { provider: 'openrouter', model: 'vendor/uno', reasoning: 'medium', sort: 'throughput' },
        normale: { provider: 'openrouter', model: 'vendor/due' },
      },
      models: {},
      excludedProviders: [],
    };
    window.__inviati = [];
    const finto = async (msg) => {
      window.__inviati.push(msg);
      switch (msg.type) {
        case 'defaults_get': return { ok: true, config };
        case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
        case 'defaults_update': return { ok: true, config };
        default: return { ok: true };
      }
    };
    const attacca = () => {
      if (!window.chrome || !window.chrome.runtime) { setTimeout(attacca, 5); return; }
      window.chrome.runtime.sendMessage = finto;
    };
    attacca();
  });
  await page.reload();
  await page.waitForSelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)', { timeout: 15_000 });
  return page;
}

test('Modelli predefiniti: ogni riga ha la scelta dell\'ordinamento degli host, con le quattro voci', async ({ openTab }) => {
  const page = await apriEditor(openTab);

  const righe = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
  await expect(righe).toHaveCount(2);

  // La scelta sta accanto al livello di ragionamento, su ogni riga.
  for (let i = 0; i < 2; i++) {
    await expect(righe.nth(i).locator('.sn-model-reason')).toHaveCount(1);
    await expect(righe.nth(i).locator('.sn-model-sort')).toHaveCount(1);
  }

  const voci = await righe.first().locator('.sn-model-sort option').allTextContents();
  expect(voci).toEqual(['Automatico', 'Più veloce', 'Risposta più pronta', 'Più economico']);

  // Il valore già salvato si rilegge; chi non ha scelto mostra "Automatico".
  await expect(righe.nth(0).locator('.sn-model-sort')).toHaveValue('throughput');
  await expect(righe.nth(1).locator('.sn-model-sort')).toHaveValue('auto');

  // La colonna ha la sua intestazione.
  const intestazioni = await page.locator('#modelRegistryList .sn-model-row-head > div').allTextContents();
  expect(intestazioni.filter((t) => t.trim()).length).toBeGreaterThanOrEqual(5);

  await page.screenshot({ path: 'tests/.shots/ordine-host-modelli-predefiniti.png', fullPage: true }).catch(() => {});
});

test('Modelli predefiniti: la scelta si salva e si toglie', async ({ openTab }) => {
  const page = await apriEditor(openTab);
  const righe = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');

  // Si mette su chi non l'aveva…
  await righe.nth(1).locator('.sn-model-sort').selectOption('latency');
  await page.locator('#save').click();
  await expect.poll(async () => page.evaluate(() => {
    const u = window.__inviati.filter((m) => m.type === 'defaults_update').pop();
    return u && u.config && u.config.modelRegistry && u.config.modelRegistry.normale
      ? (u.config.modelRegistry.normale.sort || '') : null;
  }), { timeout: 8_000 }).toBe('latency');

  // …e si toglie a chi ce l'aveva: ciò che si aggiunge si deve poter togliere.
  await righe.nth(0).locator('.sn-model-sort').selectOption('auto');
  await page.locator('#save').click();
  await expect.poll(async () => page.evaluate(() => {
    const u = window.__inviati.filter((m) => m.type === 'defaults_update').pop();
    const v = u && u.config && u.config.modelRegistry && u.config.modelRegistry.veloce;
    return v ? (v.sort || '(nessuno)') : null;
  }), { timeout: 8_000 }).toBe('(nessuno)');
});

test('Modelli predefiniti: la scelta si vede anche col tema scuro', async ({ openTab, app }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' });
  });
  const page = await apriEditor(openTab);
  const sel = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head) .sn-model-sort').first();
  await expect(sel).toBeVisible();

  const riquadro = await sel.boundingBox();
  expect(riquadro, 'la scelta dell\'ordinamento non ha una sua area sullo schermo').toBeTruthy();
  expect(riquadro.width, 'la scelta dell\'ordinamento è troppo stretta per leggerne le voci').toBeGreaterThan(60);

  // Non deve finire fuori dalla riga né sovrapporsi al controllo accanto.
  const reason = await page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head) .sn-model-reason').first().boundingBox();
  expect(riquadro.x, 'la scelta dell\'ordinamento si sovrappone al livello di ragionamento')
    .toBeGreaterThanOrEqual(reason.x + reason.width - 1);

  await page.screenshot({ path: 'tests/.shots/ordine-host-modelli-predefiniti-scuro.png', fullPage: true }).catch(() => {});
});
