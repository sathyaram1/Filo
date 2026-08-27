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
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      // Nella pagina girano anche altre chiamate AI (es. controllo dominio):
      // qui ci interessano SOLO quelle di traduzione pagina.
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      globalThis.__filoTranslateCalls++;
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
// #503 — l'avviso "tradotta solo in parte" non deve scattare a vuoto.
//
// Gli spazi pubblicitari, i banner dei cookie già chiusi e i riquadri di
// statistica sono componenti chiusi NASCOSTI: su un sito di giornale ce n'è
// sempre almeno uno, e l'avviso usciva praticamente sempre mandando l'utente a
// cercare sullo schermo un rettangolo in lingua originale che non c'è.
//
// Il metro è "l'utente lo vede?", non "quanto è grande il rettangolo":
//  1) portato fuori dallo schermo, reso trasparente, nascosto lasciandogli
//     l'ingombro o tolto dal flusso → NON conta: l'avviso dice "Pagina tradotta";
//  2) semplicemente più in basso della prima schermata → CONTA: è contenuto
//     vero, ci si arriva scorrendo.
// ───────────────────────────────────────────────────────────────────────────

const AD_SLOT_SCRIPT = `<script>
    customElements.define('ad-slot', class extends HTMLElement {
      connectedCallback() {
        this.style.display = 'block';
        this.style.width = '300px';
        this.style.height = '250px';
        const r = this.attachShadow({ mode: 'closed' });
        r.innerHTML = '<div>Sponsored message nobody outside can read</div>';
      }
    });
  </script>`;

// Pagina di giornale tradotta per intero, con quattro spazi pubblicitari chiusi
// nascosti nei quattro modi soliti. Nessuno di loro è sullo schermo.
const HIDDEN_ADS = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px;margin:0">
  <h1 id="plain">The end of an era in European football</h1>
  <p id="body">First paragraph of the body text, long enough to be picked up by the extractor.</p>
  <div style="position:absolute;left:-9999px;top:0"><ad-slot id="adOffscreen"></ad-slot></div>
  <div style="transform:translateX(-200vw)"><ad-slot id="adPushed"></ad-slot></div>
  <div style="opacity:0"><ad-slot id="adTransparent"></ad-slot></div>
  <div style="visibility:hidden"><ad-slot id="adInvisible"></ad-slot></div>
  <div style="display:none"><ad-slot id="adRemoved"></ad-slot></div>
  ${AD_SLOT_SCRIPT}
</body></html>`;

// Stessa pagina, ma lo spazio chiuso è visibilissimo: sta solo più in basso
// della prima schermata. Scorrendo lo si trova, in lingua originale.
const BELOW_FOLD_AD = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px;margin:0">
  <h1 id="plain">The end of an era in European football</h1>
  <p id="body">First paragraph of the body text, long enough to be picked up by the extractor.</p>
  <div style="height:3000px"></div>
  <ad-slot id="adBelow"></ad-slot>
  ${AD_SLOT_SCRIPT}
</body></html>`;

test('spazi chiusi ma invisibili: la pagina è tradotta e l’avviso non manda a cercare niente', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, HIDDEN_ADS);
  await watchToasts(page);

  // Il presupposto della prova: gli spazi ci sono davvero, sono componenti
  // chiusi (nessuno script può leggerci dentro) e nessuno di loro si vede.
  expect(await page.evaluate(() => document.querySelectorAll('ad-slot').length)).toBe(5);
  expect(await page.evaluate(() => [...document.querySelectorAll('ad-slot')].every((el) => !el.shadowRoot))).toBe(true);

  await clickTranslateIcon(page, '#plain');

  await expect(page.locator('#plain')).toHaveText(/^IT /);
  await expect(page.locator('#body')).toHaveText(/^IT /);

  // Quello che conta: l'avviso di fine lavoro dice che la pagina è tradotta,
  // punto. Senza il fix qui usciva "tradotta solo in parte".
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);
  expect((await toasts(page)).filter((t) => t.startsWith('Pagina tradotta solo in parte'))).toEqual([]);
  await page.screenshot({ path: 'tests/.shots/translate-page-hidden-ads.png' }).catch(() => {});
});

test('spazio chiuso sotto la prima schermata: continua a contare, l’avviso resta onesto', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, BELOW_FOLD_AD);
  await watchToasts(page);

  // Fuori dalla prima schermata, ma dentro la pagina: ci si arriva scorrendo.
  expect(await page.evaluate(() => {
    const r = document.querySelector('#adBelow').getBoundingClientRect();
    return r.top + window.scrollY > window.innerHeight;
  })).toBe(true);

  await clickTranslateIcon(page, '#plain');
  await expect(page.locator('#plain')).toHaveText(/^IT /);

  const partial = async () => (await toasts(page)).find((t) => t.startsWith('Pagina tradotta solo in parte'));
  await expect.poll(partial, { timeout: 30000 }).toBeTruthy();
  expect(await toasts(page)).not.toContain('Pagina tradotta');
});

// Striscia pubblicitaria agganciata alla finestra e spinta fuori dallo schermo:
// non scorre con la pagina, quindi non la si raggiunge nemmeno arrivando in
// fondo. Le coordinate del documento qui mentono, ed è per questo che la prova
// scorre prima di tradurre.
const FIXED_HIDDEN_AD = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px;margin:0">
  <h1 id="plain">The end of an era in European football</h1>
  <p id="body">First paragraph of the body text, long enough to be picked up by the extractor.</p>
  <div style="height:3000px"></div>
  <p id="tail">Closing paragraph at the very bottom of a long page.</p>
  <div style="position:fixed;top:-400px;left:0"><ad-slot id="adSticky"></ad-slot></div>
  ${AD_SLOT_SCRIPT}
