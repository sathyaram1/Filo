// La chat della home con un modello finto che risponde coi giri dati (tool call, testo, ritardo), senza rete.
// Nessuna chiamata vera al fornitore: `ripristina` rimette quello vero.
import { expect } from '@playwright/test';
import { paginaDellaScheda } from './schede.mjs';

// Le schede che possono dare la home, nell'ordine in cui valgono: quella chiesta; la attiva, se è una home, da sola
// (anche ancora in caricamento: una home vecchia non deve passare per lei); se no la home usata più di recente.
const schedeCandidate = (app, scheda) => app.evaluate(({ BrowserWindow }, scheda) => {
  if (scheda != null) return [scheda];
  const tutte = BrowserWindow.getAllWindows().filter((w) => w._filoTabs && !w.isDestroyed());
  const w = tutte.find((x) => x.isFocused()) || tutte.find((x) => !x._filoIncognito) || tutte[0];
  if (!w) return [];
  const tm = w._filoTabs;
  const suHome = (u) => String(u || '').startsWith('filo://newtab');
  const home = (t) => { try { return suHome(t.url) || suHome(t.view.webContents.getURL()); } catch (_) { return suHome(t.url); } };
  const attiva = tm.tabs.find((t) => t.id === tm.activeId);
  if (attiva && home(attiva)) return [attiva.id];
  return tm.tabs.filter(home).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)).map((t) => t.id);
}, scheda);

/** La home della scheda attiva, o della scheda `scheda`: per indirizzo si prendeva la prima, quella dell'avvio (#877.2). */
export async function home(app, { scheda } = {}) {
  let win = null;
  await expect.poll(async () => {
    for (const id of await schedeCandidate(app, scheda)) {
      win = await paginaDellaScheda(app, id, (p) => p.url().startsWith('filo://newtab'));
      if (win) return true;
    }
    return false;
  }, { message: `newtab non trovata${scheda != null ? ` nella scheda ${scheda}` : ''}`, timeout: 10_000, intervals: [100] }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#input')).toBeVisible({ timeout: 8000 });
  return win;
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
