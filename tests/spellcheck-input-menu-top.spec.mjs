// Feedback gRrZZ (newtab): "dovrebbe comparire un suggerimento per correggere
// in alto come prima opzione (la vecchia versione — estensione browser —
// funzionava, dopo il refactor passando ad un'app dedicata non funziona più)".
//
// Scenario reale dello screenshot: la barra di input della dashboard
// (filo://newtab/ → <input type=text> "Chiedi qualsiasi cosa…") con una parola
// errata ("ciiao come stai"). Click destro sulla parola: la PRIMA voce del menu
// deve essere la correzione suggerita.
//
// Questo test asserisce il comportamento VISIBILE end-to-end (non solo i mattoni
// getInputWordAt/applyFix coperti altrove): dispatcha un vero evento
// `contextmenu` sull'input e verifica che il menu Filo si apra con un item di
// correzione in cima che mostra il suggerimento. Prima del fix (la app si
// affidava ai soli suggerimenti nativi e non estraeva la parola dagli <input>)
// il menu si apriva senza alcuna correzione → il primo item NON era una
// correzione.

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

test('click destro su parola errata nella barra input: correzione in cima al menu', async ({ app }) => {
  const page = await newtabPage(app);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1' &&
          typeof globalThis.SN_SPELLCHECK?.getInputWordAt === 'function',
    null,
    { timeout: 8_000 },
  );

  // Prepara l'input con la parola errata e calcola le coordinate del click
  // destro sopra "ciiao". Simula inoltre l'arrivo del suggerimento nativo di
  // Electron (lo stesso che sta dietro lo zigzag rosso) così la correzione è
  // disponibile subito, senza dipendere dall'LLM (che in test non ha chiave).
  const coords = await page.evaluate(() => {
    const input = document.getElementById('input');
    if (!input) return { error: 'input mancante' };
    input.value = 'ciiao come stai';
    input.focus();
    const r = input.getBoundingClientRect();
    const cs = getComputedStyle(input);
    const x = r.left + parseFloat(cs.paddingLeft || 0)
      + parseFloat(cs.borderLeftWidth || 0) + 8;
    const y = r.top + r.height / 2;

    // Inietta il broadcast nativo per la parola "ciiao".
    const listeners = globalThis.chrome.runtime.onMessage._listeners;
    for (const fn of listeners) {
      try {
        fn({ type: '_spell:native', word: 'ciiao', suggestions: ['ciao', 'chiao'] });
      } catch (_) {}
    }
    return { x, y };
  });
  expect(coords.error).toBeFalsy();

  // Dispatcha un vero evento contextmenu sopra la parola.
  await page.evaluate(({ x, y }) => {
    const input = document.getElementById('input');
    const ev = new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2,
    });
    input.dispatchEvent(ev);
  }, coords);

  // Il menu Filo si apre con la correzione come PRIMA voce.
  const correction = page.locator('.sn-menu .sn-menu-correction');
  await expect(correction).toBeVisible({ timeout: 5_000 });

  // È davvero il primo item del menu (in cima).
  const firstItemIsCorrection = await page.evaluate(() => {
    const menu = document.querySelector('.sn-menu');
    if (!menu) return false;
    const first = Array.from(menu.children).find(
      (c) => !c.classList.contains('sn-menu-sep') && c.style.display !== 'none',
    );
    return !!first && first.classList.contains('sn-menu-correction');
  });
  expect(firstItemIsCorrection).toBe(true);

  // Mostra il suggerimento di correzione.
  await expect(correction.locator('.sn-menu-label').first()).toHaveText('ciao');
});
