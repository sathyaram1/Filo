// Verifica #592: pezzi comuni alle prove del giro (modello finto, chat).
import { expect } from '../../fixtures/electron.mjs';

export async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

export async function configuraModello(app, actions) {
  await app.evaluate(async (_e, acts) => {
    const C = globalThis.SN_CONST;
    const models = {};
    for (const a of acts) models[C.ACTIONS[a]] = 'deepseek-flash';
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models,
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  }, actions);
}

// Una risposta per giro; i messaggi ricevuti restano in globalThis.__v592.
export async function modelloFinto(app, giri) {
  await app.evaluate(async (_electron, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__v592_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__v592 = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__v592.push(JSON.parse(JSON.stringify(messages)));
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
export const ripristina = (app) => app.evaluate(() => { try { globalThis.__v592_restore?.(); } catch (_) {} });
export const stileSalvato = (app) => app.evaluate(() => globalThis.SN_STORAGE.getSettings().then((s) => s.agentStyle || ''));
export const chiamata = (nome, args) => ({ toolCalls: [{ id: `c-${nome}`, name: nome, arguments: JSON.stringify(args) }] });

export async function scrivi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}
export { expect };
