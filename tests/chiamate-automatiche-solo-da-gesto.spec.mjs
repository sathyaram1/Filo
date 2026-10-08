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
      if (t.includes('ha selezionato un testo')) { tipo = 'spiega'; text = 'Spiegazione di prova'; }
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

async function apri(app, openTab, testServer) {
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
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

test('il main ferma le chiamate automatiche oltre il tetto per scheda, avvisa una volta, e il tasto destro passa', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const M = globalThis.SN_MSG.MSG;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    let chiamate = 0;
    const finto = async () => { chiamate += 1; return { text: 'ok', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} }; };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    const spinte = [];
    const wc = {
      id: 987654, isDestroyed: () => false, once() {}, getURL: () => 'https://sito.test/',
      send: (_c, m) => spinte.push(m),
    };
    const H = globalThis.__filoHandlers;
    const chiedi = (n, extra = {}) => H.handleMessage(
      { type: M.AI_REQUEST, action: C.ACTIONS.EXPLAIN, payload: { selection: `parola ${n}`, sentence: `frase ${n}` }, ...extra },
      { wc, url: 'https://sito.test/' },
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
      avvisi: spinte.filter((m) => m && m.type === M.SHOW_TOAST).map((m) => m.text),
    };
  });
  expect(r.ok).toBe(120);
  expect(r.fermate).toBe(5);
  expect(r.frase).toMatch(/120/);
  expect(r.suRichiesta).toBe(true);
  expect(r.chiamate).toBe(121);
  expect(r.avvisi).toHaveLength(1);
  expect(r.avvisi[0]).toMatch(/tasto destro/);
});
