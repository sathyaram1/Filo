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
// segnaposto [[Lk]] intatti. `delayMs` fa durare ogni richiesta: serve agli
// scenari in cui conta cosa succede MENTRE la traduzione lavora (il sito che
// allunga la pagina, l'utente che chiede l'originale a metà).
async function stubTranslationProvider(app, delayMs = 0) {
  await app.evaluate(async (_electron, delay) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslateCalls = 0;
    // Blocchi effettivamente MANDATI al modello: è la misura di quanto l'utente
    // paga. Serve a provare che una ripresa non rispedisce ciò che è già fatto.
    globalThis.__filoTranslateBlocks = 0;
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      // Nella pagina girano anche altre chiamate AI (es. controllo dominio):
      // qui ci interessano SOLO quelle di traduzione pagina.
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      globalThis.__filoTranslateCalls++;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      globalThis.__filoTranslateBlocks += parts.length;
      const out = parts.map((p) => `IT ${p}`).join(SEP);
      return { text: out, provider: 'test', model: 'test-translate', usage: {} };
    };
  }, delayMs);
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

  // Traccia ispezionabile della resa finale (gitignorata).
  await page.screenshot({ path: 'tests/.shots/translate-page-article.png' }).catch(() => {});

  // Nessun testo perso per strada.
  const t = await toasts(page);
  expect(t).toContain('Pagina tradotta');
  expect(t.join(' | ')).not.toContain('Traduzione interrotta');
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

// ───────────────────────────────────────────────────────────────────────────
// #408 — traduzione INTERROTTA a metà (rete che salta, credito finito).
//
// Il comportamento giusto è tre cose insieme:
//  1) Filo NON dice "Pagina tradotta" quando non lo è: dice che si è fermata,
//     a che punto è arrivata e perché — in italiano, mai il messaggio grezzo
//     del provider ("fetch failed");
//  2) si può RIPRENDERE dal punto in cui si era fermata, e la ripresa NON
//     rimanda al modello i blocchi già tradotti (che l'utente ha già pagato);
//  3) chi vuole rinunciare può comunque tornare all'originale, anche nello
//     stato "a metà".
//
// Il provider stubbato fallisce dopo N richieste riuscite e può essere
// "riparato" a caldo, così la ripresa gira nello stesso test.
// ───────────────────────────────────────────────────────────────────────────

// Pagina lunga: serve testo per PIÙ chunk (≈3000 caratteri l'uno), altrimenti
// una sola richiesta o riesce o fallisce e lo stato "a metà" non esiste.
const LONG = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A very long English article about nothing in particular</h1>
  ${Array.from({ length: 40 }, (_, i) => `<p id="p${i}">Paragraph number ${i} of the body text, deliberately long enough to take a meaningful share of the request budget so that the article needs several separate requests to be translated in full.</p>`).join('\n  ')}
