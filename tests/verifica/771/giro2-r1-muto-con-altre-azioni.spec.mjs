// Verifica #771 giro 2, rilievo 1: col giro finale muto la risposta fissa dice «non ho cambiato niente» anche quando nello stesso turno Filo ha aperto una pagina.
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

test('«apri netflix dagli USA»: aperta la pagina, la risposta non dice che non è cambiato niente', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  const url = testServer.html('<title>Netflix finto</title><p id="n">catalogo</p>');
  await app.evaluate(async (_e, target) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const turni = [
      {
        text: 'Apro Netflix dagli Stati Uniti.',
        toolCalls: [
          { id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: target, etichetta: 'Netflix' }) },
          { id: 'p1', name: 'PROXY_TAB', arguments: '{"country":"us"}' },
        ],
      },
      { text: '' },
    ];
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      const t = turni[Math.min(i++, turni.length - 1)];
      return {
        text: t.text, toolCalls: t.toolCalls || [], reasoningDetails: [],
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        finishReason: t.toolCalls ? 'tool_calls' : 'stop',
      };
    };
  }, url);

  await page.locator('#input').fill('apri netflix dagli USA');
  await page.locator('#sendBtn').click();
  // La pagina è stata aperta davvero.
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 15_000 });
  const risposta = page.locator('.dash-bubble-filo', { hasText: 'da un altro paese' });
  await expect(risposta).toHaveCount(1, { timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/771-v2-muto-con-naviga.png' }).catch(() => {});
  await expect(risposta).not.toContainText('non ho cambiato niente');
});

// Stessa causa, altra porta: il «non disponibile» arriva nel primo giro, nel
// secondo il modello apre una pagina e scrive cosa ha fatto, il terzo è muto.
test('dopo il rifiuto Filo apre una pagina in un giro successivo: la risposta non dice che non è cambiato niente', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  const url = testServer.html('<title>Guida</title><p id="g">guida</p>');
  await app.evaluate(async (_e, target) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const turni = [
      { text: '', toolCalls: [{ id: 'p1', name: 'PROXY_TAB', arguments: '{"country":"fr"}' }] },
      { text: 'Da un altro paese non si può ancora: ti apro la pagina qui.', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: target, etichetta: 'Guida' }) }] },
      { text: '' },
    ];
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      const t = turni[Math.min(i++, turni.length - 1)];
      return {
        text: t.text, toolCalls: t.toolCalls || [], reasoningDetails: [],
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        finishReason: t.toolCalls ? 'tool_calls' : 'stop',
      };
    };
  }, url);

  await page.locator('#input').fill('apri questa scheda dalla Francia');
  await page.locator('#sendBtn').click();
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 15_000 });
  const risposta = page.locator('.dash-bubble-filo', { hasText: 'altro paese' });
  await expect(risposta).toHaveCount(1, { timeout: 15_000 });
  await expect(risposta).not.toContainText('non ho cambiato niente');
});
