// #407 — verifica avversariale (verificatore, giro 2026-08-26).
//
// Parte dal SINTOMO come lo racconta chi ha segnalato: "Traduci la pagina"
// traduce solo i paragrafi, lascia in inglese titolo/sommario/didascalia/box
// laterale, e su certi siti non fa proprio niente restando muto.
//
// Qui non si controllano i messaggi ma il RISULTATO SULLO SCHERMO: dopo la
// traduzione non deve restare in vista una sola riga in lingua originale, e il
// ritorno all'originale deve rimettere la pagina esattamente com'era.
//
// Il provider è stubbato nel main: la finta traduzione antepone "IT " a ogni
// blocco. Alcuni scenari usano risposte OSTILI (HTML, script, virgolette) per
// provare a far entrare del markup del modello dentro la pagina.

import { test, expect } from './fixtures/electron.mjs';

// ── Stub del modello ────────────────────────────────────────────────────────
// mode: 'prefix'  → "IT " davanti a ogni blocco (traduzione riconoscibile)
//       'hostile' → risposta che PROVA a iniettare HTML/script nella pagina
//       'dropSep' → restituisce un blocco in meno (modello che sbaglia i
//                   separatori: i testi rischiano di finire nel blocco sbagliato)
async function stubProvider(app, { mode = 'prefix', delay = 0 } = {}) {
  await app.evaluate(async (_electron, opts) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__calls = 0;
    globalThis.__blocks = 0;
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      globalThis.__calls++;
      if (opts.delay > 0) await new Promise((r) => setTimeout(r, opts.delay));
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      let parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      globalThis.__blocks += parts.length;
      if (opts.mode === 'hostile') {
        parts = parts.map(() => '<img src=x onerror="window.__pwned=1">'
          + '<script>window.__pwned=1<\/script>'
          + '" onmouseover="window.__pwned=1" x="');
      } else if (opts.mode === 'dropSep' && parts.length > 1) {
        parts = parts.slice(0, -1).map((p) => `IT ${p}`);
      } else {
        parts = parts.map((p) => `IT ${p}`);
      }
      return { text: parts.join(SEP), provider: 'test', model: 'test-translate', usage: {} };
    };
  }, { mode, delay });
}

async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) {
            window.__toasts.push(n.textContent || '');
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}
const toasts = (page) => page.evaluate(() => window.__toasts || []);

async function openMenu(page, anchor = 'body') {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  await expect(page.locator('[data-sn-icon-id="translate"]')).toBeVisible();
}
async function translateIconLabel(page) {
  return page.locator('[data-sn-icon-id="translate"]').getAttribute('aria-label')
    .catch(() => null);
}
async function clickTranslate(page, anchor = 'body') {
  await openMenu(page, anchor);
  await page.locator('[data-sn-icon-id="translate"]').click();
}