</body></html>`;

async function stubFlakyTranslationProvider(app, failAfter) {
  // NB: il primo parametro di app.evaluate è il modulo electron, non l'arg.
  await app.evaluate(async (_electron, failAfter) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslateCalls = 0;
    // Numero di richieste di traduzione servite prima di iniziare a fallire.
    // -1 = non fallire mai (usato per "riparare la rete" e riprendere).
    globalThis.__filoFailAfter = failAfter;
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      globalThis.__filoTranslateCalls++;
      const cap = globalThis.__filoFailAfter;
      if (cap >= 0 && globalThis.__filoTranslateCalls > cap) {
        // Guasto di rete "vero": è la forma che arriva dal fetch di Node.
        throw new Error('fetch failed');
      }
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      return {
        text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join(SEP),
        provider: 'test', model: 'test-translate', usage: {},
      };
    };
  }, failAfter);
}

const translatedCount = (page) => page.evaluate(() => document.querySelectorAll('[data-sn-translated="1"]').length);
const repairProvider = (app) => app.evaluate(() => { globalThis.__filoFailAfter = -1; });

test('traduzione interrotta: lo dice in italiano, con quanto ne manca, e NON dice "Pagina tradotta"', async ({ app, openTab, testServer }) => {
  await stubFlakyTranslationProvider(app, 1);   // solo la prima richiesta va a buon fine
  const page = await testServer.openReady(openTab, LONG);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p0');

  // Precondizione dello scenario: la pagina è tradotta SOLO in parte.
  await expect.poll(() => translatedCount(page), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => translatedCount(page), { timeout: 30000 }).toBeLessThan(41);

  const stopped = async () => (await toasts(page)).find((t) => t.startsWith('Traduzione interrotta dopo '));
  await expect.poll(stopped, { timeout: 30000 }).toBeTruthy();

  const msg = await stopped();
  // Dice quanto ne manca (…dopo N blocchi su M) e come riprendere.
  expect(msg).toMatch(/Traduzione interrotta dopo \d+ blocchi su \d+\./);
  expect(msg).toContain('riprenderla dal tasto destro');
  // Motivo tradotto per l'utente, MAI il messaggio grezzo del provider.
  expect(msg).toContain('rete');
  const all = await toasts(page);
  expect(all.join(' | ')).not.toContain('fetch failed');
  // La bugia da cui nasce la segnalazione: "Pagina tradotta" a traduzione monca.
  expect(all).not.toContain('Pagina tradotta');

  await page.screenshot({ path: 'tests/.shots/translate-page-stopped.png' }).catch(() => {});
});

test('traduzione interrotta: si riprende dal tasto destro e i blocchi già tradotti non si ripagano', async ({ app, openTab, testServer }) => {
  await stubFlakyTranslationProvider(app, 1);
  const page = await testServer.openReady(openTab, LONG);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p0');

  await expect.poll(() => translatedCount(page), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await toasts(page)).some((t) => t.startsWith('Traduzione interrotta')), { timeout: 30000 }).toBe(true);
  const doneBefore = await translatedCount(page);
  expect(doneBefore).toBeLessThan(41);

  // Il menu propone di RIPRENDERE, non di buttare via quel che c'è.
  await page.locator('#p0').click({ button: 'right', position: { x: 5, y: 5 } });
  const icon = page.locator('[data-sn-icon-id="translate"]');
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute('aria-label', 'Riprendi traduzione');

  await repairProvider(app);
  await icon.click();

  // SUCCESSO: la pagina finisce di tradursi (titolo + tutti i paragrafi).
  await expect(page.locator('#head')).toHaveText(/^IT /, { timeout: 60000 });
  for (const id of ['#p0', '#p20', '#p39']) {
    await expect(page.locator(id)).toHaveText(/^IT /, { timeout: 60000 });
  }
  await expect.poll(() => translatedCount(page), { timeout: 60000 }).toBe(41);
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 60000 }).toBe(true);

  // …e NESSUN blocco è stato tradotto due volte: la ripresa non rimanda al
  // modello (né rifa pagare) ciò che era già in italiano. Un secondo giro sui
  // già-tradotti lascerebbe "IT IT ".
  const doubled = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-sn-translated="1"]'))
      .filter((el) => /^IT\s+IT\s/.test(el.textContent || '')).length);
  expect(doubled).toBe(0);
});

test('traduzione interrotta: si può comunque tornare all’originale', async ({ app, openTab, testServer }) => {
  await stubFlakyTranslationProvider(app, 1);
  const page = await testServer.openReady(openTab, LONG);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p0');
  await expect.poll(() => translatedCount(page), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await toasts(page)).some((t) => t.startsWith('Traduzione interrotta')), { timeout: 30000 }).toBe(true);

  // Nello stato "a metà" l'icona serve a riprendere: il ritorno all'originale
  // deve restare raggiungibile come voce del menu.
  await page.locator('#p0').click({ button: 'right', position: { x: 5, y: 5 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  // Traccia ispezionabile: il menu nello stato "traduzione a metà".
  await page.screenshot({ path: 'tests/.shots/translate-page-partial-menu.png' }).catch(() => {});
  await menu.getByText('Mostra originale', { exact: true }).first().click();

  await expect(page.locator('#p0')).toHaveText(/^Paragraph number 0 /);
  await expect.poll(() => translatedCount(page)).toBe(0);

  // Tornati all'originale, l'icona ripropone "Traduci" (non "Riprendi").
  await page.locator('#p0').click({ button: 'right', position: { x: 5, y: 5 } });
  await expect(page.locator('[data-sn-icon-id="translate"]')).toHaveAttribute('aria-label', 'Traduci');
});

// ───────────────────────────────────────────────────────────────────────────
// #439 — i "componenti isolati" dei siti moderni.
//
// Un sito può costruire pezzi di pagina dentro un contenitore a parte (shadow
// DOM). Chi si ferma all'albero principale non li vede mai: restavano in
// lingua originale mentre il resto cambiava, e l'avviso diceva comunque
// "Pagina tradotta".
//
// Le due metà del comportamento giusto:
//  1) i componenti APERTI si traducono come il resto della pagina (e tornano
//     indietro con "Mostra originale");
//  2) i componenti CHIUSI non li può leggere nessuno script: lì l'unica cosa
//     giusta è dirlo — "tradotta solo in parte", mai "Pagina tradotta".
// ───────────────────────────────────────────────────────────────────────────

const SHADOW_OPEN = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="plain">A plain heading outside any component</h1>
  <open-card></open-card>
  <slot-card><span id="slotted">Text passed into the component by the page</span></slot-card>
  <script>
    customElements.define('open-card', class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<h2 id="shTitle">Headline living inside a component</h2>'
          + '<p id="shBody">Body text of the isolated component, long enough to matter.</p>';
      }
    });
    customElements.define('slot-card', class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<div id="shWrap">Wrapper label of the card <slot></slot></div>';
      }
    });
  </script>
</body></html>`;

