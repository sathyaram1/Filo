// #1204.3 giro 1 — esplorazione: «portami alla home» dalla home e il bottone che chiude la conversazione.
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

const HOME = [
  { toolCalls: [{ id: 'h1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
  { text: 'Sei già qui, nella home.' },
];

test('esplora: bozza nella casella, doppio clic, ripetizione e tema scuro', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, [...HOME, { toolCalls: [{ id: 'h2', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] }, { text: 'Sei ancora qui.' }]);

  await page.locator('#input').fill('portami alla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });

  await page.locator('#input').fill('una bozza che sto scrivendo');
  const btn = page.locator('.dash-action-btn', { hasText: 'Chiudi la conversazione' });
  await btn.dblclick();
  await expect(page.locator('.dash-action-btn', { hasText: 'Conversazione chiusa' })).toBeDisabled();
  const bozza = await page.locator('#input').inputValue();
  console.log('BOZZA DOPO CHIUSURA:', JSON.stringify(bozza));
  console.log('STATO:', await page.evaluate(() => document.body.dataset.state));
  await expect(page.locator('.dash-bubble-user', { hasText: 'portami alla home' })).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/1204-chiaro.png' });

  await page.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/1204-scuro.png' });

  await page.locator('#input').fill('portami alla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei ancora qui' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-action-btn', { hasText: 'Chiudi la conversazione' })).toHaveCount(1);
  await page.locator('.dash-action-btn', { hasText: 'Chiudi la conversazione' }).click();
  await expect(page.locator('.dash-action-btn', { hasText: 'Conversazione chiusa' })).toHaveCount(2);
  await expect(page.locator('.dash-bubble-user', { hasText: 'portami alla home' })).toHaveCount(2);
  await page.screenshot({ path: 'tests/.shots/1204-due-volte.png' });
});