// Ogni pezzo di testo che si LEGGE sullo schermo, come lo vedrebbe l'utente:
// il testo proprio di ogni elemento visibile (esclusa la UI di Filo) più le
// etichette che si leggono negli attributi.
async function visibleTexts(page) {
  return page.evaluate(() => {
    const out = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        const tag = el.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
        if (el.closest('[class^="sn-"],[id^="sn-"],[id^="filo-"]')) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        let own = '';
        for (const c of el.childNodes) if (c.nodeType === 3) own += c.nodeValue;
        own = own.replace(/\s+/g, ' ').trim();
        if (own && /\p{L}/u.test(own)) out.push(own);
      }
    };
    walk(document);
    return out;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Il sintomo, parola per parola: articolo con titolo in <header>, sommario
//    in un blocco generico, didascalia, box "Leggi anche" in <aside>.
//    Nessuna riga può restare in lingua originale.
// ───────────────────────────────────────────────────────────────────────────

const ARTICOLO = `<!doctype html><html lang="en"><head><title>An English tab name</title></head>
<body style="font:16px sans-serif">
  <header id="hd">
    <h1 id="title">The end of an era in European football</h1>
    <div id="standfirst">A short standfirst that explains what the piece is about.</div>
    <div id="byline">By Jane Doe, senior correspondent</div>
  </header>
  <nav id="nav"><a id="navlink" href="#a">Home page of the newspaper</a></nav>
  <main>
    <p id="p1">First paragraph of the body text, long enough to be picked up by anything.</p>
    <figure><img id="pic" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="A photograph of the stadium">
      <figcaption id="cap">The stadium on the last day of the season</figcaption></figure>
    <p id="p2">Second paragraph with a <a id="inlink" href="#x">linked phrase</a> inside it.</p>
    <div id="pullquote">A generic block used as a pull quote by the site</div>
  </main>
  <aside id="related"><h3 id="reltitle">Read also</h3>
    <ul><li><a id="rel1" href="#y">Another English headline you might like</a></li></ul></aside>
  <footer id="ft"><span id="fttext">All rights reserved by the publisher</span></footer>
</body></html>`;

test('il sintomo: dopo "Traduci la pagina" non resta in vista NESSUNA riga in lingua originale', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, ARTICOLO);
  await watchToasts(page);
  const prima = await visibleTexts(page);
  expect(prima.length).toBeGreaterThan(8);

  await clickTranslate(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /);
  // Aspetta che il giro si chiuda davvero (l'avviso finale è l'unico segnale
  // che il lavoro è terminato).
  await expect.poll(async () => (await toasts(page)).some((t) => /Pagina tradotta|tradotti|interrotta|solo in parte/.test(t)), { timeout: 20000 }).toBe(true);

  const rimasti = (await visibleTexts(page)).filter((t) => !t.startsWith('IT '));
  expect(rimasti, `righe rimaste in lingua originale: ${JSON.stringify(rimasti)}`).toEqual([]);

  // Le etichette che si leggono ma non stanno nel testo.
  await expect(page.locator('#pic')).toHaveAttribute('alt', /^IT /);
  // Il nome della scheda in alto.
  expect(await page.title()).toMatch(/^IT /);
  // L'avviso finale non mente: la pagina È tradotta tutta.
  expect((await toasts(page)).join(' | ')).toContain('Pagina tradotta');
  await page.screenshot({ path: 'tests/.shots/v407-articolo-tradotto.png' }).catch(() => {});
});

// ───────────────────────────────────────────────────────────────────────────
// 2. "Su parecchi siti moderni non viene tradotto proprio niente": pagina il
//    cui testo sta solo dentro blocchi generici.
// ───────────────────────────────────────────────────────────────────────────

const COMPONENTI = `<!doctype html><html lang="en"><body style="font:16px sans-serif">
  <div id="app"><div class="row"><div id="c1">Breaking news headline of the day</div>
  <div id="c2">Some body copy living inside a generic block.</div>
  <span id="c3">A trailing note</span></div></div></body></html>`;

test('pagina fatta di soli blocchi generici: la traduzione parte e cambia il testo', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, COMPONENTI);
  await watchToasts(page);
  await clickTranslate(page, '#c2');
  await expect(page.locator('#c1')).toHaveText(/^IT /);
  await expect(page.locator('#c2')).toHaveText(/^IT /);
  await expect(page.locator('#c3')).toHaveText(/^IT /);
  expect(await app.evaluate(() => globalThis.__calls)).toBeGreaterThan(0);
});

// ───────────────────────────────────────────────────────────────────────────
// 3. STRESS — risposta OSTILE del modello: HTML, <script>, virgolette che
//    provano a uscire da un attributo. Niente di tutto questo può diventare
//    markup nella pagina.
// ───────────────────────────────────────────────────────────────────────────

const OSTILE = `<!doctype html><html lang="en"><body style="font:16px sans-serif">
  <div id="t1">A block of English text to be translated here.</div>
  <button id="b1" title="A tooltip in English">Press me now</button>
  <img id="i1" alt="An English description" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
</body></html>`;

