// Dopo l'OK il pulsante nella risposta di Filo dice il risultato vero (#949), come la riga del diario.
// Cancellare a parole le pagine visitate di un sito, confermato, non deve dire «Nessuna pagina visitata».

import { test, expect } from './fixtures/electron.mjs';

async function homeDi(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab') && !w.url().includes('incognito'); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

test('cancellare le pagine di un sito dalla chat: dopo l\'OK il pulsante dice quante ne ha cancellate', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry, theme: 'light',
    });
    for (const [url, titolo] of [['https://www.youtube.com/watch?v=1', 'Video uno'], ['https://m.youtube.com/watch?v=2', 'Video due']]) {
      await globalThis.SN_IL_FILO.registraVisita({ url, titolo });
    }
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__pc_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      n += 1;
      const calls = n === 1 ? [{ id: 'c1', name: 'CANCELLA_PAGINE', arguments: JSON.stringify({ sito: 'youtube.com' }) }] : [];
      const text = n === 1 ? '' : 'Ti chiedo conferma.';
      if (text) onDelta && onDelta(text);
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  });
  await chat.bringToFront();
  await chat.locator('#input').fill('cancella le pagine di youtube che ho visitato');
  await chat.locator('#sendBtn').click();
  const pulsante = chat.locator('.dash-bubble-filo .dash-action-btn').last();
  await expect(pulsante).toBeVisible({ timeout: 10_000 });
  await pulsante.click();
  await expect.poll(() => chat.evaluate(() => !!window.SN_CONFIRM_UI._test.state()), { timeout: 5_000 }).toBe(true);
  await chat.evaluate(() => window.SN_CONFIRM_UI._test.click('danger') || window.SN_CONFIRM_UI._test.click('ok'));
  await expect(pulsante).toHaveText(/^✓/, { timeout: 8_000 });
  await chat.screenshot({ path: 'tests/.shots/chat-pulsante-confermato.png' }).catch(() => {});
  const testo = await pulsante.textContent();
  expect(testo, 'le due pagine sono state cancellate: il pulsante non può dire che non ce n\'erano').not.toMatch(/Nessuna pagina/);
  expect(testo).toMatch(/2 pagine/);
  await app.evaluate(() => { try { globalThis.__pc_restore?.(); } catch (_) {} });
});
