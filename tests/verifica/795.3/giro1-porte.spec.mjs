// #795.3 giro 1 — «portami alla home» dalla home: la risposta scritta insieme al comando (il caso dei modelli veri),
// e la stessa richiesta ripetuta di seguito. La pagina non si ricarica e la bolla non dice di aver portato l'utente altrove.
import { test, expect } from '../../fixtures/electron.mjs';

async function home(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function fornitore(app, giri) {
  await app.evaluate(async (_electron, g) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__v795_calls = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__v795_calls.push(JSON.parse(JSON.stringify(messages)));
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, giri);
}

test('la frase scritta insieme al comando non diventa la risposta: il modello legge che è già nella home', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await expect(page.locator('#input')).toBeVisible();
  await fornitore(app, [
    { text: 'Ti porto alla home.', toolCalls: [{ id: 'h1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
    { text: 'Sei già nella home.' },
  ]);
  await page.evaluate(() => { window.__vivo = 1; });
  await page.locator('#input').fill('portami alla hoem');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già nella home.' })).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => window.__vivo)).toBe(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ti porto alla home' })).toHaveCount(0);
  await expect(page.locator('.dash-bubble-user', { hasText: 'portami alla hoem' })).toHaveCount(1);
  expect(await app.evaluate(() => globalThis.__v795_calls.length)).toBe(2);
  await page.screenshot({ path: 'tests/.shots/v795-home-frase-insieme.png' });
});

test('la stessa richiesta due volte di seguito: niente ricarica, due scambi da leggere', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await expect(page.locator('#input')).toBeVisible();
  await fornitore(app, [
    { toolCalls: [{ id: 'h1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
    { text: 'Sei già qui, nella home.' },
    { toolCalls: [{ id: 'h2', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
    { text: 'Ancora qui, nella home.' },
  ]);
  await page.evaluate(() => { window.__vivo = 2; });
  await page.locator('#input').fill('portami alla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });
  await page.locator('#input').fill('ho detto portami alla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ancora qui' })).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => window.__vivo)).toBe(2);
  await expect(page.locator('.dash-bubble-user', { hasText: 'portami alla home' })).toHaveCount(2);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/v795-home-due-volte.png' });
});
