// Verifica avversariale #407 — secondo giro, black-box dal sintomo utente.
//
// La lamentela: "Traduci la pagina" lascia in lingua originale pezzi che si
// leggono sullo schermo (titolo, sommario, didascalie, riquadri) e su certi
// siti non fa niente senza dire niente — mentre l'avviso dichiara finito.
//
// Qui si va a cercare quello che la riproduzione base non tocca: il testo che
// NON sta nei blocchi (etichette dei campi, descrizioni delle immagini, voci
// dei menu a tendina, scritte sui bottoni), il testo dentro i componenti dei
// siti moderni, il testo che compare DOPO (scorrimento infinito, fisarmoniche),
// l'annullamento a metà, e i modi in cui un modello ostile potrebbe far entrare
// roba nella pagina attraverso la traduzione.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const MARK = '‹IT›';
const PROMPT_HEAD = 'Traduci il seguente testo in italiano mantenendo struttura';

// Modello finto nel main: prefissa ogni blocco con un marcatore riconoscibile.
// Modalità pilotabili: 'ok' | 'slow' | 'attr-injection'.
async function stubModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.__vChunks = [];
    globalThis.__vCalls = 0;
    globalThis.__vMode = 'ok';
    globalThis.__vDelay = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      const raw = messages[messages.length - 1]?.content;
      const content = typeof raw === 'string' ? raw : JSON.stringify(raw);
      if (content.indexOf('Traduci il seguente testo in italiano mantenendo struttura') !== 0) {
        return { text: '{}', model: 'm', provider: 'gemini', usage: {} };
      }
      const i = content.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? content.slice(i + 'Testo:\n\n'.length) : content;
      globalThis.__vChunks.push(chunk);
      globalThis.__vCalls++;
      if (globalThis.__vDelay) await new Promise((r) => setTimeout(r, globalThis.__vDelay));
      const segs = chunk.split(/\n?@@@\s*SN_SEP\s*@@@\n?/);
      const S = '\n@@@SN_SEP@@@\n';
      if (globalThis.__vMode === 'attr-injection') {
        // Modello ostile: prova a chiudere l'attributo e ad aprirne un altro.
        return {
          text: segs
            .map(() => '‹IT› " onmouseover="window.__pwned=1" x="javascript:alert(1)')
            .join(S),
          model: 'm', provider: 'gemini', usage: {},
        };
      }
      return { text: segs.map((s) => '‹IT› ' + s).join(S), model: 'm', provider: 'gemini', usage: {} };
    };
  });
}

async function setMode(app, mode, delay = 0) {
  await app.evaluate((_e, a) => {
    globalThis.__vMode = a.mode;
    globalThis.__vDelay = a.delay;
    globalThis.__vCalls = 0;
  }, { mode, delay });
}

// L'utente: tasto destro sulla pagina, poi clic sull'icona di traduzione.
async function openMenu(page) {
  await page.locator('body').first().click({ button: 'right', position: { x: 5, y: 5 } });
  await expect(page.locator('.sn-menu')).toBeVisible();
}

