// Il correttore: suggerimenti nativi e menu del tasto destro, dizionario personale e correzioni automatiche, segni che
// restano. Una sola app per il file, riportata com'era appena aperta prima di ogni prova (tests/helpers/appCondivisa.mjs).

import { appCondivisa } from './helpers/appCondivisa.mjs';
import { statoDi, clicca, nelMondoDiFilo } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { riquadroDelSegno } from './helpers/segniDelCorrettore.mjs';

const { test, expect } = appCondivisa();

test.describe('spellcheck', () => {
  // Spellcheck: il menu del tasto destro su una parola errata deve mostrare la
  // correzione come PRIMA voce, sia in <textarea> sia in contenteditable.
  // (Feedback alpha gRrZZ: "dovrebbe comparire un suggerimento per correggere in
  // alto come prima opzione".)
  //
  // In test non c'è chiave LLM, quindi la correzione proviene dai suggerimenti
  // NATIVI: li iniettiamo dal main via wc.send('filo:broadcast') esattamente come
  // fa l'evento context-menu di Electron in produzione.

  // Inietta i suggerimenti nativi su TUTTI i webContents con quell'host, non solo
  // sul primo: all'apertura di un tab Electron può avere transitoriamente due
  // WebContentsView con la stessa URL (uno è quello a cui è agganciata la Page di
  // Playwright, l'altro un duplicato/prerender). Un singolo `find()` poteva
  // colpire quello sbagliato → il broadcast andava perso e il menu di correzione
  // non compariva (la flakiness segnalata). Mandandolo a tutti, quello giusto lo
  // riceve sempre. Ritorna il numero di destinatari (>=1 se il tab esiste).
  async function sendNative(app, host, word, suggestions) {
    return app.evaluate(({ webContents }, { host, word, suggestions }) => {
      const targets = webContents.getAllWebContents().filter((w) => {
        try { return new URL(w.getURL()).host === host; } catch { return false; }
      });
      for (const wc of targets) wc.send('filo:broadcast', { type: '_spell:native', word, suggestions });
      return targets.length;
    }, { host, word, suggestions });
  }

  const TA_PAGE = `<!doctype html><html><body style="margin:0">
  <textarea id="ta" spellcheck="true"
    style="font:16px monospace;padding:8px;width:400px;height:120px">ciiao come stai</textarea>
</body></html>`;

  const CE_PAGE = `<!doctype html><html><body style="margin:0">
  <div id="ce" contenteditable="true" spellcheck="true"
    style="font:16px monospace;padding:8px;width:400px;height:120px">ciiao come stai</div>
</body></html>`;

  async function expectCorrectionAtTop({ app, openTab, testServer }, html, selector) {
    const url = testServer.html(html);
    const page = await openTab(url);
    // `filoContentReady` (non `filoReady`): init() è async e setta `filoReady`
    // PRIMA di registrare il listener `_spell:native` (dopo `await fetchSettings`).
    // Aspettare `filoReady` lasciava una finestra in cui il broadcast nativo veniva
    // perso → menu di correzione flaky. `filoContentReady` garantisce che il
    // listener spellcheck sia attivo.
    await page.waitForFunction(
      () => document.documentElement.dataset.filoContentReady === '1',
      null, { timeout: 8000 },
    );

    const sent = await sendNative(app, new URL(url).host, 'ciiao', ['ciao', 'chiao']);
    expect(sent).toBeGreaterThanOrEqual(1);
    // Attende che il broadcast nativo sia stato EFFETTIVAMENTE registrato (non un
    // timeout fisso): solo allora il click destro troverà i suggerimenti pronti.
    await page.waitForFunction(
      () => document.documentElement.dataset.filoNativeWord === 'ciiao',
      null, { timeout: 8000 },
    );

    const box = await page.locator(selector).boundingBox();
    await page.mouse.click(box.x + 16, box.y + 16, { button: 'right' });

    await expect(menuDi(page).locator('.sn-menu')).toBeVisible();
    const corr = menuDi(page).locator('.sn-menu-correction:visible');
    await expect(corr.first()).toBeVisible({ timeout: 4000 });
    await expect(corr.first()).toContainText('ciao');
  }

  test('right-click su parola errata in textarea mostra correzione in cima', async ({ app, openTab, testServer }) => {
    await expectCorrectionAtTop({ app, openTab, testServer }, TA_PAGE, '#ta');
  });

  test('right-click su parola errata in contenteditable mostra correzione in cima', async ({ app, openTab, testServer }) => {
    await expectCorrectionAtTop({ app, openTab, testServer }, CE_PAGE, '#ce');
  });
});

test.describe('spellcheck-autocorrect-multiword', () => {
  // Feedback #397 — le correzioni automatiche di PIÙ parole ("x es" → "per esempio")
  // venivano salvate ma non scattavano mai: tryAutocorrect risaliva al solo token
  // prima del confine e cercava quella singola parola nella mappa, quindi una
  // chiave con uno spazio dentro era irraggiungibile.
  //
  // Questi test asseriscono il SUCCESSO della sostituzione (il testo cambia
  // davvero), non l'assenza di un errore. Senza il fix il primo test è ROSSO:
  // digitando "x es " la textarea resta "x es ".

  const URL_SPELLCHECK = 'filo://spellcheck/spellcheck.html';

  const TA_PAGE = `<!doctype html><html><body style="margin:0">
  <textarea id="ta" style="font:16px monospace;padding:8px;width:400px;height:120px"></textarea>
</body></html>`;

  async function openSpellcheckPage(openTab) {
    const page = await openTab(URL_SPELLCHECK);
    await page.waitForFunction(() => {
      const el = document.getElementById('addAutocorrect');
      return el && el.textContent.length > 0;
    }, null, { timeout: 8_000 });
    return page;
  }

  async function addAutocorrect(page, trigger, correction) {
    await page.fill('#newWord', trigger);
    await page.fill('#newCorrection', correction);
    const before = await page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)').count();
    await page.click('#addAutocorrect');
    await page.waitForFunction((n) => {
      const rows = document.querySelectorAll('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)');
      return rows.length >= n;
    }, before + 1, { timeout: 4_000 });
  }

  // ---------------------------------------------------------------------------
  // tryAutocorrect: una chiave multi-parola scatta durante la digitazione
  // ---------------------------------------------------------------------------
  test('correzione automatica multi-parola: "x es " diventa "per esempio "', async ({ openTab, testServer }) => {
    // 1) Configura le regole PRIMA di aprire la pagina web: il content script le
    //    legge da storage all'init.
    const settingsPage = await openSpellcheckPage(openTab);
    await addAutocorrect(settingsPage, 'x es', 'per esempio');
    await addAutocorrect(settingsPage, 'cmq', 'comunque');

    // 2) Apri una pagina esterna con una textarea e attendi i content script.
    const url = testServer.html(TA_PAGE);
    const page = await openTab(url);
    await page.waitForFunction(
      () => document.documentElement.dataset.filoContentReady === '1',
      null, { timeout: 8000 },
    );
    // loadAutocorrect() è async e non attesa dall'init: lascia che si assesti.
    await page.waitForTimeout(500);

    // 3) Focus (aggancia il watcher) e digita la scorciatoia multi-parola + spazio.
    await page.click('#ta');
    await page.type('#ta', 'x es ');

    // ASSERISCE IL SUCCESSO: la sostituzione multi-parola è avvenuta.
    await expect.poll(
      () => page.locator('#ta').inputValue(),
      { timeout: 3000 },
    ).toBe('per esempio ');

    // 4) Regressione: la scorciatoia a parola singola continua a funzionare,
    //    anche subito dopo l'espansione multi-parola.
    await page.type('#ta', 'cmq ');
    await expect.poll(
      () => page.locator('#ta').inputValue(),
      { timeout: 3000 },
    ).toBe('per esempio comunque ');
  });

  // ---------------------------------------------------------------------------
  // Dizionario personale: input multi-parola aggiunto come voci separate
  // (una voce con spazi dentro non verrebbe mai confrontata con un token).
  // ---------------------------------------------------------------------------
  test('dizionario personale: "New York" viene aggiunto come due voci separate', async ({ openTab }) => {
    const page = await openTab(URL_SPELLCHECK);
    await page.waitForFunction(() => {
      const el = document.getElementById('addDict');
      return el && el.textContent.length > 0;
    }, null, { timeout: 8_000 });

    await page.fill('#newDictWord', 'New York');
    await page.click('#addDict');

    await page.waitForFunction(() => {
      return document.getElementById('dictList')?.querySelectorAll('.sn-spell-word').length === 2;
    }, null, { timeout: 4_000 });

    // Le parole imparate si cambiano scrivendoci (#1447): ogni riga è una casella.
    const words = await page.locator('#dictList .sn-spell-word').evaluateAll((els) => els.map((el) => el.value));
    const set = new Set(words);
    expect(set.has('New')).toBe(true);
    expect(set.has('York')).toBe(true);

    // Lo storage contiene due parole distinte, non la stringa "New York".
    const stored = await page.evaluate(async () => {
      const d = await chrome.storage.local.get('sn_personal_dict');
      return d.sn_personal_dict || [];
    });
    expect(stored).toContain('New');
    expect(stored).toContain('York');
    expect(stored).not.toContain('New York');
  });
});

