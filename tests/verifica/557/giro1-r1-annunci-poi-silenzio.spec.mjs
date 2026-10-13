// Verifica #557 giro 1, rilievo 1: un turno di sole letture annunciate, poi muto, deve dire che si è fermato.

import { test, expect } from '../../fixtures/electron.mjs';

async function home(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab') && !x.url().includes('incognito'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

async function configura(app, extra = {}) {
  await app.evaluate(async (_e, ex) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
      ...ex,
    });
  }, extra);
}

// `giri`: un elemento per chiamata al modello; l'ultimo si ripete.
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    const origWS = globalThis.SN_WEB_SEARCH;
    globalThis.__v557_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; globalThis.SN_WEB_SEARCH = origWS; };
    globalThis.SN_WEB_SEARCH = { search: async ({ query }) => ({ provider: 'finto', results: [{ title: `Risultato ${query}`, url: 'https://example.com/', snippet: 'testo' }] }) };
    globalThis.__v557_n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(globalThis.__v557_n, g.length - 1)];
      globalThis.__v557_n += 1;
      const calls = (giro.toolCalls || []).map((c, i) => ({ ...c, id: `${c.id || 'x'}${globalThis.__v557_n}_${i}` }));
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const ripristina = (app) => app.evaluate(() => { try { globalThis.__v557_restore?.(); } catch (_) {} });

async function scrivi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('r1 ricerche annunciate e poi silenzio: la bolla dice che si è fermato e offre Continua', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await configura(app);
  const cerca = (n) => ({ text: `Cerco ancora gli orari (${n})…`, toolCalls: [{ id: 'w', name: 'CERCA_WEB', arguments: JSON.stringify({ query: `orari treni ${n}` }) }] });
  await modelloFinto(app, [cerca(1), cerca(2), cerca(3), { text: '' }]);
  await scrivi(page, 'a che ora parte il treno?');
  await expect(page.locator('.dash-activity[data-phase="done"]')).toHaveCount(1, { timeout: 30_000 });
  await page.screenshot({ path: 'tests/.shots/v557-annunci-poi-silenzio.png' });
  // L'ultima frase di lavoro («Cerco ancora…») non è una risposta: l'utente deve sapere che Filo si è fermato.
  await expect(page.locator('.dash-continua')).toHaveCount(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'senza arrivare a una risposta' })).toHaveCount(1);
  await ripristina(app);
});

