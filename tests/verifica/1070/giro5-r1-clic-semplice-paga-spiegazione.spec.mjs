// Verifica #1070 giro 5: un clic semplice (senza trascinare, senza doppio clic, senza Maiusc) non produce una
// selezione, quindi non deve pagare una spiegazione in anticipo, anche se la pagina seleziona testo sotto il clic.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="font:20px sans-serif;padding:30px;margin:0">
<p id="p1">La fotosintesi clorofilliana trasforma la luce in energia chimica <button id="bt" style="font:20px sans-serif">Avanti</button> dentro le foglie.</p>
<p id="p2">Il teorema di Pitagora vale per tutti i triangoli rettangoli del piano, <a id="ln" href="#x">leggi di più</a> qui.</p>
<input id="cerca" style="display:block;margin-top:20px;font:20px monospace;width:600px">
</body>`;

async function fornitoreFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__conti = { spiega: 0, scan: 0, parola: 0, altro: 0 };
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      let tipo = 'altro';
      if (t.includes('ha selezionato un testo')) tipo = 'spiega';
      else if (t.includes('Analizza il testo qui sotto')) tipo = 'scan';
      else if (t.includes('col tasto destro su una parola')) tipo = 'parola';
      globalThis.__conti[tipo] += 1;
      return { text: tipo === 'scan' ? '{"annotated":"","issues":[]}' : 'ok', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
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

test('r1 clic su un pulsante in mezzo al testo: la pagina seleziona il paragrafo, nessuna spiegazione', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => {
    let n = 0;
    document.getElementById('bt').addEventListener('click', () => {
      const t = document.getElementById('p1').firstChild;
      const r = document.createRange(); r.setStart(t, n % 10); r.setEnd(t, 40 + (n % 10)); n += 1;
      getSelection().removeAllRanges(); getSelection().addRange(r);
    });
  });
  for (let i = 0; i < 5; i++) { await page.locator('#bt').click(); await pausa(900); }
  await pausa(1500);
  expect((await conti(app)).spiega).toBe(0);
});

test('r1 clic su un collegamento nel testo: la pagina seleziona la frase, nessuna spiegazione', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => {
    let n = 0;
    document.getElementById('ln').addEventListener('click', (e) => {
      e.preventDefault();
      const t = document.getElementById('p2').firstChild;
      const r = document.createRange(); r.setStart(t, n % 10); r.setEnd(t, 40 + (n % 10)); n += 1;
      getSelection().removeAllRanges(); getSelection().addRange(r);
    });
  });
  for (let i = 0; i < 5; i++) { await page.locator('#ln').click(); await pausa(900); }
  await pausa(1500);
  expect((await conti(app)).spiega).toBe(0);
});

test('r1 clic nel campo: la pagina ne seleziona il contenuto, nessuna spiegazione', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => {
    let n = 0;
    const c = document.getElementById('cerca');
    c.addEventListener('click', () => { n += 1; c.value = `Testo scelto dalla pagina numero ${n} da spiegare`; c.select(); });
  });
  for (let i = 0; i < 5; i++) { await page.locator('#cerca').click(); await pausa(900); }
  await pausa(1500);
  expect((await conti(app)).spiega).toBe(0);
});