const SHADOW_CLOSED = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="plain">A plain heading outside any component</h1>
  <closed-card></closed-card>
  <script>
    customElements.define('closed-card', class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'closed' });
        r.innerHTML = '<h2>Headline locked inside a closed component</h2>'
          + '<p>Body text nobody outside the component can read.</p>';
      }
    });
  </script>
</body></html>`;

test('traduce anche il testo dentro i componenti isolati della pagina', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, SHADOW_OPEN);
  await watchToasts(page);
  await clickTranslateIcon(page, '#plain');

  await expect(page.locator('#plain')).toHaveText(/^IT /);
  // Il cuore della segnalazione: titolo e paragrafo DENTRO il componente.
  await expect(page.locator('#shTitle')).toHaveText(/^IT /);
  await expect(page.locator('#shBody')).toHaveText(/^IT /);
  // Anche l'etichetta del componente che ospita testo passato dalla pagina…
  await expect(page.locator('#shWrap')).toHaveText(/IT Wrapper label/);
  // …e il testo passato dalla pagina, tradotto UNA volta sola (se lo si
  // contasse due volte — una nell'albero, una nel componente — resterebbe
  // "IT IT ").
  await expect(page.locator('#slotted')).toHaveText(/^IT /);
  await expect(page.locator('#slotted')).not.toHaveText(/^IT\s+IT\s/);

  await page.screenshot({ path: 'tests/.shots/translate-page-shadow.png' }).catch(() => {});
  expect(await toasts(page)).toContain('Pagina tradotta');
});

test('"Mostra originale" rimette a posto anche i componenti isolati', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, SHADOW_OPEN);
  await watchToasts(page);
  await clickTranslateIcon(page, '#plain');
  await expect(page.locator('#shTitle')).toHaveText(/^IT /);

  await clickTranslateIcon(page, '#plain');
  await expect(page.locator('#shTitle')).toHaveText('Headline living inside a component');
  await expect(page.locator('#shBody')).toHaveText('Body text of the isolated component, long enough to matter.');
  await expect(page.locator('#slotted')).toHaveText('Text passed into the component by the page');
  await expect(page.locator('#plain')).toHaveText('A plain heading outside any component');
});

test('componente chiuso: dice che la pagina è tradotta solo in parte, non "Pagina tradotta"', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, SHADOW_CLOSED);
  await watchToasts(page);
  await clickTranslateIcon(page, '#plain');

  // Quel che è raggiungibile viene tradotto lo stesso.
  await expect(page.locator('#plain')).toHaveText(/^IT /);

  const partial = async () => (await toasts(page)).find((t) => t.startsWith('Pagina tradotta solo in parte'));
  await expect.poll(partial, { timeout: 30000 }).toBeTruthy();
  expect(await partial()).toContain('restano nella lingua originale');
  // La bugia da cui nasce la segnalazione.
  expect(await toasts(page)).not.toContain('Pagina tradotta');
  await page.screenshot({ path: 'tests/.shots/translate-page-closed-component.png' }).catch(() => {});
});

// ───────────────────────────────────────────────────────────────────────────
// Pagina PIÙ LUNGA del tetto di blocchi che un giro riesce a prendere.
//
// L'estrazione si ferma a un tetto (migliaia di blocchi): oltre quel punto il
// testo resta in lingua originale. Finché il tetto era invisibile, il conto
// finale considerava "tutto" solo ciò che era stato raccolto e l'avviso diceva
// "Pagina tradotta" con la coda della pagina ancora in inglese — la stessa
// bugia di #407, su un'altra causa.
//
// Comportamento giusto: dirlo, e finire il lavoro alla ripresa.
// ───────────────────────────────────────────────────────────────────────────

// 2100 blocchi: sopra il tetto (2000) ma abbastanza corti da tenere il test
// veloce (il modello è stubbato: conta il numero di blocchi, non i caratteri).
const HUGE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A gigantic English page</h1>
  ${Array.from({ length: 2100 }, (_, i) => `<div id="b${i}">Block number ${i} of this page.</div>`).join('\n  ')}
</body></html>`;

