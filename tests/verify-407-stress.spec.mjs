// Verifica avversariale #407 — "Traduci la pagina" traduce solo una parte.
//
// Scritta BLACK-BOX dal sintomo utente: apro una pagina-articolo in inglese,
// tasto destro vero, clic sull'icona Traduci, e guardo cosa cambia lingua.
// Il modello è sostituito da una finta traduzione riconoscibile (prefisso
// "‹IT› " su ogni blocco) così un blocco tradotto si distingue a colpo d'occhio
// da uno rimasto in lingua originale.
//
// Oltre alla riproduzione: stress su modello che sbaglia i separatori, modello
// che risponde con HTML/JS, provider KO, doppio clic rapido, pagina enorme,
// contenuti che NON vanno tradotti (codice, campi di testo, roba nascosta).

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SEP = '\n@@@SN_SEP@@@\n';
const SEP_RE = /\n?@@@\s*SN_SEP\s*@@@\n?/;

// Stub del modello nel main process. Modalità pilotabile da globalThis.__trMode.
async function stubModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.__trChunks = [];
    globalThis.__trMode = 'ok';
    globalThis.__trCalls = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const raw = messages[messages.length - 1]?.content;
      const content = typeof raw === 'string' ? raw : JSON.stringify(raw);
      // Solo le richieste di "traduci pagina" ci interessano: le altre funzioni
      // di Filo (categorizzazione, ecc.) passano di qui e falserebbero i conteggi.
      if (content.indexOf('Traduci il seguente testo in italiano mantenendo struttura') !== 0) {
        return { text: '{}', model: 'm', provider: 'gemini', usage: {} };
      }
      const i = content.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? content.slice(i + 'Testo:\n\n'.length) : content;
      globalThis.__trChunks.push(chunk);
      globalThis.__trCalls++;
      const segs = chunk.split(/\n?@@@\s*SN_SEP\s*@@@\n?/);
      const S = '\n@@@SN_SEP@@@\n';
      const mode = globalThis.__trMode;
      const ok = () => segs.map((s) => '‹IT› ' + s).join(S);
      if (mode === 'fail') { const e = new Error('provider giù'); throw e; }
      if (mode === 'empty') return { text: '', model: 'm', provider: 'gemini', usage: {} };
      if (mode === 'html') {
        return {
          text: segs
            .map(() => '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2<\/script>OK')
            .join(S),
          model: 'm', provider: 'gemini', usage: {},
        };
      }
      if (mode === 'merge') {
        // Il modello "dimentica" i separatori e restituisce un blocco unico.
        return { text: '‹IT› ' + segs.join(' '), model: 'm', provider: 'gemini', usage: {} };
      }
      if (mode === 'flaky') {
        // Prima richiesta KO, poi ok: il ritentativo deve salvare la pagina.
        if (globalThis.__trCalls === 1) throw new Error('rete');
        return { text: ok(), model: 'm', provider: 'gemini', usage: {} };
      }
      return { text: ok(), model: 'm', provider: 'gemini', usage: {} };
    };
  });
}

async function setMode(app, mode) {
  await app.evaluate(([m]) => { globalThis.__trMode = m; globalThis.__trCalls = 0; }, [mode]);
}

