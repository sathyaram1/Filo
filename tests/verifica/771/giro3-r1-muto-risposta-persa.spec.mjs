// Verifica #771 giro 3: senza fornitore, una richiesta doppia («che tempo fa… e apri netflix dagli USA»)
// col giro finale muto non deve perdere dalla risposta la parte che Filo ha fatto davvero.

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

async function copione(app, turni) {
  await app.evaluate(async (_e, turni) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      const t = turni[Math.min(i++, turni.length - 1)];
      return {
        text: t.text, toolCalls: t.toolCalls || [], reasoningDetails: [],
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        finishReason: t.toolCalls ? 'tool_calls' : 'stop',
      };
    };
  }, turni);
}

test('richiesta doppia, giro finale muto: la risposta all\'altra metà resta nella bolla accanto al «non si può»', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  // Risposta e instradamento nello stesso giro, poi muto.
  await copione(app, [
    { text: 'SOLE_A_ROMA: a Roma oggi c\'è il sole, 24 gradi. Ti apro Netflix dagli Stati Uniti.', toolCalls: [{ id: 'p1', name: 'PROXY_TAB', arguments: '{"country":"us"}' }] },
    { text: '' },
  ]);
  await page.locator('#input').fill('che tempo fa a Roma? e apri netflix dagli USA');
  await page.locator('#sendBtn').click();
  const ultima = page.locator('.dash-bubble-filo').last();
  await expect(page.locator('.dash-bubble-filo', { hasText: /non si può/ })).toHaveCount(1, { timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/771-g3-doppia-stesso-giro.png' }).catch(() => {});
  await expect(ultima).toContainText('SOLE_A_ROMA');

  // Risposta scritta in un giro prima, rifiuto in un giro senza testo, poi muto.
  const meteo = testServer.html('<title>Meteo</title><p>sole</p>');
  await copione(app, [
    { text: 'PIOGGIA_A_PARIGI: a Parigi piove, 14 gradi.', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: meteo, etichetta: 'Meteo' }) }] },
    { text: '', toolCalls: [{ id: 'p2', name: 'PROXY_TAB', arguments: '{"country":"fr"}' }] },
    { text: '' },
  ]);
  await page.locator('#input').fill('che tempo fa a Parigi? poi apri la scheda dalla Francia');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: /non si può/ })).toHaveCount(2, { timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/771-g3-doppia-giro-prima.png' }).catch(() => {});
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('PIOGGIA_A_PARIGI');
});
