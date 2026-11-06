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
  test(`componente chiuso con testo dentro ${nome}: l'avviso dice «solo in parte», come nella fisarmonica`, async ({ app, openTab, testServer }) => {
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

// «Mostra originale» mentre le sezioni chiuse si traducono ancora in sottofondo.
const MOLTE_CHIUSE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article with many folded sections</h1>
  <p id="p1">The visible paragraph of the article, long enough to be picked up.</p>
  ${Array.from({ length: 40 }, (_, i) => `<details id="d${i}"><summary>Section ${i}</summary><p id="s${i}">${'Hidden sentence number ' + i + ' written in English for whoever opens it. '.repeat(30)}</p></details>`).join('\n')}
</body></html>`;

test('«Mostra originale» mentre le sezioni chiuse si traducono in sottofondo: aperte, restano in inglese', async ({ app, openTab, testServer }) => {
  test.setTimeout(180000);
  await stubTranslationProvider(app, 4000);
  const page = await testServer.openReady(openTab, MOLTE_CHIUSE);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  const chiamate = await app.evaluate(() => globalThis.__filoTranslatePrompts.length);
  await clickTranslateIcon(app);
  await expect(page.locator('#p1')).toHaveText(/^The visible/, { timeout: 30000 });
  await page.waitForTimeout(15000);
  const dopo = await app.evaluate(() => globalThis.__filoTranslatePrompts.length);
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
  const ancoraIt = await page.evaluate(() => Array.from(document.querySelectorAll('details p')).filter((p) => /^IT /.test(p.textContent)).map((p) => p.id));
  expect(ancoraIt, `sezioni rimaste in italiano dopo «Mostra originale»; chiamate ${chiamate} → ${dopo}`).toEqual([]);
  await expect(page.locator('#p1')).toHaveText(/^The visible/);
});