async function clickTranslate(page) {
  await openMenu(page);
  const btn = page.locator('.sn-menu [data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

async function translateIconLabel(page) {
  await openMenu(page);
  const btn = page.locator('.sn-menu [data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  return btn.getAttribute('aria-label');
}

async function closeMenu(page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-menu')).toHaveCount(0);
}

// L'avviso più recente ancora sullo schermo: quello di prima può essere ancora
// lì mentre svanisce, e leggerlo al posto dell'ultimo dà un esito vecchio.
async function toastText(page) {
  return page.evaluate(() => {
    const all = document.querySelectorAll('.sn-toast:not([data-sn-closing])');
    const t = all[all.length - 1];
    return t ? t.textContent : null;
  });
}

const settled = async (page) => {
  const t = await toastText(page);
  return t && !/^Traduzione pagina/.test(t) ? t : null;
};

// ---------------------------------------------------------------------------
// 1. Il testo che si legge ma non sta nei blocchi: etichette, descrizioni,
//    voci dei menu a tendina, scritte sui bottoni. E ciò che il modulo RIMANDA
//    INDIETRO non deve cambiare: tradurre un valore inviato romperebbe il sito.
// ---------------------------------------------------------------------------

const LABELS = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="h">The page heading in english</h1>
  <form id="f" action="/x">
    <input id="q" type="search" name="q" placeholder="Search the whole site" title="Type your query here">
    <input id="txt" type="text" name="city" value="Original value of the field">
    <input id="btn" type="button" value="Open the panel now">
    <input id="sub" type="submit" name="do" value="Send the form data">
    <select id="sel" name="country">
      <option id="o1" value="uk">United Kingdom of stuff</option>
      <option id="o2" value="it">Italy and other places</option>
    </select>
    <button id="b2" title="Click here to subscribe">Subscribe to the newsletter</button>
  </form>
  <img id="img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
       alt="A dog running across a green field" title="Photo of a dog">
</body></html>`;

test('etichette sullo schermo (campi, immagini, menu a tendina, bottoni) cambiano lingua e i dati del modulo no', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await stubModel(app);
  const page = await testServer.openReady(openTab, LABELS);

  await clickTranslate(page);
  await expect.poll(() => settled(page), { timeout: 60_000 }).toMatch(/^Pagina tradotta/);

  const got = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    return {
      h: g('h').innerText,
      placeholder: g('q').getAttribute('placeholder'),
      qTitle: g('q').getAttribute('title'),
      alt: g('img').getAttribute('alt'),
      imgTitle: g('img').getAttribute('title'),
      btnValue: g('btn').value,
      b2Text: g('b2').innerText,
      b2Title: g('b2').getAttribute('title'),
      o1Label: g('o1').label,
      o2Label: g('o2').label,
      // Ciò che il modulo rimanda indietro
      txtValue: g('txt').value,
      subValue: g('sub').value,
      selValue: g('sel').value,
      o1Value: g('o1').value,
      qName: g('q').getAttribute('name'),
      imgSrcHead: g('img').getAttribute('src').slice(0, 11),
    };
  });

  // Ciò che si legge: tradotto.
  for (const k of ['h', 'placeholder', 'qTitle', 'alt', 'imgTitle', 'btnValue', 'b2Text', 'b2Title', 'o1Label', 'o2Label']) {
    expect(got[k], `"${k}" è rimasto in lingua originale: ${JSON.stringify(got[k])}`).toContain(MARK);
  }
  // Ciò che si invia: intatto.
  expect(got.txtValue).toBe('Original value of the field');
  expect(got.subValue).toBe('Send the form data');
  expect(got.selValue).toBe('uk');
  expect(got.o1Value).toBe('uk');
  expect(got.qName).toBe('q');
  expect(got.imgSrcHead).toBe('data:image/');

  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/407v-etichette-tradotte.png' });

  // Ritorno all'originale: ciò che è stato aggiunto deve poter essere tolto,
  // etichette comprese — e la <option> che l'attributo non ce l'aveva deve
  // tornare SENZA attributo, non con uno finto.
  await clickTranslate(page);
  await expect.poll(() => toastText(page), { timeout: 20_000 }).toBe('Originale ripristinato');
  const back = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    return {
      h: g('h').innerText,
      placeholder: g('q').getAttribute('placeholder'),
      qTitle: g('q').getAttribute('title'),
      alt: g('img').getAttribute('alt'),
      btnValue: g('btn').value,
      b2Text: g('b2').innerText,
      o1LabelAttr: g('o1').getAttribute('label'),
      o1Text: g('o1').textContent,
      o1Label: g('o1').label,
      selValue: g('sel').value,
    };
  });
  expect(back.h).toBe('The page heading in english');
  expect(back.placeholder).toBe('Search the whole site');
  expect(back.qTitle).toBe('Type your query here');
  expect(back.alt).toBe('A dog running across a green field');
  expect(back.btnValue).toBe('Open the panel now');
  expect(back.b2Text).toBe('Subscribe to the newsletter');
  expect(back.o1LabelAttr).toBeNull();
  expect(back.o1Text).toBe('United Kingdom of stuff');
  expect(back.o1Label).toBe('United Kingdom of stuff');
  expect(back.selValue).toBe('uk');
});

// ---------------------------------------------------------------------------
// 2. Modello ostile che prova a uscire dall'attributo.
// ---------------------------------------------------------------------------

test('modello che prova a iniettare attributi: la scritta resta testo inerte', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await stubModel(app);
  await setMode(app, 'attr-injection');
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <input id="q" placeholder="Search the site here" title="A tooltip in english">
    <img id="img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="Some alt text in english">
  </body></html>`);

  await clickTranslate(page);
  await expect.poll(() => settled(page), { timeout: 45_000 }).not.toBeNull();
  await page.waitForTimeout(400);
  await page.locator('#q').hover();
  await page.locator('#img').hover();
  await page.waitForTimeout(200);

  const res = await page.evaluate(() => {
    const q = document.getElementById('q');
    return {
      pwned: window.__pwned,
      attrs: Array.from(q.attributes).map((a) => a.name).sort(),
      placeholder: q.getAttribute('placeholder'),
    };
  });
  expect(res.pwned).toBeUndefined();
  expect(res.attrs).not.toContain('onmouseover');
  expect(res.attrs).not.toContain('x');
  expect(res.placeholder).toContain('onmouseover');   // testo, non attributo
});