test.describe('spellcheck-native-in-ritardo', () => {
  // Feedback alpha gRrZZ (riaperto): «in questo stesso box non mi corregge questa parolla». Il correttore di sistema
  // segna la parola ma la correzione non compariva in cima al menu. Con #1446 la parola fuori dizionario è un candidato
  // del correttore di Filo, e senza modello (in prova non c'è chiave) la riga di correzione la riempie il dizionario:
  // anche quando le proposte del sistema arrivano dopo che il menu si è aperto.

  async function newtabPage(app) {
    const deadline = Date.now() + 10_000;
    let win = null;
    while (Date.now() < deadline) {
      win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
      if (win) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(win, 'newtab non trovata').toBeTruthy();
    await win.waitForLoadState('domcontentloaded');
    return win;
  }

  test('textarea con una parola fuori dizionario: la proposta del sistema arrivata in ritardo va in cima', async ({ app }) => {
    const page = await newtabPage(app);
    await page.waitForFunction(
      () => document.documentElement.dataset.filoContentScripts === '1' && typeof globalThis.SN_SPELLCHECK?.segniSotto === 'function',
      null, { timeout: 8_000 },
    );
    await expect.poll(() => page.evaluate(() => globalThis.SN_DIZIONARIO.sbagliata('ciiao')), { timeout: 20_000 }).toBe(true);
    const coords = await page.evaluate(() => {
      const ta = document.createElement('textarea');
      ta.id = 'sn-test-ta';
      ta.value = 'ciiao come stai';
      ta.style.cssText = 'position:fixed;top:200px;left:40px;width:520px;height:120px;font:24px monospace;padding:10px';
      document.body.appendChild(ta);
      ta.focus();
      ta.setSelectionRange(0, 0);
      const r = ta.getBoundingClientRect();
      return { x: r.left + 10 + 24, y: r.top + 10 + 14 };
    });
    await page.evaluate(({ x, y }) => {
      document.getElementById('sn-test-ta').dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2,
      }));
    }, coords);
    await expect(menuDi(page).locator('.sn-menu')).toBeVisible({ timeout: 5_000 });
    await page.evaluate(() => {
      for (const fn of globalThis.chrome.runtime.onMessage._listeners) {
        try { fn({ type: '_spell:native', word: 'ciiao', suggestions: ['ciao', 'chiao'] }); } catch (_) {}
      }
    });
    const correction = menuDi(page).locator('.sn-menu .sn-menu-correction');
    await expect(correction).toBeVisible({ timeout: 5_000 });
    await expect(correction.locator('.sn-menu-label').first()).toHaveText('ciao');
  });
});

test.describe('spellcheck-filo-page', () => {
  // Regressione feedback #4 ("Correttore poco preciso e malfunzionante"):
  // segnalate due problematiche distinte.
  //
  // (A) Lingua suggerimenti: il correttore nativo (Hunspell) suggeriva parole
  //     inglesi anche su testo italiano perché la lingua di sistema (spesso en-US)
  //     aveva priorità sull'italiano. Fix: configureSpellchecker() ora mette 'it'
  //     per prima nella lista — il test verifica che il dizionario italiano sia
  //     configurato come primo dizionario disponibile.
  //
  // (B) Box feedback: cliccando col tasto destro su una parola errata in una
  //     textarea di una pagina filo:// (es. il box "Invia feedback") non
  //     comparivano suggerimenti. Il meccanismo è identico alle pagine esterne:
  //     il broadcast `_spell:native` deve arrivare e il menu Filo deve mostrare
  //     la correzione in cima. Il test simula il broadcast e verifica che la riga
  //     di correzione appaia nel menu personalizzato di Filo.

  // ── helper: recupera la pagina newtab (è sempre aperta all'avvio) ──────────
  async function newtabPage(app) {
    const deadline = Date.now() + 10_000;
    let win = null;
    while (Date.now() < deadline) {
      win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
      if (win) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(win, 'newtab non trovata').toBeTruthy();
    await win.waitForLoadState('domcontentloaded');
    return win;
  }

  // ── (A) italiano prioritario nel correttore nativo ─────────────────────────
  test('(A) il dizionario italiano è primo nella lista lingue del correttore', async ({ app }) => {
    const info = await app.evaluate(async ({ session }) => {
      const ses = session.defaultSession;
      return {
        available: ses.availableSpellCheckerLanguages || [],
        configured: ses.getSpellCheckerLanguages ? ses.getSpellCheckerLanguages() : [],
      };
    });

    // Su macOS (NSSpellChecker) la lista Hunspell è vuota: skip.
    if (!info.available.length) {
      test.info().annotations.push({ type: 'skip', description: 'nessun dizionario Hunspell (macOS)' });
      return;
    }

    expect(info.configured.length, 'almeno una lingua configurata').toBeGreaterThan(0);

    // Se il dizionario italiano è disponibile nell'ambiente, deve essere il PRIMO.
    const italianAvailable = info.available.some((l) => l.toLowerCase().startsWith('it'));
    if (italianAvailable) {
      expect(
        info.configured[0].toLowerCase().startsWith('it'),
        `l'italiano deve essere il primo dizionario (configured: ${JSON.stringify(info.configured)})`,
      ).toBe(true);
    }
  });

  // ── (B) suggerimento su filo:// page (box feedback) ────────────────────────
  // Simula il right-click su una parola errata in una textarea su una pagina
  // interna filo:// (newtab è la più semplice da aprire). Il broadcast
  // `_spell:native` viene iniettato manualmente (come fa Electron in produzione
  // quando Hunspell trova la parola errata), e verifichiamo che la riga di
  // correzione Filo compaia nel menu personalizzato.
  test('(B) click destro su parola errata in textarea filo:// mostra la correzione', async ({ app }) => {
    const page = await newtabPage(app);

    // Aspetta che i content script siano montati.
    await page.waitForFunction(
      () => document.documentElement.dataset.filoContentScripts === '1' &&
            typeof globalThis.SN_SPELLCHECK?.onNativeSuggestions === 'function',
      null,
      { timeout: 8_000 },
    );

    // Crea una textarea di test nel documento filo:// e inietta una parola errata.
    // Usa document.body per non interferire con la struttura del newtab.
    const coords = await page.evaluate(() => {
      const ta = document.createElement('textarea');
      ta.setAttribute('data-sn-test', 'spell');
      ta.style.cssText = 'position:fixed;top:50px;left:50px;width:300px;height:80px;font:16px monospace';
      ta.value = 'quii';
      document.body.appendChild(ta);
      ta.focus();

      const r = ta.getBoundingClientRect();
      const x = r.left + 10;
      const y = r.top + r.height / 2;

      // Inietta il broadcast nativo per "quii" come farebbe Electron via
      // wc.on('context-menu') → wc.send('filo:broadcast').
      const listeners = globalThis.chrome.runtime.onMessage._listeners;
      for (const fn of listeners) {
        try {
          fn({ type: '_spell:native', word: 'quii', suggestions: ['qui', 'quiz'] });
        } catch (_) {}
      }
      return { x, y };
    });

    // Dispatcha il contextmenu sopra la parola (sulla textarea stessa).
    await page.evaluate(({ x, y }) => {
      const ta = document.querySelector('textarea[data-sn-test="spell"]');
      if (!ta) return;
      const ev = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2,
      });
      ta.dispatchEvent(ev);
    }, coords);

    // Il menu Filo deve aprirsi con la correzione in cima.
    const correction = menuDi(page).locator('.sn-menu .sn-menu-correction');
    await expect(correction).toBeVisible({ timeout: 5_000 });

    // Verifica che la correzione mostri il suggerimento nativo italiano.
    await expect(correction.locator('.sn-menu-label').first()).toHaveText('qui');
  });
});