test('pagina più lunga del tetto: lo dice e la ripresa la finisce', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, HUGE);
  await watchToasts(page);
  await clickTranslateIcon(page, '#head');

  // Precondizione: il primo giro si ferma al tetto, la coda resta in inglese.
  await expect.poll(() => translatedCount(page), { timeout: 120000 }).toBeGreaterThan(1000);
  // Gli avvisi si leggono quando il primo giro ha FINITO. Leggerli al mille-esimo
  // blocco vuol dire leggerli a lavoro in corso, e l'unico avviso sullo schermo
  // è ancora quello di avanzamento.
  await expect
    .poll(async () => (await toasts(page)).join(' | ').includes('Riprendi dal tasto destro'), { timeout: 120000 })
    .toBe(true);
  await expect(page.locator('#b2099')).toHaveText('Block number 2099 of this page.');

  // La bugia: mai "Pagina tradotta" con la coda ancora in lingua originale.
  expect(await toasts(page)).not.toContain('Pagina tradotta');

  // Il menu offre di RIPRENDERE (non di buttare via i blocchi già tradotti).
  await page.locator('#head').click({ button: 'right', position: { x: 5, y: 5 } });
  const icon = page.locator('[data-sn-icon-id="translate"]');
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute('aria-label', 'Riprendi traduzione');
  await icon.click();

  // SUCCESSO dal punto di vista dell'utente: la pagina finisce in italiano.
  await expect(page.locator('#b2099')).toHaveText(/^IT /, { timeout: 120000 });
  await expect(page.locator('#b0')).toHaveText(/^IT /);
  await expect(page.locator('#head')).toHaveText(/^IT /);
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 120000 }).toBe(true);

  // Nessun blocco pagato due volte.
  const doubled = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-sn-translated="1"]'))
      .filter((el) => /^IT\s+IT\s/.test(el.textContent || '')).length);
  expect(doubled).toBe(0);
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

// ───────────────────────────────────────────────────────────────────────────
// #407 (secondo giro) — testo che si LEGGE ma non sta nel testo.
//
// Il grigio dentro un campo di ricerca, il suggerimento che compare fermando il
// mouse, la descrizione di un'immagine, le voci di un menu a tendina: sono
// etichette che l'utente vede sullo schermo. Restavano in inglese mentre
// l'avviso diceva "Pagina tradotta" — la stessa bugia della segnalazione.
//
// La riga di confine: si traduce ciò che si LEGGE, mai ciò che il sito RIMANDA
// INDIETRO (il valore di un campo, il valore inviato da una voce di menu).
// ───────────────────────────────────────────────────────────────────────────

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const LABELS = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An English article with labels outside the body text</h1>
  <input id="search" type="search" placeholder="Search the whole archive">
  <button id="more" title="Open the full story">More</button>
  <img id="pic" src="${PIXEL}" alt="A photo of the empty stadium">
  <select id="pick">
    <option id="o1" value="a">First option label</option>
    <option id="o2" value="b">Second option label</option>
  </select>
  <a id="icon" href="#z" aria-label="Share this article"><span>·</span></a>
  <form id="form" action="#">
    <input id="q" name="q" type="text" value="do not touch this value" placeholder="Type your query here">
  </form>
