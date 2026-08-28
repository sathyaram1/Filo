// #407 — verifica avversariale indipendente.
//
// Parte dal SINTOMO dell'utente ("Traduci la pagina lascia in lingua originale
// titoli, sommari e didascalie, e su certi siti non fa nulla") e prova a
// romperlo su strade che gli altri spec del ramo non percorrono:
//  - i sottoalberi che il vecchio codice scartava per intero (FORM, NAV,
//    HEADER, FOOTER, ASIDE) e i tag che non erano nella lista (TH, DL, SUMMARY);
//  - componenti annidati uno dentro l'altro, con testo "in luce" via <slot>:
//    non deve restare in inglese né essere tradotto due volte;
//  - il ciclo traduci → originale ripetuto: la pagina deve tornare IDENTICA
//    ogni volta e ritradursi ogni volta;
//  - sequenze rapide (doppio clic, annullo a metà, ripartenza);
//  - limiti: blocco da 10.000 caratteri, emoji, caratteri invisibili, RTL,
//    pagina completamente vuota.

import { test, expect } from './fixtures/electron.mjs';

// Finta traduzione nel main: antepone "IT " a ogni blocco e lascia intatti i
// segnaposto [[Lk]]. Conta le chiamate e i blocchi spediti (= quanto si paga).
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
    globalThis.__filoTranslateBlocks = 0;
    globalThis.__filoSentTexts = [];
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      globalThis.__filoTranslateCalls++;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      globalThis.__filoTranslateBlocks += parts.length;
      for (const p of parts) globalThis.__filoSentTexts.push(p);
      return { text: parts.map((p) => `IT ${p}`).join(SEP), provider: 'test', model: 'test-translate', usage: {} };
    };
  }, delayMs);
}

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

// NB: Playwright, se deve PRIMA scorrere e POI cliccare nella stessa azione,
// manda il contextmenu a coordinate ormai vecchie e il menu non si apre (è un
// limite del pilota, non dell'app: scorrendo prima a parte il menu esce). Da
// qui lo scorrimento esplicito prima di ogni tasto destro.
async function openMenu(page, anchor = 'body') {
  const el = page.locator(anchor).first();
  await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  await el.click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  return btn;
}

// L'etichetta dell'icona dice a che stato è la traduzione: "Traduci",
// "Mostra originale", "Riprendi traduzione", "Traduci il testo nuovo".
const iconLabel = (btn) => btn.getAttribute('aria-label');

async function clickTranslateIcon(page, anchor = 'body') {
  const btn = await openMenu(page, anchor);
  await btn.click();
}

// ───────────────────────────────────────────────────────────────────────────
// 1. I sottoalberi che il vecchio codice buttava via interi.
// ───────────────────────────────────────────────────────────────────────────

const SKIPPED_SUBTREES = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <nav id="nav"><a id="navlink" href="#a">Home page of the site</a> · <a id="navlink2" href="#b">Latest stories</a></nav>
  <header id="hdr"><h1 id="h1">A headline that lives inside the header element</h1>
    <div id="stand">The standfirst, in a generic block right under the title</div></header>
  <form id="form" action="#">
    <fieldset><legend id="legend">Search the archive</legend>
      <label id="lab" for="q">What are you looking for?</label>
      <input id="q" type="search" placeholder="Type your search here">
      <button id="go" type="submit">Search now</button>
      <p id="hint">Results are limited to the last five years of the archive.</p>
    </fieldset>
  </form>
  <table id="tbl"><caption id="cap">Table of results by year</caption>
    <thead><tr><th id="th1">Year of publication</th><th id="th2">Number of stories</th></tr></thead>
    <tbody><tr><td id="td1">Nineteen ninety nine</td><td id="td2">Forty two stories</td></tr></tbody></table>
  <dl><dt id="dt">Definition term of the glossary</dt><dd id="dd">The explanation that goes with it.</dd></dl>
  <details id="det" open><summary id="sum">More about this investigation</summary>
    <p id="detp">The body of the expandable section, visible because it is open.</p></details>
  <aside id="aside"><h3 id="asideh">Read also</h3><a id="asidea" href="#c">Another English headline</a></aside>
  <footer id="foot"><p id="footp">All rights reserved by the newspaper company.</p></footer>
