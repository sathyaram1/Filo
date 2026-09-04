// #407 — verifica avversariale INDIPENDENTE ("prova a romperlo").
//
// Non ripete gli scenari di chi ha scritto il codice: parte dal sintomo come lo
// descrive chi ha segnalato ("resta in inglese metà pagina", "su certi siti non
// fa niente e non dice niente") e prova a farlo ricomparire da strade diverse:
//
//  A) un articolo costruito SENZA nessuno dei tag di prosa (niente <p>, niente
//     <h1>): titolo, sommario, didascalia e "Leggi anche" scritti con blocchi
//     generici, dentro <header>/<aside>/<footer>/<nav>, più tabella e glossario;
//  B) il modello che risponde con HTML/script: non deve finire NIENTE di
//     eseguibile nella pagina;
//  C) testo estremo nella pagina: 10.000 caratteri, emoji, caratteri di
//     controllo, virgolette, scrittura da destra a sinistra, «javascript:»;
//  D) sequenze rapide e inusuali: traduci→originale→traduci→originale, e
//     interruzione a metà seguita da una nuova traduzione immediata. Alla fine
//     la pagina deve tornare IDENTICA all'originale, carattere per carattere,
//     e i pezzi interattivi devono essere ancora vivi (stesso nodo, stessi
//     ascoltatori);
//  E) stato vuoto e pagina fatta di soli campi/immagini.

import { test, expect } from './fixtures/electron.mjs';