</body></html>`;

const labelState = (page) => page.evaluate(() => ({
  placeholder: document.getElementById('search').getAttribute('placeholder'),
  title: document.getElementById('more').getAttribute('title'),
  alt: document.getElementById('pic').getAttribute('alt'),
  ariaLabel: document.getElementById('icon').getAttribute('aria-label'),
  // `label` è ciò che il menu a tendina MOSTRA; `value` e il testo sono ciò
  // che il modulo invia.
  optionLabels: Array.from(document.querySelectorAll('#pick option')).map((o) => o.label),
  optionValues: Array.from(document.querySelectorAll('#pick option')).map((o) => o.value),
  optionTexts: Array.from(document.querySelectorAll('#pick option')).map((o) => o.textContent),
  fieldValue: document.getElementById('q').value,
  fieldPlaceholder: document.getElementById('q').getAttribute('placeholder'),
  hasLabelAttr: Array.from(document.querySelectorAll('#pick option')).map((o) => o.hasAttribute('label')),
}));

test('traduce anche le etichette che non stanno nel testo (campi, suggerimenti, immagini, menu a tendina)', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, LABELS);
  await watchToasts(page);
  await clickTranslateIcon(page, '#head');

  await expect(page.locator('#head')).toHaveText(/^IT /);
  await expect.poll(async () => (await labelState(page)).placeholder, { timeout: 30000 }).toMatch(/^IT /);

  const after = await labelState(page);
  expect(after.placeholder).toBe('IT Search the whole archive');
  expect(after.title).toBe('IT Open the full story');
  expect(after.alt).toBe('IT A photo of the empty stadium');
  expect(after.ariaLabel).toBe('IT Share this article');
  expect(after.fieldPlaceholder).toBe('IT Type your query here');
  // Le voci del menu a tendina si LEGGONO in italiano…
  expect(after.optionLabels).toEqual(['IT First option label', 'IT Second option label']);
  // …e ciò che il modulo invia non è cambiato di una virgola.
  expect(after.optionValues).toEqual(['a', 'b']);
  expect(after.optionTexts).toEqual(['First option label', 'Second option label']);
  expect(after.fieldValue).toBe('do not touch this value');

  // L'avviso può dire "Pagina tradotta" perché adesso è vero.
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);
  await page.screenshot({ path: 'tests/.shots/translate-page-labels.png' }).catch(() => {});
});

test('"Mostra originale" rimette a posto anche le etichette', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, LABELS);
  await watchToasts(page);
  await clickTranslateIcon(page, '#head');
  await expect.poll(async () => (await labelState(page)).placeholder, { timeout: 30000 }).toMatch(/^IT /);

  await clickTranslateIcon(page, '#head');
  await expect(page.locator('#head')).toHaveText('An English article with labels outside the body text');

  const back = await labelState(page);
  expect(back.placeholder).toBe('Search the whole archive');
  expect(back.title).toBe('Open the full story');
  expect(back.alt).toBe('A photo of the empty stadium');
  expect(back.ariaLabel).toBe('Share this article');
  expect(back.fieldPlaceholder).toBe('Type your query here');
  expect(back.optionLabels).toEqual(['First option label', 'Second option label']);
  // L'etichetta l'avevamo aggiunta noi: tornando all'originale sparisce, non
  // resta un attributo finto addosso alla pagina.
  expect(back.hasLabelAttr).toEqual([false, false]);
});

// ───────────────────────────────────────────────────────────────────────────
// #407 (secondo giro) — testo che il sito aggiunge DOPO la traduzione.
//
// È la normalità sulle pagine che si allungano scorrendo e su quelle che
// cambiano schermata senza ricaricare. Prima, a traduzione finita il menu
// offriva solo "Mostra originale": per avere in italiano le righe arrivate dopo
// bisognava tornare all'originale e RIPAGARE tutta la pagina.
// ───────────────────────────────────────────────────────────────────────────

const FEED = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A feed that keeps growing while you scroll it</h1>
  <div id="feed">
    <div class="row" id="r0">First row of the feed, written in English.</div>
    <div class="row" id="r1">Second row of the feed, written in English.</div>
    <div class="row" id="r2">Third row of the feed, written in English.</div>
  </div>
  <script>
    window.__addRows = (n) => {
      const feed = document.getElementById('feed');
      for (let i = 0; i < n; i++) {
        const d = document.createElement('div');
        d.id = 'later' + i;
        d.className = 'row';
        d.textContent = 'Row number ' + i + ' arrived after the translation was done.';
        feed.appendChild(d);
      }
    };
  </script>
</body></html>`;

const blocksSent = (app) => app.evaluate(() => globalThis.__filoTranslateBlocks);