</body></html>`;

test('i sottoalberi che prima si buttavano via interi (menu, intestazione, modulo, tabella, piè di pagina) cambiano lingua', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, SKIPPED_SUBTREES);
  await watchToasts(page);
  await clickTranslateIcon(page, '#hint');

  // Ogni id qui sotto era, prima, un pezzo di pagina che restava in inglese.
  const ids = ['navlink', 'navlink2', 'h1', 'stand', 'legend', 'lab', 'go', 'hint',
    'cap', 'th1', 'th2', 'td1', 'td2', 'dt', 'dd', 'sum', 'detp', 'asideh', 'asidea', 'footp'];
  for (const id of ids) {
    await expect(page.locator(`#${id}`), `#${id} non tradotto`).toHaveText(/^IT /);
  }
  // Il grigio dentro il campo di ricerca: si legge sullo schermo, si traduce.
  await expect(page.locator('#q')).toHaveAttribute('placeholder', /^IT /);
  // Il campo di ricerca NON viene riempito: quello lo scrive l'utente.
  expect(await page.locator('#q').inputValue()).toBe('');
  // Il bottone di invio senza `name` porta un'etichetta, non un dato: si traduce
  // il testo, ma il modulo continua a inviare quello che inviava.
  await expect(page.locator('#go')).toHaveText(/^IT /);

  await page.screenshot({ path: 'tests/.shots/407-sottoalberi.png' }).catch(() => {});
  expect((await toasts(page)).join(' | ')).toContain('Pagina tradotta');
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Componenti annidati + testo "in luce" (<slot>): niente inglese rimasto,
//    e niente tradotto due volte (che si pagherebbe due volte e stamperebbe
//    "IT IT ").
// ───────────────────────────────────────────────────────────────────────────

const NESTED_COMPONENTS = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <x-outer id="outer"><span id="slotted">Text handed to the component by the page</span></x-outer>
  <script>
    class XInner extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<h2 id="innerTitle">Headline inside the inner component</h2>' +
          '<div id="innerBody">Body copy two levels deep inside components.</div>';
      }
    }
    customElements.define('x-inner', XInner);
    class XOuter extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<div id="outerTitle">Headline inside the outer component</div>' +
          '<slot></slot><x-inner></x-inner>';
      }
    }
    customElements.define('x-outer', XOuter);
  </script>
</body></html>`;

const deepText = (page, sel) => page.evaluate((s) => {
  const outer = document.querySelector('#outer');
  const r1 = outer.shadowRoot;
  if (s === 'outerTitle') return r1.querySelector('#outerTitle').textContent;
  const r2 = r1.querySelector('x-inner').shadowRoot;
  return r2.querySelector('#' + s).textContent;
}, sel);

test('componenti annidati e testo passato dalla pagina: tutto tradotto una volta sola', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, NESTED_COMPONENTS);
  await watchToasts(page);
  await clickTranslateIcon(page, '#outer');

  await expect.poll(() => deepText(page, 'outerTitle')).toMatch(/^IT /);
  await expect.poll(() => deepText(page, 'innerTitle')).toMatch(/^IT /);
  await expect.poll(() => deepText(page, 'innerBody')).toMatch(/^IT /);
  await expect(page.locator('#slotted')).toHaveText(/^IT /);

  // Il testo "in luce" sta nell'albero normale e nel componente c'è solo il
  // segnaposto: se venisse contato due volte comparirebbe "IT IT ".
  await expect(page.locator('#slotted')).not.toHaveText(/IT IT/);
  expect(await deepText(page, 'innerTitle')).not.toMatch(/IT IT/);
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Traduci → originale, tre volte: la pagina torna IDENTICA e si ritraduce.
// ───────────────────────────────────────────────────────────────────────────

const ROUNDTRIP = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="t">An English headline for the round trip</h1>
  <div id="s">A standfirst in a generic block, with a <a id="a" href="#z" title="Link tooltip in English">link inside</a> it.</div>
  <p id="p">A paragraph with <img id="im" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Photo of the stadium"> an image in the middle.</p>
  <select id="sel"><option id="o1" value="a">First choice</option><option id="o2" value="b">Second choice</option></select>
</body></html>`;

const snapshot = (page) => page.evaluate(() => document.body.innerHTML);

async function restoreFromMenu(page, anchor) {
  const btn = await openMenu(page, anchor);
  expect(await iconLabel(btn), 'l’icona non offre il ritorno all’originale').toBe('Mostra originale');
  await btn.click();
}

