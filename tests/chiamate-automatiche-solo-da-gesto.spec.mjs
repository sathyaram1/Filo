// Uno script di un sito non spende i crediti dell'utente (#1070): la spiegazione in anticipo e il correttore
// partono solo dietro un gesto vero (tasto, clic, tocco), mai da selezioni, input, execCommand o focus() di script;
// il correttore non lavora a scheda nascosta, e il main ha un tetto per scheda sulle chiamate automatiche.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="font:20px sans-serif;padding:30px;margin:0">
<p id="p1">La fotosintesi clorofilliana trasforma la luce in energia chimica dentro le foglie.</p>
<p id="p2">Il teorema di Pitagora vale per tutti i triangoli rettangoli del piano.</p>
<textarea id="ta" style="display:block;width:640px;height:140px;font:20px monospace"></textarea>
<input id="cerca" style="display:block;margin-top:20px;font:20px monospace;width:400px">
<button id="bt" style="margin-top:20px;font:20px sans-serif">Avanti</button>
</body>`;

// Un paragrafo di oltre 4000 caratteri senza un punto, per la selezione lunga e la frase intorno a una parola.
// Sta in una pagina sua: con lui Ctrl+A prenderebbe più del tetto dell'anticipo.
const PAGINA_LUNGA = PAGINA.replace('</body>',
  `<p id="p3" style="font:12px sans-serif">parolainizio ${'lorem ipsum dolor sit amet '.repeat(150)}parolafine</p></body>`);

// Il fornitore finto conta le chiamate per tipo, riconoscendole dal prompt: nessuna esce dalla macchina.
async function fornitoreFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.EXPLAIN]: 'deepseek-flash',
        [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash',
        [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    // `scan` è il controllo rapido del correttore (#1446), `coerenza` quello ragionato.
    globalThis.__conti = { spiega: 0, scan: 0, coerenza: 0, altro: 0 };
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      let tipo = 'altro';
      let text = 'ok';
      if (t.includes('ha selezionato un testo')) { tipo = 'spiega'; text = 'Spiegazione di prova'; globalThis.__ultimaSpiega = t; }
      else if (t.includes('Sei il controllo rapido')) {
        tipo = 'scan';
        // Con `__segnaXq` il controllo segna come errore ogni parola «xq…», come un modello vero coi refusi.
        const parole = globalThis.__segnaXq ? [...new Set(t.match(/xq[a-z]+\d+/g) || [])] : [];
        text = parole.map((w) => `[${w}][y][x][errore]`).join('\n') || '[][][][nessuno]';
      }
      else if (t.includes('proponi SUGGERIMENTI')) { tipo = 'coerenza'; text = '[][][][nessuno]'; }
      globalThis.__conti[tipo] += 1;
      return { text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
}

const conti = (app) => app.evaluate(() => ({ ...globalThis.__conti }));

async function apri(app, openTab, testServer, html = PAGINA) {
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  // Le parole «xq…» sono candidati solo col dizionario del browser caricato.
  await expect.poll(() => app.evaluate(() => globalThis.__filoDizionari.stato().inizializzati), { timeout: 20_000 }).toContain('it-IT');
  return page;
}

// Il centro della parola nella pagina, per un doppio clic vero.
function puntoDellaParola(page, id, parola) {
  return page.evaluate(([i, w]) => {
    const nodo = document.getElementById(i).firstChild;
    const da = nodo.textContent.indexOf(w);
    const r = document.createRange();
    r.setStart(nodo, da);
    r.setEnd(nodo, da + w.length);
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, [id, parola]);
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test('selezioni ed eventi finti per 5 s: nessuna spiegazione in anticipo; un doppio clic vero: una', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);

  // Lo script del sito: selezioni sempre diverse, con mouseup/keyup/dblclick fabbricati per sembrare l'utente.
  await page.evaluate(async () => {
    const fine = Date.now() + 5000;
    let i = 0;
    while (Date.now() < fine) {
      const p = document.getElementById(i % 2 ? 'p1' : 'p2').firstChild;
      const da = i % 7;
      const s = getSelection();
      s.removeAllRanges();
      const r = document.createRange();
      r.setStart(p, da);
      r.setEnd(p, Math.min(p.textContent.length, da + 12 + (i % 9)));
      s.addRange(r);
      for (const tipo of ['mouseup', 'keyup', 'dblclick']) {
        document.body.dispatchEvent(new MouseEvent(tipo, { bubbles: true }));
      }
      i += 1;
      await new Promise((ok) => setTimeout(ok, 450));
    }
    getSelection().removeAllRanges();
  });
  await pausa(1000);
  expect((await conti(app)).spiega).toBe(0);

  const p = await puntoDellaParola(page, 'p2', 'Pitagora');
  await page.mouse.dblclick(p.x, p.y);
  await expect.poll(async () => (await conti(app)).spiega, { timeout: 5000 }).toBe(1);
  await pausa(1200);
  expect((await conti(app)).spiega).toBe(1);

  // Anche la tastiera è un gesto: Maiusc+frecce allarga la selezione, Ctrl+A prende tutto.
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await conti(app)).spiega, { timeout: 5000 }).toBe(2);
  await page.keyboard.press('ControlOrMeta+A');
  await expect.poll(async () => (await conti(app)).spiega, { timeout: 5000 }).toBe(3);
});

test('selezione lunga: niente anticipo, al tasto destro intera; la frase intorno a una parola resta corta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, PAGINA_LUNGA);
  const ultima = () => app.evaluate(() => globalThis.__ultimaSpiega || '');

  // Un paragrafo senza punti: la «frase» di una parola non è più il blocco intero.
  const p = await puntoDellaParola(page, 'p3', 'parolainizio');
  await page.mouse.dblclick(p.x, p.y);
  await expect.poll(async () => (await conti(app)).spiega, { timeout: 5000 }).toBe(1);
  expect(await ultima()).toContain('parolainizio');
  expect(await ultima()).not.toContain('parolafine');

  // Tre clic prendono il paragrafo (oltre 4000 caratteri): l'anticipo non parte.
  await page.mouse.click(p.x, p.y, { clickCount: 3 });
  await pausa(1500);
  expect((await conti(app)).spiega).toBe(1);

  // Al tasto destro la spiegazione si chiede davvero, con tutta la selezione.
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const sezione = menuDi(page).locator('.sn-menu .sn-menu-inline-explain');
  await expect(sezione).toContainText('Spiegazione di prova', { timeout: 10_000 });
  expect((await conti(app)).spiega).toBe(2);
  expect(await ultima()).toContain('parolafine');
});

test('il correttore non parte da execCommand, input finti o focus() di script; scrivere davvero lo fa partire', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);

  // Lo script del sito: rimette il fuoco al campo e ci scrive dentro, con eventi `input` veri (execCommand) e finti.
  await page.evaluate(async () => {
    const ta = document.getElementById('ta');
    const fine = Date.now() + 5000;
    let i = 0;
    while (Date.now() < fine) {
      ta.blur();
      ta.focus();
      document.execCommand('insertText', false, ` frase numero ${i} scritta bene, `);
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
      i += 1;
      await new Promise((ok) => setTimeout(ok, 400));
    }
  });
  // Il ragionato parte dopo 3,5 s di pausa: si aspetta di più.
  await pausa(4500);
  const prima = await conti(app);
  expect(prima.scan).toBe(0);
  expect(prima.coerenza).toBe(0);

  await page.locator('#ta').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ciao come stai oggi ');
  await expect.poll(async () => (await conti(app)).scan, { timeout: 6000 }).toBe(1);
  await expect.poll(async () => (await conti(app)).coerenza, { timeout: 8000 }).toBe(1);
});

test('un gesto vero paga al più un controllo del correttore: lo script che dopo un clic scrive quaranta parole ne ottiene uno', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => {
    window.addEventListener('mouseup', () => {
      const ta = document.getElementById('ta');
      ta.focus();
      for (let i = 0; i < 40; i++) {
        ta.value += ` xqzparola${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))} `;
        ta.selectionStart = ta.selectionEnd = ta.value.length;
        ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' }));
      }
    }, { once: true });
  });
  await page.mouse.click(700, 20);
  await pausa(4500);
  expect((await conti(app)).scan).toBeLessThanOrEqual(1);
  expect((await conti(app)).coerenza).toBeLessThanOrEqual(1);

  // Chi scrive davvero, parola per parola, ha un controllo a ogni parola sbagliata che chiude.
  const prima = (await conti(app)).scan;
  await page.locator('#ta').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' qwzuno qwzdue qwztre ', { delay: 60 });
  await expect.poll(async () => (await conti(app)).scan - prima, { timeout: 6000 }).toBeGreaterThanOrEqual(3);
});

test('un tasto tenuto premuto è un gesto solo: le ripetizioni non pagano altri controlli né altre spiegazioni', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  // Il sito: a ogni ripetizione del tasto scrive una parola nella sua casella; ogni mezzo secondo cambia la selezione.
  await page.evaluate(() => {
    let i = 0;
    let ultima = 0;
    window.addEventListener('keydown', () => {
      const ta = document.getElementById('ta');
      if (document.activeElement !== ta) ta.focus();
      ta.value += ` xqzgioco${i} `;
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' }));
      i += 1;
      if (Date.now() - ultima < 500) return;
      ultima = Date.now();
      const p = document.getElementById('p1').firstChild;
      const r = document.createRange();
      r.setStart(p, i % 40); r.setEnd(p, (i % 40) + 15);
      getSelection().removeAllRanges(); getSelection().addRange(r);
    });
  });
  await page.mouse.click(700, 20);
  await pausa(300);
  // Tre secondi di freccia giù tenuta, come chi scorre o gioca.
  for (let i = 0; i < 100; i++) { await page.keyboard.down('ArrowDown'); await pausa(30); }
  await page.keyboard.up('ArrowDown');
  await pausa(2500);
  await pausa(2000);
  const c = await conti(app);
  expect(c.spiega).toBeLessThanOrEqual(1);
  expect(c.scan).toBeLessThanOrEqual(1);
  expect(c.coerenza).toBeLessThanOrEqual(1);
});

test('chi tiene premuto un tasto dentro la casella ha lo scan sul testo finale, una volta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('oggi ho scritto una frase ');
  await expect.poll(async () => (await conti(app)).scan, { timeout: 6000 }).toBe(1);
  // Due secondi di Backspace tenuto: lo scan non parte a metà, parte dopo, sul testo che resta.
  for (let i = 0; i < 60; i++) { await page.keyboard.down('Backspace'); await pausa(33); }
  await page.keyboard.up('Backspace');
  await page.keyboard.type('oggi ho scritto ');
  await expect.poll(async () => (await conti(app)).scan, { timeout: 6000 }).toBe(2);
  await pausa(2000);
  expect((await conti(app)).scan).toBe(2);
});

test('trascinamento lento con una pausa prima di rilasciare: la spiegazione in anticipo parte al rilascio', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  const e = await page.evaluate(() => {
    const nodo = document.getElementById('p1').firstChild;
    const r = document.createRange();
    r.setStart(nodo, 0); r.setEnd(nodo, 1);
    const a = r.getBoundingClientRect();
    r.setStart(nodo, nodo.textContent.length - 1); r.setEnd(nodo, nodo.textContent.length);
    const b = r.getBoundingClientRect();
    return { x0: a.left + 1, y0: a.top + a.height / 2, x1: b.right - 1, y1: b.top + b.height / 2 };
  });
  await page.mouse.move(e.x0, e.y0);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(e.x0 + ((e.x1 - e.x0) * i) / 20, e.y0 + ((e.y1 - e.y0) * i) / 20);
    await pausa(100);
  }
  await pausa(700);
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection().toString().length)).toBeGreaterThan(20);
  await expect.poll(async () => (await conti(app)).spiega, { timeout: 4000 }).toBe(1);
});

// Le schede di dietro di Filo, coi test a finestra fuori schermo, restano «visible»: la scheda nascosta si
// simula sulla nuova scheda, dove i content script girano nel mondo della pagina e vedono la stessa `document`.
test('a scheda nascosta il correttore aspetta: riparte quando si torna', async ({ app }) => {
  test.setTimeout(60_000);
  await fornitoreFinto(app);
  const deadline = Date.now() + 10_000;
  let page = null;
  while (!page && Date.now() < deadline) {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (!page) await pausa(100);
  }
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.evaluate(() => {
    const ta = document.createElement('textarea');
    ta.id = 'sn-test-ta';
    ta.style.cssText = 'position:fixed;top:220px;left:40px;width:560px;height:120px;font:20px monospace;z-index:2147483000';
    document.body.appendChild(ta);
  });

  await page.locator('#sn-test-ta').click();
  await page.keyboard.type('oggi ho scritto una frase');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pausa(4500);
  expect((await conti(app)).scan).toBe(0);
  expect((await conti(app)).coerenza).toBe(0);

  await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await conti(app)).scan, { timeout: 6000 }).toBe(1);
});

test('il main ferma le chiamate automatiche oltre il tetto per scheda, avvisa una volta nella pagina, e il tasto destro passa', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.mouse.click(5, 5);
  const indirizzo = page.url();
  const r = await app.evaluate(async ({ webContents }, url) => {
    const C = globalThis.SN_CONST;
    const M = globalThis.SN_MSG.MSG;
    let chiamate = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      const testo = JSON.stringify(messages);
      // La home aperta scrive il suo saluto col modello: non è una chiamata di questa scheda.
      if (testo.includes('preparare la dashboard')) return { text: '{"message":"","suggestions":[]}', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
      // Si contano le spiegazioni chieste qui: una chiamata di fondo dell'app nel frattempo faceva 122 (#1219).
      if (testo.includes('parola ')) chiamate += 1;
      return { text: 'ok', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === url);
    const H = globalThis.__filoHandlers;
    const chiedi = (n, extra = {}) => H.handleMessage(
      { type: M.AI_REQUEST, action: C.ACTIONS.EXPLAIN, payload: { selection: `parola ${n}`, sentence: `frase ${n}` }, ...extra },
      { wc, url },
    );
    const esiti = [];
    for (let n = 0; n < 125; n += 1) esiti.push(await chiedi(n));
    const suRichiesta = await chiedi(999, { suRichiesta: true });
    return {
      ok: esiti.filter((e) => e && e.ok).length,
      fermate: esiti.filter((e) => e && e.code === 'TROPPE_AUTOMATICHE').length,
      frase: (esiti.find((e) => e && e.code === 'TROPPE_AUTOMATICHE') || {}).error || '',
      suRichiesta: Boolean(suRichiesta && suRichiesta.ok),
      chiamate,
    };
  }, indirizzo);
  expect(r.ok).toBe(120);
  expect(r.fermate).toBe(5);
  expect(r.frase).toMatch(/120/);
  expect(r.suRichiesta).toBe(true);
  expect(r.chiamate).toBe(121);

  const avviso = page.locator('.sn-toast');
  await expect(avviso).toHaveCount(1, { timeout: 5000 });
  await expect(avviso).toContainText('120 spiegazioni automatiche');
  await expect(avviso).toContainText('tasto destro');
  await page.screenshot({ path: 'tests/.shots/1070-tetto-avviso.png' }).catch(() => {});
});

// Un gesto paga solo la chiamata che chiede (#1070 giro 3): una lettera scritta non seleziona e non chiude parole.
test('scrivere nel campo di ricerca della pagina non paga spiegazioni in anticipo delle selezioni che fa la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, PAGINA.replace('</body>', '<input id="cerca" style="font:20px monospace;width:400px"></body>'));
  await page.evaluate(() => {
    let i = 0;
    let ultima = 0;
    window.addEventListener('keydown', () => {
      if (Date.now() - ultima < 450) return;
      ultima = Date.now();
      setTimeout(() => {
        const p = document.getElementById('p1').firstChild;
        const da = (i++ * 3) % 60;
        const r = document.createRange();
        r.setStart(p, da);
        r.setEnd(p, da + 20);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
      }, 0);
    });
  });
  await page.click('#cerca');
  const prima = (await conti(app)).spiega;
  await page.keyboard.type('una ricerca qualunque scritta da una persona normale', { delay: 150 });
  await pausa(1500);
  // Nessuna: né il clic nel campo né le lettere selezionano niente (#1070.1).
  expect((await conti(app)).spiega - prima).toBe(0);
});

test('il controllo della parola lo paga il tasto che chiude una parola, non ogni lettera', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => {
    let i = 0;
    const ta = document.getElementById('ta');
    ta.addEventListener('keydown', (e) => {
      if (e.key.length !== 1) return;
      e.preventDefault();
      ta.value += ` xqzparola${i++} `;
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' }));
    });
  });
  await page.click('#ta');
  await pausa(300);
  const prima = (await conti(app)).scan;
  await page.keyboard.type('ciao come stai oggi', { delay: 150 });
  await pausa(2500);
  // Ogni tasto scrive una parola sbagliata: senza aspettare la pausa la paga solo chi chiude una parola (tre spazi), più
  // la pausa finale, non uno per ognuna delle 19 lettere.
  const fatti = (await conti(app)).scan - prima;
  expect(fatti).toBeGreaterThanOrEqual(1);
  expect(fatti).toBeLessThanOrEqual(4);
});

test('un gesto paga solo la cosa che ha toccato: scrivere nella ricerca non paga la casella della pagina, un pulsante non paga la selezione lontana', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await apri(app, openTab, testServer);
  await app.evaluate(() => { globalThis.__segnaXq = true; });
  // Il sito dà il fuoco alla sua casella da script, una volta, e lo rimette sulla ricerca; a ogni tasto scritto nella
  // ricerca (al più ogni 1,7 s) riscrive la casella con otto refusi. A ogni clic sul pulsante seleziona il primo paragrafo.
  await page.evaluate(() => {
    const ta = document.getElementById('ta');
    ta.focus();
    document.getElementById('cerca').focus();
    let n = 0; let ultima = 0;
    document.getElementById('cerca').addEventListener('keydown', () => {
      if (Date.now() - ultima < 1700) return;
      ultima = Date.now();
      n += 1;
      ta.value = Array.from({ length: 8 }, (_, i) => `xq${'abcdefgh'[i]}${n}`).join(' ') + ' fine.';
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '.' }));
    });
    document.getElementById('bt').addEventListener('click', () => {
      const t = document.getElementById('p1').firstChild;
      const r = document.createRange();
      r.setStart(t, n % 10); r.setEnd(t, 30 + (n % 10));
      n += 1;
      getSelection().removeAllRanges(); getSelection().addRange(r);
    });
  });
  await page.locator('#cerca').click();
  await page.keyboard.type('ricetta della pasta al forno con le melanzane', { delay: 130 });
  for (let i = 0; i < 4; i++) { await page.locator('#bt').click(); await pausa(900); }
  await pausa(2500);
  expect(await conti(app)).toMatchObject({ scan: 0, coerenza: 0, spiega: 0 });

  // Il doppio clic sulla parola resta la strada vera: paga la sua spiegazione.
  const p = await puntoDellaParola(page, 'p2', 'Pitagora');
  await page.mouse.dblclick(p.x, p.y);
  await expect.poll(async () => (await conti(app)).spiega, { timeout: 5000 }).toBe(1);
});

// I tre casi di #1070.1: la pagina seleziona proprio sotto il clic, che però da solo non seleziona niente.
const PAGINA_CLIC = `<!doctype html><meta charset="utf-8">
<body style="font:20px sans-serif;padding:30px;margin:0">
<p id="pp">Il ciclo dell'acqua porta il vapore <button id="bp" style="font:20px sans-serif">Evidenzia</button> in alto e lo restituisce come pioggia sulle montagne.</p>
<p id="pl">La deriva dei continenti <a id="al" href="#fondo">sposta</a> le placche di pochi centimetri ogni anno.</p>
<input id="ic" style="display:block;font:20px monospace;width:640px">
<p id="pv">Le maree dipendono dalla Luna e dal Sole, che tirano gli oceani in direzioni diverse.</p>
</body>`;

test('la pagina che seleziona dove si clicca non paga spiegazioni: pulsante, collegamento, campo; trascinare, doppio clic e Maiusc+clic sì', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await apri(app, openTab, testServer, PAGINA_CLIC);
  // A ogni clic la pagina seleziona un testo sempre diverso: il resto del paragrafo del pulsante, la frase del
  // collegamento, l'indirizzo che scrive nel campo (come i campi «copia il link»).
  await page.evaluate(() => {
    let n = 0;
    const scegli = (da, a, dove, fino) => {
      const r = document.createRange();
      r.setStart(da, dove); r.setEnd(a, fino);
      getSelection().removeAllRanges(); getSelection().addRange(r);
    };
    document.getElementById('bp').addEventListener('click', () => {
      const t = document.getElementById('pp').lastChild;
      n += 1;
      scegli(t, t, n % 6, 25 + (n % 6));
    });
    document.getElementById('al').addEventListener('click', (e) => {
      e.preventDefault();
      const p = document.getElementById('pl');
      n += 1;
      scegli(p.firstChild, p.lastChild, n % 6, p.lastChild.textContent.length - (n % 3));
    });
    const ic = document.getElementById('ic');
    ic.addEventListener('click', () => {
      n += 1;
      ic.value = `https://esempio.it/condividi/${n}/ricetta-della-nonna`;
      ic.select();
    });
  });
  const clicca = async (sel) => {
    await page.locator(sel).click();
    await pausa(700);
    return page.evaluate(() => {
      const a = document.activeElement;
      return a && a.tagName === 'INPUT' ? a.value.slice(a.selectionStart, a.selectionEnd) : getSelection().toString();
    });
  };
  const viste = new Set();
  for (const sel of ['#bp', '#al', '#ic']) {
    for (let i = 0; i < 5; i++) viste.add(await clicca(sel));
  }
  // La pagina ha davvero selezionato quindici testi diversi sotto i clic.
  expect(viste.size).toBe(15);
  await pausa(1000);
  expect((await conti(app)).spiega).toBe(0);

  // Le strade vere restano: trascinare sul testo, il doppio clic, Maiusc+clic che allarga la selezione.
  // Punti interi: con coordinate frazionarie il trascinamento sintetico di Playwright qui non seleziona niente.
  const parola = async (w) => {
    const q = await puntoDellaParola(page, 'pv', w);
    return { x: Math.round(q.x), y: Math.round(q.y) };
  };
  const a = await parola('maree');
  const b = await parola('Luna');
  await page.mouse.move(a.x - 20, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection().toString())).toContain('maree dipendono');
  await expect.poll(async () => (await conti(app)).spiega, { timeout: 5000 }).toBe(1);
  const c = await parola('oceani');
  await page.mouse.dblclick(c.x, c.y);
  await expect.poll(async () => (await conti(app)).spiega, { timeout: 5000 }).toBe(2);
  await pausa(600);
  const d = await parola('diverse');
  await page.keyboard.down('Shift');
  await page.mouse.click(d.x, d.y);
  await page.keyboard.up('Shift');
  expect(await page.evaluate(() => getSelection().toString())).toContain('oceani in direzioni');
  await expect.poll(async () => (await conti(app)).spiega, { timeout: 5000 }).toBe(3);
});