test('il testo comparso dopo la traduzione si traduce dal menu, senza ripagare il resto', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, FEED);
  await watchToasts(page);
  await clickTranslateIcon(page, '#head');

  await expect(page.locator('#r2')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);
  const paidFirst = await blocksSent(app);

  // Il sito allunga la pagina: sei righe nuove, in inglese.
  await page.evaluate(() => window.__addRows(6));
  await expect(page.locator('#later5')).toHaveText(/^Row number 5 /);

  // Il menu se ne accorge e offre di tradurre SOLO quelle.
  await page.locator('#head').click({ button: 'right', position: { x: 5, y: 5 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  const icon = page.locator('[data-sn-icon-id="translate"]');
  await expect(icon).toHaveAttribute('aria-label', 'Traduci il testo nuovo');
  // Anche in questo stato si deve poter rinunciare e tornare all'originale.
  await expect(menu.getByText('Mostra originale', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/translate-page-new-content-menu.png' }).catch(() => {});
  await icon.click();

  // SUCCESSO per l'utente: le righe nuove sono in italiano…
  for (const id of ['#later0', '#later3', '#later5']) {
    await expect(page.locator(id)).toHaveText(/^IT /, { timeout: 60000 });
  }
  // …e quelle di prima non sono state tradotte due volte.
  const doubled = await page.evaluate(() => Array.from(document.querySelectorAll('[data-sn-translated="1"]'))
    .filter((el) => /^IT\s+IT\s/.test(el.textContent || '')).length);
  expect(doubled).toBe(0);

  // Il conto che l'utente paga: al modello sono andate SOLO le sei righe nuove.
  expect(await blocksSent(app) - paidFirst).toBe(6);

  // Finito il secondo giro l'avviso torna a dire il vero, e l'icona torna a
  // offrire il ritorno all'originale.
  await expect.poll(async () => (await toasts(page)).filter((t) => t === 'Pagina tradotta').length, { timeout: 60000 }).toBeGreaterThan(1);
  await page.locator('#head').click({ button: 'right', position: { x: 5, y: 5 } });
  await expect(page.locator('[data-sn-icon-id="translate"]')).toHaveAttribute('aria-label', 'Mostra originale');
});

test('il testo comparso dopo torna in inglese con tutto il resto', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, FEED);
  await watchToasts(page);
  await clickTranslateIcon(page, '#head');
  await expect(page.locator('#r2')).toHaveText(/^IT /, { timeout: 30000 });

  await page.evaluate(() => window.__addRows(2));
  await page.locator('#head').click({ button: 'right', position: { x: 5, y: 5 } });
  const icon = page.locator('[data-sn-icon-id="translate"]');
  await expect(icon).toHaveAttribute('aria-label', 'Traduci il testo nuovo');
  await icon.click();
  await expect(page.locator('#later1')).toHaveText(/^IT /, { timeout: 60000 });

  await clickTranslateIcon(page, '#head');
  await expect(page.locator('#later1')).toHaveText('Row number 1 arrived after the translation was done.');
  await expect(page.locator('#r0')).toHaveText('First row of the feed, written in English.');
  await expect.poll(() => translatedCount(page)).toBe(0);
});

// Stesso caso, ma il contenuto nuovo arriva DENTRO un componente del sito
// (#439 + #407): una sentinella che guarda solo il documento non vede oltre il
// confine del componente, e sui siti a componenti è proprio lì che il contenuto
// cambia.
const SHADOW_FEED = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="plain">A page whose feed lives inside a component</h1>
  <feed-card></feed-card>
  <script>
    customElements.define('feed-card', class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<div id="fTitle">Headline living inside a component</div><div id="fRows"></div>';
        window.__addShadowRows = (n) => {
          const rows = r.getElementById('fRows');
          for (let i = 0; i < n; i++) {
            const d = document.createElement('div');
            d.id = 'srow' + i;
            d.textContent = 'Component row ' + i + ' that arrived after the translation.';
            rows.appendChild(d);
          }
        };
      }
    });
  </script>
</body></html>`;

test('anche il testo che arriva dentro un componente del sito si può tradurre dopo', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, SHADOW_FEED);
  await watchToasts(page);
  await clickTranslateIcon(page, '#plain');
  await expect(page.locator('#fTitle')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);

  await page.evaluate(() => window.__addShadowRows(3));
  await expect(page.locator('#srow2')).toHaveText(/^Component row 2 /);

  await page.locator('#plain').click({ button: 'right', position: { x: 5, y: 5 } });
  const icon = page.locator('[data-sn-icon-id="translate"]');
  await expect(icon).toHaveAttribute('aria-label', 'Traduci il testo nuovo');
  await icon.click();

  await expect(page.locator('#srow0')).toHaveText(/^IT /, { timeout: 60000 });
  await expect(page.locator('#srow2')).toHaveText(/^IT /, { timeout: 60000 });
});

// ───────────────────────────────────────────────────────────────────────────
// #407 (terzo giro) — quello che resta in lingua originale sotto un avviso che
// dice "Pagina tradotta". Cinque strade diverse per la stessa bugia:
//
//  1) il testo che il sito carica MENTRE la traduzione lavora (scorrere
//     aspettando è il comportamento normale, non il caso limite);
//  2) il testo già nella pagina ma ripiegato quando la traduzione parte: chi
//     lo apre dopo se lo trova in inglese, e il sito non ha aggiunto niente;
//  3) le scritte sui bottoni dei moduli, che si leggono a occhio come il
//     titolo della segnalazione;
//  4) l'avviso onesto che scatta a vuoto: "tradotta solo in parte" su una
//     pagina tradotta tutta manda l'utente a cercare inglese che non c'è;
//  5) chiedere l'originale mentre lavora: se l'utente dice di tornare indietro,
//     ci deve tornare e restarci.
// ───────────────────────────────────────────────────────────────────────────

// Il sito allunga la pagina NEL MOMENTO in cui la traduzione comincia a
// sostituire testo: è quello che si vede scorrendo mentre si aspetta.
const DURING = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A feed that keeps loading while you wait</h1>
  <div id="feed">
    <div class="row" id="r0">First row of the feed, written in English.</div>
    <div class="row" id="r1">Second row of the feed, written in English.</div>
    <div class="row" id="r2">Third row of the feed, written in English.</div>
  </div>
  <script>
    const obs = new MutationObserver(() => {
      if (!document.querySelector('[data-sn-translated]')) return;
      obs.disconnect();
      const feed = document.getElementById('feed');
      for (let i = 0; i < 4; i++) {
        const d = document.createElement('div');
        d.id = 'dur' + i;
        d.className = 'row';
        d.textContent = 'Row number ' + i + ' loaded while the translation was still running.';
        feed.appendChild(d);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  </script>
</body></html>`;