// ── Stub del provider, pilotabile dal test ─────────────────────────────────
// mode:
//   'it'      → "IT " davanti a ogni blocco (finta traduzione verificabile)
//   'html'    → il modello risponde con markup e uno <script>
//   'noPlace' → il modello si "dimentica" i segnaposto [[Lk]]
//   'huge'    → risposta lunghissima
async function stubProvider(app, { mode = 'it', delay = 0 } = {}) {
  await app.evaluate(async (_electron, cfg) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__calls = 0;
    globalThis.__sent = [];
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      globalThis.__calls++;
      if (cfg.delay > 0) await new Promise((r) => setTimeout(r, cfg.delay));
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      globalThis.__sent.push(chunk);
      const SEP = '\n@@@SN_SEP@@@\n';
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      const map = (p) => {
        if (cfg.mode === 'html') {
          return `<b class="x">IT ${p}</b><script>window.__pwned = 1;</script>`
            + `<img src="x" onerror="window.__pwned = 2">`;
        }
        if (cfg.mode === 'noPlace') return `IT ${p.replace(/\[\[L\d+\]\]/g, '')}`;
        if (cfg.mode === 'huge') return `IT ${p} ${'Z'.repeat(5000)}`;
        return `IT ${p}`;
      };
      return { text: parts.map(map).join(SEP), provider: 'test', model: 't', usage: {} };
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

async function openMenu(page, anchor) {
  // Lo scorrimento automatico di Playwright e il clic destro possono
  // sovrapporsi su una pagina alta: le coordinate del clic restano quelle di
  // prima dello scorrimento e l'evento cade fuori dalla pagina. Si porta
  // l'elemento in vista, si lascia posare, poi si clicca.
  await page.locator(anchor).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.locator(anchor).first().click({ button: 'right', position: { x: 3, y: 3 } });
}
async function clickTranslate(page, anchor = 'body') {
  await openMenu(page, anchor);
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}
// Nello stato "tradotta e ferma" la stessa icona È il ritorno all'originale.
async function clickRestoreIcon(page, anchor = 'body') {
  await openMenu(page, anchor);
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

// ───────────────────────────────────────────────────────────────────────────
// A. L'articolo del sintomo, ma senza NESSUN tag di prosa.
// ───────────────────────────────────────────────────────────────────────────

const NO_PROSE_ARTICLE = `<!doctype html><html lang="en"><head><title>Original tab name</title></head>
<body style="font:16px sans-serif;padding:16px"><div id="content">
  <nav><div id="nav1">Home page</div><div id="nav2">World news</div></nav>
  <header>
    <div id="kicker">Champions League</div>
    <div id="title">The end of an era in European football</div>
    <span id="standfirst">A short standfirst explaining what this article is about.</span>
  </header>
  <div id="byline">By our correspondent in Madrid</div>
  <div id="body1">First block of body text, written inside a generic container.</div>
  <div id="figure"><img id="photo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="The stadium seen from above">
    <div id="cap">The stadium on the last day of the season</div></div>
  <div id="body2">Second block with a <a id="inlink" href="#x" title="Read the full profile">linked phrase</a> inside it.</div>
  <table><tr><td id="cell1">Total goals scored</td><td id="cell2">Ninety two</td></tr></table>
  <dl><dt id="term">Relegation</dt><dd id="def">Dropping down to a lower division</dd></dl>
  <aside id="related"><div id="relTitle">Read also</div>
    <div><a id="rel1" href="#y">Another English headline</a></div></aside>
  <footer><div id="foot">All rights reserved by the publisher</div></footer>
</div></body></html>`;

test('A — articolo senza tag di prosa: cambia lingua TUTTO, e l’avviso non mente', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, NO_PROSE_ARTICLE);
  await watchToasts(page);
  await clickTranslate(page, '#body1');

  // Ogni pezzo che l'utente elencava nella segnalazione, uno per uno.
  for (const id of ['kicker', 'title', 'standfirst', 'byline', 'body1', 'cap',
    'body2', 'cell1', 'cell2', 'term', 'def', 'relTitle', 'rel1', 'inlink',
    'nav1', 'nav2', 'foot']) {
    await expect(page.locator(`#${id}`), `#${id} è rimasto in lingua originale`).toHaveText(/^IT /);
  }
  // Il nome della scheda e le scritte che stanno negli attributi.
  await expect.poll(() => page.title()).toMatch(/^IT /);
  await expect(page.locator('#photo')).toHaveAttribute('alt', /^IT /);
  await expect(page.locator('#inlink')).toHaveAttribute('title', /^IT /);
  // Struttura intatta: il link è ancora un link, al suo posto.
  await expect(page.locator('#body2 a#inlink')).toHaveAttribute('href', '#x');

  await page.screenshot({ path: 'tests/.shots/v407-rottura-articolo.png' }).catch(() => {});

  const t = (await toasts(page)).join(' | ');
  expect(t).toContain('Pagina tradotta');
  expect(t).not.toContain('solo in parte');
  expect(t).not.toContain('interrotta');
});

// ───────────────────────────────────────────────────────────────────────────
// B. Il modello risponde con HTML ed esecuzione.
// ───────────────────────────────────────────────────────────────────────────

const SIMPLE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:16px">
<div id="content"><div id="a">A first block of English text to translate.</div>
<div id="b">A second block, with a <a id="lk" href="#z">link</a> in it.</div></div></body></html>`;

test('B — markup e script nella risposta del modello non entrano nella pagina', async ({ app, openTab, testServer }) => {
  await stubProvider(app, { mode: 'html' });
  const page = await testServer.openReady(openTab, SIMPLE);
  await watchToasts(page);
  await clickTranslate(page, '#a');

  await expect(page.locator('#a')).toHaveText(/IT /);
  // Niente di eseguibile: nessuno script partito, nessun elemento fabbricato.
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.evaluate(() => document.querySelectorAll('#content script, #content b.x, #content img').length)).toBe(0);
  // Il markup si vede come TESTO, che è l'unico esito onesto.
  await expect(page.locator('#a')).toContainText('<b class="x">');
  // Il link vero è ancora lì, ancora un link.
  await expect(page.locator('#b a#lk')).toHaveAttribute('href', '#z');
});

// ───────────────────────────────────────────────────────────────────────────
// C. Testo estremo nella pagina.
// ───────────────────────────────────────────────────────────────────────────

const LONG = 'The quick brown fox jumps over the lazy dog. '.repeat(240); // ~10.500 caratteri

const EXTREME = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:16px"><div id="content">
  <div id="long">${LONG}</div>
  <div id="emoji">Weather today 🌤️👨‍👩‍👧‍👦 looks fine, said the crew 🇮🇹</div>
  <div id="quotes">He said &quot;hello&quot; &amp; left &lt;immediately&gt; — didn&#39;t he?</div>
  <div id="rtl" dir="rtl">مرحبا بالعالم this line mixes scripts</div>
  <div id="ctrl">Zero&#8203;width and a tab\there, plus a soft&#173;hyphen</div>
  <div id="jsurl"><a id="jslink" href="javascript:window.__ran=1">Click here for more</a></div>
  <div id="ws">   </div>
  <div id="num">12345 67.89 %</div>
</div></body></html>`;

test('C — testo estremo: 10.000 caratteri, emoji, caratteri invisibili, RTL, javascript:', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, EXTREME);
  await watchToasts(page);
  await clickTranslate(page, '#emoji');

  for (const id of ['long', 'emoji', 'quotes', 'rtl', 'ctrl', 'jslink']) {
    await expect(page.locator(`#${id}`), `#${id} non tradotto`).toHaveText(/^IT /);
  }
  // Il blocco lunghissimo non è stato troncato per strada.
  expect(await page.locator('#long').innerText()).toContain('lazy dog');
  expect((await page.locator('#long').innerText()).length).toBeGreaterThan(10000);
  // Emoji composte sopravvissute intatte.
  await expect(page.locator('#emoji')).toContainText('👨‍👩‍👧‍👦');
  // Un indirizzo «javascript:» non viene toccato né eseguito dalla traduzione.
  await expect(page.locator('#jslink')).toHaveAttribute('href', 'javascript:window.__ran=1');
  expect(await page.evaluate(() => window.__ran)).toBeUndefined();
  // Spazi e numeri non sono testo da tradurre: nessuna sostituzione a vuoto.
  await expect(page.locator('#num')).toHaveText('12345 67.89 %');

  const t = (await toasts(page)).join(' | ');
  expect(t).toContain('Pagina tradotta');
  expect(t).not.toContain('solo in parte');
});

