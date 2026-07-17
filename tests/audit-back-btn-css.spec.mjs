// AUDIT (routine): il bottone "← Tutte le categorie" nella pagina "Aperti per dopo"
// usa `all: unset` nel CSS, che annulla la regola del browser `[hidden] { display: none }`.
// Risultato: quando il flag `categorize` è disattivato (default), il pulsante ha
// l'attributo HTML `hidden` ma rimane nel layout con display="inline" — occupa spazio,
// è cliccabile e fuorvia l'utente.

import { test, expect } from './fixtures/electron.mjs';

const HOME = 'filo://home/home.html';

test('BACK button in home: all:unset annulla [hidden]{display:none} — il bottone è nascosto ma rimane nel layout', async ({ openTab }) => {
  const page = await openTab(HOME);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);

  const info = await page.evaluate(() => {
    const btn = document.getElementById('back');
    if (!btn) return { found: false };
    const style = getComputedStyle(btn);
    return {
      found: true,
      hiddenAttr: btn.hidden,
      displayValue: style.display,
    };
  });

  await page.screenshot({ path: 'tests/.shots/audit-back-btn-css.png', fullPage: false }).catch(() => {});

  expect(info.found).toBe(true);
  // Con categorize disattivato (default) home.js imposta back.hidden = true.
  expect(info.hiddenAttr, 'con categorize OFF il bottone deve avere hidden=true').toBe(true);
  // E il display computed DEVE essere 'none': se è 'inline' (o altro) il bug è
  // confermato — all:unset nel CSS ha annullato [hidden]{display:none}.
  expect(
    info.displayValue,
    `BUG CONFERMATO: .sn-back-btn ha hidden=true ma display="${info.displayValue}" — all:unset nel CSS ha annullato [hidden]{display:none}`,
  ).toBe('none');

  // Simmetria: senza l'attributo hidden il bottone deve tornare visibile
  // (la regola [hidden]{display:none} non deve nasconderlo sempre).
  const displayWhenShown = await page.evaluate(() => {
    const btn = document.getElementById('back');
    btn.hidden = false;
    return getComputedStyle(btn).display;
  });
  expect(displayWhenShown, 'senza hidden il bottone deve essere visibile').not.toBe('none');
});