// L'utente: tasto destro sulla pagina, poi clic sull'icona Traduci del menu.
async function clickTranslate(page, anchor = 'body') {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  await expect(page.locator('.sn-menu')).toBeVisible();
  const btn = page.locator('.sn-menu [data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

// Testo tradotto se contiene il marcatore della finta traduzione.
const MARK = '‹IT›';

async function toastText(page) {
  return page.evaluate(() => {
    const t = document.querySelector('.sn-toast');
    return t ? t.textContent : null;
  });
}

// ---------------------------------------------------------------------------
// 1. Riproduzione esatta della lamentela: articolo misto.
// ---------------------------------------------------------------------------

const ARTICLE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <nav id="nav"><a id="navlink" href="#">Home page of the site</a></nav>
  <header id="hdr">
    <h1 id="title">Breaking news from the capital city</h1>
    <div id="summary">A short summary of what happened yesterday downtown.</div>
  </header>
  <main>
    <p id="p1">The first paragraph of the body explains the situation in detail.</p>
    <figure>
      <div id="fakeimg" style="width:80px;height:40px;background:#ccc"></div>
      <figcaption id="cap">A photo caption describing the picture above.</figcaption>
    </figure>
    <p id="p2">Read the <a id="inlink" href="https://example.com/guide">full guide</a> before you continue.</p>
  </main>
  <aside id="side">
    <h2 id="sidetitle">Read also</h2>
    <ul><li id="sideli"><a id="sidelink" href="https://example.com/other">Another interesting story</a></li></ul>
  </aside>
</body></html>`;

test('articolo: titolo, sommario, didascalia, riquadro laterale, menu e link cambiano lingua', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await stubModel(app);
  const page = await testServer.openReady(openTab, ARTICLE);

  // Marchia i nodi vivi: devono sopravvivere alla traduzione, non essere ricreati.
  await page.evaluate(() => {
    document.getElementById('inlink').__filoProbe = 'inlink';
    document.getElementById('sidelink').__filoProbe = 'sidelink';
    document.getElementById('inlink').addEventListener('click', (e) => {
      e.preventDefault(); window.__inlinkClicked = true;
    });
  });

  await clickTranslate(page);
  await expect.poll(() => toastText(page), { timeout: 45_000 })
    .toBe('Pagina tradotta');

  const got = await page.evaluate(() => {
    const g = (id) => (document.getElementById(id).innerText || '').trim();
    return {
      title: g('title'), summary: g('summary'), p1: g('p1'), cap: g('cap'),
      p2: g('p2'), sidetitle: g('sidetitle'), sidelink: g('sidelink'),
      inlink: g('inlink'), navlink: g('navlink'),
    };
  });
  for (const [k, v] of Object.entries(got)) {
    expect(v, `blocco "${k}" non tradotto: ${JSON.stringify(v)}`).toContain(MARK);
  }

  // I nodi originali sono stati SPOSTATI, non ricreati: link ancora vivi.
  const alive = await page.evaluate(() => ({
    inlink: document.getElementById('inlink')?.__filoProbe,
    sidelink: document.getElementById('sidelink')?.__filoProbe,
    href: document.getElementById('inlink')?.getAttribute('href'),
  }));
  expect(alive).toEqual({ inlink: 'inlink', sidelink: 'sidelink', href: 'https://example.com/guide' });
  await page.locator('#inlink').click();
  expect(await page.evaluate(() => window.__inlinkClicked)).toBe(true);

  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/407-article-translated.png' });

  // "Mostra originale" rimette tutto com'era, link compresi.
  await clickTranslate(page);
  await expect.poll(() => page.evaluate(() => (document.getElementById('title').innerText || '')), { timeout: 15_000 })
    .not.toContain(MARK);
  const back = await page.evaluate(() => {
    const g = (id) => (document.getElementById(id).innerText || '').trim();
    return {
      title: g('title'), summary: g('summary'), cap: g('cap'), p2: g('p2'),
      sidelink: g('sidelink'), probe: document.getElementById('inlink')?.__filoProbe,
      href: document.getElementById('inlink')?.getAttribute('href'),
    };
  });
  expect(back.title).toBe('Breaking news from the capital city');
  expect(back.summary).toBe('A short summary of what happened yesterday downtown.');
  expect(back.cap).toBe('A photo caption describing the picture above.');
  expect(back.p2).toBe('Read the full guide before you continue.');
  expect(back.sidelink).toBe('Another interesting story');
  expect(back.probe).toBe('inlink');
  expect(back.href).toBe('https://example.com/guide');
});

// ---------------------------------------------------------------------------
// 2. Sito "moderno": nessun <p>, tutto in <div>/<span>.
// ---------------------------------------------------------------------------

const APPLIKE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <div id="root">
    <div id="hero"><span id="brand">The daily report</span></div>
    <div id="lead">Everything on this page lives inside generic blocks.</div>
    <div id="body">
      <div id="b1">This is the first block of the article body, written as a div.</div>
      <div id="b2">And this is the second one, also a plain div with text inside.</div>
    </div>
    <div id="foot"><span id="cta">Subscribe now</span></div>
  </div>
</body></html>`;

test('sito costruito a componenti (solo div/span): la traduzione parte e sostituisce il testo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await stubModel(app);
  const page = await testServer.openReady(openTab, APPLIKE);

  await clickTranslate(page);
  await expect.poll(() => toastText(page), { timeout: 45_000 }).toBe('Pagina tradotta');

  const got = await page.evaluate(() => {
    const g = (id) => (document.getElementById(id).innerText || '').trim();
    return { brand: g('brand'), lead: g('lead'), b1: g('b1'), b2: g('b2'), cta: g('cta') };
  });
  for (const [k, v] of Object.entries(got)) {
    expect(v, `blocco "${k}" non tradotto`).toContain(MARK);
  }
  // Il modello è stato davvero interpellato (prima non partiva nemmeno una richiesta).
  expect(await app.evaluate(() => globalThis.__trChunks.length)).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// 3. Pagina senza testo: l'utente deve capire cosa è successo.
// ---------------------------------------------------------------------------

test('pagina senza testo: avviso esplicito invece del silenzio', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await stubModel(app);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:20px">
    <div style="width:120px;height:80px;background:#ddd"></div>
    <div>42</div><div>—</div>
  </body></html>`);

  await clickTranslate(page);
  await expect.poll(() => toastText(page), { timeout: 20_000 })
    .toBe('Non ho trovato testo da tradurre in questa pagina');
  expect(await app.evaluate(() => globalThis.__trChunks.length)).toBe(0);
});

// ---------------------------------------------------------------------------
// 4. Stress: il modello sbaglia i separatori → i testi NON devono sfasarsi.
// ---------------------------------------------------------------------------

test('modello che fonde i blocchi: ogni testo resta nel proprio blocco', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await stubModel(app);
  await setMode(app, 'merge');
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <h1 id="a">Alpha heading about cats</h1>
    <p id="b">Bravo paragraph about dogs and their habits.</p>
    <p id="c">Charlie paragraph about birds and migration.</p>
    <p id="d">Delta paragraph about fish in deep water.</p>
  </body></html>`);

  await clickTranslate(page);
  await expect.poll(() => toastText(page), { timeout: 60_000 })
    .toMatch(/^Pagina tradotta/);

  const got = await page.evaluate(() => {
    const g = (id) => (document.getElementById(id).innerText || '').trim();
    return { a: g('a'), b: g('b'), c: g('c'), d: g('d') };
  });
  // Ogni blocco contiene la PROPRIA parola chiave e nessuna delle altre.
  const keys = { a: 'Alpha', b: 'Bravo', c: 'Charlie', d: 'Delta' };
  for (const [id, own] of Object.entries(keys)) {
    expect(got[id], `blocco ${id}`).toContain(own);
    for (const [other, w] of Object.entries(keys)) {
      if (other !== id) expect(got[id], `blocco ${id} ha rubato il testo di ${other}`).not.toContain(w);
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Stress: risposta del modello con HTML/JS → deve restare testo inerte.
// ---------------------------------------------------------------------------

test('risposta del modello con HTML/script: nessun codice eseguito nella pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await stubModel(app);
  await setMode(app, 'html');
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <h1 id="a">A heading in english here</h1>
    <p id="b">A paragraph in english here as well.</p>
  </body></html>`);

  await clickTranslate(page);
  await expect.poll(() => toastText(page), { timeout: 45_000 }).toMatch(/^Pagina tradotta/);
  await page.waitForTimeout(500);

  const res = await page.evaluate(() => ({
    pwned: window.__pwned,
    imgs: document.querySelectorAll('#a img, #b img').length,
    scripts: document.querySelectorAll('#a script, #b script').length,
    aText: document.getElementById('a').textContent,
  }));
  expect(res.pwned).toBeUndefined();
  expect(res.imgs).toBe(0);
  expect(res.scripts).toBe(0);
  expect(res.aText).toContain('<img');
});

// ---------------------------------------------------------------------------
// 6. Stress: provider KO / risposta vuota → esito onesto, pagina intatta.
// ---------------------------------------------------------------------------

test('provider KO: avviso di errore e pagina lasciata in lingua originale', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await stubModel(app);
  await setMode(app, 'fail');
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <h1 id="a">A heading that stays in english</h1>
    <p id="b">A paragraph that must stay in english too.</p>
  </body></html>`);

  await clickTranslate(page);
  await expect.poll(async () => {
    const t = await toastText(page);
    return t && t !== 'Traduzione pagina in corso…' ? t : null;
  }, { timeout: 60_000 }).not.toBeNull();
  const t = await toastText(page);
  expect(t).not.toBe('Pagina tradotta');
  expect(t).not.toBe('Pagina tradotta solo in parte');
  const txt = await page.evaluate(() => document.getElementById('a').innerText);
  expect(txt).toBe('A heading that stays in english');
});

test('errore singolo di rete: il ritentativo traduce comunque la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await stubModel(app);
  await setMode(app, 'flaky');
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <h1 id="a">A heading in english to translate</h1>
    <p id="b">A paragraph in english to translate as well.</p>
  </body></html>`);

  await clickTranslate(page);
  await expect.poll(() => toastText(page), { timeout: 60_000 }).toMatch(/^Pagina tradotta/);
  expect(await page.evaluate(() => document.getElementById('a').innerText)).toContain(MARK);
});

// ---------------------------------------------------------------------------
// 7. Stress: doppio clic rapido su Traduci.
// ---------------------------------------------------------------------------

test('doppio clic rapido: nessuna doppia traduzione, un solo avviso', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await stubModel(app);
  // Rallenta il modello per aprire davvero la finestra del doppio clic.
  await app.evaluate(() => {
    const orig = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async (a) => {
      await new Promise((r) => setTimeout(r, 1500));
      return orig(a);
    };
  });
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <h1 id="a">A heading in english about something</h1>
    <p id="b">A paragraph in english about something else entirely.</p>
  </body></html>`);

  await clickTranslate(page);
  const toasts1 = await page.evaluate(() => document.querySelectorAll('.sn-toast').length);
  await clickTranslate(page);
  await page.waitForTimeout(300);
  const toasts2 = await page.evaluate(() => document.querySelectorAll('.sn-toast').length);
  expect(toasts1).toBe(1);
  expect(toasts2).toBe(1);

  await expect.poll(() => toastText(page), { timeout: 60_000 }).toMatch(/^Pagina tradotta/);
  const a = await page.evaluate(() => document.getElementById('a').innerText);
  // Un solo marcatore: il blocco non è stato tradotto due volte.
  expect((a.match(/‹IT›/g) || []).length).toBe(1);
});

// ---------------------------------------------------------------------------
// 8. Stress: cosa NON va tradotto (codice, campi utente, nascosto, notranslate).
// ---------------------------------------------------------------------------

test('non tocca codice, campi di testo, contenuti nascosti e la UI di Filo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await stubModel(app);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <h1 id="a">A visible heading in english</h1>
    <pre id="code">const answer = 42; // do not translate this line</pre>
    <textarea id="ta">Text the user is typing right now</textarea>
    <div id="edit" contenteditable="true">Draft the user is writing here</div>
    <div id="hid" style="display:none">Hidden text that nobody sees on screen</div>
    <div id="nt" translate="no">Brand name that must not be translated</div>
    <div id="emoji">Party time 🎉🎉 with emoji and symbols ©®™</div>
  </body></html>`);

  await clickTranslate(page);
  await expect.poll(() => toastText(page), { timeout: 45_000 }).toMatch(/^Pagina tradotta/);

  const got = await page.evaluate(() => ({
    a: document.getElementById('a').innerText,
    code: document.getElementById('code').textContent,
    ta: document.getElementById('ta').value,
    edit: document.getElementById('edit').textContent,
    hid: document.getElementById('hid').textContent,
    nt: document.getElementById('nt').textContent,
    emoji: document.getElementById('emoji').innerText,
  }));
  expect(got.a).toContain(MARK);
  expect(got.emoji).toContain(MARK);
  expect(got.emoji).toContain('🎉');
  expect(got.code).toBe('const answer = 42; // do not translate this line');
  expect(got.ta).toBe('Text the user is typing right now');
  expect(got.edit).toBe('Draft the user is writing here');
  expect(got.hid).toBe('Hidden text that nobody sees on screen');
  expect(got.nt).toBe('Brand name that must not be translated');

  // Nessun chunk inviato al modello contiene testo dell'interfaccia di Filo.
  const chunks = await app.evaluate(() => globalThis.__trChunks.join('\n'));
  expect(chunks).not.toContain('Traduzione pagina in corso');
});

// ---------------------------------------------------------------------------
// 9. Stress: pagina enorme (molti blocchi, testo lungo).
// ---------------------------------------------------------------------------

test('pagina lunga: tutti i blocchi finiscono tradotti', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  await stubModel(app);
  const rows = Array.from({ length: 120 }, (_, i) =>
    `<p id="q${i}">Paragraph number ${i} with a reasonably long english sentence inside of it.</p>`).join('');
  const page = await testServer.openReady(openTab,
    `<!doctype html><html lang="en"><body style="padding:20px">${rows}</body></html>`);

  await clickTranslate(page);
  await expect.poll(() => toastText(page), { timeout: 120_000 }).toMatch(/^Pagina tradotta/);
  const missing = await page.evaluate((mark) => {
    const bad = [];
    document.querySelectorAll('p[id^="q"]').forEach((p) => {
      if (!(p.innerText || '').includes(mark)) bad.push(p.id);
    });
    return bad;
  }, MARK);
  expect(missing).toEqual([]);
  expect(await toastText(page)).toBe('Pagina tradotta');
});