// ───────────────────────────────────────────────────────────────────────────
// D. Sequenze rapide, annullamenti, ritorno all'originale fedele.
// ───────────────────────────────────────────────────────────────────────────

const INTERACTIVE = `<!doctype html><html lang="en"><head><title>Original tab name</title></head>
<body style="font:16px sans-serif;padding:16px"><div id="content">
  <div id="t1">First paragraph of the article body.</div>
  <div id="t2">Second one with a <a id="lk" href="#z" title="Open the profile">link inside</a> the sentence.</div>
  <div id="t3">Third block, longer, so the page has something to say about itself.</div>
  <p><button id="btn" title="Press to count">Press me</button> <span id="out">0</span></p>
  <img id="pic" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="A photo of the stadium">
  <form><select id="sel"><option id="o1">Choose a country</option></select>
    <input id="q" placeholder="Search the archive">
    <input id="send" type="submit" name="go" value="Send the form">
    <input id="clear" type="reset" value="Clear the form"></form>
</div>
<script>
  document.getElementById('btn').addEventListener('click', () => {
    const o = document.getElementById('out');
    o.textContent = String(Number(o.textContent) + 1);
  });
  document.getElementById('lk').addEventListener('click', (e) => { e.preventDefault(); window.__linkClicks = (window.__linkClicks || 0) + 1; });
</script></body></html>`;

test('D — traduci/originale ripetuti: la pagina torna IDENTICA e resta viva', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, INTERACTIVE);
  await watchToasts(page);

  const before = await page.locator('#content').innerHTML();
  const titleBefore = await page.title();

  for (let round = 0; round < 3; round++) {
    await clickTranslate(page, '#t1');
    await expect(page.locator('#t1')).toHaveText(/^IT /);
    await expect(page.locator('#t3')).toHaveText(/^IT /);
    // Doppia traduzione: niente "IT IT ".
    expect(await page.locator('#t1').innerText()).not.toMatch(/IT\s+IT/);

    await clickRestoreIcon(page, '#t1');
    await expect(page.locator('#t1')).toHaveText('First paragraph of the article body.');
  }

  // Fedeltà carattere per carattere, attributi compresi.
  expect(await page.locator('#content').innerHTML()).toBe(before);
  expect(await page.title()).toBe(titleBefore);

  // I nodi interattivi sono gli STESSI: gli ascoltatori registrati dal sito
  // prima della traduzione funzionano ancora.
  await page.locator('#btn').click();
  await expect(page.locator('#out')).toHaveText('1');
  await page.locator('#lk').click();
  expect(await page.evaluate(() => window.__linkClicks)).toBe(1);
});