// ---------------------------------------------------------------------------
// 3. Sito a componenti: il testo dentro un componente aperto.
// ---------------------------------------------------------------------------

test('testo dentro un componente del sito: tradotto e ripristinabile', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await stubModel(app);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <h1 id="h">Outside heading in english</h1>
    <my-card id="card"></my-card>
    <script>
      class MyCard extends HTMLElement {
        connectedCallback() {
          const r = this.attachShadow({ mode: 'open' });
          r.innerHTML = '<h2 id="ch">Inner card title in english</h2>'
            + '<div id="cp">Inner card body text written in english here.</div>';
        }
      }
      customElements.define('my-card', MyCard);
    </script>
  </body></html>`);

  await clickTranslate(page);
  await expect.poll(() => settled(page), { timeout: 45_000 }).toMatch(/^Pagina tradotta/);

  const inside = await page.evaluate(() => {
    const r = document.getElementById('card').shadowRoot;
    return { ch: r.getElementById('ch').innerText, cp: r.getElementById('cp').innerText };
  });
  expect(inside.ch, 'titolo dentro il componente non tradotto').toContain(MARK);
  expect(inside.cp, 'testo dentro il componente non tradotto').toContain(MARK);

  await clickTranslate(page);
  await expect.poll(() => toastText(page), { timeout: 20_000 }).toBe('Originale ripristinato');
  const back = await page.evaluate(() => {
    const r = document.getElementById('card').shadowRoot;
    return { ch: r.getElementById('ch').innerText, cp: r.getElementById('cp').innerText };
  });
  expect(back.ch).toBe('Inner card title in english');
  expect(back.cp).toBe('Inner card body text written in english here.');
});

// ---------------------------------------------------------------------------
// 4. Testo che il sito AGGIUNGE dopo (scorrimento infinito).
// ---------------------------------------------------------------------------

test('testo aggiunto dopo la fine: il menu offre di prenderlo e non ritraduce il resto', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await stubModel(app);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <h1 id="h">A heading that is translated first</h1>
    <div id="feed"><p id="p1">The first paragraph of the feed, in english.</p></div>
  </body></html>`);

  await clickTranslate(page);
  await expect.poll(() => settled(page), { timeout: 45_000 }).toMatch(/^Pagina tradotta/);
  const callsAfterFirst = await app.evaluate(() => globalThis.__vCalls);

  // Il sito allunga la pagina mentre l'utente scorre.
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'p2';
    p.textContent = 'A brand new paragraph that arrived later, in english.';
    document.getElementById('feed').appendChild(p);
  });
  await page.waitForTimeout(300);

  expect(await translateIconLabel(page)).toBe('Traduci il testo nuovo');
  // Chi vuole rinunciare deve comunque poter tornare indietro.
  const menuText = await page.evaluate(() => document.querySelector('.sn-menu').textContent);
  expect(menuText).toContain('Mostra originale');
  await closeMenu(page);

  await clickTranslate(page);
  await expect.poll(() => page.evaluate(() => document.getElementById('p2').innerText),
    { timeout: 45_000 }).toContain(MARK);

  const state = await page.evaluate(() => ({
    h: document.getElementById('h').innerText,
    p1: document.getElementById('p1').innerText,
  }));
  // Niente pagato due volte: un solo marcatore per blocco già tradotto.
  expect((state.h.match(/‹IT›/g) || []).length).toBe(1);
  expect((state.p1.match(/‹IT›/g) || []).length).toBe(1);
  const calls = await app.evaluate(() => globalThis.__vCalls);
  expect(calls).toBeGreaterThan(callsAfterFirst);

  // E il testo nuovo mandato al modello è SOLO quello nuovo.
  const lastChunk = await app.evaluate(() => globalThis.__vChunks[globalThis.__vChunks.length - 1]);
  expect(lastChunk).toContain('brand new paragraph');
  expect(lastChunk).not.toContain('A heading that is translated first');
});

