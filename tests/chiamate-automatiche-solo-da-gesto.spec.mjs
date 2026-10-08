// Uno script di un sito non spende i crediti dell'utente (#1070): la spiegazione in anticipo e il correttore
// partono solo dietro un gesto vero (tasto, clic, tocco), mai da selezioni, input, execCommand o focus() di script;
// il correttore non lavora a scheda nascosta, e il main ha un tetto per scheda sulle chiamate automatiche.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="font:20px sans-serif;padding:30px;margin:0">
<p id="p1">La fotosintesi clorofilliana trasforma la luce in energia chimica dentro le foglie.</p>
<p id="p2">Il teorema di Pitagora vale per tutti i triangoli rettangoli del piano.</p>
<textarea id="ta" style="display:block;width:640px;height:140px;font:20px monospace"></textarea>
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
        [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__conti = { spiega: 0, scan: 0, parola: 0, altro: 0 };
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      let tipo = 'altro';
      let text = 'ok';
      if (t.includes('ha selezionato un testo')) { tipo = 'spiega'; text = 'Spiegazione di prova'; globalThis.__ultimaSpiega = t; }
      else if (t.includes('Analizza il testo qui sotto')) { tipo = 'scan'; text = '{"annotated":"","issues":[]}'; }
      else if (t.includes('col tasto destro su una parola')) { tipo = 'parola'; text = '{"misspelled":false,"correction":""}'; }
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
  const sezione = page.locator('.sn-menu .sn-menu-inline-explain');
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
      document.execCommand('insertText', false, ` parola${i} scrita male, `);
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
      i += 1;
      await new Promise((ok) => setTimeout(ok, 400));
    }
  });
  // Lo scan parte 1,5 s dopo l'ultimo input: si aspetta di più.
  await pausa(2500);
  const prima = await conti(app);
  expect(prima.scan).toBe(0);
  expect(prima.parola).toBe(0);

  await page.locator('#ta').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ciao come stai oggi ');
  await expect.poll(async () => (await conti(app)).scan, { timeout: 6000 }).toBe(1);
  expect((await conti(app)).parola).toBeGreaterThan(0);
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
  await pausa(3000);
  expect((await conti(app)).parola).toBeLessThanOrEqual(1);

  // Chi scrive davvero, parola per parola, ha il suo controllo per ognuna.
  const prima = (await conti(app)).parola;
  await page.locator('#ta').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' qwzuno qwzdue qwztre ');
  await expect.poll(async () => (await conti(app)).parola - prima, { timeout: 6000 }).toBeGreaterThanOrEqual(3);
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
  const c = await conti(app);
  expect(c.parola).toBeLessThanOrEqual(1);
  expect(c.spiega).toBeLessThanOrEqual(1);
  expect(c.scan).toBeLessThanOrEqual(1);
});

test('chi tiene premuto un tasto dentro la casella ha lo scan sul testo finale, una volta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('oggi ho scrito una frase ');
  await expect.poll(async () => (await conti(app)).scan, { timeout: 6000 }).toBe(1);
  // Due secondi di Backspace tenuto: lo scan non parte a metà, parte dopo, sul testo che resta.
  for (let i = 0; i < 60; i++) { await page.keyboard.down('Backspace'); await pausa(33); }
  await page.keyboard.up('Backspace');
  await page.keyboard.type('oggi ho scrito ');
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
  await page.keyboard.type('oggi ho scrito una frase');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await pausa(2500);
  expect((await conti(app)).scan).toBe(0);

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
    globalThis.SN_PROVIDERS.completeWithFallback = async () => {
      chiamate += 1;
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
  // Al più una: il clic nel campo è un gesto che seleziona, e lo prende la prima selezione della pagina.
  expect((await conti(app)).spiega - prima).toBeLessThanOrEqual(1);
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
  const prima = (await conti(app)).parola;
  await page.keyboard.type('ciao come stai oggi', { delay: 150 });
  await pausa(2500);
  // Tre parole chiuse dall'utente (tre spazi): un controllo ciascuna, non uno per ognuna delle 19 lettere.
  const fatti = (await conti(app)).parola - prima;
  expect(fatti).toBeGreaterThanOrEqual(1);
  expect(fatti).toBeLessThanOrEqual(3);
});
