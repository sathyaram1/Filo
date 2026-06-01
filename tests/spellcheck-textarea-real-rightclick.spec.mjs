// Feedback alpha gRrZZ (riaperto): "in questo stesso box non mi corregge questa
// parolla (non vedo suggerimenti quando clicco con il tasto destro su parolla)".
//
// Lo screenshot mostra la parola sottolineata in ROSSO dal correttore NATIVO:
// quindi sulla macchina dell'utente il nativo MARCA la parola (ha i suggerimenti)
// ma la correzione non compariva in cima al menu. Due cause nel percorso di
// openSpellWordMenu, indipendenti dalla disponibilità dei dizionari Hunspell
// (che in CI headless non vengono scaricati, quindi non possiamo affidarci al
// click destro "reale" per il segnale):
//
//   1) Senza chiave LLM, requestWordSuggestion() torna null (fallimento), ma il
//      codice cachava comunque { misspelled:false } per quella parola. Al click
//      destro SUCCESSIVO la cache "negativa" faceva saltare sia il rilancio sia
//      la RISERVA dello slot di correzione → onNativeSuggestions non aveva dove
//      rivelare il suggerimento nativo → niente correzione, per sempre.
//   2) Lo snapshot dei suggerimenti nativi era preso all'apertura del menu: se
//      il broadcast `_spell:native` arrivava dopo, la riserva/rivelazione usava
//      lo snapshot vuoto.
//
// Questo test riproduce in modo DETERMINISTICO lo stato "cache dice non errata"
// + arrivo del suggerimento nativo, e verifica che la correzione nativa compaia
// comunque in cima. Prima del fix lo slot non veniva riservato → la correzione
// non comparirebbe mai (rosso). Dopo il fix lo slot è sempre riservato e il
// nativo viene riletto al volo → verde.

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

test('parola errata già cachata come "non errata": il suggerimento nativo compare comunque in cima', async ({ app }) => {
  const page = await newtabPage(app);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1' &&
          typeof globalThis.SN_SPELLCHECK?.getInputWordAt === 'function' &&
          typeof globalThis.SN_SPELLCHECK?.setCachedSuggestion === 'function',
    null, { timeout: 8_000 },
  );

  // Prepara l'input con "ciiao come stai" e SIMULA lo stato che soffocava il
  // suggerimento: una voce di cache "non errata" per "ciiao" (come quella che il
  // vecchio codice scriveva su un fallimento LLM senza chiave).
  const coords = await page.evaluate(() => {
    const input = document.getElementById('input');
    if (!input) return { error: 'input mancante' };
    input.value = 'ciiao come stai';
    input.focus();
    // Cache "negativa" per la parola sotto il cursore (refireInBackground=false).
    globalThis.SN_SPELLCHECK.setCachedSuggestion(input, 'ciiao', {
      misspelled: false, correction: '', sentence: 'ciiao come stai',
    });
    const r = input.getBoundingClientRect();
    const cs = getComputedStyle(input);
    const x = r.left + parseFloat(cs.paddingLeft || 0) + parseFloat(cs.borderLeftWidth || 0) + 8;
    const y = r.top + r.height / 2;
    return { x, y };
  });
  expect(coords.error).toBeFalsy();

  // Click destro sulla parola: il menu si apre. NON iniettiamo ancora il nativo.
  await page.evaluate(({ x, y }) => {
    const input = document.getElementById('input');
    input.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2,
    }));
  }, coords);

  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 5_000 });

  // Ora arriva (in ritardo) il suggerimento del correttore NATIVO — esattamente
  // quello dietro lo zigzag rosso che l'utente vede.
  await page.evaluate(() => {
    const listeners = globalThis.chrome.runtime.onMessage._listeners;
    for (const fn of listeners) {
      try { fn({ type: '_spell:native', word: 'ciiao', suggestions: ['ciao', 'chiao'] }); } catch (_) {}
    }
  });

  // La correzione nativa deve comparire in cima al menu.
  const correction = page.locator('.sn-menu .sn-menu-correction');
  await expect(correction).toBeVisible({ timeout: 5_000 });
  await expect(correction.locator('.sn-menu-label').first()).toHaveText('ciao');
});
