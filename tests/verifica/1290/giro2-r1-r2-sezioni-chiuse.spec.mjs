// Verifica di #1290, giro 2: esplorazione.

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo, premiNellaBarra } from '../../helpers/barra.mjs';

async function stubTranslationProvider(app, delayMs = 0) {
  await app.evaluate(async (_electron, delay) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslatePrompts = [];
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
      globalThis.__filoTranslatePrompts.push(chunk);
      if (delay > 0 && globalThis.__filoTranslatePrompts.length > 1) await new Promise((r) => setTimeout(r, delay));
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      return { text: parts.map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 'test', model: 'test-translate', usage: {} };
    };
  }, delayMs);
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
const sentText = (app) => app.evaluate(() => (globalThis.__filoTranslatePrompts || []).join('\n'));
const clickTranslateIcon = (app) => premiNellaBarra(app, 'translate');

async function iconaTraduci(app) {
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

const CARD = `<script>
    customElements.define('closed-card', class extends HTMLElement {
      connectedCallback() {
        this.attachShadow({ mode: 'closed' }).innerHTML = '<h2>Headline locked inside a closed component</h2><p>Body text nobody outside can read.</p>';
      }
    });
  </script>`;

// Una sezione chiusa da un bottone, o un pannello di schede spento, con dentro un componente chiuso col testo.
for (const [nome, sezione, apri] of [
  ['una sezione chiusa da un bottone', '<button id="tg" onclick="document.getElementById(\'more\').hidden=false">Show more</button><div id="more" hidden><p id="m1">Folded paragraph written in English for the reader.</p><closed-card></closed-card></div>', '#tg'],
  ['un pannello di schede spento', '<button id="tg" onclick="document.getElementById(\'more\').style.display=\'block\'">Second tab</button><div id="more" style="display:none"><p id="m1">Tab paragraph written in English for the reader.</p><closed-card></closed-card></div>', '#tg'],
]) {
  test(`r1 componente chiuso con testo dentro ${nome}: l'avviso dice «solo in parte», come nella fisarmonica`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120000);
    await stubTranslationProvider(app);
    const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
      <h1>A plain heading outside any component</h1>
      <p id="p1">First paragraph of the article, long enough to be picked up by the translation.</p>
      ${sezione}${CARD}</body></html>`);
    await watchToasts(page);
    await clickTranslateIcon(app);
    await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
    await expect.poll(() => toasts(page), { timeout: 30000 }).toMatch(/Pagina tradotta|solo in parte/);
    await page.waitForTimeout(2000);
    await page.locator(apri).click();
    await expect(page.locator('#m1')).toHaveText(/^IT /, { timeout: 30000 });
    expect(await toasts(page)).toContain('solo in parte');
  });
}

// «Solo quando le apro»: la scelta promette la sezione tradotta un paio di secondi dopo averla aperta.
test('r2 solo quando le apro: aperta la sezione su una pagina tradotta, si traduce da sola', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const r = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION(
    { type: 'IMPOSTA_PREFERENZA', chiave: 'traduzione delle sezioni nascoste', valore: 'solo quando apro' }, { sender: null }));
  expect(r.executed).toBe(true);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
    <h1>An article with a folded section</h1>
    <p id="p1">First paragraph of the article, long enough to be picked up by the translation.</p>
    <details id="d"><summary id="sum">Read more</summary><p id="m1">Folded paragraph written in English for the reader.</p></details>
  </body></html>`);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
  expect(await sentText(app)).not.toContain('Folded paragraph');
  await page.locator('#sum').click();
  await expect(page.locator('#m1')).toHaveText(/^IT /, { timeout: 10000 });
});
