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

  // Se l'attributo hidden è presente, il display computed DEVE essere 'none'.
  // Se è 'inline' o qualsiasi altro valore, il bug è confermato.
  if (info.hiddenAttr) {
    expect(
      info.displayValue,
      `BUG CONFERMATO: .sn-back-btn ha hidden=${info.hiddenAttr} ma display="${info.displayValue}" — all:unset nel CSS ha annullato [hidden]{display:none}`,
    ).toBe('none');
  }
  // Se hidden è false, il test passa (categorize è attivo, il bottone deve essere visibile).
});