test('il testo che arriva MENTRE traduce non resta in inglese', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app, 300);
  const page = await testServer.openReady(openTab, DURING);
  await watchToasts(page);
  await clickTranslateIcon(page, '#head');

  // SUCCESSO per chi guarda lo schermo: anche le righe caricate durante
  // l'attesa sono in italiano, senza dover ricliccare niente.
  for (const id of ['#dur0', '#dur2', '#dur3']) {
    await expect(page.locator(id)).toHaveText(/^IT /, { timeout: 60000 });
  }
  await expect(page.locator('#r0')).toHaveText(/^IT /);

  // Nessun blocco pagato due volte dal giro in più.
  const doubled = await page.evaluate(() => Array.from(document.querySelectorAll('[data-sn-translated="1"]'))
    .filter((el) => /^IT\s+IT\s/.test(el.textContent || '')).length);
  expect(doubled).toBe(0);

  // E l'avviso può dire "Pagina tradotta" perché adesso è vero.
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 60000 }).toBe(true);
  await page.screenshot({ path: 'tests/.shots/translate-page-during.png' }).catch(() => {});
});

// Testo già presente ma RIPIEGATO quando la traduzione parte. Il sito non
// aggiunge niente: è l'utente che lo scopre — e per lui è la stessa cosa.
const COLLAPSED = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article with a section folded away</h1>
  <p id="p1">The visible paragraph of the article, long enough to be picked up.</p>
  <button id="toggle" onclick="document.getElementById('more').hidden = false">Show more</button>
  <div id="more" hidden>
    <h2 id="mtitle">The headline hidden inside the folded section</h2>
    <p id="mbody">The body of the folded section, written in English like the rest.</p>
  </div>
</body></html>`;

test('la sezione ripiegata che si apre DOPO si traduce dal menu, senza rifare il resto', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, COLLAPSED);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');

  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);
  const paidFirst = await blocksSent(app);

  // L'utente apre la fisarmonica: dentro è tutto in lingua originale.
  await page.locator('#toggle').click();
  await expect(page.locator('#mtitle')).toHaveText('The headline hidden inside the folded section');

  // Il menu se ne accorge e offre di tradurre quello, non di buttare via tutto.
  await page.locator('#head').click({ button: 'right', position: { x: 5, y: 5 } });
  const icon = page.locator('[data-sn-icon-id="translate"]');
  await expect(icon).toHaveAttribute('aria-label', 'Traduci il testo nuovo');
  await page.screenshot({ path: 'tests/.shots/translate-page-revealed-menu.png' }).catch(() => {});
  await icon.click();

  await expect(page.locator('#mtitle')).toHaveText(/^IT /, { timeout: 60000 });
  await expect(page.locator('#mbody')).toHaveText(/^IT /, { timeout: 60000 });
  // Al modello sono andati SOLO i due blocchi scoperti adesso.
  expect(await blocksSent(app) - paidFirst).toBe(2);
  const doubled = await page.evaluate(() => Array.from(document.querySelectorAll('[data-sn-translated="1"]'))
    .filter((el) => /^IT\s+IT\s/.test(el.textContent || '')).length);
  expect(doubled).toBe(0);
});

// Le scritte sui bottoni dei moduli: su <input> la scritta è `value`. La riga
// di confine passa in mezzo agli input — si traduce ciò che si legge, mai ciò
// che il modulo rimanda indietro (e il valore di un bottone parte solo se il
// bottone ha un `name`).
const FORM_BUTTONS = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A page with the usual three form buttons</h1>
  <form id="f" action="#">
    <input id="b1" type="button" value="Show all comments">
    <input id="b2" type="reset" value="Clear the form">
    <input id="b3" type="submit" value="Send the message">
    <input id="b4" type="submit" name="action" value="Save the draft">
  </form>
</body></html>`;

const buttonValues = (page) => page.evaluate(() => ['b1', 'b2', 'b3', 'b4']
  .map((id) => document.getElementById(id).getAttribute('value')));

