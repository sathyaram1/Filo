// Verifica #1070 giro 2: r1 un tasto tenuto premuto vale un gesto solo; r2 il trascinamento lento con una pausa avvia l'anticipo.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="font:20px sans-serif;padding:30px;margin:0">
<p id="p1">La fotosintesi clorofilliana trasforma la luce in energia chimica dentro le foglie verdi delle piante.</p>
<textarea id="ta" style="display:block;width:640px;height:140px;font:20px monospace"></textarea>
</body>`;

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
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function apri(app, openTab, testServer) {
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

function estremi(page) {
  return page.evaluate(() => {
    const nodo = document.getElementById('p1').firstChild;
    const r = document.createRange();
    r.setStart(nodo, 0); r.setEnd(nodo, 1);
    const a = r.getBoundingClientRect();
    r.setStart(nodo, nodo.textContent.length - 1); r.setEnd(nodo, nodo.textContent.length);
    const b = r.getBoundingClientRect();
    return { x0: a.left + 1, y0: a.top + a.height / 2, x1: b.right - 1, y1: b.top + b.height / 2 };
  });
}

test('r2 trascinamento lento con una pausa prima di rilasciare: la spiegazione in anticipo parte', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  const e = await estremi(page);
  await page.mouse.move(e.x0, e.y0);
  await page.mouse.down();
  // Due secondi di trascinamento, poi l'utente si ferma un attimo a guardare cosa ha preso e rilascia.
  const passi = 20;
  for (let i = 1; i <= passi; i++) {
    await page.mouse.move(e.x0 + ((e.x1 - e.x0) * i) / passi, e.y0 + ((e.y1 - e.y0) * i) / passi);
    await pausa(100);
  }
  await pausa(700);
  await page.mouse.up();
  const sel = await page.evaluate(() => getSelection().toString().length);
  expect(sel).toBeGreaterThan(20);
  await expect.poll(async () => (await conti(app)).spiega, { timeout: 4000 }).toBe(1);
});

test('r1 un tasto tenuto premuto è un gesto solo: la pagina che scrive una parola a ogni ripetizione ottiene un controllo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => {
    let i = 0;
    window.addEventListener('keydown', () => {
      const ta = document.getElementById('ta');
      if (document.activeElement !== ta) ta.focus();
      ta.value += ` xqzgioco${i++} `;
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' }));
    });
  });
  // L'utente tiene premuta una freccia (un gioco, uno scorrimento): trenta ripetizioni del tasto.
  await page.mouse.click(700, 20);
  await pausa(300);
  const prima = (await conti(app)).parola;
  for (let i = 0; i < 30; i++) { await page.keyboard.down('ArrowDown'); await pausa(30); }
  await page.keyboard.up('ArrowDown');
  await pausa(2500);
  expect((await conti(app)).parola - prima).toBeLessThanOrEqual(2);
});

test('r1 un tasto tenuto premuto è un gesto solo: la pagina che cambia la selezione a ogni ripetizione ottiene una spiegazione', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => {
    let i = 0;
    let ultima = 0;
    window.addEventListener('keydown', () => {
      if (Date.now() - ultima < 500) return;
      ultima = Date.now();
      const p = document.getElementById('p1').firstChild;
      const da = i++ % 40;
      const r = document.createRange();
      r.setStart(p, da); r.setEnd(p, da + 15);
      getSelection().removeAllRanges(); getSelection().addRange(r);
    });
  });
  await page.mouse.click(700, 20);
  await pausa(300);
  const prima = (await conti(app)).spiega;
  for (let i = 0; i < 100; i++) { await page.keyboard.down('ArrowDown'); await pausa(30); }
  await page.keyboard.up('ArrowDown');
  await pausa(1500);
  expect((await conti(app)).spiega - prima).toBeLessThanOrEqual(1);
});
