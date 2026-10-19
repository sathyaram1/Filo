// #829 giro 2 — Anthropic che non risponde, dal punto di vista di chi usa la chat, il ripiego e il «Prova».

import { test, expect } from '../../fixtures/electron.mjs';

const CLAUDE = 'anthropic/claude-haiku-4.5';
const MOTIVO = 'lo serve solo Anthropic, e adesso non risponde';

async function preparaRouter(app, modelli, guasto) {
  await app.evaluate(async (_e, { CLAUDE, modelli, guasto }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, 'claude-x': { provider: 'openrouter', model: CLAUDE } },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: modelli, [C.ACTIONS.EXPLAIN]: modelli },
    });
    globalThis.SN_PROVIDER_OPENROUTER.forgetModelHosts();
    globalThis.__corpi = [];
    globalThis.__guasto = guasto;
    if (globalThis.__fetchVero) return;
    globalThis.__fetchVero = globalThis.fetch;
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'retry-after': '0' } });
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) {
        const endpoints = u.includes('/models/anthropic/')
          ? [{ provider_name: 'Anthropic', tag: 'anthropic', supported_parameters: ['tools', 'reasoning', 'max_tokens'] }, { provider_name: 'Amazon Bedrock', tag: 'amazon-bedrock', supported_parameters: ['tools', 'reasoning', 'max_tokens'] }]
          : [{ provider_name: 'DeepInfra', tag: 'deepinfra', supported_parameters: ['tools', 'reasoning', 'max_tokens'] }];
        return json({ data: { endpoints } });
      }
      if (!u.includes('openrouter.ai/api/v1/chat/completions')) return globalThis.__fetchVero(url, init);
      const body = JSON.parse(init.body);
      globalThis.__corpi.push({ model: body.model, provider: body.provider || null, stream: !!body.stream });
      const g = globalThis.__guasto;
      if (body.model.startsWith('anthropic/')) {
        if (g === 'flusso' && body.stream) {
          const sse = `data: ${JSON.stringify({ provider: 'Anthropic', error: { code: 502, message: 'Provider returned error' }, choices: [{ delta: { content: '' }, finish_reason: 'error' }] })}\n\ndata: [DONE]\n\n`;
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        if (typeof g === 'number') return json({ error: { code: g, message: 'Provider returned error', metadata: { provider_name: 'Anthropic' } } }, g);
      }
      if (body.stream) {
        const sse = `data: ${JSON.stringify({ provider: 'DeepInfra', choices: [{ delta: { content: 'Ecco fatto.' } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return json({ provider: 'DeepInfra', choices: [{ message: { content: 'Ecco fatto.' } }], usage: {} });
    };
  }, { CLAUDE, modelli, guasto });
}

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

for (const guasto of [503, 529, 'flusso']) {
  test(`chat della home, Anthropic giù (${guasto}): la bolla lo dice e porta alle Opzioni`, async ({ app, shell }) => {
    test.setTimeout(60_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await expect(page.locator('#input')).toBeVisible();
    await preparaRouter(app, 'claude-x', guasto);
    await page.locator('#input').fill('che tempo fa domani a Roma?');
    await page.locator('#sendBtn').click();
    const bolla = page.locator('.dash-bubble-filo', { hasText: MOTIVO });
    await expect(bolla).toBeVisible({ timeout: 20_000 });
    await expect(bolla).toContainText('Home — chat con Filo');
    await expect(bolla.getByRole('button', { name: 'Apri Opzioni' })).toBeVisible();
    const corpi = await app.evaluate(() => globalThis.__corpi);
    expect(corpi.every((b) => b.model === 'anthropic/claude-haiku-4.5' && JSON.stringify(b.provider.only) === '["anthropic","claude-on-aws"]')).toBe(true);
    await page.screenshot({ path: `tests/.shots/829-chat-${guasto}.png` });
  });
}

test('chat della home con un secondo modello: Anthropic giù, risponde il secondo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaRouter(app, 'claude-x, deepseek-flash', 503);
  await page.locator('#input').fill('dimmi una curiosità');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco fatto.' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: MOTIVO })).toHaveCount(0);
  const modelli = await app.evaluate(() => globalThis.__corpi.map((b) => b.model));
  expect(modelli[0]).toBe(CLAUDE);
  expect(modelli[modelli.length - 1]).not.toBe(CLAUDE);
});

test('«Prova» di una riga Claude con Anthropic giù: lo stesso vincolo e lo stesso motivo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await preparaRouter(app, 'claude-x', 503);
  const page = await openTab('filo://options/options.html');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 8_000 });
  await page.waitForFunction((id) => [...document.querySelectorAll('#modelRegistryList .sn-model-id')].some((i) => i.value === id), CLAUDE, { timeout: 8_000 });
  await page.evaluate((id) => {
    const input = [...document.querySelectorAll('#modelRegistryList .sn-model-id')].find((i) => i.value === id);
    input.closest('.sn-model-row').dataset.provaClaude = '1';
  }, CLAUDE);
  const riga = page.locator('#modelRegistryList .sn-model-row[data-prova-claude="1"]');
  await riga.locator('.sn-model-test').click();
  const stato = riga.locator('.sn-model-row-status');
  await expect(stato).toContainText(MOTIVO, { timeout: 20_000 });
  const corpi = await app.evaluate(() => globalThis.__corpi);
  expect(corpi.length).toBeGreaterThan(0);
  expect(corpi.every((b) => JSON.stringify(b.provider.only) === '["anthropic","claude-on-aws"]')).toBe(true);
  await riga.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/829-prova.png' });
});
