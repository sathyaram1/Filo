// La chat della home con un modello finto che risponde coi giri dati (tool call, testo, ritardo), senza rete.
// Nessuna chiamata vera al fornitore: `ripristina` rimette quello vero.
import { expect } from '@playwright/test';

export async function home(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) {
      await win.waitForLoadState('domcontentloaded');
      await expect(win.locator('#input')).toBeVisible({ timeout: 8000 });
      return win;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

export async function modelloFinto(app, giri) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async (_electron, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__chatFinta_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__chatFinta_calls = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__chatFinta_calls.push(JSON.parse(JSON.stringify(messages)));
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      // Il secondo giro di un modello vero arriva dopo qualche secondo: qui lo si dice col ritardo.
      if (giro.ritardoMs) await new Promise((r) => setTimeout(r, giro.ritardoMs));
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

export const chiamateAlModello = (app) => app.evaluate(() => globalThis.__chatFinta_calls || []);
export const ripristina = (app) => app.evaluate(() => { try { globalThis.__chatFinta_restore?.(); } catch (_) {} });

export async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}
