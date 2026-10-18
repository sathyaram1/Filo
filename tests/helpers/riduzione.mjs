// Riduce a icona la finestra di Filo in uno spec e la rialza. Senza gestore di finestre (xvfb: routine
// e suite in GitHub) `minimize()` cade nel vuoto: si finge la risposta del sistema, non un'altra uscita
// dalla vista. Racconto: patterns/un-test-chiede-al-sistema-non-presume-quello-su-cui-e-nato.md.

import { test } from '@playwright/test';

/** `'vera'` o `'simulata'`, da ripassare a `rialza`. Lo spec lo porta nelle annotazioni. */
export async function riduciAIcona(app) {
  const come = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.minimize();
    // Su Mac e sui desktop Linux la riduzione arriva a fine animazione.
    for (let i = 0; i < 40 && !w.isMinimized(); i++) await new Promise((r) => setTimeout(r, 50));
    if (w.isMinimized()) return 'vera';
    w.isMinimized = () => true;
    w.emit('minimize');
    return 'simulata';
  });
  test.info().annotations.push({ type: 'riduzione a icona', description: come });
  return come;
}

export async function rialza(app, come) {
  await app.evaluate(({ BrowserWindow }, come) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    if (come === 'simulata') delete w.isMinimized;
    // Una riduzione vera arrivata dopo la finta si toglie davvero.
    if (w.isMinimized()) w.restore(); else w.emit('restore');
  }, come);
}