test.describe('spellcheck-input-correction', () => {
  // Regression test per il feedback "non compare il suggerimento di correzione
  // in cima al menu" sulla newtab.
  //
  // Sintomo: click destro su una parola errata scritta nella barra di input
  // (un <input type=text>) non mostrava alcuna correzione. La vecchia estensione
  // browser lo mostrava; dopo il refactor la app si affidava ai SOLI suggerimenti
  // nativi di Electron, che non arrivano quando il dizionario della lingua attiva
  // non flagga la parola.
  //
  // Fix: per gli <input> testuali estraiamo la parola sotto il cursore
  // (getInputWordAt) e usiamo lo stesso menu di correzione di textarea/CE, che
  // applica la correzione via applyFix (ora gestisce anche gli <input>).
  //
  // Il test asserisce il SUCCESSO della feature: estraendo la parola errata e
  // applicando una correzione, il testo dell'input viene davvero corretto. Prima
  // del fix getInputWordAt non esisteva e applyFix non toccava gli <input>.

  async function newtabPage(app) {
    const deadline = Date.now() + 10_000;
    let win = null;
    while (Date.now() < deadline) {
      win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
      if (win) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(win, 'newtab non trovata').toBeTruthy();
    await win.waitForLoadState('domcontentloaded');
    return win;
  }

  test('parola errata in <input>: estrazione + correzione applicate', async ({ app }) => {
    const page = await newtabPage(app);
    await page.waitForFunction(
      () => document.documentElement.dataset.filoContentScripts === '1' &&
            typeof globalThis.SN_SPELLCHECK?.getInputWordAt === 'function',
      null,
      { timeout: 8_000 },
    );

    // Il campo `#input` della dashboard è ora una <textarea> (non un <input type=text>):
    // creiamo noi un <input type=text> dedicato per testare la funzione getInputWordAt.
    // In questo modo il test resta valido anche se il layout della dashboard cambia.
    const result = await page.evaluate(() => {
      // Crea un <input type=text> di test con testo e dimensioni note.
      const input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('data-sn-test', 'correction');
      input.style.cssText = 'position:fixed;top:200px;left:50px;width:300px;font:16px monospace;padding:4px';
      input.value = 'ciiao come stai';
      document.body.appendChild(input);
      input.focus();

      const r = input.getBoundingClientRect();
      const cs = getComputedStyle(input);
      // X viewport che cade sopra la prima parola "ciiao".
      const x = r.left + parseFloat(cs.paddingLeft || 0)
        + parseFloat(cs.borderLeftWidth || 0) + 8;
      const wordCtx = SN_SPELLCHECK.getInputWordAt(input, x);
      if (!wordCtx) return { wordCtx: null, value: input.value };
      SN_SPELLCHECK.applyFix(
        input,
        { start: wordCtx.start, end: wordCtx.end },
        'ciao',
        { expectedSegment: wordCtx.word },
      );
      return { word: wordCtx.word, value: input.value };
    });

    expect(result.error).toBeFalsy();
    expect(result.word).toBe('ciiao');
    expect(result.value).toBe('ciao come stai');
  });
});

test.describe('spellcheck-input-menu-top', () => {
  // Feedback gRrZZ (newtab): "dovrebbe comparire un suggerimento per correggere
  // in alto come prima opzione (la vecchia versione — estensione browser —
  // funzionava, dopo il refactor passando ad un'app dedicata non funziona più)".
  //
  // Scenario reale dello screenshot: la barra di input della dashboard
  // (filo://newtab/ → <input type=text> "Chiedi qualsiasi cosa…") con una parola
  // errata ("ciiao come stai"). Click destro sulla parola: la PRIMA voce del menu
  // deve essere la correzione suggerita.
  //
  // Questo test asserisce il comportamento VISIBILE end-to-end (non solo i mattoni
  // getInputWordAt/applyFix coperti altrove): dispatcha un vero evento
  // `contextmenu` sull'input e verifica che il menu Filo si apra con un item di
  // correzione in cima che mostra il suggerimento. Prima del fix (la app si
  // affidava ai soli suggerimenti nativi e non estraeva la parola dagli <input>)
  // il menu si apriva senza alcuna correzione → il primo item NON era una
  // correzione.

  async function newtabPage(app) {
    const deadline = Date.now() + 10_000;
    let win = null;
    while (Date.now() < deadline) {
      win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
      if (win) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(win, 'newtab non trovata').toBeTruthy();
    await win.waitForLoadState('domcontentloaded');
    return win;
  }

  test('click destro su parola errata nella barra input: correzione in cima al menu', async ({ app }) => {
    const page = await newtabPage(app);
    await page.waitForFunction(
      () => document.documentElement.dataset.filoContentScripts === '1' &&
            typeof globalThis.SN_SPELLCHECK?.getInputWordAt === 'function',
      null,
      { timeout: 8_000 },
    );

    // Prepara l'input con la parola errata e calcola le coordinate del click
    // destro sopra "ciiao". Simula inoltre l'arrivo del suggerimento nativo di
    // Electron (lo stesso che sta dietro lo zigzag rosso) così la correzione è
    // disponibile subito, senza dipendere dall'LLM (che in test non ha chiave).
    const coords = await page.evaluate(() => {
      const input = document.getElementById('input');
      if (!input) return { error: 'input mancante' };
      input.value = 'ciiao come stai';
      input.focus();
      const r = input.getBoundingClientRect();
      const cs = getComputedStyle(input);
      const x = r.left + parseFloat(cs.paddingLeft || 0)
        + parseFloat(cs.borderLeftWidth || 0) + 8;
      const y = r.top + r.height / 2;

      // Inietta il broadcast nativo per la parola "ciiao".
      const listeners = globalThis.chrome.runtime.onMessage._listeners;
      for (const fn of listeners) {
        try {
          fn({ type: '_spell:native', word: 'ciiao', suggestions: ['ciao', 'chiao'] });
        } catch (_) {}
      }
      return { x, y };
    });
    expect(coords.error).toBeFalsy();

    // Dispatcha un vero evento contextmenu sopra la parola.
    await page.evaluate(({ x, y }) => {
      const input = document.getElementById('input');
      const ev = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2,
      });
      input.dispatchEvent(ev);
    }, coords);

    // Il menu Filo si apre con la correzione come PRIMA voce.
    const correction = menuDi(page).locator('.sn-menu .sn-menu-correction');
    await expect(correction).toBeVisible({ timeout: 5_000 });

    // È davvero il primo item del menu (in cima).
    const firstItemIsCorrection = await menuDi(page).valuta(() => {
      const menu = document.querySelector('.sn-menu');
      if (!menu) return false;
      const first = Array.from(menu.children).find(
        (c) => !c.classList.contains('sn-menu-sep') && c.style.display !== 'none',
      );
      return !!first && first.classList.contains('sn-menu-correction');
    });
    expect(firstItemIsCorrection).toBe(true);

    // Mostra il suggerimento di correzione.
    await expect(correction.locator('.sn-menu-label').first()).toHaveText('ciao');
  });
});

test.describe('spellcheck-languages', () => {
  // Feedback alpha gRrZZ: il suggerimento di correzione deve comparire in cima al
  // menu come nella vecchia estensione. Una delle cause di "non appare nulla" era
  // che il correttore NATIVO di Electron non aveva i dizionari attivi: senza
  // configurazione esplicita usa solo la lingua di sistema, quindi su parole
  // italiane i `dictionarySuggestions` (che il main inoltra al menu via
  // `_spell:native`) restavano vuoti. configureSpellchecker() in main.js ora
  // abilita esplicitamente locale di sistema + italiano + inglese.
  //
  // Questo test verifica che la configurazione sia stata applicata: se i dizionari
  // Hunspell sono disponibili nell'ambiente, l'italiano DEVE risultare attivo.

  test('il correttore nativo ha i dizionari (incluso italiano) configurati', async ({ app }) => {
    const info = await app.evaluate(async ({ session }) => {
      const ses = session.defaultSession;
      return {
        available: ses.availableSpellCheckerLanguages || [],
        configured: ses.getSpellCheckerLanguages ? ses.getSpellCheckerLanguages() : [],
      };
    });

    // Su macOS (NSSpellChecker) la lista Hunspell è vuota e la configurazione è
    // un no-op: in quel caso non asseriamo nulla sui codici.
    if (!info.available.length) {
      test.info().annotations.push({ type: 'skip', description: 'nessun dizionario Hunspell (macOS)' });
      return;
    }

    // Configurazione applicata: almeno una lingua attiva.
    expect(info.configured.length).toBeGreaterThan(0);

    // Se l'italiano è disponibile nell'ambiente, DEVE essere tra le lingue attive
    // (è il fix specifico per le parole italiane del feedback).
    const italianAvailable = info.available.some((l) => l.toLowerCase().startsWith('it'));
    if (italianAvailable) {
      const italianConfigured = info.configured.some((l) => l.toLowerCase().startsWith('it'));
      expect(italianConfigured).toBe(true);
    }
  });
});

test.describe('spellcheck-native-event-fires', () => {
  // Feedback alpha gRrZZ (regressione reale): dopo il refactor da estensione ad
  // app dedicata, il suggerimento ortografico in cima al menu del tasto destro non
  // compariva più. Causa: il content script chiamava e.preventDefault() sull'evento
  // DOM `contextmenu`, e questo IMPEDISCE a Chromium di emettere nel main process
  // l'evento `context-menu` del webContents — l'unico che porta `misspelledWord` +
  // `dictionarySuggestions` del correttore nativo. Senza quell'evento i broadcast
  // `_spell:native` (che alimentano la correzione in cima al menu, come faceva il
  // menu nativo di Chrome nella vecchia estensione) non partivano mai in
  // produzione: scattavano SOLO nei test che li iniettano a mano.
  //
  // Questo test guarda il canale alla radice: fa un VERO click destro su una
  // pagina e verifica che l'evento `context-menu` del webContents scatti nel main
  // process. Prima del fix (preventDefault) NON scatta → 0 eventi → test rosso.
  // Dopo il fix (niente preventDefault, solo stopImmediatePropagation) scatta →
  // test verde. È indipendente dai dizionari Hunspell (che in CI headless non
  // vengono scaricati): asserisce che il canale dei suggerimenti nativi è aperto.

  const PAGE = `<!doctype html><html><body style="margin:0">
  <div id="ce" contenteditable="true" spellcheck="true" lang="it"
       style="font:24px monospace;padding:10px;width:500px;height:120px">testo</div>
</body></html>`;

  // In headless Linux il CDP-simulated right-click non sempre fa scattare
  // l'evento `context-menu` del webContents a ogni singolo click (dipende da
  // dbus/X11). Usiamo retries a livello di describe per riprovare l'intera
  // sequenza fino a 3 volte in stato fresco, senza mascherare bug reali (se
  // preventDefault fosse attivo, il test fallirebbe su TUTTI i retry).
  test.describe('canale context-menu nativo', () => {
    test.describe.configure({ retries: 3 });

    test('il click destro lascia scattare l\'evento context-menu nativo (canale suggerimenti aperto)', async ({ app, openTab, testServer }) => {
      const url = testServer.html(PAGE);
      const host = new URL(url).host;
      const page = await openTab(url);
      // `filoContentReady` (non `filoReady`): init() è async e setta `filoReady`
      // prima di registrare l'handler `contextmenu`; aspettare quello sbagliato
      // lasciava una finestra in cui il click destro non era ancora intercettato.
      await page.waitForFunction(
        () => document.documentElement.dataset.filoContentReady === '1',
        null, { timeout: 8000 },
      );

      // Aggancia un contatore sull'evento `context-menu` di TUTTI i webContents con
      // quell'host (non solo il primo): all'apertura di un tab Electron può averne
      // due con la stessa URL, e attaccare il listener a quello sbagliato lasciava
      // __ctxCount a 0 anche quando l'evento scattava (fonte di flakiness).
      await app.evaluate(({ webContents }, host) => {
        globalThis.__ctxCount = 0;
        const targets = webContents.getAllWebContents().filter((w) => {
          try { return new URL(w.getURL()).host === host; } catch { return false; }
        });
        for (const wc of targets) wc.on('context-menu', () => { globalThis.__ctxCount++; });
      }, host);

      // Vero click destro sul contenuto editabile.
      const box = await page.locator('#ce').boundingBox();
      await page.mouse.click(box.x + 20, box.y + 24, { button: 'right' });

      // Il menu Filo custom si apre comunque (nessuna regressione al menu).
      await expect(menuDi(page).locator('.sn-menu')).toBeVisible({ timeout: 4000 });

      // Chiudi il menu e riapri: in headless Linux il primo click può essere
      // "sordo" per il context-menu del webContents (evento OS non sempre emesso
      // al primo CDP-simulated right-click). Un secondo click aumenta
      // significativamente l'affidabilità senza cambiare la semantica del test.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      await page.mouse.click(box.x + 20, box.y + 24, { button: 'right' });
      await expect(menuDi(page).locator('.sn-menu')).toBeVisible({ timeout: 4000 });

      // E l'evento nativo è scattato almeno una volta: senza il fix (preventDefault)
      // sarebbe sempre 0 perché preventDefault blocca l'emissione dell'evento.
      await expect.poll(
        () => app.evaluate(() => globalThis.__ctxCount),
        { timeout: 8000, message: 'l\'evento context-menu del webContents non è scattato: il canale dei suggerimenti nativi è chiuso (preventDefault?)' },
      ).toBeGreaterThan(0);
    });
  });
});

