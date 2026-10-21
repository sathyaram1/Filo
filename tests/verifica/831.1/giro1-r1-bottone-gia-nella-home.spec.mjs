// #831.1 giro 1 — chiesta la home dalla home, il bottone sotto la risposta non deve promettere un ritorno alla home:
// l'utente è già lì, e premendolo resta tutto com'è (la home è la coda del filo). Promettere un movimento che non
// avviene è proprio ciò che ha fatto credere a un guasto chi ha segnalato.

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
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__v831_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
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

test('r1 chiesta la home dalla home, il bottone sotto la risposta non promette di tornarci', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, [
    { toolCalls: [{ id: 'v1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
    { text: 'Sei già qui, nella home.' },
  ]);

  await page.locator('#input').fill('portami alla home');
  await page.locator('#sendBtn').click();
  const risposta = page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' });
  await expect(risposta).toBeVisible({ timeout: 10_000 });

  const bottone = risposta.locator('.dash-action-btn');
  await expect(bottone).toHaveCount(1);
  await expect(bottone).not.toContainText(/torna alla home/i);

  await app.evaluate(() => { try { globalThis.__v831_restore?.(); } catch (_) {} });
});