// ---------------------------------------------------------------------------
// 5. Testo che l'utente SCOPRE (fisarmonica chiusa che si apre).
// ---------------------------------------------------------------------------

test('sezione ripiegata aperta dopo: il menu offre di tradurla', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await stubModel(app);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <h1 id="h">A visible heading in english</h1>
    <button id="more">Read more</button>
    <div id="fold" style="display:none">
      <p id="hiddenp">The folded paragraph nobody sees until they click, in english.</p>
    </div>
  </body></html>`);

  await clickTranslate(page);
  await expect.poll(() => settled(page), { timeout: 45_000 }).toMatch(/^Pagina tradotta/);
  // Ciò che non si vede non si paga.
  const chunks = await app.evaluate(() => globalThis.__vChunks.join('\n'));
  expect(chunks).not.toContain('folded paragraph');
  expect(await page.evaluate(() => document.getElementById('hiddenp').textContent))
    .toBe('The folded paragraph nobody sees until they click, in english.');

  // L'utente apre la fisarmonica: adesso quel testo si vede, in inglese.
  await page.evaluate(() => { document.getElementById('fold').style.display = 'block'; });
  await page.waitForTimeout(200);
  expect(await translateIconLabel(page)).toBe('Traduci il testo nuovo');
  await closeMenu(page);

  await clickTranslate(page);
  await expect.poll(() => page.evaluate(() => document.getElementById('hiddenp').innerText),
    { timeout: 45_000 }).toContain(MARK);
  expect((await page.evaluate(() => document.getElementById('h').innerText)).match(/‹IT›/g).length).toBe(1);
});

// ---------------------------------------------------------------------------
// 6. Testo che arriva MENTRE traduce: l'avviso non deve dichiarare finito
//    lasciandolo in lingua originale.
// ---------------------------------------------------------------------------

test('il sito allunga la pagina durante il lavoro: niente "finito" con testo in inglese sotto', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  await stubModel(app);
  await setMode(app, 'ok', 900);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <h1 id="h">A heading present from the start</h1>
    <div id="feed"><p id="p1">The paragraph that is there from the beginning.</p></div>
    <script>
      setTimeout(function () {
        var p = document.createElement('p');
        p.id = 'late';
        p.textContent = 'A late paragraph appended while the translation was running.';
        document.getElementById('feed').appendChild(p);
      }, 400);
    </script>
  </body></html>`);

  await clickTranslate(page);
  await expect.poll(() => settled(page), { timeout: 90_000 }).not.toBeNull();
  const toast = await settled(page);
  const late = await page.evaluate(() => document.getElementById('late').innerText);
  // O lo ha preso, o l'avviso dice chiaramente che ne è arrivato dell'altro:
  // ciò che non deve succedere è "Pagina tradotta" secco con l'inglese sotto.
  if (!late.includes(MARK)) {
    expect(toast, `avviso disonesto: "${toast}" con testo ancora in inglese`).not.toBe('Pagina tradotta');
    expect(toast).toContain('Traduci il testo nuovo');
  }
});

// ---------------------------------------------------------------------------
// 7. Annullare a metà: l'avviso "in corso" sparisce subito e la pagina resta
//    dove l'utente l'ha lasciata (nessuna traduzione in ritardo).
// ---------------------------------------------------------------------------

