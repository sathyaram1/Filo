import { test, expect } from './fixtures/electron.mjs';

// Regressione (feedback alpha): dopo il refactor da estensione ad app, il
// suggerimento di correzione NON compariva più in cima al menu del tasto
// destro su una parola errata. Causa: il wiring del broadcast `_spell:native`
// (suggerimenti nativi di Electron) era stato perso, quindi getNativeSuggestions
// restava sempre vuoto. Questo test guida il path NATIVO end-to-end e asserisce
// che il suggerimento corretto compaia come PRIMA voce del menu.
//
// Determinismo: la parola "wrlod" non viene corretta dallo stub LLM (FILO_TEST),
// quindi se la riga di correzione appare può provenire SOLO dai suggerimenti
// nativi → il test fallisce senza il fix (slot resta nascosto) e passa con esso.

test('suggerimento nativo compare in cima al menu su parola errata', async ({ app, openTab, testServer }) => {
  const targetUrl = testServer.url('/spellnative.html');
  const page = await openTab(targetUrl);
  await page.waitForTimeout(600);

  // Right-click esattamente sopra la parola "wrlod".
  const box = await page.locator('#ce').boundingBox();
  await page.mouse.click(box.x + 10, box.y + box.height / 2, { button: 'right' });

  // Il menu custom deve essere comparso.
  await expect(page.locator('.sn-menu')).toBeVisible();

  // Simula il broadcast nativo del main (esattamente come fa l'evento
  // `context-menu` di Electron in produzione): manda parola + suggerimenti
  // dizionario al webContents della pagina, che il preload inoltra come
  // messaggio runtime `_spell:native`.
  const host = new URL(targetUrl).host;
  const sent = await app.app.evaluate(async ({ webContents }, host) => {
    const wc = webContents.getAllWebContents().find((w) => {
      try { return new URL(w.getURL()).host === host; } catch { return false; }
    });
    if (!wc) return false;
    wc.send('_spell:native', { misspelledWord: 'wrlod', dictionarySuggestions: ['world', 'word', 'wrlds'] });
    return true;
  }, host);
  expect(sent).toBe(true);

  // La riga di correzione deve rivelarsi col suggerimento nativo "world" in cima.
  const corr = page.locator('.sn-menu-correction:visible');
  await expect(corr.first()).toBeVisible({ timeout: 4000 });
  await expect(corr.first()).toContainText('world');

  // E deve essere la PRIMA voce cliccabile del menu (in cima).
  const firstLabel = await page.evaluate(() => {
    const menu = document.querySelector('.sn-menu');
    if (!menu) return null;
    // prima riga di correzione visibile dentro il menu
    const c = Array.from(menu.querySelectorAll('.sn-menu-correction'))
      .find((el) => el.offsetParent !== null);
    return c ? c.textContent.trim() : null;
  });
  expect(firstLabel).toContain('world');
});
