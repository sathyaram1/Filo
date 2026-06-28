// Spec Playwright per la schermata "Modelli di supporto" (tab della pagina
// gestione), sezione giudici resa analoga a "Modelli predefiniti".
//
// Assert di COMPORTAMENTO (fallirebbero senza la feature):
//   - la chiave dedicata dei giudici mostra "configurata/non configurata";
//   - il registro modelli dei giudici (nickname → modello OpenRouter) si popola
//     dai dati e i suoi nickname finiscono nella <datalist id="nicknames-list">
//     che alimenta i selettori per-giudice;
//   - il payload di salvataggio raccoglie il registro (incluse le righe aggiunte
//     a mano) e la chiave digitata.
//
// Il render dell'editor è esercitato via __mgTest.renderSupportModelsEditor:
// niente Firestore né sessione admin, si verifica la UI e la raccolta dei dati.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const FAKE_MODELS = {
  sanitizer: '',
  judge1: 'giudice-veloce',
  judge2: '',
  judge3: '',
  judgeDynamic: '',
  judgeRedTeam: '',
  judgePriority: '',
  judgeRegistry: {
    'giudice-veloce': { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' },
  },
  openrouterKeyPresent: true,
};

test('editor giudici: chiave, registro e datalist nickname si popolano dai dati', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderSupportModelsEditor);

  await page.evaluate(() => window.__mgTest.setTab("models"));

  await page.evaluate((m) => window.__mgTest.renderSupportModelsEditor(m), FAKE_MODELS);

  // Editor visibile.
  await expect(page.locator('#mgSmEditor')).toBeVisible();

  // Stato chiave: "configurata".
  await expect(page.locator('#mgSmKeyOpenrouterState')).toHaveText('(configurata)');

  // Registro: una riga col nickname e il modello attesi.
  const nick = page.locator('#mgSmRegistryList .sn-model-row:not(.sn-model-row-head) .sn-model-nick').first();
  const model = page.locator('#mgSmRegistryList .sn-model-row:not(.sn-model-row-head) .sn-model-id').first();
  await expect(nick).toHaveValue('giudice-veloce');
  await expect(model).toHaveValue('deepseek/deepseek-v4-pro');

  // Il nickname del registro giudici è tra le opzioni della datalist letta dai
  // selettori per-giudice (id 'nicknames-list', quello che SN_MODEL_CHAIN legge).
  const hasNick = await page.evaluate(() => {
    const dl = document.getElementById('nicknames-list');
    return !!dl && Array.from(dl.options).some((o) => o.value === 'giudice-veloce');
  });
  expect(hasNick).toBe(true);

  // I 7 slot per-giudice sono renderizzati (catena per ciascuno).
  const slotCount = await page.evaluate(() => document.querySelectorAll('#mgSmSlots .mg-sm-chain-host .sn-chain').length);
  expect(slotCount).toBe(7);
});

test('il registro raccoglie le righe (anche quelle aggiunte) come voci OpenRouter', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderSupportModelsEditor);

  await page.evaluate(() => window.__mgTest.setTab("models"));

  await page.evaluate((m) => window.__mgTest.renderSupportModelsEditor(m), FAKE_MODELS);
  await expect(page.locator('#mgSmEditor')).toBeVisible();

  // L'owner digita una nuova chiave e aggiunge un modello al registro.
  await page.fill('#mgSmKeyOpenrouter', 'sk-or-v1-nuova');
  await page.click('#mgSmRegistryAdd');
  const rows = page.locator('#mgSmRegistryList .sn-model-row:not(.sn-model-row-head)');
  await rows.last().locator('.sn-model-nick').fill('giudice-forte');
  await rows.last().locator('.sn-model-id').fill('anthropic/claude-haiku-4-5');

  // Il registro raccolto contiene entrambe le voci, con provider openrouter.
  const reg = await page.evaluate(() => window.__mgTest.collectJudgeRegistry());
  expect(reg['giudice-veloce']).toEqual({ provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' });
  expect(reg['giudice-forte']).toEqual({ provider: 'openrouter', model: 'anthropic/claude-haiku-4-5' });

  // Aggiungere un nickname lo rende disponibile ai selettori per-giudice.
  const hasNew = await page.evaluate(() => {
    const dl = document.getElementById('nicknames-list');
    return Array.from(dl.options).some((o) => o.value === 'giudice-forte');
  });
  expect(hasNew).toBe(true);

  // La chiave digitata è nel campo (verrà inviata dal save).
  await expect(page.locator('#mgSmKeyOpenrouter')).toHaveValue('sk-or-v1-nuova');
});
