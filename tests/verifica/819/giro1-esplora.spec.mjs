// #819 giro 1 — esplorazione della verifica: tema scuro, soglia storta, registro d'uso vero, chat a Normale.
import { test, expect } from '../../fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';
const CHAT = 'Home — chat con Filo';
const CATALOGO = [
  { id: 'deepseek/deepseek-v4-pro', pricing: { prompt: '0.0000004', completion: '0.0000008' } },
  { id: 'deepseek/deepseek-v4-flash', pricing: { prompt: '0.00000009', completion: '0.00000018' } },
  { id: 'google/gemma-4-31b-it', pricing: { prompt: '0.0000001', completion: '0.0000003' } },
  { id: 'google/gemma-4-26b-a4b-it', pricing: { prompt: '0.00000004', completion: '0.00000012' } },
  { id: 'anthropic/claude-haiku-4.5', pricing: { prompt: '0.000001', completion: '0.000005' } },
  { id: 'anthropic/claude-opus-4.5', pricing: { prompt: '0.000005', completion: '0.000025' } },
];
const OPUS = { label: 'Claude Opus 4.5', provider: 'openrouter', model: 'anthropic/claude-opus-4.5', inputs: ['text', 'image'], outputs: ['text'] };
const HAIKU = { label: 'Claude Haiku 4.5', provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', inputs: ['text', 'image'], outputs: ['text'] };

async function listino(app, { lento = 0 } = {}) {
  await app.evaluate((_e, { catalogo, lento: ms }) => {
    const vero = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String((input && input.url) || input);
      if (/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(url)) {
        if (ms) await new Promise((r) => setTimeout(r, ms));
        const data = url.includes('output_modalities') ? [] : catalogo;
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return vero(input, init);
    };
  }, { catalogo: CATALOGO, lento });
}
async function configura(app, extra = {}) {
  await app.evaluate(async (_e, x) => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      modelRegistry: { ...T.registry, opus: x.opus, haiku: x.haiku },
      models: { ...T.models, ...(x.models || {}) },
      apiKeys: { openrouter: x.chiave || '' },
      ...(x.theme ? { theme: x.theme } : {}),
    });
  }, { opus: OPUS, haiku: HAIKU, ...extra });
}
const cellaDi = (page, nome) => page.locator('#modelsGrid > div').filter({ has: page.locator('label', { hasText: nome }) });

test('esplora: tema scuro, soglia storta, catena con due modelli cari', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await listino(app, { lento: 2500 });
  await configura(app, { models: { filo_chat: 'opus, haiku' }, theme: 'dark' });
  const page = await openTab(OPTIONS_URL);
  const chat = cellaDi(page, CHAT);
  const costo = chat.locator('.sn-chain-cost').first();
  const attesa = await costo.textContent({ timeout: 8_000 });
  console.log('durante il caricamento:', JSON.stringify(attesa), await costo.getAttribute('title'));
  await expect(costo).toHaveText('≈ 118 crediti', { timeout: 10_000 });
  const avviso = chat.locator('.sn-chain-costo');
  await expect(avviso).toBeVisible();
  console.log('avviso:', await avviso.innerText());
  await chat.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/v819-scuro.png' });
  await chat.screenshot({ path: 'tests/.shots/v819-scuro-cella.png' });
  for (const v of ['0', '-5', '', '3.5', '99999']) {
    await page.locator('#costWarnRatio').fill(v);
    await page.waitForTimeout(150);
    console.log(`soglia ${JSON.stringify(v)} → avviso visibile: ${await avviso.isVisible()}`);
  }
  await page.locator('#costWarnRatio').fill('-5');
  await page.locator('#costWarnRatio').press('Tab');
  await page.waitForTimeout(800);
  console.log('salvato con -5:', JSON.stringify((await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).costoModelli));
  console.log('campo dopo salvataggio:', await page.locator('#costWarnRatio').inputValue());
  await page.locator('#costWarnRatio').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/v819-soglia.png' });
  // Predefiniti accesi: cosa resta accanto ai modelli.
  await page.locator('#useDefaultModels').click({ force: true });
  await page.waitForTimeout(800);
  console.log('predefiniti accesi, costi:', JSON.stringify(await chat.locator('.sn-chain-cost').allTextContents()), 'avviso:', await avviso.isVisible());
  await chat.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/v819-predefiniti.png' });
});

test('esplora: dopo tre messaggi veri la stima usa i token dell\'utente', async ({ app, openTab }) => {
  await listino(app);
  await configura(app, { models: { filo_chat: 'opus' } });
  await app.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      await globalThis.SN_COSTS.unUso('filo_chat', async () => {
        await globalThis.SN_COSTS.record({ action: 'filo_chat', provider: 'openrouter', model: 'anthropic/claude-opus-4.5', usage: { promptTokens: 1500, completionTokens: 100 }, pricing: null });
        await globalThis.SN_COSTS.record({ action: 'filo_chat', provider: 'openrouter', model: 'anthropic/claude-opus-4.5', usage: { promptTokens: 500, completionTokens: 100 }, pricing: null });
      });
    }
  });
  const page = await openTab(OPTIONS_URL);
  const costo = cellaDi(page, CHAT).locator('.sn-chain-cost').first();
  // (2000 × 5 + 200 × 25) milionesimi di dollaro × 1150 crediti/dollaro = 17,25
  await expect(costo).toHaveText('≈ 17 crediti', { timeout: 8_000 });
  console.log('titolo:', await costo.getAttribute('title'));
});