test('chi esce dalla casella e ci rientra, anche col fuoco dato dalla pagina, ritrova il correttore sottolineato', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await app.evaluate(() => { globalThis.__segnaXq = true; });
  await page.locator('#ta').click();
  await page.keyboard.type('oggi xqprima1 frase ');
  await expect(page.locator('.sn-spell-overlay .sn-errore:not(.sn-dubbio)')).toHaveText(['xqprima1'], { timeout: 6000 });
  await page.locator('#cerca').click();
  await pausa(500);
  // Rientra col fuoco dato dalla pagina (come dopo un «Rispondi»): scrivere deve bastare.
  await page.evaluate(() => { const ta = document.getElementById('ta'); ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; });
  await page.keyboard.type(' poi xqseconda2 ');
  await expect(page.locator('.sn-spell-overlay .sn-errore:not(.sn-dubbio)')).toHaveText(['xqprima1', 'xqseconda2'], { timeout: 6000 });
});

test('spenta la spiegazione preparata (#818), il doppio clic non la paga; il tasto destro sì', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ spiegaAnticipata: { enabled: false } }); });
  const page = await apri(app, openTab, testServer);
  const p = await puntoDellaParola(page, 'p2', 'Pitagora');
  await page.mouse.dblclick(p.x, p.y);
  await pausa(1500);
  expect((await conti(app)).spiega).toBe(0);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(menuDi(page).locator('.sn-menu .sn-menu-inline-explain')).toContainText('Spiegazione di prova', { timeout: 10_000 });
  expect((await conti(app)).spiega).toBe(1);
});