test('risposta ostile del modello: nessun HTML e nessuno script entrano nella pagina', async ({ app, openTab, testServer }) => {
  await stubProvider(app, { mode: 'hostile' });
  const page = await testServer.openReady(openTab, OSTILE);
  await watchToasts(page);
  await clickTranslate(page, '#t1');
  await expect.poll(async () => (await page.locator('#t1').textContent()) !== 'A block of English text to be translated here.', { timeout: 15000 }).toBe(true);

  // Il testo del modello è finito nella pagina COME TESTO, non come markup.
  expect(await page.locator('#t1').textContent()).toContain('<img src=x');
  expect(await page.evaluate(() => document.querySelectorAll('#t1 img, #t1 script').length)).toBe(0);
  // Nessun attributo nuovo spuntato dalle virgolette dentro title/alt.
  expect(await page.evaluate(() => document.getElementById('b1').getAttribute('onmouseover'))).toBeNull();
  expect(await page.evaluate(() => document.getElementById('i1').getAttribute('onmouseover'))).toBeNull();
  // E niente è stato eseguito.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

// ───────────────────────────────────────────────────────────────────────────
// 4. STRESS — pagina enorme (oltre 10.000 caratteri), emoji, entità HTML,
//    virgolette, testo a destra-sinistra. Traduce tutto e non mente.
// ───────────────────────────────────────────────────────────────────────────

function paginaEnorme() {
  const blocchi = [];
  for (let i = 0; i < 60; i++) {
    blocchi.push(`<div id="b${i}">Paragraph number ${i} with a fairly long English sentence inside it so that the page is well past ten thousand characters in total. 🚀 &amp; "quotes" &lt;tags&gt; — أهلا</div>`);
  }
  return `<!doctype html><html lang="en"><body style="font:16px sans-serif">${blocchi.join('')}</body></html>`;
}

test('pagina da oltre 10.000 caratteri con emoji ed entità: tradotta tutta, avviso onesto', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubProvider(app);
  const page = await testServer.openReady(openTab, paginaEnorme());
  await watchToasts(page);
  const lunghezza = await page.evaluate(() => document.body.innerText.length);
  expect(lunghezza).toBeGreaterThan(10000);

  await clickTranslate(page, '#b0');
  await expect.poll(async () => (await toasts(page)).some((t) => /Pagina tradotta|tradotti|interrotta/.test(t)), { timeout: 60000 }).toBe(true);

  const rimasti = (await visibleTexts(page)).filter((t) => !t.startsWith('IT '));
  expect(rimasti, `blocchi non tradotti: ${JSON.stringify(rimasti.slice(0, 5))}`).toEqual([]);
  expect((await toasts(page)).join(' | ')).toContain('Pagina tradotta');
});

// ───────────────────────────────────────────────────────────────────────────
// 5. STRESS — andata e ritorno ripetuti: la pagina deve tornare IDENTICA
//    all'originale, ogni volta.
// ───────────────────────────────────────────────────────────────────────────

test('traduci → mostra originale → traduci → mostra originale: la pagina torna identica', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubProvider(app);
  const page = await testServer.openReady(openTab, ARTICOLO);
  await watchToasts(page);
  const htmlPrima = await page.evaluate(() => document.body.innerHTML);
  const titoloPrima = await page.title();

  for (let giro = 0; giro < 2; giro++) {
    await clickTranslate(page, '#p1');
    await expect(page.locator('#p1')).toHaveText(/^IT /);
    await expect.poll(async () => (await toasts(page)).length > giro * 2, { timeout: 20000 }).toBe(true);

    await openMenu(page, '#p1');
    expect(await translateIconLabel(page)).toBe('Mostra originale');
    await page.locator('[data-sn-icon-id="translate"]').click();
    await expect(page.locator('#p1')).not.toHaveText(/^IT /);

    const htmlDopo = await page.evaluate(() => document.body.innerHTML
      .replace(/<div[^>]*class="sn-[^"]*"[\s\S]*$/, '')
      .replace(/ data-sn-[a-z-]+="[^"]*"/g, ''));
    const atteso = htmlPrima.replace(/<div[^>]*class="sn-[^"]*"[\s\S]*$/, '');
    expect(htmlDopo.trim(), `giro ${giro + 1}`).toBe(atteso.trim());
    expect(await page.title()).toBe(titoloPrima);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 6. STRESS — quello che NON si deve toccare: codice, campi dell'utente,
//    translate="no", valori che il modulo rimanda indietro.
// ───────────────────────────────────────────────────────────────────────────

const INTOCCABILI = `<!doctype html><html lang="en"><body style="font:16px sans-serif">
  <div id="ok">A normal English sentence that must change.</div>
  <pre id="code">const x = "do not translate me";</pre>
  <code id="inline">array.map(function (item) { return item; })</code>
  <div id="noTr" translate="no">Brand name that must stay</div>
  <div id="editable" contenteditable="true">Something the user typed here</div>
  <form><input id="field" type="text" value="user typed value" placeholder="Search the site">
    <input id="submit" type="submit" name="go" value="Send the form">
    <textarea id="ta">Text written by the user</textarea></form>
</body></html>`;

test('codice, testo dell’utente e valori dei moduli restano intatti', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, INTOCCABILI);
  await watchToasts(page);
  await clickTranslate(page, '#ok');
  await expect(page.locator('#ok')).toHaveText(/^IT /);

  expect(await page.locator('#code').textContent()).toBe('const x = "do not translate me";');
  expect(await page.locator('#inline').textContent()).toBe('array.map(function (item) { return item; })');
  expect(await page.locator('#noTr').textContent()).toBe('Brand name that must stay');
  expect(await page.locator('#editable').textContent()).toBe('Something the user typed here');
  expect(await page.locator('#ta').inputValue()).toBe('Text written by the user');
  expect(await page.locator('#field').inputValue()).toBe('user typed value');
  // Il bottone di invio porta un name: il suo valore finisce nei dati del
  // modulo e non si tocca…
  expect(await page.locator('#submit').getAttribute('value')).toBe('Send the form');
  // …mentre il grigio del campo di ricerca si legge e basta, e si traduce.
  await expect(page.locator('#field')).toHaveAttribute('placeholder', /^IT /);
});

// ───────────────────────────────────────────────────────────────────────────
// 7. STRESS — pagina senza niente da tradurre e pagina di soli spazi:
//    Filo lo DICE (il sintomo era che restava muto).
// ───────────────────────────────────────────────────────────────────────────

test('pagina vuota o di soli simboli: lo dice invece di restare muta', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab,
    `<!doctype html><html><body style="font:16px sans-serif;min-height:200px">
      <div id="z">   </div><div>1234</div><div>— • ×</div></body></html>`);
  await watchToasts(page);
  await clickTranslate(page, 'body');
  await expect.poll(async () => (await toasts(page)).some((t) => /Non ho trovato testo/.test(t)), { timeout: 15000 }).toBe(true);
  expect(await app.evaluate(() => globalThis.__calls)).toBe(0);
});

