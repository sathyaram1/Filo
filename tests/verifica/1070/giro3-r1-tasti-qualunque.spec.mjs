// Verifica #1070 giro 3: r1 un tasto qualunque non compra la chiamata che non chiede (spiegazione in anticipo, controllo della parola).

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="font:20px sans-serif;padding:30px;margin:0">
<p id="p1">La fotosintesi clorofilliana trasforma la luce in energia chimica dentro le foglie verdi delle piante.</p>
<textarea id="ta" style="display:block;width:640px;height:140px;font:20px monospace"></textarea>
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

test('r1 scrivere nel campo di ricerca della pagina non paga spiegazioni in anticipo di selezioni fatte dalla pagina', async ({ app, openTab, testServer }) => {
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
  expect((await conti(app)).spiega - prima).toBeLessThanOrEqual(1);
});

test('r1 ogni lettera scritta non paga il controllo di una parola chiusa dalla pagina: al più uno per parola chiusa dall\'utente', async ({ app, openTab, testServer }) => {
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
  const prima = await conti(app);
  await page.keyboard.type('ciao come stai oggi', { delay: 150 });
  await pausa(2500);
  const dopo = await conti(app);
  // L'utente ha chiuso tre parole (tre spazi): il ritmo legittimo è un controllo per parola, più l'ultima.
  expect(dopo.parola - prima.parola).toBeLessThanOrEqual(4);
});
