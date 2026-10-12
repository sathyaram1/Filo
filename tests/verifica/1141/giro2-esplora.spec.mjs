// #1141 giro 2: esplorazione. Nelle Opzioni l'avviso di voce segue il modello della riga del registro
// quando lo si cambia sotto lo stesso nome, e due modelli in catena danno l'avviso di quello che non parte.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

async function prepara(app, tts) {
  await app.evaluate(async (_e, tts) => {
    const A = globalThis.SN_CONST.ACTIONS;
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: {
        ...T.registry,
        'voce-mista': { label: 'Voce mista', provider: 'openrouter', model: 'acme/voce-mista', inputs: ['text'], outputs: ['audio'] },
      },
      models: { ...T.models, [A.TTS]: tts },
    });
    const OR = globalThis.SN_PROVIDER_OPENROUTER;
    OR.forgetModelHosts();
    const HOSTS = {
      'hexgrad/kokoro-82m': [{ provider_name: 'DeepInfra', tag: 'deepinfra/fp16' }],
      'acme/voce-mista': [{ provider_name: 'DeepInfra', tag: 'deepinfra' }, { provider_name: 'OpenAI', tag: 'openai' }],
      'acme/voce-buona': [{ provider_name: 'Together', tag: 'together' }],
    };
    if (!globalThis.__fetchVero) globalThis.__fetchVero = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input && input.url ? input.url : input);
      const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
      if (url.startsWith(`${OR.MODELS_ENDPOINT}/`) && url.endsWith('/endpoints')) {
        const model = decodeURIComponent(url.slice(OR.MODELS_ENDPOINT.length + 1, -'/endpoints'.length));
        return HOSTS[model] ? json({ data: { id: model, endpoints: HOSTS[model] } }) : json({ error: 'nf' }, 404);
      }
      return globalThis.__fetchVero(input, init);
    };
  }, tts);
}

test('Opzioni: cambiato il modello della riga del registro, l\'avviso di voce lo segue; in catena avvisa solo per quello che non parte', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app, 'voce-mista, kokoro');
  const p = await openTab('filo://options/options.html');
  await expect(p.locator('#modelsGrid .sn-chain input').first()).toBeVisible({ timeout: 8000 });
  const idx = await p.evaluate(() => window.SN_MODEL_CHAIN.actionLabels().findIndex(([x]) => x === 'tts'));
  const cella = p.locator('#modelsGrid > div').nth(idx);
  const avviso = cella.locator('.sn-chain-warn');
  await expect(avviso).toHaveText('Con «Voce mista» la lettura ad alta voce non parte: lo serve anche OpenAI, che Filo esclude.', { timeout: 8000 });
  mkdirSync('tests/.shots', { recursive: true });
  await p.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await cella.screenshot({ path: 'tests/.shots/v1141-cella-scura.png' });
  await p.evaluate(() => { document.documentElement.dataset.snTheme = 'light'; });
  await cella.screenshot({ path: 'tests/.shots/v1141-cella-chiara.png' });
  await p.evaluate(() => { delete document.documentElement.dataset.snTheme; });

  // La riga «voce-mista» del registro passa a un modello servito solo da ammessi.
  const riga = p.locator('.sn-model-row').filter({ has: p.locator('input[value="voce-mista"]') }).first();
  const id = riga.locator('input.sn-model-id');
  await id.fill('acme/voce-buona');
  await id.dispatchEvent('input');
  await id.dispatchEvent('change');
  await id.blur();
  await expect.poll(async () => (await app.evaluate(() => globalThis.SN_STORAGE.getSettings())).modelRegistry['voce-mista'].model, { timeout: 10_000 })
    .toBe('acme/voce-buona');
  await expect(avviso).toBeHidden({ timeout: 10_000 });
  await app.evaluate(() => { if (globalThis.__fetchVero) globalThis.fetch = globalThis.__fetchVero; });
});
