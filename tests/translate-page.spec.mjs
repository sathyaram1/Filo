// #407 — "Traduci la pagina" deve tradurre TUTTA la pagina.
//
// Verifica il COMPORTAMENTO (non i messaggi):
//  1) su un articolo con struttura mista (titolo dentro <header>, sommario e
//     didascalia dentro blocchi generici, riquadro "Leggi anche" dentro <aside>,
//     link dentro il testo) TUTTI i pezzi cambiano lingua, non solo i paragrafi;
//  2) su una pagina "a componenti" (nessun <p>: solo blocchi generici) la
//     traduzione parte e sostituisce il testo — prima non partiva nessuna
//     richiesta al modello;
//  3) quando non c'è davvero niente da tradurre, Filo lo DICE (prima restava
//     muto e l'utente riprovava all'infinito);
//  4) "Mostra originale" riporta indietro tutto, link compresi.
//
// Il provider AI è stubbato nel main process (globalThis.SN_PROVIDERS): la
// finta traduzione antepone "IT " a ogni blocco e lascia intatti i segnaposto,
// così "è stato tradotto" è verificabile carattere per carattere.

import { test, expect } from './fixtures/electron.mjs';

const ARTICLE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <header><h1 id="title">The end of an era in European football</h1></header>
  <div id="summary">A short standfirst explaining what this article is about.</div>
  <article>
    <p id="p1">First paragraph of the body text, long enough to be picked up.</p>
    <figure><figcaption id="cap">The stadium on the last day of the season</figcaption></figure>
    <p id="p2">Second paragraph with a <a id="inlink" href="#x">linked phrase</a> inside it.</p>
  </article>
  <aside id="related">
    <h3 id="relatedTitle">Read also</h3>
    <ul><li><a id="rel1" href="#y">Another English headline</a></li></ul>
  </aside>
</body></html>`;

const COMPONENTS = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <div id="root">
    <div class="card">
      <div id="dtitle">Breaking news headline</div>
      <div id="dbody">Some body text living inside a generic block, the way component based sites are built.</div>
      <span id="dspan">A trailing note</span>
    </div>
  </div>
</body></html>`;

const NOTHING = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <div id="only">1234</div><div>•</div><div>—</div>
</body></html>`;

// Finta traduzione nel main: "IT " davanti a ogni blocco, separatori e
// segnaposto [[Lk]] intatti.
async function stubTranslationProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslateCalls = 0;
    P.completeWithFallback = async ({ messages }) => {
      globalThis.__filoTranslateCalls++;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      const out = chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join(SEP);
      return { text: out, provider: 'test', model: 'test-translate', usage: {} };
    };
  });
}

// Raccoglie i toast man mano che compaiono (durano pochi secondi: un assert
// a campione sarebbe race-prone).
async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) {
            window.__toasts.push(n.textContent || '');
          }
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
}

const toasts = (page) => page.evaluate(() => window.__toasts || []);

async function clickTranslateIcon(page, anchor = 'body') {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

test('traduce tutta la pagina: titolo, sommario, didascalia, riquadro laterale e link', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, ARTICLE);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');

  // Il paragrafo era l'unica cosa che funzionava prima: parte da lì l'attesa.
  await expect(page.locator('#p1')).toHaveText(/^IT /);
  // …e tutto il resto DEVE essere tradotto allo stesso modo.
  await expect(page.locator('#title')).toHaveText(/^IT /);        // dentro <header>
  await expect(page.locator('#summary')).toHaveText(/^IT /);      // blocco generico
  await expect(page.locator('#cap')).toHaveText(/^IT /);          // didascalia
  await expect(page.locator('#relatedTitle')).toHaveText(/^IT /); // dentro <aside>
  await expect(page.locator('#rel1')).toHaveText(/^IT /);         // testo del link
  await expect(page.locator('#inlink')).toHaveText(/^IT /);       // link dentro la frase

  // La struttura resta: il link è ancora dentro il paragrafo ed è ancora un link.
  await expect(page.locator('#p2 a#inlink')).toHaveAttribute('href', '#x');
  await expect(page.locator('#p2')).toHaveText(/^IT /);

  // Nessun testo perso per strada.
  const t = await toasts(page);
  expect(t).toContain('Pagina tradotta');
  expect(t).not.toContain('Pagina tradotta solo in parte');
});

test('traduce anche le pagine senza <p>, fatte di blocchi generici', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, COMPONENTS);
  await watchToasts(page);
  await clickTranslateIcon(page, '#dbody');

  await expect(page.locator('#dtitle')).toHaveText(/^IT /);
  await expect(page.locator('#dbody')).toHaveText(/^IT /);
  await expect(page.locator('#dspan')).toHaveText(/^IT /);

  // La richiesta al modello è partita davvero (prima non partiva nulla).
  expect(await app.evaluate(() => globalThis.__filoTranslateCalls)).toBeGreaterThan(0);
  expect(await toasts(page)).toContain('Pagina tradotta');
});

test('quando non c’è testo da tradurre lo dice, invece di restare muto', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, NOTHING);
  await watchToasts(page);
  await clickTranslateIcon(page, '#only');

  await expect
    .poll(async () => (await toasts(page)).includes('Non ho trovato testo da tradurre in questa pagina'))
    .toBe(true);
  expect(await app.evaluate(() => globalThis.__filoTranslateCalls)).toBe(0);
});

test('"Mostra originale" riporta indietro tutta la pagina, link compresi', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, ARTICLE);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  await expect(page.locator('#title')).toHaveText(/^IT /);
  await expect(page.locator('#rel1')).toHaveText(/^IT /);

  await clickTranslateIcon(page, '#p1');
  await expect(page.locator('#title')).toHaveText('The end of an era in European football');
  await expect(page.locator('#summary')).toHaveText('A short standfirst explaining what this article is about.');
  await expect(page.locator('#rel1')).toHaveText('Another English headline');
  await expect(page.locator('#inlink')).toHaveText('linked phrase');
  await expect(page.locator('#p2')).toHaveText('Second paragraph with a linked phrase inside it.');
  await expect(page.locator('#p2 a#inlink')).toHaveAttribute('href', '#x');
});
