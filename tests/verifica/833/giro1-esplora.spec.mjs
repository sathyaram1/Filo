// #833, giro 1: l'avviso «pesi aperti» della pagina Modelli predefiniti segue ogni strada con cui l'owner cambia
// la configurazione (catena scritta a mano, registro, fornitore), e si vede da dove si lavora.
import { test, expect } from '../../fixtures/electron.mjs';

const ADMIN_URL = 'filo://admin-defaults/admin-defaults.html';

async function apri(openTab, over) {
  const page = await openTab(ADMIN_URL);
  await page.addInitScript((o) => {
    const cfg = {
      apiKeysPresent: { openrouter: true }, safeBrowsingKeyPresent: false,
      excludedProviders: [], ...o,
    };
    window.__sent = [];
    const stub = async (msg) => {
      window.__sent.push(msg);
      switch (msg.type) {
        case 'defaults_get': return { ok: true, config: cfg };
        case 'default_models_list':
          return { ok: true, provider: 'openrouter', items: [
            { id: 'deepseek/deepseek-v4-pro', label: 'Testo' },
            { id: 'openai/gpt-5.2', label: 'Testo' },
          ] };
        case 'default_providers_list': return { ok: true, items: [] };
        case 'audio_host_check': return { ok: true, verdict: 'ok' };
        default: return { ok: true };
      }
    };
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  }, over);
  await page.reload();
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  return page;
}

const CFG = {
  modelRegistry: {
    chiuso: { provider: 'openrouter', model: 'openai/gpt-5.2' },
    aperto: { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' },
    claude: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' },
    deepseek: { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' },
  },
  models: { explain: 'chiuso', filo_chat: 'claude', translate_selection: 'aperto' },
};

const cellaDi = (page, action) => page.evaluate((a) => window.SN_MODEL_CHAIN.actionLabels().findIndex(([x]) => x === a), action)
  .then((i) => page.locator('#modelsGrid > div').nth(i));
const ferme = (page) => page.locator('#openWeightsImpact .sn-ow-stop');
const rigaReg = async (page, nick) => {
  const righe = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
  const i = await righe.evaluateAll((els, n) => els.findIndex((r) => r.querySelector('.sn-model-nick').value === n), nick);
  return righe.nth(i);
};

test('catena scritta a mano e confermata con Tab: l\'avviso la segue', async ({ openTab }) => {
  const page = await apri(openTab, CFG);
  const spiega = await page.evaluate(() => window.SN_I18N.t('options_action_explain'));
  await expect(ferme(page)).toContainText(spiega);
  const cella = await cellaDi(page, 'explain');
  const campo = cella.locator('.sn-chain-input').first();
  await campo.click();
  await campo.fill('aperto');
  await page.keyboard.press('Tab');
  await expect(ferme(page)).toHaveCount(0);
});

test('nel registro il modello di «chiuso» diventa aperto scelto dal catalogo: la funzione esce dalle ferme', async ({ openTab }) => {
  const page = await apri(openTab, CFG);
  const spiega = await page.evaluate(() => window.SN_I18N.t('options_action_explain'));
  await expect(ferme(page)).toContainText(spiega);
  const riga = await rigaReg(page, 'chiuso');
  const id = riga.locator('.sn-model-id');
  await id.click();
  await id.fill('');
  await riga.locator('.sn-select-option', { hasText: 'deepseek/deepseek-v4-pro' }).first().click();
  await expect(id).toHaveValue('deepseek/deepseek-v4-pro');
  await page.locator('#h-models').click();
  await expect(ferme(page)).toHaveCount(0);
});

test('nel registro il modello di «chiuso» diventa aperto scritto a mano: la funzione esce dalle ferme', async ({ openTab }) => {
  const page = await apri(openTab, CFG);
  const riga = await rigaReg(page, 'chiuso');
  const id = riga.locator('.sn-model-id');
  await id.fill('deepseek/deepseek-v4-pro');
  await page.locator('#h-models').click();
  await expect(ferme(page)).toHaveCount(0);
});

test('rinominato il sostituto nel registro, la chat che contava su di lui si ferma', async ({ openTab }) => {
  const page = await apri(openTab, CFG);
  const chat = await page.evaluate(() => window.SN_I18N.t('options_action_filo_chat'));
  const riga = await rigaReg(page, 'deepseek');
  await riga.locator('.sn-model-nick').fill('deepseek2');
  await page.locator('#h-models').click();
  await expect(ferme(page)).toContainText(chat);
});

test('tolto il secondo anello aperto dalla catena, la funzione torna fra le ferme', async ({ openTab }) => {
  const page = await apri(openTab, { ...CFG, models: { ...CFG.models, explain: 'chiuso, aperto' } });
  const spiega = await page.evaluate(() => window.SN_I18N.t('options_action_explain'));
  await expect(ferme(page)).toHaveCount(0);
  const cella = await cellaDi(page, 'explain');
  const segs = cella.locator('.sn-chain-seg');
  await segs.nth(1).hover();
  const x = segs.nth(1).locator('button, .sn-chain-del, .sn-chain-remove').first();
  await x.click();
  await expect(cella.locator('.sn-chain-input')).toHaveCount(1);
  await expect(ferme(page)).toContainText(spiega);
});
