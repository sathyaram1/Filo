// Verifica indipendente (giro 5) — parte E: sguardo visivo al blocco di attività.
import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

async function newtabPage(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('blocco di attività leggibile, tema chiaro e scuro', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const s = [
      { text: 'Cerco il meteo…', reasoning: 'Prima cerco, poi metto la sveglia.',
        toolCalls: [{ id: 'v1', name: 'CERCA_WEB', arguments: { query: 'meteo Roma domani' } }] },
      { text: 'Ora la sveglia e il colore…',
        toolCalls: [
          { id: 'v2', name: 'SVEGLIA', arguments: { time: '07:00', label: 'mattina' } },
          { id: 'v3', name: 'IMPOSTA_ESTETICA', arguments: { token: 'accent', valore: '#c2571a' } },
          { id: 'v4', name: 'SALVA_APPUNTO', arguments: { testo: 'domani sereno', contesto: 'meteo' } },
        ] },
      { text: 'Domani a Roma sereno: sveglia alle 7 e accento arancio.' },
    ];
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onToolCall, onDelta, onReasoning }) => {
      const step = s[Math.min(i, s.length - 1)];
      i += 1;
      if (step.reasoning) { try { onReasoning && onReasoning(step.reasoning); } catch (_) {} }
      const calls = (step.toolCalls || []).map((c) => ({ ...c, arguments: JSON.stringify(c.arguments || {}) }));
      if (step.text) { try { onDelta && onDelta(step.text); } catch (_) {} }
      for (const c of calls) { try { onToolCall && onToolCall(c); } catch (_) {} }
      return { text: step.text || '', toolCalls: calls, reasoningDetails: [], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });

  await page.locator('#input').fill('meteo di domani, sveglia alle 7, accento arancio e segnalo');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('accento arancio', { timeout: 40_000 });

  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/zz-v5-chiaro-chiuso.png' });
  await page.locator('.dash-activity-head').last().click();
  await expect(page.locator('.dash-activity-body').last()).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/zz-v5-chiaro-aperto.png' });

  // Tema scuro applicato dal vivo, come quando lo si chiede a Filo.
  await page.evaluate(() => window.SN_PAGE_BOOTSTRAP.applyTheme && window.SN_PAGE_BOOTSTRAP.applyTheme('dark'));
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.screenshot({ path: 'tests/.shots/zz-v5-scuro-aperto.png' });
});
