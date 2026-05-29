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

import { test, expect } from './fixtures/electron.mjs';

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

  const result = await page.evaluate(() => {
    const input = document.getElementById('input');
    if (!input) return { error: 'input mancante' };
    input.value = 'ciiao come stai';
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
