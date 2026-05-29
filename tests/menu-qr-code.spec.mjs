// Feedback alpha: "aggiungi fra le azioni rapide nel box tasto destro un'opzione
// per generare un QR code della pagina."
//
// Verifica il SUCCESSO della feature: dopo il click sull'azione "QR code", un
// overlay mostra un QR code generato in locale (un <img> con un SVG che contiene
// moduli) e l'URL della pagina corrente. Asserisce anche che la codifica QR
// (src/shared/qr.js) produca una matrice valida e non vuota.

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo QR test</h1>
  <p id="p">Click destro qui, poi apri "Altro…" e genera il QR code.</p>
</body></html>`;

async function openMenu(page) {
  await page.locator('#p').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  return menu;
}

test('l\'azione "QR code" mostra un overlay con il QR e l\'URL della pagina', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  const pageUrl = page.url();
  const menu = await openMenu(page);

  // qrCode vive nella griglia secondaria → apri l'overflow "Altro…".
  const overflow = menu.locator('.sn-menu-row-overflow').first();
  await expect(overflow).toBeVisible();
  await overflow.hover();
  const grid = page.locator('.sn-menu-icon-grid');
  await expect(grid).toBeVisible({ timeout: 2000 });

  const qrBtn = grid.locator('[data-sn-icon-id="qrCode"]');
  await expect(qrBtn).toBeVisible();
  await qrBtn.click();

  // L'overlay del QR deve comparire con un'immagine e l'URL corrente.
  const overlay = page.locator('.sn-qr-overlay');
  await expect(overlay).toBeVisible();
  const img = overlay.locator('img');
  await expect(img).toBeVisible();

  // L'immagine è un data-URL SVG non vuoto (contiene <rect> = moduli QR).
  const src = await img.getAttribute('src');
  expect(src).toContain('data:image/svg+xml');
  const decoded = decodeURIComponent(src);
  expect(decoded).toContain('<rect');
  // Deve esserci più di un solo rect (sfondo) → moduli neri presenti.
  expect((decoded.match(/<rect/g) || []).length).toBeGreaterThan(20);

  // L'URL della pagina è mostrato sotto il QR.
  await expect(overlay).toContainText(pageUrl.replace(/\/$/, '').slice(0, 30));

  // Esc chiude l'overlay.
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
});

test('il generatore QR produce una matrice quadrata non vuota con finder pattern', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  // SN_QR gira nel mondo isolato del page-preload; eseguo la verifica lì.
  const result = await page.evaluate(() => {
    // eslint-disable-next-line no-undef
    const m = (self.SN_QR || globalThis.SN_QR).toMatrix('https://filo.test/qr-check', { ecc: 'M' });
    const n = m.length;
    // finder pattern in alto a sinistra: bordo 7x7 con anello scuro
    const corner = m[0][0] && m[0][6] && m[6][0] && m[6][6] && m[0][3] && m[3][0];
    let dark = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) dark++;
    return { n, rows: m.every((row) => row.length === n), corner, dark };
  });
  expect(result.n).toBeGreaterThanOrEqual(21); // versione 1 = 21x21
  expect(result.rows).toBe(true);
  expect(result.corner).toBe(true);
  expect(result.dark).toBeGreaterThan(30);
});
