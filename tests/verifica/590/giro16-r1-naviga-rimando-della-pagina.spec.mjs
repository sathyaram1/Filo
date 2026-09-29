// Verifica #590 giro 16, rilievo 1: NAVIGA verso un indirizzo che rimanda da sé (meta refresh,
// script) su un sito della lista. Il sito non si apre, ma la chat e il modello devono saperlo.
import { test, expect, lista } from '../../helpers/reteFinta.mjs';

async function home(app) {
  const fine = Date.now() + 10_000;
  while (Date.now() < fine) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

async function modelloFinto(app, giri) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async (_e, g) => {
    globalThis.__g16_calls = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__g16_calls.push(JSON.parse(JSON.stringify(messages)));
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

for (const [forma, corpo] of [
  ['meta refresh', (b) => `<meta http-equiv="refresh" content="0;url=${b}"><p>ti porto di là</p>`],
  ['script', (b) => `<p>ti porto di là</p><script>location.replace(${JSON.stringify(b)})</script>`],
]) {
  test(`NAVIGA verso un rimando della pagina (${forma}) sul sito della lista: la chat e il modello sanno che non si è aperto`, async ({ app, shell, rete }) => {
    test.setTimeout(60_000);
    await lista(shell, ['blocked.test']);
    const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO DELLA LISTA</h1>');
    const corto = rete.pagina('accorcia.test', '/c', corpo(bersaglio));
    const page = await home(app);
    await modelloFinto(app, [
      { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: corto, etichetta: 'corto' }) }] },
      { text: 'RISPOSTA-G16' },
    ]);
    await page.locator('#input').fill('apri quel link');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA-G16' })).toBeVisible({ timeout: 15_000 });

    const alModello = JSON.stringify((await app.evaluate(() => globalThis.__g16_calls))[1] || []);
    expect(alModello, 'al modello non deve tornare «Eseguita» per una pagina che non si è aperta').toContain('NON aperta');
    const diario = page.locator('.dash-activity');
    await diario.locator('.dash-activity-head').click();
    await expect(diario.locator('.dash-activity-row', { hasText: 'Link non aperto' })).toContainText('blocked.test');
  });
}