test.describe('spellcheck-native-suggestion', () => {
  // Regression test per il feedback "non vedo la parola suggerita" sulla newtab.
  //
  // Bug: openNormalMenuAt() fa `await getClipboardHistory()` PRIMA di registrare
  // il waiter `onNextNativeSuggestion`. Il broadcast `_spell:native` dal main
  // arrivava in mezzo all'await: il waiter veniva registrato dopo che
  // `lastNative` era già stato aggiornato, ma onNextNativeSuggestion ascoltava
  // solo broadcast futuri, quindi perdeva il suggerimento e l'item di
  // correzione restava nascosto.
  //
  // Fix: onNextNativeSuggestion accetta { since: ts } e se lastNative è arrivato
  // dopo quell'istante lo consegna subito. Qui verifichiamo il fix simulando
  // l'arrivo "in anticipo" del broadcast.

  async function newtabPage(app) {
    const deadline = Date.now() + 10_000;
    let win = null;
    while (Date.now() < deadline) {
      win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
      if (win) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(win, 'newtab non trovata').toBeTruthy();
    await win.waitForLoadState('domcontentloaded');
    return win;
  }

  test('onNextNativeSuggestion consegna lastNative arrivato durante await', async ({ app }) => {
    const page = await newtabPage(app);
    await page.waitForFunction(
      () => document.documentElement.dataset.filoContentScripts === '1' &&
            typeof globalThis.SN_SPELLCHECK?.onNextNativeSuggestion === 'function',
      null,
      { timeout: 8_000 },
    );

    const result = await page.evaluate(async () => {
      const openedAt = Date.now();
      // Simula l'arrivo "in mezzo all'await" del broadcast nativo: prima
      // facciamo finta che sia arrivato (chrome.runtime.onMessage listener
      // popola lastNative), poi registriamo il waiter passando since=openedAt.
      const listeners = globalThis.chrome.runtime.onMessage._listeners;
      for (const fn of listeners) {
        try { fn({ type: '_spell:native', word: 'recieve', suggestions: ['receive', 'reverse', 'received'] }); } catch (_) {}
      }
      // Piccola attesa per simulare il completamento dell'await.
      await new Promise((r) => setTimeout(r, 30));
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ timedOut: true }), 1000);
        SN_SPELLCHECK.onNextNativeSuggestion(({ word, suggestions }) => {
          clearTimeout(timer);
          resolve({ word, suggestions });
        }, { since: openedAt });
      });
    });

    expect(result.timedOut).toBeFalsy();
    expect(result.word).toBe('recieve');
    expect(result.suggestions[0]).toBe('receive');
  });

  test('onNextNativeSuggestion ignora lastNative precedente al since', async ({ app }) => {
    const page = await newtabPage(app);
    await page.waitForFunction(
      () => document.documentElement.dataset.filoContentScripts === '1' &&
            typeof globalThis.SN_SPELLCHECK?.onNextNativeSuggestion === 'function',
      null,
      { timeout: 8_000 },
    );

    const result = await page.evaluate(async () => {
      // Simula un broadcast di un right-click "vecchio" (3s fa).
      const listeners = globalThis.chrome.runtime.onMessage._listeners;
      for (const fn of listeners) {
        try { fn({ type: '_spell:native', word: 'old', suggestions: ['older'] }); } catch (_) {}
      }
      await new Promise((r) => setTimeout(r, 50));
      const openedAt = Date.now(); // nuovo right-click ADESSO, dopo il broadcast
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ timedOut: true }), 300);
        SN_SPELLCHECK.onNextNativeSuggestion(({ word }) => {
          clearTimeout(timer);
          resolve({ word });
        }, { since: openedAt, timeoutMs: 250 });
      });
    });

    // Deve scadere in timeout: il broadcast vecchio non va consumato.
    expect(result.timedOut).toBeTruthy();
  });
});

test.describe('spellcheck-native', () => {
  // Regressione (feedback alpha gRrZZ): dopo il refactor da estensione ad app, il
  // suggerimento di correzione NON compariva più in cima al menu del tasto destro
  // su una parola errata. Causa storica: il wiring del broadcast `_spell:native`
  // (suggerimenti nativi di Electron) era andato perso, quindi getNativeSuggestions
  // restava sempre vuoto. Questo test guida il path NATIVO end-to-end su una pagina
  // esterna e asserisce che il suggerimento corretto compaia come PRIMA voce.
  //
  // Determinismo: in test non c'è chiave LLM, quindi la riga di correzione può
  // provenire SOLO dai suggerimenti nativi inviati dal main (esattamente come fa
  // l'evento `context-menu` di Electron in produzione, via wc.send('filo:broadcast')).
  // Senza il wiring (slot nascosto) il test fallisce; con esso la correzione appare.

  const PAGE = `<!doctype html><html><body style="margin:0">
  <div id="ce" contenteditable="true" spellcheck="true"
       style="font:16px monospace;padding:8px;width:400px;height:120px">wrlod ciao</div>
</body></html>`;

  // Invia il broadcast nativo dal main al webContents della pagina, come fa
  // Electron quando l'utente clicca destro su una parola sotto lo zigzag rosso.
  // Invia a TUTTI i webContents con quell'host (non solo al primo): all'apertura
  // di un tab Electron può avere transitoriamente due WebContentsView con la stessa
  // URL, e un singolo `find()` poteva colpire quello sbagliato → broadcast perso →
  // test flaky. Vedi la stessa nota in spellcheck.spec.mjs.
  async function sendNative(app, host, word, suggestions) {
    return app.evaluate(({ webContents }, { host, word, suggestions }) => {
      const targets = webContents.getAllWebContents().filter((w) => {
        try { return new URL(w.getURL()).host === host; } catch { return false; }
      });
      for (const wc of targets) wc.send('filo:broadcast', { type: '_spell:native', word, suggestions });
      return targets.length;
    }, { host, word, suggestions });
  }

  test('suggerimento nativo compare in cima al menu su parola errata', async ({ app, openTab, testServer }) => {
    const url = testServer.html(PAGE);
    const page = await openTab(url);
    // `filoContentReady` (non `filoReady`): garantisce che il listener spellcheck
    // sia già registrato — init() è async e setta `filoReady` prima di esso.
    await page.waitForFunction(
      () => document.documentElement.dataset.filoContentReady === '1',
      null, { timeout: 8000 },
    );

    // Pre-popola i suggerimenti nativi per "wrlod" e attende che siano stati
    // EFFETTIVAMENTE registrati nel content script prima del click (niente timeout
    // fisso): così sono freschi quando il menu si compone, in modo deterministico.
    const sent = await sendNative(app, new URL(url).host, 'wrlod', ['world', 'word']);
    expect(sent).toBeGreaterThanOrEqual(1);
    await page.waitForFunction(
      () => document.documentElement.dataset.filoNativeWord === 'wrlod',
      null, { timeout: 8000 },
    );

    // Right-click esattamente sopra la parola "wrlod" (inizio del contenteditable).
    const box = await page.locator('#ce').boundingBox();
    await page.mouse.click(box.x + 18, box.y + 16, { button: 'right' });

    await expect(menuDi(page).locator('.sn-menu')).toBeVisible();

    // La riga di correzione deve mostrare il suggerimento nativo "world" in cima.
    const corr = menuDi(page).locator('.sn-menu-correction:visible');
    await expect(corr.first()).toBeVisible({ timeout: 4000 });
    await expect(corr.first()).toContainText('world');

    // Ed è davvero la prima voce cliccabile del menu.
    const firstIsCorrection = await menuDi(page).valuta(() => {
      const menu = document.querySelector('.sn-menu');
      if (!menu) return false;
      const first = Array.from(menu.children).find(
        (c) => !c.classList.contains('sn-menu-sep') && c.style.display !== 'none',
      );
      return !!first && first.classList.contains('sn-menu-correction');
    });
    expect(firstIsCorrection).toBe(true);
  });
});

