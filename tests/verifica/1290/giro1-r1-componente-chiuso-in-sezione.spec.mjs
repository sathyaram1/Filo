// Verifica di #1290, giro 1: la porta di r1 rimasta aperta, il componente chiuso con testo dentro una sezione chiusa.
// La decide l'owner in #1290.1 (contare o no quel che non si vede e non si è potuto tradurre): rosso atteso fino ad allora.
// Fornitore finto nel main come in translate-page.spec.mjs: "IT " davanti a ogni blocco.

import { test, expect } from '../../fixtures/electron.mjs';
import { premiNellaBarra } from '../../helpers/barra.mjs';

async function stubTranslationProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      return { text: parts.map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 'test', model: 'test-translate', usage: {} };
    };
  });
}

async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}
const toasts = (page) => page.evaluate(() => (window.__toasts || []).join(' | '));

const SIGILLATO_IN_SEZIONE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="plain">A plain heading outside any component</h1>
  <p id="p1">First paragraph of the article, long enough to be picked up by the translation.</p>
  <details id="d"><summary>Open the box</summary><closed-card></closed-card></details>
  <script>
    customElements.define('closed-card', class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'closed' });
        r.innerHTML = '<h2>Headline locked inside a closed component</h2><p>Body text nobody outside the component can read.</p>';
      }
    });
  </script>
</body></html>`;

test('r1 componente chiuso con testo dentro una sezione chiusa, che di serie si traduce: l\'avviso dice «solo in parte»', async ({ app, openTab, testServer }) => {
  test.fail(true, '#1290.1: Un riquadro chiuso a chiave che non si vede (trasparente, in una sezione chiusa, fuori schermo) fa dire «Pagina tradotta» anche se dentro potrebbe esserci testo rimasto in inglese');
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, SIGILLATO_IN_SEZIONE);
  await watchToasts(page);
  await premiNellaBarra(app, 'translate');
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
  await page.waitForTimeout(1500);
  expect(await toasts(page)).toContain('solo in parte');
});
