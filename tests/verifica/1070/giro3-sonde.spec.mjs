// Verifica #1070 giro 3: sonde.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="font:20px sans-serif;padding:30px;margin:0">
<p id="p1">La fotosintesi clorofilliana trasforma la luce in energia chimica dentro le foglie verdi delle piante.</p>
<textarea id="ta" style="display:block;width:640px;height:140px;font:20px monospace"></textarea>
<div id="ed" contenteditable="true" style="width:640px;height:80px;border:1px solid #888;font:20px monospace"></div>
<input id="cerca" style="font:20px monospace;width:400px">
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

test('sonda execCommand paste: produce un paste vero?', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  const esito = await page.evaluate(async () => {
    const visti = [];
    document.addEventListener('paste', (e) => visti.push(e.isTrusted));
    const ta = document.getElementById('ta');
    ta.focus();
    let ok = null;
    try { ok = document.execCommand('paste'); } catch (e) { ok = String(e); }
    await new Promise((r) => setTimeout(r, 200));
    return { ok, visti };
  });
  console.log('PASTE', JSON.stringify(esito));
});

test('sonda editor ricco: tasti veri con inserimento da script, la parola si controlla', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => {
    const ed = document.getElementById('ed');
    ed.addEventListener('keydown', (e) => {
      if (e.key.length !== 1) return;
      e.preventDefault();
      ed.textContent += e.key;
      const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
      getSelection().removeAllRanges(); getSelection().addRange(r);
      ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: e.key }));
    });
  });
  await page.click('#ed');
  await page.keyboard.type('qwzrtx sbagliatta ', { delay: 60 });
  await pausa(2500);
  const c = await conti(app);
  console.log('EDITOR', JSON.stringify(c));
  expect(c.parola + c.scan).toBeGreaterThan(0);
});

test('sonda: la pagina sfrutta i tasti scritti nel suo campo di ricerca per cambiare la selezione', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => {
    let i = 0; let ultima = 0;
    window.addEventListener('keydown', () => {
      if (Date.now() - ultima < 450) return;
      ultima = Date.now();
      setTimeout(() => {
        const p = document.getElementById('p1').firstChild;
        const da = (i++ * 3) % 60;
        const r = document.createRange(); r.setStart(p, da); r.setEnd(p, da + 20);
        // Selezione non nel campo: il campo perde il cursore ma la pagina lo rimette.
        getSelection().removeAllRanges(); getSelection().addRange(r);
      }, 0);
    });
  });
  await page.click('#cerca');
  const prima = (await conti(app)).spiega;
  await page.keyboard.type('una ricerca qualunque scritta da una persona normale', { delay: 150 });
  await pausa(1500);
  console.log('SPIEGA PER TASTI', (await conti(app)).spiega - prima);
});
