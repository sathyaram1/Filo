// Verifica di #1290, giro 1: le porte che la richiesta nomina, provate dal lato dell'utente.
// Fornitore finto nel main come in translate-page.spec.mjs: "IT " davanti a ogni blocco.

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
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      globalThis.__filoTranslatePrompts.push(chunk);
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

const frameInner = (token) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;margin:0;padding:10px">
  <p id="fbody">${token} an embedded box written in english and long enough to count as text.</p>
</body></html>`;

const framePage = (frames) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article that carries a few embedded boxes around it</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  ${frames}
</body></html>`;

// Un componente chiuso del sito CON testo dentro: la parte che nessuno può tradurre.
const SIGILLATO = (prima, dopo) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="plain">A plain heading outside any component</h1>
  <p id="p1">First paragraph of the article, long enough to be picked up by the translation.</p>
  ${prima}<closed-card></closed-card>${dopo}
  ${Array.from({ length: 6 }, (_, i) => `<p>Paragraph ${i} of the article that keeps going under the component.</p>`).join('')}
  <script>
    customElements.define('closed-card', class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'closed' });
        r.innerHTML = '<h2>Headline locked inside a closed component</h2><p>Body text nobody outside the component can read.</p>';
      }
    });
  </script>
</body></html>`;

for (const [nome, prima, dopo, scorri] of [
  ['più in basso della prima schermata', '<div style="height:2500px"></div>', '', 0],
  ['in cima, tradotto dopo averlo superato scorrendo', '', '<div style="height:2500px"></div>', 1400],
  ['dentro una sezione chiusa, che di serie si traduce', '<details id="d"><summary>Open the box</summary>', '</details>', 0],
]) {
  test(`r1 componente chiuso con testo ${nome}: l'avviso dice «solo in parte»`, async ({ app, openTab, testServer }) => {
    test.fail(nome.startsWith('dentro una sezione chiusa'), '#1290.1: Un riquadro chiuso a chiave che non si vede (trasparente, in una sezione chiusa, fuori schermo) fa dire «Pagina tradotta» anche se dentro potrebbe esserci testo rimasto in inglese');
    test.setTimeout(120000);
    await stubTranslationProvider(app);
    const page = await testServer.openReady(openTab, SIGILLATO(prima, dopo));
    await watchToasts(page);
    if (scorri) await page.evaluate((y) => window.scrollTo(0, y), scorri);
    await clickTranslateIcon(app);
    await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
    await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
    await page.waitForTimeout(1500);
    expect(await toasts(page)).toContain('solo in parte');
  });
}

test('r2 riquadro incorporato dentro un componente chiuso: tradotto, o l’avviso lo dice', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const src = testServer.html(frameInner('ZZSHUT')).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, framePage(`<embed-card></embed-card>
    <style>embed-card { display:block; width:560px; height:240px; }</style>
    <script>customElements.define('embed-card', class extends HTMLElement { connectedCallback() {
      this.attachShadow({ mode: 'closed' }).innerHTML = '<iframe src="${src}" style="width:520px;height:220px"></iframe>'; } });</script>`));
  await page.waitForTimeout(1000);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(() => toasts(page), { timeout: 60000 }).toContain('Pagina tradotta');
  await page.waitForTimeout(3000);
  const frame = page.frames().find((f) => f.url().includes('blocked.test'));
  const tradotto = /^IT /.test(await frame.locator('#fbody').textContent());
  const avvisa = /solo in parte|riquadro incorporato/.test(await toasts(page));
  expect(tradotto || avvisa, `il riquadro è rimasto in inglese e l'avviso dice: ${await toasts(page)}`).toBe(true);
});

test('r3 riquadro arrivato MENTRE la traduzione lavora: a lavoro finito è tradotto, o l’icona offre di tradurlo', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app, 6000);
  const src = testServer.html(frameInner('ZZMID')).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, framePage(`<div id="slot"></div><script>window.__arriva = () => {
      document.getElementById('slot').innerHTML = '<iframe id="emb" src="${src}" style="width:520px;height:220px"></iframe>'; };</script>`));
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(() => toasts(page), { timeout: 10000 }).toContain('in corso');
  await page.evaluate(() => window.__arriva());
  expect(await toasts(page)).not.toContain('Pagina tradotta');
  await expect(page.frameLocator('#emb').locator('#fbody')).toHaveText(/ZZMID /, { timeout: 30000 });
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(() => toasts(page), { timeout: 30000 }).toMatch(/Pagina tradotta|riquadro/);
  await page.waitForTimeout(1500);
  const tradotto = /^IT /.test(await page.frameLocator('#emb').locator('#fbody').textContent());
  if (!tradotto) await expect(await iconaTraduci(app)).toHaveAttribute('aria-label', 'Traduci il testo nuovo');
});
