// Verifica #1443: la conversazione chiusa dal bottone della home resta chiusa anche in una scheda nuova.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function configureModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function fakeProvider(app, giri) {
  await app.evaluate(async (_electron, g) => {
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [],
        finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}

const chatDi = (app, testo) => app.evaluate(async (_electron, t) => (await globalThis.SN_IL_FILO.chats())
  .filter((c) => c.messages.some((m) => m.text === t)).map((c) => c.id), testo);

test('r1 chiusa col bottone, la conversazione non si riapre nella scheda nuova', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, [
    { toolCalls: [{ id: 'f1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
    { text: 'Sei già qui, nella home.' },
    { text: 'Di niente.' },
  ]);
  await page.locator('#input').fill('portami alla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.dash-action-btn', { hasText: 'Torna alla home' }).click();
  await expect(page.locator('.dash-action-btn', { hasText: 'Conversazione chiusa' })).toBeDisabled();
  await page.waitForTimeout(800);

  const nuova = await openTab('filo://newtab/');
  await expect(nuova.locator('#input')).toBeVisible();
  await nuova.waitForTimeout(800);
  await nuova.locator('#input').fill('grazie');
  await nuova.locator('#sendBtn').click();
  await expect(nuova.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => chatDi(app, 'grazie')).toHaveLength(1);
  const [prima] = await chatDi(app, 'portami alla home');
  expect(await chatDi(app, 'grazie'), 'la scheda nuova continua la conversazione chiusa').not.toContain(prima);
});

test('r1 chiusa col bottone, la conversazione non si riapre ricaricando la home', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, [
    { toolCalls: [{ id: 'f1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
    { text: 'Sei già qui, nella home.' },
    { text: 'Di niente.' },
  ]);
  await page.locator('#input').fill('portami alla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.dash-action-btn', { hasText: 'Torna alla home' }).click();
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await page.waitForTimeout(800);
  await page.locator('#input').fill('grazie');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => chatDi(app, 'grazie')).toHaveLength(1);
  const [prima] = await chatDi(app, 'portami alla home');
  expect(await chatDi(app, 'grazie'), 'la home ricaricata continua la conversazione chiusa').not.toContain(prima);
});