test.describe('spellcheck-page-dict-autocorrect', () => {
  // Test per la pagina "Gestisci correttore" (filo://spellcheck/spellcheck.html):
  //
  // Feedback 38Tfo78fXtrWA0MUNro8 — dizionario personale preserva il casing originale
  //   - Aggiungendo "iPhone" deve comparire in lista come "iPhone", non "iphone"
  //   - Aggiungendo di nuovo "iphone" (casing diverso) non deve creare un duplicato
  //
  // Feedback 4GBMRPWXgBrsqI1xDJaG — rinominare trigger autocorrect su collisione avvisa
  //   - Crea 'colore'→'colour' e 'sapore'→'savour'
  //   - Rinomina il trigger della seconda in 'colore'
  //   - La regola 'colore'→'colour' deve essere ancora presente (non sovrascritta)
  //   - Deve comparire un avviso di conflitto

  const URL_SPELLCHECK = 'filo://spellcheck/spellcheck.html';

  async function openSpellcheckPage(openTab) {
    const page = await openTab(URL_SPELLCHECK);
    // Aspetta che la pagina sia carica (il DOMContentLoaded popola i campi).
    await page.waitForFunction(() => {
      const el = document.getElementById('addDict');
      return el && el.textContent.length > 0;
    }, null, { timeout: 8_000 });
    return page;
  }

  // ---------------------------------------------------------------------------
  // Feedback 1: casing preservato nel dizionario personale
  // ---------------------------------------------------------------------------
  test('dizionario personale preserva il casing originale (iPhone resta iPhone, non iphone)', async ({ openTab }) => {
    const page = await openSpellcheckPage(openTab);

    // Aggiungi "iPhone" con casing misto
    await page.fill('#newDictWord', 'iPhone');
    await page.click('#addDict');

    // Aspetta che la lista venga aggiornata
    await page.waitForFunction(() => {
      const list = document.getElementById('dictList');
      return list && list.querySelectorAll('.sn-spell-word').length > 0;
    }, null, { timeout: 4_000 });

    // ASSERISCE IL SUCCESSO: la parola in lista deve essere "iPhone" (casing preservato)
    const wordSpans = page.locator('#dictList .sn-spell-word');
    await expect(wordSpans).toHaveCount(1);
    await expect(wordSpans.first()).toHaveValue('iPhone');
  });

  test('dizionario personale dedup case-insensitive: aggiungere "iphone" dopo "iPhone" non crea duplicati', async ({ openTab }) => {
    const page = await openSpellcheckPage(openTab);

    // Aggiungi prima "iPhone"
    await page.fill('#newDictWord', 'iPhone');
    await page.click('#addDict');
    await page.waitForFunction(() => {
      return document.getElementById('dictList')?.querySelectorAll('.sn-spell-word').length > 0;
    }, null, { timeout: 4_000 });

    // Poi aggiungi "iphone" (casing diverso) — non deve creare duplicato
    await page.fill('#newDictWord', 'iphone');
    await page.click('#addDict');
    await page.waitForTimeout(300);

    // Deve esserci ancora una sola parola in lista
    const wordSpans = page.locator('#dictList .sn-spell-word');
    await expect(wordSpans).toHaveCount(1);
    // Il casing originale ("iPhone") deve essere preservato
    await expect(wordSpans.first()).toHaveValue('iPhone');
  });

  // ---------------------------------------------------------------------------
  // Feedback 2: collisione trigger autocorrect mostra avviso e non sovrascrive
  // ---------------------------------------------------------------------------
  test('rinominare trigger autocorrect su una chiave già esistente mostra avviso e NON perde la regola originale', async ({ openTab }) => {
    const page = await openSpellcheckPage(openTab);

    // Aggiungi 'colore' → 'colour'
    await page.fill('#newWord', 'colore');
    await page.fill('#newCorrection', 'colour');
    await page.click('#addAutocorrect');
    await page.waitForFunction(() => {
      return document.getElementById('autocorrectList')?.querySelectorAll('.sn-spell-row:not(.sn-spell-row-head)').length >= 1;
    }, null, { timeout: 4_000 });

    // Aggiungi 'sapore' → 'savour'
    await page.fill('#newWord', 'sapore');
    await page.fill('#newCorrection', 'savour');
    await page.click('#addAutocorrect');
    await page.waitForFunction(() => {
      return document.getElementById('autocorrectList')?.querySelectorAll('.sn-spell-row:not(.sn-spell-row-head)').length >= 2;
    }, null, { timeout: 4_000 });

    // Trova la riga 'sapore' e modifica il trigger in 'colore' (collisione)
    // Le righe sono ordinate alfabeticamente: 'colore' viene prima di 'sapore'
    // Troviamo il campo input della riga 'sapore'
    const rows = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)');
    await expect(rows).toHaveCount(2);

    // La seconda riga (indice 1) dovrebbe essere 'sapore' (ordine alfabetico: colore < sapore)
    const saporeInput = rows.nth(1).locator('input').first();
    await expect(saporeInput).toHaveValue('sapore');

    // Modifica il trigger della riga 'sapore' in 'colore' (collisione)
    await saporeInput.fill('colore');
    await saporeInput.press('Tab'); // triggera il 'change' event

    // Aspetta un momento per la reazione
    await page.waitForTimeout(500);

    // ASSERISCE IL SUCCESSO 1: deve comparire un avviso di conflitto
    const conflictMsg = page.locator('#autocorrectConflict');
    await expect(conflictMsg).toBeVisible({ timeout: 3_000 });
    await expect(conflictMsg).toContainText('colore');

    // ASSERISCE IL SUCCESSO 2: la regola 'colore'→'colour' deve essere ancora presente
    // (non sovrascritta silenziosamente)
    const rowsAfter = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)');
    await expect(rowsAfter).toHaveCount(2); // entrambe le righe devono essere presenti

    // Verifica che la riga 'colore' abbia ancora correzione 'colour' (non 'savour')
    const coloreRow = rowsAfter.nth(0); // 'colore' è ancora prima alfabeticamente
    await expect(coloreRow.locator('input').first()).toHaveValue('colore');
    await expect(coloreRow.locator('input').nth(1)).toHaveValue('colour');

    // Verifica che il trigger della riga 'sapore' sia stato ripristinato a 'sapore'
    const saporeRowAfter = rowsAfter.nth(1);
    await expect(saporeRowAfter.locator('input').first()).toHaveValue('sapore');
  });

  // ---------------------------------------------------------------------------
  // Feedback #227: aggiungere una parola già nel dizionario (anche con casing
  // diverso) mostrava di svuotare il campo in silenzio, senza alcun avviso.
  // Deve invece comparire un messaggio "già nel dizionario", in simmetria con
  // la sezione "Correzioni automatiche".
  // ---------------------------------------------------------------------------
  test('dizionario personale: aggiungere una parola già presente (casing diverso) mostra un avviso, non ingoia l\'input', async ({ openTab }) => {
    const page = await openSpellcheckPage(openTab);

    // Aggiungi "casa"
    await page.fill('#newDictWord', 'casa');
    await page.click('#addDict');
    await page.waitForFunction(() => {
      return document.getElementById('dictList')?.querySelectorAll('.sn-spell-word').length > 0;
    }, null, { timeout: 4_000 });

    // Riprova con "Casa" (stesso significato, casing diverso)
    await page.fill('#newDictWord', 'Casa');
    await page.click('#addDict');

    // ASSERISCE IL SUCCESSO 1: compare un avviso inline di duplicato che nomina la parola
    const conflictMsg = page.locator('#dictConflict');
    await expect(conflictMsg).toBeVisible({ timeout: 3_000 });
    await expect(conflictMsg).toContainText('Casa');

    // ASSERISCE IL SUCCESSO 2: nessun duplicato aggiunto (resta una sola parola)
    const wordSpans = page.locator('#dictList .sn-spell-word');
    await expect(wordSpans).toHaveCount(1);
    await expect(wordSpans.first()).toHaveValue('casa');

    // ASSERISCE IL SUCCESSO 3: l'input NON viene ingoiato in silenzio — il testo
    // digitato resta visibile così l'utente capisce cosa è successo.
    await expect(page.locator('#newDictWord')).toHaveValue('Casa');
  });

  // ---------------------------------------------------------------------------
  // Feedback #214: parola lunghissima senza spazi nel dizionario personale
  // sforava la riga e spingeva il bottone "Rimuovi" fuori dal viewport
  // (scroll orizzontale). La parola deve andare a capo dentro la cella e
  // "Rimuovi" deve restare cliccabile.
  // ---------------------------------------------------------------------------
  test('parola lunga senza spazi nel dizionario: niente scroll orizzontale, "Rimuovi" resta visibile e funziona', async ({ openTab }) => {
    const page = await openSpellcheckPage(openTab);

    // Token lungo senza spazi (tipo indirizzo/codice incollato dall'utente)
    const longWord = 'https-esempio-molto-lungo-' + 'abcdefghij0123456789'.repeat(8);
    await page.fill('#newDictWord', longWord);
    await page.click('#addDict');

    await page.waitForFunction(() => {
      return document.getElementById('dictList')?.querySelectorAll('.sn-spell-word').length > 0;
    }, null, { timeout: 4_000 });

    // ASSERISCE IL SUCCESSO 1: la pagina NON deve avere scroll orizzontale
    // (senza fix: la parola sfora la griglia → scrollWidth > clientWidth).
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    // ASSERISCE IL SUCCESSO 2: il bottone "Rimuovi" della riga sta DENTRO il
    // viewport orizzontale (senza fix veniva spinto oltre il bordo destro).
    const row = page.locator('#dictList .sn-spell-row-dict').first();
    const btnInViewport = await row.locator('button').evaluate((btn) => {
      const r = btn.getBoundingClientRect();
      return r.right <= window.innerWidth && r.left >= 0 && r.width > 0;
    });
    expect(btnInViewport).toBe(true);

    // ASSERISCE IL SUCCESSO 3: cliccare "Rimuovi" toglie davvero la parola.
    await row.locator('button').click();
    await page.waitForFunction(() => {
      return document.getElementById('dictList')?.querySelectorAll('.sn-spell-word').length === 0;
    }, null, { timeout: 4_000 });
    const emptyVisible = await page.evaluate(() => !document.getElementById('dictEmpty').hidden);
    expect(emptyVisible).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Feedback #389: svuotare il campo di una correzione automatica salvata la
  // faceva SEMBRARE cancellata (riga con casella vuota) ma la regola restava
  // intatta in storage e continuava a correggere. Il salvataggio falliva in
  // silenzio, senza avviso, e la UI mostrava uno stato falso.
  // Fix: in simmetria col ramo conflitto, ripristina il valore reale nel campo
  // e mostra un avviso che indirizza al bottone «Rimuovi».
  // ---------------------------------------------------------------------------
  test('correttore: svuotare la correzione ripristina il valore reale e avvisa (regola intatta, niente stato falso)', async ({ openTab }) => {
    const page = await openSpellcheckPage(openTab);

    // Crea la correzione 'ke' → 'che'
    await page.fill('#newWord', 'ke');
    await page.fill('#newCorrection', 'che');
    await page.click('#addAutocorrect');
    await page.waitForFunction(() => {
      return document.getElementById('autocorrectList')?.querySelectorAll('.sn-spell-row:not(.sn-spell-row-head)').length >= 1;
    }, null, { timeout: 4_000 });

    const row = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)').first();
    const correctionInput = row.locator('input').nth(1);
    await expect(correctionInput).toHaveValue('che');

    // Svuota il campo correzione e sposta il focus (triggera 'change')
    await correctionInput.fill('');
    await correctionInput.press('Tab');
    await page.waitForTimeout(400);

    // ASSERISCE IL SUCCESSO 1: compare l'avviso (senza fix: nessun avviso)
    await expect(page.locator('#autocorrectConflict')).toBeVisible({ timeout: 3_000 });

    // ASSERISCE IL SUCCESSO 2: il campo torna a mostrare il valore reale 'che'
    // (senza fix: il campo restava vuoto, stato falso)
    await expect(correctionInput).toHaveValue('che');

    // ASSERISCE IL SUCCESSO 3: la regola è ancora salvata in storage come {ke:'che'}
    const stored = await page.evaluate(async () => {
      const d = await chrome.storage.local.get('sn_autocorrect');
      return d.sn_autocorrect || null;
    });
    expect(stored).toEqual({ ke: 'che' });
  });

  test('correttore: svuotare la parola-trigger ripristina il valore reale e avvisa', async ({ openTab }) => {
    const page = await openSpellcheckPage(openTab);

    await page.fill('#newWord', 'ke');
    await page.fill('#newCorrection', 'che');
    await page.click('#addAutocorrect');
    await page.waitForFunction(() => {
      return document.getElementById('autocorrectList')?.querySelectorAll('.sn-spell-row:not(.sn-spell-row-head)').length >= 1;
    }, null, { timeout: 4_000 });

    const row = page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)').first();
    const wordInput = row.locator('input').first();
    await expect(wordInput).toHaveValue('ke');

    // Svuota il campo parola e sposta il focus
    await wordInput.fill('');
    await wordInput.press('Tab');
    await page.waitForTimeout(400);

    // Avviso + campo ripristinato + regola intatta
    await expect(page.locator('#autocorrectConflict')).toBeVisible({ timeout: 3_000 });
    await expect(wordInput).toHaveValue('ke');
    const stored = await page.evaluate(async () => {
      const d = await chrome.storage.local.get('sn_autocorrect');
      return d.sn_autocorrect || null;
    });
    expect(stored).toEqual({ ke: 'che' });
  });
});