</body></html>`;

test('striscia agganciata alla finestra e spinta fuori: non la si raggiunge scorrendo, e non fa uscire l’avviso', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, FIXED_HIDDEN_AD);
  await watchToasts(page);

  await page.evaluate(() => window.scrollTo(0, 3000));
  // Con la pagina scorsa, le coordinate del documento direbbero che la striscia
  // sta a metà pagina; sullo schermo invece non c'è.
  expect(await page.evaluate(() => {
    const r = document.querySelector('#adSticky').getBoundingClientRect();
    return { onScreen: r.bottom > 0, docWouldSay: r.top + window.scrollY > 0 };
  })).toEqual({ onScreen: false, docWouldSay: true });

  await clickTranslateIcon(page, '#tail');
  await expect(page.locator('#tail')).toHaveText(/^IT /);

  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);
  expect((await toasts(page)).filter((t) => t.startsWith('Pagina tradotta solo in parte'))).toEqual([]);
});

// ───────────────────────────────────────────────────────────────────────────
// #503 (secondo giro) — nascondere non è solo questione di CSS sull'elemento:
// il modo più comune è RITAGLIARLO da un antenato.
//
//  1) fisarmonica ripiegata / banner dei cookie chiuso: il contenitore è
//     schiacciato a zero e taglia via quello che sborda → NON conta;
//  2) contenitore di dimensioni normali che ritaglia il riquadro spinto più in
//     basso del suo bordo → NON conta;
//  3) pannello con una barra di scorrimento SUA (colonne laterali, finestre col
//     corpo che scorre): il riquadro sta più in basso di quanto il pannello
//     mostri, ma basta scorrere il pannello per averlo sotto gli occhi in
//     lingua originale → CONTA, esattamente come il contenuto sotto la prima
//     schermata.
// ───────────────────────────────────────────────────────────────────────────

const CLIPPED_ADS = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px;margin:0">
  <h1 id="plain">The end of an era in European football</h1>
  <p id="body">First paragraph of the body text, long enough to be picked up by the extractor.</p>
  <!-- Fisarmonica ripiegata: contenitore a zero che taglia via quel che sborda. -->
  <section id="accordion" style="height:0;overflow:hidden">
    <ad-slot id="adFolded"></ad-slot>
  </section>
  <!-- Banner dei cookie chiuso: contenitore di dimensioni normali, riquadro
       spinto fuori dal suo bordo e ritagliato via. -->
  <div id="cookiebar" style="height:30px;overflow:hidden">
    <div style="height:400px"></div>
    <ad-slot id="adClipped"></ad-slot>
  </div>
  ${AD_SLOT_SCRIPT}
</body></html>`;

test('riquadro ritagliato via da un antenato: la pagina è tradotta e l’avviso non manda a cercare niente', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, CLIPPED_ADS);
  await watchToasts(page);

  // Il presupposto della prova: i due riquadri hanno un rettangolo grande —
  // quindi il conteggio "a rettangolo" li prenderebbe — ma sullo schermo non
  // c'è un solo pixel loro, perché l'antenato li ritaglia.
  expect(await page.evaluate(() => {
    const big = (id) => {
      const r = document.querySelector(id).getBoundingClientRect();
      return r.width >= 40 && r.height >= 16;
    };
    const painted = (id) => {
      const el = document.querySelector(id);
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      return document.elementsFromPoint(x, y).includes(el);
    };
    return {
      folded: { big: big('#adFolded'), painted: painted('#adFolded') },
      clipped: { big: big('#adClipped'), painted: painted('#adClipped') },
    };
  })).toEqual({
    folded: { big: true, painted: false },
    clipped: { big: true, painted: false },
  });

  await clickTranslateIcon(page, '#plain');
  await expect(page.locator('#plain')).toHaveText(/^IT /);
  await expect(page.locator('#body')).toHaveText(/^IT /);

  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);
  expect((await toasts(page)).filter((t) => t.startsWith('Pagina tradotta solo in parte'))).toEqual([]);
  await page.screenshot({ path: 'tests/.shots/translate-page-clipped-ads.png' }).catch(() => {});
});

const PANEL_AD = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px;margin:0">
  <h1 id="plain">The end of an era in European football</h1>
  <p id="body">First paragraph of the body text, long enough to be picked up by the extractor.</p>
  <aside id="panel" style="height:200px;width:340px;overflow-y:auto;border:1px solid #ccc">
    <div style="height:1000px"></div>
    <ad-slot id="adInPanel"></ad-slot>
  </aside>
  ${AD_SLOT_SCRIPT}
</body></html>`;

test('riquadro più in basso dentro un pannello che scorre: si raggiunge scorrendo, quindi l’avviso esce', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PANEL_AD);
  await watchToasts(page);

  // Il presupposto: adesso il riquadro non si vede (sta oltre il fondo del
  // pannello), ma il pannello ha una barra di scorrimento sua e ce lo porta.
  expect(await page.evaluate(() => {
    const p = document.querySelector('#panel');
    const r = document.querySelector('#adInPanel').getBoundingClientRect();
    return {
      belowPanel: r.top > p.getBoundingClientRect().bottom,
      panelScrolls: p.scrollHeight > p.clientHeight,
    };
  })).toEqual({ belowPanel: true, panelScrolls: true });

  await clickTranslateIcon(page, '#plain');
  await expect(page.locator('#plain')).toHaveText(/^IT /);

  const partial = async () => (await toasts(page)).find((t) => t.startsWith('Pagina tradotta solo in parte'));
  await expect.poll(partial, { timeout: 30000 }).toBeTruthy();
  expect(await toasts(page)).not.toContain('Pagina tradotta');
});
