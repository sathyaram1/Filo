// Verifica #1070 giro 4: r1 un tasto scritto in un campo della pagina non paga il controllo di un'altra casella, né la raffica di controlli della parola che lo segue.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="font:20px sans-serif;padding:30px;margin:0">
<input id="cerca" style="font:20px monospace;width:400px">
<button id="bt" style="font:20px sans-serif">Avanti</button>
<p id="p1">La fotosintesi clorofilliana trasforma la luce in energia chimica dentro le foglie verdi delle piante.</p>
<textarea id="ta" style="display:block;width:640px;height:140px;font:20px monospace"></textarea>
</body>`;

// Lo scan finto segna come errore ogni parola «xq…» del testo: è quello che un modello vero fa con dei refusi.
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
      else if (t.includes('Analizza il testo qui sotto')) {
        tipo = 'scan';
        const parole = [...new Set(t.match(/xq[a-z]+\d+/g) || [])];
        text = JSON.stringify({ annotated: parole.map((p) => `**${p}**`).join(' '), issues: parole.map(() => ({ type: 'grammar', explanation: 'x', correction: 'y' })) });
      } else if (t.includes('col tasto destro su una parola')) { tipo = 'parola'; text = '{"misspelled":false,"correction":""}'; }
      globalThis.__conti[tipo] += 1;
      return { text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
}

const conti = (app) => app.evaluate(() => ({ ...globalThis.__conti }));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test('r1 scrivere nel campo di ricerca non paga il controllo della casella che la pagina riempie da sola', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });

  // Il sito: dà il fuoco alla sua casella da script (l'utente non la tocca mai), poi lo rimette sulla ricerca.
  // A ogni tasto dell'utente nella ricerca, al più ogni 1,7 s, riscrive la casella con otto refusi nuovi.
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
  });
  await page.locator('#cerca').click();
  await page.keyboard.type('ricetta della pasta al forno con le melanzane e la mozzarella', { delay: 130 });
  await pausa(3000);
  const c = await conti(app);
  console.log('conti dopo ~8 s di scrittura nella ricerca:', JSON.stringify(c));
  expect(c.scan + c.parola).toBe(0);
});

test('r1 un clic su un pulsante non paga la spiegazione di un testo che la pagina seleziona altrove', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  // Il sito: a ogni clic sul suo pulsante seleziona un pezzo diverso del paragrafo, lontano dal pulsante.
  await page.evaluate(() => {
    let n = 0;
    document.getElementById('bt').addEventListener('click', () => {
      const t = document.getElementById('p1').firstChild;
      const r = document.createRange();
      r.setStart(t, n % 10);
      r.setEnd(t, 30 + (n % 10));
      n += 1;
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
  });
  for (let i = 0; i < 5; i++) { await page.locator('#bt').click(); await pausa(900); }
  await pausa(1000);
  const c = await conti(app);
  console.log('conti dopo cinque clic sul pulsante:', JSON.stringify(c));
  expect(c.spiega).toBe(0);
});
