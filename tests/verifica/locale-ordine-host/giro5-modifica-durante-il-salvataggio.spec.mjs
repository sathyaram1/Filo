// Stessa famiglia dei giri 2, 3 e 4: quello che è sullo schermo e quello che è
// partito agli utenti non sono la stessa cosa. Qui la finestra è il salvataggio
// in corso: il criterio scelto mentre il salvataggio viaggia sparisce quando la
// risposta arriva, e la pagina annuncia comunque «Salvato e propagato».

import { test, expect } from '../../fixtures/electron.mjs';

const MODELLI_PREDEFINITI = 'filo://admin-defaults/admin-defaults.html';
const ATTESA_SALVATAGGIO = 1200;

async function apriEditor(openTab) {
  const page = await openTab(MODELLI_PREDEFINITI);
  await page.addInitScript((msAttesa) => {
    const config = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: {
        primo: { provider: 'openrouter', model: 'vendor/uno' },
        secondo: { provider: 'openrouter', model: 'vendor/due' },
      },
      models: {},
      excludedProviders: [],
      providerSort: '',
    };
    window.chrome = window.chrome || {};
    const attacca = () => {
      if (!window.chrome || !window.chrome.runtime) { setTimeout(attacca, 5); return; }
      const vero = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
      window.chrome.runtime.sendMessage = async (msg) => {
        switch (msg.type) {
          case 'defaults_get': return { ok: true, config };
          case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
          case 'defaults_update': {
            // Il salvataggio vero è un giro di rete: qui dura altrettanto.
            await new Promise((r) => setTimeout(r, msAttesa));
            config.modelRegistry = msg.config.modelRegistry;
            config.providerSort = msg.config.providerSort || '';
            return { ok: true, config };
          }
          default: return vero(msg);
        }
      };
    };
    attacca();
  }, ATTESA_SALVATAGGIO);
  await page.reload();
  await page.waitForSelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)', { timeout: 15_000 });
  return page;
}

const stato = (page) => page.evaluate(() => (document.getElementById('saveStatus').textContent || '').trim());
const righe = (page) => page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');

test('il criterio scelto mentre il salvataggio è in corso non si perde', async ({ openTab }) => {
  test.fail(true, 'rilievo aperto del giro 5: la scelta fatta durante il salvataggio torna indietro da sola');
  const page = await apriEditor(openTab);
  await righe(page).nth(0).locator('.sn-model-sort').selectOption('latency');

  // Salva senza aspettare la risposta, come chi continua a sistemare le righe.
  await page.click('#saveBtn');
  await page.waitForTimeout(200);
  await righe(page).nth(1).locator('.sn-model-sort').selectOption('price');

  await expect.poll(() => stato(page), { timeout: 10_000 }).not.toMatch(/in corso|Salvataggio/i);
  await page.waitForTimeout(300);

  const scelto = await righe(page).nth(1).locator('.sn-model-sort').inputValue();
  const testo = await stato(page);
  expect(scelto,
    `il criterio scelto durante il salvataggio è tornato indietro da solo, e la pagina dice «${testo}»`)
    .toBe('price');
});

test('la scelta generale cambiata mentre il salvataggio è in corso non si perde', async ({ openTab }) => {
  test.fail(true, 'rilievo aperto del giro 5: la scelta fatta durante il salvataggio torna indietro da sola');
  const page = await apriEditor(openTab);
  await righe(page).nth(0).locator('.sn-model-sort').selectOption('latency');

  await page.click('#saveBtn');
  await page.waitForTimeout(200);
  await page.selectOption('#providerSort', 'throughput');

  await expect.poll(() => stato(page), { timeout: 10_000 }).not.toMatch(/in corso|Salvataggio/i);
  await page.waitForTimeout(300);

  const scelto = await page.locator('#providerSort').inputValue();
  const testo = await stato(page);
  expect(scelto,
    `la scelta generale fatta durante il salvataggio è tornata indietro da sola, e la pagina dice «${testo}»`)
    .toBe('throughput');
});