// ───────────────────────────────────────────────────────────────────────────
// 8. STRESS — ferma e riparti: annullare a metà e ritradurre subito.
// ───────────────────────────────────────────────────────────────────────────

test('annullare a metà e ritradurre subito: la pagina finisce tradotta lo stesso', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubProvider(app, { delay: 900 });
  const page = await testServer.openReady(openTab, ARTICOLO);
  await watchToasts(page);

  await clickTranslate(page, '#p1');
  // Mentre lavora, l'icona serve a FERMARE.
  await openMenu(page, '#p1');
  expect(await translateIconLabel(page)).toBe('Mostra originale');
  await page.locator('[data-sn-icon-id="translate"]').click();
  await page.waitForTimeout(1500);
  // Fermata vuol dire ferma: niente si ritraduce da solo dopo.
  const dopoStop = await visibleTexts(page);
  expect(dopoStop.filter((t) => t.startsWith('IT '))).toEqual([]);

  // E si riparte da capo senza restare bloccati.
  await stubProvider(app);
  await clickTranslate(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 20000 });
  await expect(page.locator('#title')).toHaveText(/^IT /);
});

// ───────────────────────────────────────────────────────────────────────────
// 9. STRESS — modello che sbaglia i separatori su una pagina fatta di TANTI
//    blocchi corti (menu, etichette, link): i testi non devono finire nel
//    blocco sbagliato, e l'avviso non deve dire "Pagina tradotta".
// ───────────────────────────────────────────────────────────────────────────

function paginaCorta() {
  const voci = [];
  for (let i = 0; i < 40; i++) voci.push(`<div id="v${i}">Item label ${i}</div>`);
  return `<!doctype html><html lang="en"><body style="font:16px sans-serif">${voci.join('')}</body></html>`;
}

test('modello che perde un separatore: niente testi nel blocco sbagliato', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubProvider(app, { mode: 'dropSep' });
  const page = await testServer.openReady(openTab, paginaCorta());
  await watchToasts(page);
  await clickTranslate(page, '#v0');
  await expect.poll(async () => (await toasts(page)).length > 0, { timeout: 60000 }).toBe(true);

  // Ogni blocco tradotto deve contenere il PROPRIO numero, non quello del
  // vicino: uno scivolamento di un posto è testo sbagliato sotto gli occhi.
  const sbagliati = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 40; i++) {
      const t = (document.getElementById('v' + i).textContent || '').trim();
      if (t.startsWith('IT ') && t !== `IT Item label ${i}`) out.push(`v${i} → ${t}`);
    }
    return out;
  });
  expect(sbagliati, `blocchi con la traduzione di un altro: ${JSON.stringify(sbagliati)}`).toEqual([]);
});