test('D2 — i pezzi interattivi restano vivi anche MENTRE la pagina è tradotta', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, INTERACTIVE);
  await clickTranslate(page, '#t1');
  await expect(page.locator('#t2')).toHaveText(/^IT /);

  // Il link è stato spostato, non ricreato: il suo ascoltatore c'è ancora.
  await page.locator('#lk').click();
  expect(await page.evaluate(() => window.__linkClicks)).toBe(1);
  await page.locator('#btn').click();
  await expect(page.locator('#out')).toHaveText('1');

  // Le scritte fuori dal testo cambiano lingua…
  await expect(page.locator('#q')).toHaveAttribute('placeholder', /^IT /);
  await expect(page.locator('#pic')).toHaveAttribute('alt', /^IT /);
  await expect(page.locator('#clear')).toHaveAttribute('value', /^IT /);
  await expect(page.locator('#o1')).toHaveAttribute('label', /^IT /);
  // …ma NON quello che il modulo rimanda indietro.
  await expect(page.locator('#send')).toHaveAttribute('value', 'Send the form');
  expect(await page.locator('#o1').evaluate((el) => el.value)).toBe('Choose a country');
});

test('D3 — fermare a metà e ritradurre subito: nessuna traduzione fantasma', async ({ app, openTab, testServer }) => {
  await stubProvider(app, { delay: 900 });
  const page = await testServer.openReady(openTab, INTERACTIVE);
  await watchToasts(page);
  const before = await page.locator('#content').innerHTML();

  await clickTranslate(page, '#t1');
  // Ferma mentre lavora: l'icona del menu è già il ritorno all'originale.
  await clickRestoreIcon(page, '#t1');
  await expect(page.locator('#t1')).toHaveText('First paragraph of the article body.');
  // …e ci deve RESTARE anche dopo che le richieste in volo sono tornate.
  await page.waitForTimeout(2500);
  expect(await page.locator('#content').innerHTML()).toBe(before);
  // L'avviso "in corso" non è rimasto appeso.
  const live = await page.evaluate(() => Array.from(document.querySelectorAll('.sn-toast'))
    .filter((t) => !t.dataset.snClosing).map((t) => t.textContent).join(' | '));
  expect(live).not.toContain('in corso');

  // Ripartire subito deve funzionare.
  await stubProvider(app);
  await clickTranslate(page, '#t1');
  await expect(page.locator('#t1')).toHaveText(/^IT /);
  expect(await page.locator('#t1').innerText()).not.toMatch(/IT\s+IT/);
});

test('D4 — il modello dimentica i segnaposto: il link non si perde', async ({ app, openTab, testServer }) => {
  await stubProvider(app, { mode: 'noPlace' });
  const page = await testServer.openReady(openTab, SIMPLE);
  await clickTranslate(page, '#a');
  await expect(page.locator('#b')).toHaveText(/^IT /);
  // Contenuto mai perso: il link torna comunque nella pagina, ancora un link
  // (il suo testo è un'unità sua, quindi cambia lingua anche lui).
  await expect(page.locator('#b a#lk')).toHaveAttribute('href', '#z');
  await expect(page.locator('#b a#lk')).toContainText('link');
  expect(await page.evaluate(() => document.querySelectorAll('#content a').length)).toBe(1);
});

// ───────────────────────────────────────────────────────────────────────────
// E. Stato vuoto e pagine di soli campi.
// ───────────────────────────────────────────────────────────────────────────

const EMPTY = `<!doctype html><html lang="en"><head><title>1234</title></head>
<body style="font:16px sans-serif;padding:16px"><div id="content">
<div id="n1">1234</div><div id="n2">— • ✓</div><div id="n3">   </div>
<div id="n4">🙂🙂</div></div></body></html>`;

test('E — pagina senza testo: lo dice, e non spende una richiesta', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, EMPTY);
  await watchToasts(page);
  await clickTranslate(page, '#n1');

  await expect.poll(async () => (await toasts(page)).join(' | '))
    .toContain('Non ho trovato testo da tradurre');
  expect(await app.evaluate(() => globalThis.__calls)).toBe(0);
  await page.screenshot({ path: 'tests/.shots/v407-rottura-vuoto.png' }).catch(() => {});
});

const ONLY_FIELDS = `<!doctype html><html lang="en"><head><title>1234</title></head>
<body style="font:16px sans-serif;padding:16px"><div id="content">
<img id="pic" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="A photo of the stadium">
<input id="q" placeholder="Search the archive">
</div></body></html>`;

