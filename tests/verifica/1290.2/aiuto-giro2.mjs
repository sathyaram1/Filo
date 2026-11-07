// Aiuti delle prove del giro 2 di #1290.2: fornitore finto della traduzione ("IT " davanti), avvisi, icona Traduci.
import { expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo, premiNellaBarra } from '../../helpers/barra.mjs';

export async function stub(app, delay = 0) {
  await app.evaluate(async (_e, delay) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslatePrompts = [];
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      globalThis.__filoTranslatePrompts.push(chunk);
      const out = chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n');
      return { text: out, provider: 'test', model: 'test-translate', usage: {} };
    };
  }, delay);
}

export async function soloQuandoApro(app) {
  const r = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION(
    { type: 'IMPOSTA_PREFERENZA', chiave: 'traduzione delle sezioni nascoste', valore: 'solo quando apro' }, { sender: null }));
  expect(r.executed).toBe(true);
}

export async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

export const toasts = async (page) => (await page.evaluate(() => window.__toasts || [])).join(' | ');
export const sentText = (app) => app.evaluate(() => (globalThis.__filoTranslatePrompts || []).join('\n'));
export const clickTranslateIcon = (app) => premiNellaBarra(app, 'translate');

// L'icona Traduci a barra aperta, col nome che la scheda le dà adesso.
export async function iconaTraduci(app) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'chiudi');
  await app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.barra;
    b.etichettePagina = null;
    b._invia();
  });
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  return barra.locator('#nav .ico[data-id="translate"]');
}

export const frameInner = (token, extra = '') => `<!doctype html><html lang="en"><body style="font:16px sans-serif;margin:0;padding:10px">
  <p id="fbody">${token} an embedded box written in english and long enough to count as text.</p>${extra}
</body></html>`;

export const framePage = (frames) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article that carries a few embedded boxes around it</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  ${frames}
</body></html>`;
