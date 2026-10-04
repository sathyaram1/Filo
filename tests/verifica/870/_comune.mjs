// Attrezzi condivisi dalle prove dei giri di #870.
import { expect } from '../../fixtures/electron.mjs';

export async function homeTab(app, escludi = []) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith('filo://newtab') && !escludi.includes(x); } catch (_) { return false; } });
    if (w) {
      await w.waitForLoadState('domcontentloaded');
      await expect(w.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
      return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

export const finestre = (app, pre) => app.windows().filter((x) => { try { return x.url().startsWith(pre); } catch (_) { return false; } });

// `ritardoMs`: quanto ci mette il modello finto a rispondere (un lavoro lungo).
export async function modelloFinto(app, risposte, ritardoMs = 0) {
  await app.evaluate(async (_e, { risp, ritardo }) => {
    const C = globalThis.SN_CONST;
    await chrome.storage.local.set({ filo_onboarding: { done: true } });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const r = risp[Math.min(globalThis.__giro++, risp.length - 1)];
      if (ritardo) await new Promise((ok) => setTimeout(ok, ritardo));
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (r.testo) { try { onDelta && onDelta(r.testo); } catch (_) {} }
      return { ...base, text: r.testo || '', toolCalls: r.strumenti || [], finishReason: r.strumenti ? 'tool_calls' : 'stop' };
    };
  }, { risp: risposte, ritardo: ritardoMs });
}
