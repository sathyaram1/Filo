// Spec Playwright per la schermata "Modelli di supporto" (tab della pagina
// gestione), sezione giudici resa analoga a "Modelli predefiniti".
//
// Assert di COMPORTAMENTO (fallirebbero senza la feature):
//   - la chiave dedicata dei giudici mostra "configurata/non configurata";
//   - il registro modelli dei giudici (nickname → modello OpenRouter) si popola
//     dai dati e i suoi nickname finiscono nella <datalist id="nicknames-list">
//     che alimenta i selettori per-giudice;
//   - al salvataggio il messaggio verso il main porta judgeRegistry + la chiave
//     digitata, e il campo chiave viene svuotato dopo il salvataggio.
//
// Il canale verso il main è stubbato in pagina (window.filo.message): niente
// Firestore né admin reale, si verifica la UI e il payload che invierebbe.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

// Installa uno stub del canale main che risponde a support_models_get/update e
// registra l'ultimo update ricevuto su window.__lastUpdate.
async function stubChannel(page, getPayload) {
  await page.evaluate((models) => {
    window.__lastUpdate = null;
    window.filo = window.filo || {};
    window.filo.message = async (msg) => {
      if (msg.type === 'support_models_get') return { ok: true, models };
      if (msg.type === 'support_models_update') {
        window.__lastUpdate = msg;
        // Eco: rispecchia il registro inviato + segna la chiave come presente.
        return {
          ok: true,
          models: Object.assign({}, models, {
            judgeRegistry: msg.judgeRegistry || {},
            openrouterKeyPresent: !!(msg.openrouterKey && msg.openrouterKey.length),
          }),
        };
      }
      return { ok: true };
    };
  }, getPayload);
}

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
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.loadSupportModels);

  await stubChannel(page, FAKE_MODELS);
  await page.evaluate(() => window.__mgTest.loadSupportModels());

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

test('salvataggio: il payload porta judgeRegistry + chiave, e il campo chiave si svuota', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.loadSupportModels);

  await stubChannel(page, FAKE_MODELS);
  await page.evaluate(() => window.__mgTest.loadSupportModels());
  await expect(page.locator('#mgSmEditor')).toBeVisible();

  // L'owner digita una nuova chiave e aggiunge un modello al registro.
  await page.fill('#mgSmKeyOpenrouter', 'sk-or-v1-nuova');
  await page.click('#mgSmRegistryAdd');
  const rows = page.locator('#mgSmRegistryList .sn-model-row:not(.sn-model-row-head)');
  await rows.last().locator('.sn-model-nick').fill('giudice-forte');
  await rows.last().locator('.sn-model-id').fill('anthropic/claude-haiku-4-5');

  await page.click('#mgSmSaveBtn');
  await page.waitForFunction(() => window.__lastUpdate !== null);

  const upd = await page.evaluate(() => window.__lastUpdate);
  expect(upd.openrouterKey).toBe('sk-or-v1-nuova');
  expect(upd.judgeRegistry['giudice-veloce'].model).toBe('deepseek/deepseek-v4-pro');
  expect(upd.judgeRegistry['giudice-forte']).toEqual({ provider: 'openrouter', model: 'anthropic/claude-haiku-4-5' });

  // Dopo il salvataggio il campo chiave è svuotato (non si ritiene in pagina).
  await expect(page.locator('#mgSmKeyOpenrouter')).toHaveValue('');
  // E lo stato resta "configurata".
  await expect(page.locator('#mgSmKeyOpenrouterState')).toHaveText('(configurata)');
});