test('traduce anche le scritte sui bottoni dei moduli, senza toccare quel che il modulo invia', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, FORM_BUTTONS);
  await watchToasts(page);
  await clickTranslateIcon(page, '#head');

  await expect(page.locator('#head')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await buttonValues(page))[0], { timeout: 30000 }).toMatch(/^IT /);

  const after = await buttonValues(page);
  expect(after[0]).toBe('IT Show all comments');   // apre qualcosa nella pagina
  expect(after[1]).toBe('IT Clear the form');      // azzera il modulo
  expect(after[2]).toBe('IT Send the message');    // invia, ma senza `name`: non parte niente
  // Con un `name`, quel valore è un dato che il sito riceve: non si tocca.
  expect(after[3]).toBe('Save the draft');
  await page.screenshot({ path: 'tests/.shots/translate-page-buttons.png' }).catch(() => {});

  // E "Mostra originale" le rimette com'erano.
  await clickTranslateIcon(page, '#head');
  await expect(page.locator('#head')).toHaveText('A page with the usual three form buttons');
  expect(await buttonValues(page)).toEqual(['Show all comments', 'Clear the form', 'Send the message', 'Save the draft']);
});

// Elementi col trattino nel nome che non nascondono NIENTE: un separatore
// disegnato in CSS e uno spaziatore registrato ma vuoto. Su una pagina così
// "tradotta solo in parte" manda l'utente a cercare inglese che non esiste.
const DECOR = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A page with a decorative divider between the paragraphs</h1>
  <p id="p1">First paragraph of the page, long enough to be picked up by the translation.</p>
  <x-divider></x-divider>
  <fancy-spacer></fancy-spacer>
  <p id="p2">Second paragraph of the page, also long enough to be picked up.</p>
  <style>
    x-divider { display:block; width:600px; height:40px; background:#ccc; }
    fancy-spacer { display:block; width:600px; height:60px; }
  </style>
  <script>customElements.define('fancy-spacer', class extends HTMLElement {});</script>
</body></html>`;

test('un separatore decorativo non fa dire "tradotta solo in parte" a una pagina tradotta tutta', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, DECOR);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');

  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect(page.locator('#p2')).toHaveText(/^IT /);
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);
  // Il falso allarme al contrario: non c'è niente di chiuso, e non va detto.
  expect((await toasts(page)).join(' | ')).not.toContain('solo in parte');
});

// Pagina abbastanza grande da tenere occupate più richieste: serve a chiedere
// l'originale MENTRE il lavoro è ancora in volo.
const SLOW = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A long English article used to stop a translation halfway</h1>
  ${Array.from({ length: 60 }, (_, i) => `<p id="q${i}">Paragraph number ${i} of an article written to be long: it exists so that the translation needs many separate requests, one after the other, and stays busy long enough for someone to change their mind while it is still working on the rest of the page.</p>`).join('\n  ')}
</body></html>`;

test('chiedere l’originale mentre traduce: la pagina torna indietro e ci RESTA', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app, 1200);
  const page = await testServer.openReady(openTab, SLOW);
  await watchToasts(page);
  await clickTranslateIcon(page, '#q0');

  // Il lavoro è cominciato: qualcosa è già in italiano, il resto è per strada.
  await expect.poll(() => translatedCount(page), { timeout: 60000 }).toBeGreaterThan(0);

  // A lavoro in corso l'icona serve a fermare: aprire il menu e trovare solo
  // "Traduci la pagina" (che non fa niente) sarebbe un vicolo cieco.
  await page.locator('#q0').click({ button: 'right', position: { x: 5, y: 5 } });
  const icon = page.locator('[data-sn-icon-id="translate"]');
  await expect(icon).toHaveAttribute('aria-label', 'Mostra originale');
  await icon.click();

  // Torna in inglese subito…
  await expect.poll(() => translatedCount(page), { timeout: 15000 }).toBe(0);
  // …e ci resta: il lavoro rimasto in volo non si scarica addosso alla pagina.
  await page.waitForTimeout(8000);
  expect(await translatedCount(page)).toBe(0);
  await expect(page.locator('#q0')).toHaveText(/^Paragraph number 0 /);
  await expect(page.locator('#head')).toHaveText('A long English article used to stop a translation halfway');
  // E nessuno dichiara finito un lavoro che l'utente ha fermato.
  expect((await toasts(page)).join(' | ')).not.toContain('Pagina tradotta');

  // Tornati all'originale, l'icona ripropone "Traduci".
  await page.locator('#q0').click({ button: 'right', position: { x: 5, y: 5 } });
  await expect(page.locator('[data-sn-icon-id="translate"]')).toHaveAttribute('aria-label', 'Traduci');
});
