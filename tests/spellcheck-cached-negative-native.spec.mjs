// Feedback alpha gRrZZ (riaperto): "in questo stesso box non mi corregge questa
// parolla (non vedo suggerimenti quando clicco con il tasto destro su parolla)".
//
// "Questo box" = una <textarea> (il form feedback). Lo screenshot mostra la
// parola sottolineata in ROSSO dal correttore NATIVO: il nativo MARCA la parola
// (ha i suggerimenti) ma la correzione non compariva in cima al menu. Causa nel
// percorso openSpellWordMenu, indipendente dai dizionari Hunspell (che in CI
// headless non si scaricano, quindi non possiamo usare il click destro "reale"):
//
//   - Senza chiave LLM, requestWordSuggestion() torna null (fallimento), ma il
//     codice cachava comunque { misspelled:false } per quella parola. Al click
//     destro SUCCESSIVO la cache "negativa" (refireInBackground=false) faceva
//     saltare la RISERVA dello slot di correzione → onNativeSuggestions non
//     aveva dove rivelare il suggerimento nativo → niente correzione, per sempre.
//
// Fix: lo slot di correzione è ora SEMPRE riservato (anche con cache negativa) e
// i suggerimenti nativi vengono riletti al volo all'arrivo del broadcast. Inoltre
// un fallimento LLM (null) non viene più cachato come "non errata".
//
// Il test crea una <textarea> reale (monitorata come il box feedback), simula lo
// stato "cache dice non errata" e l'arrivo del suggerimento nativo, e verifica
// che la correzione compaia comunque in cima. Pre-fix: rosso. Post-fix: verde.

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

test('textarea con cache "non errata": il suggerimento nativo compare comunque in cima', async ({ app }) => {
  const page = await newtabPage(app);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1' &&
          typeof globalThis.SN_SPELLCHECK?.getWordAt === 'function' &&
          typeof globalThis.SN_SPELLCHECK?.setCachedSuggestion === 'function',
    null, { timeout: 8_000 },
  );

  // Crea una textarea reale, la focalizza (così lo spellcheck la "aggancia" e
  // diventa cachabile, come il box feedback), e calcola le coordinate del click
  // destro sopra "ciiao". Poi semina una cache "negativa" per "ciiao" — lo stato
  // che il vecchio codice produceva su un fallimento LLM senza chiave.
  const coords = await page.evaluate(() => {
    const ta = document.createElement('textarea');
    ta.id = 'sn-test-ta';
    ta.value = 'ciiao come stai';
    ta.style.cssText = 'position:fixed;top:200px;left:40px;width:520px;height:120px;font:24px monospace;padding:10px';
    document.body.appendChild(ta);
    ta.focus(); // → onFocusIn → attach → monitored (cachabile)
    ta.setSelectionRange(0, 0);

    globalThis.SN_SPELLCHECK.setCachedSuggestion(ta, 'ciiao', {
      misspelled: false, correction: '', sentence: 'ciiao come stai',
    });

    const r = ta.getBoundingClientRect();
    // "ciiao" è la prima parola: click destro vicino all'inizio del testo.
    const x = r.left + 10 + 24; // padding + ~1 carattere monospace
    const y = r.top + 10 + 14;
    return { x, y, cached: !!globalThis.SN_SPELLCHECK.getCachedSuggestion(ta, 'ciiao') };
  });
  // La cache è stata davvero registrata (textarea monitorata): è la pre-condizione
  // dello scenario rotto.
  expect(coords.cached).toBe(true);

  // Click destro sulla parola: il menu si apre. NON iniettiamo ancora il nativo.
  await page.evaluate(({ x, y }) => {
    const ta = document.getElementById('sn-test-ta');
    ta.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2,
    }));
  }, coords);

  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 5_000 });

  // Ora arriva (in ritardo) il suggerimento del correttore NATIVO — quello dietro
  // lo zigzag rosso che l'utente vede nello screenshot.
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
