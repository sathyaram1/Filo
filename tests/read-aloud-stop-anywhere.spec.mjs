// Feedback alpha (tkaVKHmhHw23SDdwcSMv):
//   1. mentre una lettura è in corso, QUALSIASI menu del tasto destro deve
//      contenere "Interrompi lettura", anche senza testo selezionato;
//   2. la voce di lettura usa un'icona SVG coerente con lo stile di Filo,
//      non più l'emoji 🔊.
//
// Asserisce il SUCCESSO: la voce "Interrompi lettura" compare in un menu aperto
// su un'area SENZA selezione mentre la sintesi è attiva. Prima del fix lo stop
// esisteva solo nei due rami "testo selezionato".

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:18px sans-serif">
  <h1 id="title">Pagina di prova</h1>
  <p id="target">Questo è un testo lungo abbastanza da tenere occupata la sintesi vocale per qualche istante mentre proviamo ad aprire un altro menu.</p>
  <div id="empty" style="height:200px"></div>
</body></html>`;

test('la voce "Leggi" usa un\'icona SVG, non un\'emoji', async ({ openTab, testServer }) => {
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

  // L'item "Leggi" ha un'icona SVG e la sua etichetta NON contiene emoji.
  const readItem = menu.locator('.sn-menu-item', { hasText: 'Leggi' }).first();
  await expect(readItem).toBeVisible();
  await expect(readItem.locator('.sn-menu-item-icon svg')).toBeVisible();
  const label = await readItem.locator('.sn-menu-label').innerText();
  expect(label.trim()).toBe('Leggi');
  expect(label).not.toMatch(/[\u{1F500}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});

test('durante la lettura, un menu senza selezione mostra "Interrompi lettura"', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  // Avvia la lettura dal menu sulla selezione.
  await page.evaluate(() => {
    const el = document.getElementById('target');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.locator('#target').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  await page.locator('.sn-menu-item', { hasText: 'Leggi' }).first().click();

  // Azzera la selezione: il prossimo menu sarà "senza contesto di testo".
  await page.evaluate(() => window.getSelection().removeAllRanges());

  // Riapre il menu su un'area vuota (nessuna selezione) e attende che la voce
  // di stop compaia mentre la sintesi è attiva. Poll perché l'avvio lettura è
  // asincrono (prova modello → fallback voce browser).
  await expect.poll(async () => {
    // chiudi eventuale menu aperto
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('#empty').click({ button: 'right' });
    const menu = page.locator('.sn-menu').first();
    const visible = await menu.isVisible().catch(() => false);
    if (!visible) return false;
    return await menu.locator('.sn-menu-item', { hasText: 'Interrompi lettura' }).count();
  }, { timeout: 8000, intervals: [200, 300, 500, 800] }).toBeGreaterThan(0);
});