test('D5 — se il modello non risponde MAI, non dice "Pagina tradotta"', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      if (String((last && last.content) || '').indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      const e = new Error('fetch failed');
      e.code = 'NETWORK';
      throw e;
    };
  });
  const page = await testServer.openReady(openTab, SIMPLE);
  await watchToasts(page);
  const before = await page.locator('#content').innerHTML();
  await clickTranslate(page, '#a');

  await expect.poll(async () => (await toasts(page)).join(' | '), { timeout: 20000 })
    .toContain('Non sono riuscito a tradurre la pagina');
  const t = (await toasts(page)).join(' | ');
  expect(t).not.toContain('Pagina tradotta');
  // Mai il messaggio grezzo del provider.
  expect(t).not.toContain('fetch failed');
  // La pagina è rimasta esattamente com'era.
  expect(await page.locator('#content').innerHTML()).toBe(before);
  // E il menu offre ancora di riprovare, non il ritorno all'originale: dopo un
  // buco nell'acqua non è rimasto in piedi nessuno stato di traduzione.
  await openMenu(page, '#a');
  await expect(page.locator('[data-sn-icon-id="translate"]'))
    .toHaveAttribute('aria-label', 'Traduci');
});

// ───────────────────────────────────────────────────────────────────────────
// F. La UI di Filo non deve inquinare il conto del "testo nuovo".
// ───────────────────────────────────────────────────────────────────────────

test('F — dopo una pagina tradotta il menu offre l’originale, non "testo nuovo"', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, NO_PROSE_ARTICLE);
  await watchToasts(page);
  await clickTranslate(page, '#body1');
  await expect(page.locator('#title')).toHaveText(/^IT /);
  await expect.poll(async () => (await toasts(page)).join(' | ')).toContain('Pagina tradotta');

  // I nostri avvisi e i nostri menu sono comparsi nella pagina: se passassero
  // per testo appena arrivato dal sito, il menu proporrebbe di tradurre roba
  // che non esiste e l'utente pagherebbe un giro a vuoto.
  await page.waitForTimeout(1200);
  await openMenu(page, '#body1');
  await expect(page.locator('[data-sn-icon-id="translate"]'))
    .toHaveAttribute('aria-label', 'Mostra originale');
});

// ───────────────────────────────────────────────────────────────────────────
// G. Resa visiva degli avvisi, tema chiaro e tema scuro.
// ───────────────────────────────────────────────────────────────────────────

for (const theme of ['light', 'dark']) {
  test(`G — l’avviso di fine lavoro si legge sul tema ${theme}`, async ({ app, openTab, testServer }) => {
    await stubProvider(app, { delay: 400 });
    await app.evaluate(async (_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), theme);
    const page = await testServer.openReady(openTab, SIMPLE);
    await clickTranslate(page, '#a');
    // Colto MENTRE lavora: è l'avviso che l'utente guarda più a lungo.
    await expect(page.locator('.sn-toast').first()).toBeVisible();
    await page.screenshot({ path: `tests/.shots/v407-rottura-toast-${theme}.png` }).catch(() => {});
    const box = await page.locator('.sn-toast').first().boundingBox();
    // Non tagliato, non fuori dallo schermo.
    const vp = page.viewportSize() || { width: 1280, height: 800 };
    expect(box.width).toBeGreaterThan(80);
    expect(box.height).toBeGreaterThan(16);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
    // Un solo avviso alla volta: due sovrapposti nello stesso angolo sarebbero
    // illeggibili.
    await expect(page.locator('#a')).toHaveText(/^IT /);
    await page.waitForTimeout(300);
    const live = await page.evaluate(() => Array.from(document.querySelectorAll('.sn-toast'))
      .filter((t) => !t.dataset.snClosing).length);
    expect(live).toBeLessThanOrEqual(1);
  });
}

test('E2 — pagina fatta di soli campi e immagini: le scritte cambiano lingua lo stesso', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, ONLY_FIELDS);
  await watchToasts(page);
  await clickTranslate(page, '#content');

  await expect(page.locator('#q')).toHaveAttribute('placeholder', /^IT /);
  await expect(page.locator('#pic')).toHaveAttribute('alt', /^IT /);
  const t = (await toasts(page)).join(' | ');
  expect(t).toContain('Pagina tradotta');
  expect(t).not.toContain('Non ho trovato testo');
});
