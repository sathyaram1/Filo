// Stessa famiglia dei giri 2, 3 e 4: la conferma della pagina dei modelli
// predefiniti parla di uno stato che non è quello sullo schermo. Qui la porta
// è il salvataggio stesso: una riga senza soprannome, o con un soprannome già
// usato, viene buttata via mentre la pagina annuncia «Salvato e propagato».
// Nella pagina gemella (le Opzioni, coi modelli propri) la stessa riga viene
// segnalata e non si perde in silenzio.

import { test, expect } from '../../fixtures/electron.mjs';

const MODELLI_PREDEFINITI = 'filo://admin-defaults/admin-defaults.html';

async function apriEditor(openTab) {
  const page = await openTab(MODELLI_PREDEFINITI);
  await page.addInitScript(() => {
    const config = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: { normale: { provider: 'openrouter', model: 'vendor/uno' } },
      models: {},
      excludedProviders: [],
      providerSort: '',
    };
    window.__salvataggi = [];
    window.chrome = window.chrome || {};
    const attacca = () => {
      if (!window.chrome || !window.chrome.runtime) { setTimeout(attacca, 5); return; }
      const vero = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
      window.chrome.runtime.sendMessage = async (msg) => {
        switch (msg.type) {
          case 'defaults_get': return { ok: true, config };
          case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
          case 'defaults_update': {
            // Come il server: torna la configurazione DAVVERO salvata.
            window.__salvataggi.push(msg.config);
            config.modelRegistry = msg.config.modelRegistry;
            config.providerSort = msg.config.providerSort || '';
            return { ok: true, config };
          }
          case 'test_default_model': return { ok: true, ttftMs: 42, tokensPerSec: 77.7 };
          default: return vero(msg);
        }
      };
    };
    attacca();
  });
  await page.reload();
  await page.waitForSelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)', { timeout: 15_000 });
  return page;
}

const stato = (page) => page.evaluate(() => (document.getElementById('saveStatus').textContent || '').trim());

// Scrive una riga nuova (soprannome, modello, criterio degli host) e salva.
async function aggiungiRigaESalva(page, { nick, model, sort }) {
  await page.click('#addModelRow');
  const nuova = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').last();
  if (nick) await nuova.locator('.sn-model-nick').fill(nick);
  await nuova.locator('.sn-model-id').fill(model);
  await nuova.locator('.sn-model-sort').selectOption(sort);
  await page.click('#saveBtn');
  await expect.poll(() => stato(page), { timeout: 10_000 }).not.toMatch(/in corso|Salvataggio/i);
}

async function righeSalvate(page) {
  const salvataggi = await page.evaluate(() => window.__salvataggi);
  const ultimo = salvataggi[salvataggi.length - 1] || {};
  return Object.keys(ultimo.modelRegistry || {});
}

// Segnale che la pagina ha avvisato: un messaggio d'errore nello stato, oppure
// la riga marcata come le Opzioni marcano le proprie.
async function haAvvisato(page) {
  return page.evaluate(() => {
    const s = document.getElementById('saveStatus');
    const testo = (s.textContent || '').trim();
    const errore = s.classList.contains('sn-error') || /non salvat|scartat|soprannome|duplicat/i.test(testo);
    const marcate = document.querySelectorAll('#modelRegistryList .sn-row-invalid, #modelRegistryList .sn-input-invalid').length;
    return { errore, marcate, testo };
  });
}

test('una riga senza soprannome non viene salvata, e la pagina dice «Salvato» lo stesso', async ({ openTab }) => {
  const page = await apriEditor(openTab);
  await aggiungiRigaESalva(page, { nick: '', model: 'vendor/dimenticato', sort: 'latency' });

  const salvate = await righeSalvate(page);
  const avviso = await haAvvisato(page);
  expect(salvate.length === 2 || avviso.errore || avviso.marcate > 0,
    `la riga è stata buttata via senza dirlo: salvate ${JSON.stringify(salvate)}, la pagina dice «${avviso.testo}»`)
    .toBe(true);
});

test('una riga con un soprannome già usato non viene salvata, e la pagina dice «Salvato» lo stesso', async ({ openTab }) => {
  const page = await apriEditor(openTab);
  await aggiungiRigaESalva(page, { nick: 'normale', model: 'vendor/due', sort: 'throughput' });

  const salvate = await righeSalvate(page);
  const avviso = await haAvvisato(page);
  expect(avviso.errore || avviso.marcate > 0,
    `la riga doppia è sparita senza dirlo: salvate ${JSON.stringify(salvate)}, la pagina dice «${avviso.testo}»`)
    .toBe(true);
});

// Il metro: nelle Opzioni, sui modelli propri, la stessa riga viene segnalata.
test('nelle Opzioni la stessa riga senza soprannome viene segnalata', async ({ openTab }) => {
  const page = await openTab('filo://options/options.html');
  await page.waitForSelector('#addModelRow', { timeout: 15_000 });
  await page.click('#addModelRow');
  const nuova = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').last();
  await nuova.locator('.sn-model-id').fill('vendor/senza-nome');
  await nuova.locator('.sn-model-id').dispatchEvent('change');
  await page.waitForTimeout(1500);

  const marcate = await page.evaluate(() => document.querySelectorAll(
    '#modelRegistryList .sn-row-invalid, #modelRegistryList .sn-input-invalid',
  ).length);
  expect(marcate, 'nemmeno le Opzioni segnalano la riga senza soprannome').toBeGreaterThan(0);
});