test('annullo a metà: l\'avviso in corso sparisce subito e niente si traduce dopo', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  await stubModel(app);
  await setMode(app, 'ok', 2500);
  const filler = 'A long english sentence used to fill the request up to the limit. ';
  const rows = Array.from({ length: 8 }, (_, i) =>
    `<p id="r${i}">${filler.repeat(9)} Row ${i}.</p>`).join('');
  const page = await testServer.openReady(openTab,
    `<!doctype html><html lang="en"><body style="padding:20px">${rows}</body></html>`);

  await clickTranslate(page);
  await expect.poll(() => toastText(page), { timeout: 15_000 }).toMatch(/^Traduzione pagina/);

  // Tasto destro mentre lavora: l'icona deve fermare.
  expect(await translateIconLabel(page)).toBe('Mostra originale');
  await page.locator('.sn-menu [data-sn-icon-id="translate"]').click();

  await page.waitForTimeout(600);
  const during = await page.evaluate(() => Array.from(
    document.querySelectorAll('.sn-toast:not([data-sn-closing])')).map((t) => t.textContent));
  expect(during.some((t) => /^Traduzione pagina/.test(t)),
    `l'avviso "in corso" è rimasto sullo schermo dopo lo stop: ${JSON.stringify(during)}`).toBe(false);
  expect(during.length).toBeLessThanOrEqual(1);

  // Le risposte già spedite tornano dopo: la pagina non deve ritradursi da sola.
  await page.waitForTimeout(6000);
  const marks = await page.evaluate(() => document.body.innerText.split('‹IT›').length - 1);
  expect(marks, 'la pagina si è ritradotta dopo l\'annullamento').toBe(0);
  const t = await toastText(page);
  expect(t === null || !/^Pagina tradotta/.test(t)).toBe(true);
});

// ---------------------------------------------------------------------------
// 8. Blocco enorme, caratteri strani, testo che sembra codice.
// ---------------------------------------------------------------------------

test('blocco da 10.000 caratteri, emoji e testo che sembra codice: tradotti senza perdere niente', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  await stubModel(app);
  const huge = 'This is one very long english sentence repeated many times. '.repeat(170);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <p id="huge">${huge}</p>
    <p id="odd">Weird ones: &lt;script&gt;alert(1)&lt;/script&gt; &amp; 🎉 ünïcödé ©®™ 100% &quot;quotes&quot;</p>
    <p id="spaces">   </p>
  </body></html>`);

  await clickTranslate(page);
  await expect.poll(() => settled(page), { timeout: 90_000 }).toMatch(/^Pagina tradotta/);
  const res = await page.evaluate(() => ({
    huge: document.getElementById('huge').innerText,
    odd: document.getElementById('odd').innerText,
    scripts: document.querySelectorAll('#odd script').length,
    alerted: window.__alerted,
  }));
  expect(res.huge).toContain(MARK);
  expect(res.huge.length).toBeGreaterThan(9000);
  expect(res.odd).toContain(MARK);
  expect(res.odd).toContain('🎉');
  expect(res.odd).toContain('<script>alert(1)</script>');
  expect(res.scripts).toBe(0);
  expect(res.alerted).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 9. Pagina oltre il tetto di un giro solo: l'avviso non deve mentire, e la
//    ripresa deve arrivare in fondo.
// ---------------------------------------------------------------------------

test('pagina oltre il tetto di un giro: avviso onesto e ripresa che arriva in fondo', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  await stubModel(app);
  const rows = Array.from({ length: 2400 }, (_, i) =>
    `<div id="n${i}">English row number ${i} here.</div>`).join('');
  const page = await testServer.openReady(openTab,
    `<!doctype html><html lang="en"><body style="padding:20px">${rows}</body></html>`);

  await clickTranslate(page);
  await expect.poll(() => settled(page), { timeout: 180_000 }).not.toBeNull();
  const first = await settled(page);
  const leftover = await page.evaluate((mark) => {
    let n = 0;
    document.querySelectorAll('div[id^="n"]').forEach((d) => {
      if (!(d.innerText || '').includes(mark)) n++;
    });
    return n;
  }, MARK);

  // 2400 righe superano il tetto di un giro solo: la coda DEVE restare fuori,
  // altrimenti questo caso non lo sta provando nessuno.
  expect(leftover, 'il tetto di un giro non è stato superato: il caso non è coperto')
    .toBeGreaterThan(0);
  {
    expect(first, `avviso disonesto: "${first}" con ${leftover} righe ancora in inglese`)
      .not.toBe('Pagina tradotta');
    expect(first).toMatch(/Riprendi|riprender/);
    // La ripresa esiste ed è offerta dal tasto destro.
    expect(await translateIconLabel(page)).toMatch(/Riprendi traduzione|Traduci il testo nuovo/);
    await closeMenu(page);
    await clickTranslate(page);
    await expect.poll(async () => page.evaluate((mark) => {
      let n = 0;
      document.querySelectorAll('div[id^="n"]').forEach((d) => {
        if (!(d.innerText || '').includes(mark)) n++;
      });
      return n;
    }, MARK), { timeout: 180_000 }).toBe(0);
  }
});