test('traduci e torna all’originale tre volte di fila: ogni volta la pagina è identica a com’era', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, ROUNDTRIP);
  await watchToasts(page);
  const original = await snapshot(page);

  for (let round = 1; round <= 3; round++) {
    await clickTranslateIcon(page, '#p');
    await expect(page.locator('#t'), `giro ${round}: titolo`).toHaveText(/^IT /);
    await expect(page.locator('#s'), `giro ${round}: sommario`).toHaveText(/^IT /);
    await expect(page.locator('#a'), `giro ${round}: link`).toHaveText(/^IT /);
    await expect(page.locator('#im'), `giro ${round}: alt`).toHaveAttribute('alt', /^IT /);
    // Il valore inviato dal menu a tendina non cambia mai.
    expect(await page.locator('#o1').getAttribute('value')).toBe('a');

    // Nessun "IT IT": niente ritradotto sopra una traduzione.
    expect(await page.locator('#t').textContent(), `giro ${round}`).not.toMatch(/IT IT/);

    await restoreFromMenu(page, '#p');
    await expect.poll(() => page.locator('#t').textContent(), { timeout: 8000 })
      .not.toMatch(/^IT /);
    // …e la pagina è tornata esattamente com'era, attributi compresi.
    expect(await snapshot(page), `giro ${round}: HTML ripristinato`).toBe(original);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Sequenze rapide: doppio clic, annullo a metà, ripartenza.
// ───────────────────────────────────────────────────────────────────────────

const LONGISH = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A long English page used for the timing tests</h1>
  ${Array.from({ length: 25 }, (_, i) => `<div id="d${i}">Block number ${i} of the page body, written long enough to take a real share of the request budget so the work lasts more than one request.</div>`).join('\n  ')}
</body></html>`;

test('mentre lavora si può fermare, e dopo l’annullo niente si traduce alle spalle dell’utente', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app, 700);
  const page = await testServer.openReady(openTab, LONGISH);
  await watchToasts(page);

  const btn = await openMenu(page, '#d0');
  expect(await iconLabel(btn)).toBe('Traduci');
  await btn.click();
  await page.waitForTimeout(300);

  // Riaprire il menu MENTRE lavora deve offrire di fermarla: trovarci solo
  // "Traduci la pagina" sarebbe un vicolo cieco.
  const btn2 = await openMenu(page, '#d0');
  expect(await iconLabel(btn2), 'a lavoro in corso il menu non offre di fermare').toBe('Mostra originale');
  await btn2.click();

  // Le richieste già spedite tornano dopo: non devono ritradurre niente.
  await page.waitForTimeout(3000);
  const afterCancel = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[id^="d"]')).filter((e) => /^IT /.test(e.textContent)).length);
  expect(afterCancel, 'dopo l’annullo è rimasto del testo tradotto').toBe(0);
  // E l'avviso "sto traducendo" non è rimasto sullo schermo.
  const live = await page.evaluate(() => Array.from(document.querySelectorAll('.sn-toast'))
    .filter((t) => !t.dataset.snClosing).map((t) => t.textContent).join(' | '));
  expect(live).not.toContain('Traduzione pagina in corso');

  // Si riparte da zero e questa volta si arriva in fondo.
  await stubTranslationProvider(app, 0);
  await clickTranslateIcon(page, '#d0');
  await expect(page.locator('#head')).toHaveText(/^IT /);
  await expect(page.locator('#d24')).toHaveText(/^IT /);
  const doubled = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[id^="d"]')).filter((e) => /IT IT/.test(e.textContent)).length);
  expect(doubled, 'blocchi tradotti due volte').toBe(0);
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Limiti: blocco enorme, emoji, caratteri invisibili, RTL, pagina vuota.
// ───────────────────────────────────────────────────────────────────────────

const HUGE = 'Sentence number X of a very long single block. '.repeat(230); // ~10.000 caratteri

const EXTREMES = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <div id="huge">${HUGE}</div>
  <div id="emoji">Breaking 🚨 news 👩‍👩‍👧‍👦 from the stadium 🏟️ tonight</div>
  <div id="zw">Invisible​​characters﻿inside this line of text</div>
  <div id="rtl">مرحبا بالعالم من هذه الصفحة</div>
  <div id="spaces">     </div>
  <div id="entity">Text with &lt;script&gt;alert(1)&lt;/script&gt; written as characters</div>
</body></html>`;

test('blocco da 10.000 caratteri, emoji, caratteri invisibili, RTL e testo che sembra codice', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, EXTREMES);
  await watchToasts(page);
  await page.evaluate(() => { window.__alerted = false; window.alert = () => { window.__alerted = true; }; });
  await clickTranslateIcon(page, '#emoji');

  for (const id of ['huge', 'emoji', 'zw', 'rtl', 'entity']) {
    await expect(page.locator(`#${id}`), `#${id}`).toHaveText(/^IT /);
  }
  // Il blocco enorme non viene troncato per strada.
  const hugeLen = await page.locator('#huge').evaluate((e) => e.textContent.length);
  expect(hugeLen).toBeGreaterThan(10000);
  // Gli emoji sopravvivono al viaggio.
  await expect(page.locator('#emoji')).toHaveText(/🚨/);
  // Il testo che sembra codice resta testo: nessuno script eseguito, nessun
  // elemento nuovo comparso nella pagina.
  expect(await page.evaluate(() => window.__alerted)).toBe(false);
  expect(await page.locator('#entity script').count()).toBe(0);
  expect(await page.locator('#entity').textContent()).toContain('<script>');
});

test('pagina completamente vuota: lo dice, non resta muta e non crolla', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, '<!doctype html><html lang="en"><head><title>x</title></head><body style="height:400px"></body></html>');
  await watchToasts(page);
  await clickTranslateIcon(page, 'body');

  await expect
    .poll(async () => (await toasts(page)).join(' | '), { timeout: 8000 })
    .toContain('Non ho trovato testo da tradurre');
  // Nessuna richiesta al modello per una pagina senza testo.
  expect(await app.evaluate(() => globalThis.__filoTranslateCalls)).toBe(0);
  // Il menu continua a funzionare dopo (niente stato sporco).
  const btn = await openMenu(page, 'body');
  await expect(btn).toHaveAttribute('data-sn-icon-id', 'translate');
});
