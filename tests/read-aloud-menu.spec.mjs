// Migliorie alla lettura ad alta voce (feedback alpha):
//   - mentre una lettura è in corso, "Interrompi lettura" deve comparire in
//     QUALSIASI menu tasto destro, anche senza testo selezionato (l'utente
//     avvia la lettura, clicca altrove e deve poterla comunque fermare);
//   - la voce di lettura usa un'icona SVG coerente con Filo, non un'emoji.
//
// I test ASSERISCONO il successo: la voce "Interrompi lettura" è presente nel
// menu, e l'item ha un'icona SVG (non il carattere 🔊).

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:18px sans-serif">
  <h1>Pagina di prova</h1>
  <p id="target">Questo è il testo che Filo deve leggere ad alta voce.</p>
</body></html>`;

test('la voce "Leggi" usa un\'icona SVG, non l\'emoji 🔊', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  await page.evaluate(() => {
    const el = document.getElementById('target');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  await page.locator('#target').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();

  // L'item "Leggi" esiste, ha un'icona SVG e NON contiene l'emoji nel testo.
  const readItem = menu.locator('.sn-menu-item', { hasText: 'Leggi' }).first();
  await expect(readItem).toBeVisible();
  await expect(readItem.locator('.sn-menu-item-icon svg')).toHaveCount(1);
  const label = await readItem.locator('.sn-menu-label').textContent();
  expect(label).not.toContain('🔊');
  expect(label.trim()).toBe('Leggi');
});

test('mentre legge, "Interrompi lettura" compare anche in un menu senza selezione', async ({ openTab }) => {
  // Pagina interna filo:// → mondo condiviso (contextIsolation off): possiamo
  // stubbare il motore TTS così "sta leggendo" è deterministico, senza dipendere
  // dalla presenza di una voce di sistema (assente nel cloud headless).
  const page = await openTab('filo://security/security.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  await page.evaluate(() => {
    window.__speaking = true;
    window.speechSynthesis = {
      get speaking() { return window.__speaking; },
      get pending() { return false; },
      cancel() { window.__speaking = false; },
      speak() { window.__speaking = true; },
      getVoices() { return []; },
    };
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });

  // Click destro su un punto "vuoto" della pagina: nessuna selezione di testo.
  await page.locator('body').click({ button: 'right', position: { x: 4, y: 4 } });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible({ timeout: 4000 });

  // La voce globale "Interrompi lettura" è presente nel menu (senza selezione).
  const stopItem = menu.locator('.sn-menu-item', { hasText: 'Interrompi lettura' }).first();
  await expect(stopItem).toBeVisible();
  await expect(stopItem.locator('.sn-menu-item-icon svg')).toHaveCount(1);

  // Cliccandola, la lettura viene fermata (lo stub azzera lo stato "speaking").
  await stopItem.click();
  await expect.poll(() => page.evaluate(() => window.__speaking), { timeout: 3000 }).toBe(false);
});