test.describe('spellcheck-segni-restano', () => {
  // #1111 — chi corregge una parola non perde, nemmeno per un istante, le sottolineature delle altre: né il blu del
  // correttore di Filo mentre si ricontrolla, né il rosso del correttore di sistema dopo una correzione dal menu.

  const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px">
<textarea id="ta" spellcheck="true" lang="it" style="display:block;width:900px;height:420px;font:18px monospace"></textarea>
</body>`;

  // Il fornitore finto segna come errore ogni parola «xq…» (correzione «y»): nessuna chiamata esce dalla macchina.
  async function apri(app, openTab, testServer) {
    await app.evaluate(async () => {
      const C = globalThis.SN_CONST;
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false,
        apiKeys: { openrouter: 'k-test' },
        models: {
          [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash',
          [C.ACTIONS.EDIT_TEXT]: 'deepseek-flash',
        },
        modelRegistry: globalThis.SN_TEST_MODELS.registry,
      });
      globalThis.__scan = 0;
      const finto = async ({ messages }) => {
        const t = JSON.stringify(messages);
        if (t.includes('Sei il controllo rapido')) {
          globalThis.__scan += 1;
          const parole = [...new Set(t.match(/xq[a-z]+\d+/g) || [])];
          // Come un modello vero conferma i refusi fra i candidati (ciiao, staii): uno taciuto sarebbe giusto (#1580).
          const candidati = [...String(messages[messages.length - 1].content).matchAll(/^\[([^\]\n]+)\]/gm)]
            .map((m) => m[1]).filter((w) => !parole.includes(w));
          // `__trattieni`: la risposta aspetta che la prova la lasci andare, come un modello lento.
          if (globalThis.__trattieni) await new Promise((ok) => globalThis.__rilascia.push(ok));
          const righe = [...parole.map((w) => `[${w}][y][x][errore]`), ...candidati.map((w) => `[${w}][${w.replace(/(.)\1/g, '$1')}][refuso][errore]`)];
          return { text: righe.join('\n') || 'NIENTE', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
        }
        // «Correggi» nel riquadro Modifica, sulla prima riga della prova del rosso.
        if (t.includes('Correggi eventuali errori')) return { text: 'ciao amico mio', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
        return { text: '[][][][nessuno]', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
      };
      globalThis.SN_PROVIDERS.completeWithFallback = finto;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    });
    const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    return page;
  }

  // Gli errori confermati dal controllo rapido: le parole «xq…» sono anche candidati del dizionario, sbiaditi prima.
  const blu = (page) => page.locator('.sn-spell-overlay .sn-errore:not(.sn-dubbio)');
  const scan = (app) => app.evaluate(() => globalThis.__scan);

  // Per `ms` guarda il riquadro a ogni giro: i segni attesi, sul testo che c'è adesso nella casella.
  async function restanoPer(page, attesi, ms) {
    return page.evaluate(async ([attesi, ms]) => {
      const visti = [];
      const fine = performance.now() + ms;
      while (performance.now() < fine) {
        const o = document.querySelector('.sn-spell-overlay');
        const ta = document.getElementById('ta');
        const segni = o ? [...o.querySelectorAll('.sn-errore:not(.sn-dubbio)')].map((s) => s.textContent) : [];
        const allineato = !!o && o.textContent === ta.value;
        if (JSON.stringify(segni) !== JSON.stringify(attesi) || !allineato) visti.push({ segni, allineato });
        await new Promise((r) => setTimeout(r, 30));
      }
      return visti.slice(0, 3);
    }, [attesi, ms]);
  }

  async function seleziona(page, parola) {
    await page.evaluate((w) => {
      const ta = document.getElementById('ta');
      const i = ta.value.indexOf(w);
      ta.setSelectionRange(i, i + w.length);
    }, parola);
  }

  test('correggendo a mano una parola, i segni blu delle altre restano al loro posto finché lo scan non li rinnova', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await apri(app, openTab, testServer);
    await page.locator('#ta').click();
    await page.keyboard.type('oggi xqprima1 bella giornata con xqseconda2 e poi xqterza3 fine ');
    await expect(blu(page)).toHaveText(['xqprima1', 'xqseconda2', 'xqterza3'], { timeout: 6000 });
    const prima = await scan(app);

    await seleziona(page, 'xqseconda2');
    await page.keyboard.type('seconda');
    await page.screenshot({ path: 'tests/.shots/1111-blu-dopo-correzione.png' }).catch(() => {});
    // Fino al controllo dopo (mezzo secondo di pausa) e oltre: la parola corretta non è più segnata, le altre sì.
    expect(await restanoPer(page, ['xqprima1', 'xqterza3'], 1200)).toEqual([]);
    await expect.poll(() => scan(app), { timeout: 6000 }).toBe(prima + 1);
    await expect(blu(page)).toHaveText(['xqprima1', 'xqterza3']);

    // Una parola nuova in mezzo sposta le altre: i segni la seguono.
    await page.evaluate(() => { const ta = document.getElementById('ta'); const i = ta.value.indexOf('bella'); ta.setSelectionRange(i, i); });
    await page.keyboard.type('davvero ');
    expect(await restanoPer(page, ['xqprima1', 'xqterza3'], 600)).toEqual([]);
  });

  // La parola che il correttore di sistema segna sotto il punto, chiesta come la chiede il menu: col tasto destro.
  async function segnataDalSistema(app, page, x, y) {
    const host = new URL(page.url()).host;
    await app.evaluate(({ webContents }, h) => {
      globalThis.__segnata = null;
      for (const wc of webContents.getAllWebContents()) {
        let qui = false;
        try { qui = new URL(wc.getURL()).host === h; } catch (_) {}
        if (qui) wc.once('context-menu', (_e, p) => { globalThis.__segnata = p.misspelledWord; });
      }
    }, host);
    await page.mouse.click(x, y, { button: 'right' });
    await expect.poll(() => app.evaluate(() => globalThis.__segnata), { timeout: 3000 }).not.toBeNull();
    const parola = await app.evaluate(() => globalThis.__segnata);
    await page.keyboard.press('Escape');
    return parola;
  }

  // Il punto della riga `riga` (righe da 24 px), colonna `col`, nella casella.
  async function puntoInRiga(page, riga, col) {
    return page.evaluate(([riga, col]) => {
      const ta = document.getElementById('ta');
      const r = ta.getBoundingClientRect();
      const cs = getComputedStyle(ta);
      const c = document.createElement('canvas').getContext('2d');
      c.font = cs.font;
      const w = c.measureText('m').width;
      return {
        x: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + (col + 2) * w,
        y: r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop) + riga * 24 + 12 - ta.scrollTop,
      };
    }, [riga, col]);
  }

  // Diciotto righe: «ciiao» in cima e «staii» in fondo, abbastanza lontane perché il correttore di sistema, dopo un
  // cambio in cima, non torni da sé subito a ricontrollare il fondo. Torna quando tutte e due sono segnate di rosso.
  async function dueParoleRosse(app, page) {
    const piattaforma = await app.evaluate(() => process.platform);
    test.skip(piattaforma === 'darwin', 'su Mac il correttore è quello del sistema');
    await expect.poll(() => app.evaluate(() => globalThis.__filoDizionari.stato().inizializzati), { timeout: 20_000 })
      .toContain('it-IT');
    await page.locator('#ta').evaluate((ta) => { ta.style.lineHeight = '24px'; ta.style.height = '520px'; ta.style.padding = '4px'; });
    const riempi = 'la casa sul lago era bella e il sole splendeva sopra le montagne';
    const righe = ['ciiao amico mio', ...Array.from({ length: 16 }, () => riempi), 'staii bene oggi'];
    await page.locator('#ta').click();
    await page.keyboard.insertText(righe.join('\n'));
    const staii = await puntoInRiga(page, 17, 1);
    const ciiao = await puntoInRiga(page, 0, 1);
    await expect.poll(() => segnataDalSistema(app, page, staii.x, staii.y), { timeout: 20_000, intervals: [1000] }).toBe('staii');
    await expect.poll(() => segnataDalSistema(app, page, ciiao.x, ciiao.y), { timeout: 20_000, intervals: [1000] }).toBe('ciiao');
    return { staii, ciiao };
  }

  test('correggendo dal menu una parola rossa, il rosso delle altre parole resta', async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const page = await apri(app, openTab, testServer);
    const { staii, ciiao } = await dueParoleRosse(app, page);

    await page.mouse.click(ciiao.x, ciiao.y, { button: 'right' });
    const corr = menuDi(page).locator('.sn-menu-correction:visible').first();
    await expect(corr).not.toBeEmpty({ timeout: 4000 });
    await corr.click();
    await expect(page.locator('#ta')).toHaveValue(/^(?!ciiao )\p{L}+ amico mio\n/u);
    await page.screenshot({ path: 'tests/.shots/1111-rosso-dopo-correzione.png' }).catch(() => {});
    expect(await segnataDalSistema(app, page, staii.x, staii.y)).toBe('staii');
    // La correzione è una battuta: Ctrl+Z la annulla.
    await page.keyboard.press('Control+z');
    await expect(page.locator('#ta')).toHaveValue(/^ciiao amico mio\n/);
  });

  test('una correzione automatica mentre si scrive lascia il rosso alle altre parole e il cursore dopo lo spazio', async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const page = await apri(app, openTab, testServer);
    const { staii } = await dueParoleRosse(app, page);
    await nelMondoDiFilo(app, page, () => globalThis.SN_SPELLCHECK.setAutocorrect('cmq', 'comunque'));

    await page.evaluate(() => { const ta = document.getElementById('ta'); ta.focus(); ta.setSelectionRange(15, 15); });
    await page.keyboard.type(' cmq ok');
    await expect(page.locator('#ta')).toHaveValue(/^ciiao amico mio comunque ok\nla casa/);
    expect(await segnataDalSistema(app, page, staii.x, staii.y)).toBe('staii');
  });

  test('con «Correggi» del riquadro Modifica su una riga, il rosso delle altre righe resta', async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const page = await apri(app, openTab, testServer);
    const { staii } = await dueParoleRosse(app, page);

    await page.evaluate(() => { const ta = document.getElementById('ta'); ta.focus(); ta.setSelectionRange(0, 'ciiao amico mio'.length); });
    const amico = await puntoInRiga(page, 0, 8);
    await page.mouse.click(amico.x, amico.y, { button: 'right' });
    const menu = menuDi(page).locator('.sn-menu');
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await menu.locator('.sn-menu-item', { hasText: 'Modifica' }).click();
    await expect.poll(async () => (await statoDi(app, page, '.sn-editbox'))?.visibile, { timeout: 10_000 }).toBe(true);
    await clicca(app, page, '.sn-editbox button[data-sc="fix"]');
    await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-replace'))?.disabilitato, { timeout: 10_000 }).toBe(false);
    await clicca(app, page, '.sn-editbox-replace');
    await expect(page.locator('#ta')).toHaveValue(/^ciao amico mio\nla casa/);
    expect(await segnataDalSistema(app, page, staii.x, staii.y)).toBe('staii');
  });

  test('con «Risolvi» dal tasto destro sul blu, le altre parole blu restano segnate', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await apri(app, openTab, testServer);
    await page.locator('#ta').click();
    await page.keyboard.type('oggi xqprima1 bella giornata con xqseconda2 e poi xqterza3 fine ');
    await expect(blu(page)).toHaveText(['xqprima1', 'xqseconda2', 'xqterza3'], { timeout: 6000 });

    const b = await riquadroDelSegno(blu(page).nth(1));
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
    const corr = menuDi(page).locator('.sn-menu-correction:visible').first();
    await expect(corr).toContainText('y');
    await corr.click();
    await expect(page.locator('#ta')).toHaveValue('oggi xqprima1 bella giornata con y e poi xqterza3 fine ');
    expect(await restanoPer(page, ['xqprima1', 'xqterza3'], 1000)).toEqual([]);
  });

  test('#1097.5 — la risposta arrivata mentre si scriveva non si butta; spazi e punteggiatura non rifanno il controllo', async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await apri(app, openTab, testServer);
    await app.evaluate(() => { globalThis.__trattieni = true; globalThis.__rilascia = []; });
    await page.locator('#ta').click();
    await page.keyboard.type('oggi xqprima1 bella giornata ');
    await expect.poll(() => scan(app), { timeout: 6000 }).toBeGreaterThan(0);
    // Il controllo è partito: l'utente continua a scrivere, e le risposte arrivano dopo.
    await page.keyboard.type('e poi xqdopo2 al mare ');
    await page.waitForTimeout(800);
    await app.evaluate(() => { globalThis.__trattieni = false; for (const ok of globalThis.__rilascia.splice(0)) ok(); });
    // I segni delle risposte vecchie compaiono sulle loro parole, nel testo di adesso.
    await expect(blu(page)).toHaveText(['xqprima1', 'xqdopo2'], { timeout: 6000 });
    await page.screenshot({ path: 'tests/.shots/1097-correttore-risposta-tardiva.png' }).catch(() => {});
    const fatti = await scan(app);

    // Un punto e uno spazio in più: le parole sono le stesse, nessuna domanda nuova al modello.
    await page.keyboard.type('. ');
    await new Promise((r) => setTimeout(r, 2500));
    expect(await scan(app)).toBe(fatti);
    await expect(blu(page)).toHaveText(['xqprima1', 'xqdopo2']);
    // Una parola nuova invece sì.
    await page.keyboard.type('xqterza3 ');
    await expect.poll(() => scan(app), { timeout: 6000 }).toBeGreaterThan(fatti);
    await expect(blu(page)).toHaveText(['xqprima1', 'xqdopo2', 'xqterza3'], { timeout: 6000 });
  });
});

test.describe('spellcheck-shadow-editable', () => {
  // Feedback #438 — correttore ortografico nelle aree di scrittura "ricche"
  // (contenteditable) DENTRO un componente web (shadow DOM), i "blocchi isolati"
  // con cui i siti moderni costruiscono le pagine.
  //
  // Il menu del tasto destro dentro questi blocchi funziona (#406) e nelle
  // textarea il suggerimento di correzione compare. In un contenteditable dentro
  // il blocco non compariva: per sapere QUALE parola è stata cliccata il
  // correttore chiedeva al documento "che carattere c'è in questo punto"
  // (caretPositionFromPoint), e quella domanda si ferma al confine dello shadow
  // root — torna un punto nel light DOM, fuori dall'editabile. Senza parola il
  // menu di correzione non veniva nemmeno preparato: nessun suggerimento, mai.
  //
  // Gli spec asseriscono il SUCCESSO: la correzione compare come PRIMA voce del
  // menu dentro il blocco, esattamente come fuori, e cliccarla corregge davvero il
  // testo. Togliendo il ripiego geometrico in spellcheck.js tornano rossi.

  // Consegna i suggerimenti nativi come fa il main sull'evento `context-menu` di
  // Electron (tabs.js), così il test è deterministico anche senza chiave LLM.
  async function sendNative(app, host, word, suggestions) {
    return app.evaluate(({ webContents }, { host, word, suggestions }) => {
      const targets = webContents.getAllWebContents().filter((w) => {
        try { return new URL(w.getURL()).host === host; } catch { return false; }
      });
      for (const wc of targets) wc.send('filo:broadcast', { type: '_spell:native', word, suggestions });
      return targets.length;
    }, { host, word, suggestions });
  }

  const CE_OPEN = '<div id="ce" contenteditable="true" spellcheck="true" '
    + 'style="font:16px monospace;padding:8px;width:400px;height:120px">';
  const CE = `${CE_OPEN}ciiao come stai</div>`;

  // Stessa identica area di scrittura due volte: una in chiaro, una dentro il
  // blocco isolato. Il confronto è il cuore del feedback.
  function pageHtml() {
    return `<!doctype html><html><body style="margin:0;padding:0">
    <div id="light">${CE.replace('id="ce"', 'id="ce-light"')}</div>
    <div id="host"></div>
    <script>
      const r = document.querySelector('#host').attachShadow({ mode: 'open' });
      r.innerHTML = ${JSON.stringify(CE)};
    </script>
  </body></html>`;
  }

  // Apre il menu col tasto destro sopra la parola "ciiao" e ritorna il menu.
  async function rightClickOnWord(page, box) {
    await page.mouse.click(box.x + 16, box.y + 16, { button: 'right' });
    const menu = menuDi(page).locator('.sn-menu');
    await expect(menu).toBeVisible();
    return menu;
  }

  async function prepare({ app, openTab, testServer }) {
    const url = testServer.html(pageHtml());
    const page = await openTab(url);
    await page.waitForFunction(
      () => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    const sent = await sendNative(app, new URL(url).host, 'ciiao', ['ciao', 'chiao']);
    expect(sent).toBeGreaterThanOrEqual(1);
    await page.waitForFunction(
      () => document.documentElement.dataset.filoNativeWord === 'ciiao', null, { timeout: 8000 });
    return page;
  }

  // Rettangolo dell'editabile dentro lo shadow root (i locator normali non lo
  // vedono: qui ci interessa solo dove cliccare).
  async function shadowBox(page) {
    return page.evaluate(() => {
      const el = document.querySelector('#host').shadowRoot.querySelector('#ce');
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
  }

  test('area di scrittura ricca dentro un blocco isolato: la correzione è la prima voce del menu', async ({ app, openTab, testServer }) => {
    const page = await prepare({ app, openTab, testServer });

    const menu = await rightClickOnWord(page, await shadowBox(page));
    await page.screenshot({ path: 'tests/.shots/spellcheck-shadow-ce.png' }).catch(() => {});

    const corr = menuDi(page).locator('.sn-menu-correction:visible');
    await expect(corr.first()).toBeVisible({ timeout: 4000 });
    await expect(corr.first()).toContainText('ciao');

    // Ed è davvero la prima voce cliccabile del menu, come in light DOM.
    const firstIsCorrection = await menuDi(page).valuta(() => {
      const m = document.querySelector('.sn-menu');
      if (!m) return false;
      const first = Array.from(m.children).find(
        (c) => !c.classList.contains('sn-menu-sep') && c.style.display !== 'none',
      );
      return !!first && first.classList.contains('sn-menu-correction');
    });
    expect(firstIsCorrection).toBe(true);
    await expect(menu).toBeVisible();
  });

  test('cliccando la correzione la parola viene sostituita nel testo dentro il blocco', async ({ app, openTab, testServer }) => {
    const page = await prepare({ app, openTab, testServer });

    await rightClickOnWord(page, await shadowBox(page));
    const corr = menuDi(page).locator('.sn-menu-correction:visible').first();
    await expect(corr).toBeVisible({ timeout: 4000 });
    await corr.click();

    await expect.poll(async () => page.evaluate(
      () => document.querySelector('#host').shadowRoot.querySelector('#ce').textContent,
    ), { timeout: 4000 }).toBe('ciao come stai');
  });

  test('la stessa area di scrittura in chiaro continua a suggerire (baseline)', async ({ app, openTab, testServer }) => {
    const page = await prepare({ app, openTab, testServer });

    const box = await page.locator('#ce-light').boundingBox();
    await rightClickOnWord(page, box);
    const corr = menuDi(page).locator('.sn-menu-correction:visible');
    await expect(corr.first()).toBeVisible({ timeout: 4000 });
    await expect(corr.first()).toContainText('ciao');
  });

  // ---------------------------------------------------------------------------
  // Variante "sigillata" (shadow root CHIUSO): il bersaglio del click non è
  // raggiungibile da nessuna API di pagina, quindi la parola non è ricavabile né
  // col ripiego geometrico. Il correttore di sistema però la vede: il menu deve
  // riservare lo slot, mostrare il suggerimento — e soprattutto APPLICARLO.
  //
  // In CI i dizionari Hunspell non vengono scaricati, quindi il correttore di
  // sistema non marca niente da solo. Emuliamo i suoi DUE effetti, quelli su cui
  // la correzione si regge in produzione:
  //   1. l'evento context-menu porta parola + suggerimenti (sendNative);
  //   2. Chromium SELEZIONA la parola marcata sotto al cursore
  //      (SpellChecker::SelectMisspellingAsync) → `selectMisspelled()` qui sotto.
  // Nient'altro è simulato: il menu, il fuoco e la sostituzione sono quelli veri.
  const SEALED = (text) => `<!doctype html><html><body style="margin:0;padding:0">
  <div id="host"></div>
  <script>
    const r = document.querySelector('#host').attachShadow({ mode: 'closed' });
    r.innerHTML = ${JSON.stringify(CE_OPEN)} + ${JSON.stringify(text)} + '</div>';
    const el = r.querySelector('#ce');
    // Sonda di sola lettura: dal test il contenuto del blocco sigillato è
    // altrimenti invisibile (è esattamente il punto del feedback).
    window.__peek = () => el.textContent;
    // Emula SpellChecker::SelectMisspellingAsync di Chromium.
    window.__selectMisspelled = (len) => {
      el.focus();
      const range = document.createRange();
      range.setStart(el.firstChild, 0);
      range.setEnd(el.firstChild, len);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
    };
  </script>
</body></html>`;

  async function openSealed({ openTab, testServer }, text) {
    const url = testServer.html(SEALED(text));
    const page = await openTab(url);
    await page.waitForFunction(
      () => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    return { page, host: new URL(url).host };
  }

  test('blocco sigillato: il suggerimento del correttore di sistema compare lo stesso', async ({ app, openTab, testServer }) => {
    const { page, host } = await openSealed({ openTab, testServer }, 'ciiao come stai');

    // Click destro sopra la parola errata: il menu si apre "povero" (dentro un
    // blocco sigillato non sappiamo cosa sia stato cliccato).
    await page.mouse.click(24, 24, { button: 'right' });
    await expect(menuDi(page).locator('.sn-menu')).toBeVisible();

    // …e subito dopo arrivano i suggerimenti nativi, come fa Electron sull'evento
    // context-menu del webContents.
    const sent = await sendNative(app, host, 'ciiao', ['ciao', 'chiao']);
    expect(sent).toBeGreaterThanOrEqual(1);

    const corr = menuDi(page).locator('.sn-menu-correction:visible');
    await expect(corr.first()).toBeVisible({ timeout: 4000 });
    await expect(corr.first()).toContainText('ciao');
  });

  test('blocco sigillato: cliccando il suggerimento la parola viene davvero corretta', async ({ app, openTab, testServer }) => {
    const { page, host } = await openSealed({ openTab, testServer }, 'wrlod ciao');

    await page.mouse.click(24, 24, { button: 'right' });
    await expect(menuDi(page).locator('.sn-menu')).toBeVisible();
    await page.evaluate(() => window.__selectMisspelled(5));
    expect(await sendNative(app, host, 'wrlod', ['world', 'word'])).toBeGreaterThanOrEqual(1);

    const corr = menuDi(page).locator('.sn-menu-correction:visible').first();
    await expect(corr).toBeVisible({ timeout: 4000 });
    await corr.click();

    // Il testo dentro il blocco sigillato è cambiato davvero.
    await expect.poll(() => page.evaluate(() => window.__peek()), { timeout: 4000 })
      .toBe('world ciao');
    // E il punto in cui si stava scrivendo non è andato perso: il campo dentro il
    // blocco è ancora quello a fuoco (dal light DOM si vede l'host).
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('host');
  });

  test('blocco sigillato: anche i suggerimenti nella freccetta correggono davvero', async ({ app, openTab, testServer }) => {
    const { page, host } = await openSealed({ openTab, testServer }, 'wrlod ciao');

    await page.mouse.click(24, 24, { button: 'right' });
    await expect(menuDi(page).locator('.sn-menu')).toBeVisible();
    await page.evaluate(() => window.__selectMisspelled(5));
    expect(await sendNative(app, host, 'wrlod', ['world', 'word'])).toBeGreaterThanOrEqual(1);

    const corr = menuDi(page).locator('.sn-menu-correction:visible').first();
    await expect(corr).toBeVisible({ timeout: 4000 });
    await corr.locator('.sn-menu-correction-arrow').click();
    const second = menuDi(page).locator('.sn-menu-sub .sn-menu-item', { hasText: 'word' }).first();
    await expect(second).toBeVisible({ timeout: 4000 });
    await second.click();

    await expect.poll(() => page.evaluate(() => window.__peek()), { timeout: 4000 })
      .toBe('word ciao');
  });
});
