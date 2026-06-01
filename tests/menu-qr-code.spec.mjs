// Feedback alpha: "aggiungi fra le azioni rapide nel box tasto destro un'opzione
// per generare un QR code della pagina."
//
// Verifica il SUCCESSO della feature: dopo il click sull'azione "QR code", un
// overlay mostra un QR code generato in locale (un <img> con un SVG che contiene
// moduli) e l'URL della pagina corrente. Asserisce anche che la codifica QR
// (src/shared/qr.js) produca una matrice valida e non vuota.

import { test, expect } from './fixtures/electron.mjs';
import { roundTrip, SN_QR } from './helpers/qr-decode.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo QR test</h1>
  <p id="p">Click destro qui per generare il QR code dalle azioni rapide.</p>
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

  // Feedback alpha: il QR deve stare FRA LE AZIONI RAPIDE (riga icone primaria),
  // non sepolto nell'overflow "Altro…". Lo cerchiamo direttamente nella riga,
  // fuori dalla griglia secondaria.
  const grid = page.locator('.sn-menu-icon-grid');
  const qrBtn = menu.locator('.sn-menu-row [data-sn-icon-id="qrCode"]').first();
  await expect(qrBtn, 'qrCode deve essere fra le azioni rapide, non in "Altro…"').toBeVisible();
  // Sanity: l'overflow "Altro…" non è ancora aperto (la griglia secondaria non
  // esiste finché non si fa hover su "Altro…") → l'icona è davvero nella riga.
  await expect(grid).toHaveCount(0);
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

test('il generatore QR produce una matrice valida con finder pattern', () => {
  const m = SN_QR.toMatrix('https://filo.test/qr-check', { ecc: 'M' });
  const n = m.length;
  expect(n).toBeGreaterThanOrEqual(21); // versione 1 = 21x21
  expect(m.every((row) => row.length === n)).toBe(true);
  // finder pattern (anello scuro 7x7) nei tre angoli
  const finderTL = m[0][0] && m[0][6] && m[6][0] && m[6][6] && m[0][3] && m[3][0];
  const finderTR = m[0][n - 7] && m[0][n - 1] && m[6][n - 7] && m[6][n - 1];
  const finderBL = m[n - 7][0] && m[n - 1][0] && m[n - 7][6] && m[n - 1][6];
  expect(finderTL && finderTR && finderBL).toBe(true);
});

test('round-trip: la matrice si decodifica negli stessi byte UTF-8 dell\'input', () => {
  const samples = [
    'https://example.com',
    'filo://newtab/',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://github.com/sathyaram1/Filo',
    'Ciao mondo àèì',
    'A',
  ];
  for (const s of samples) {
    const r = roundTrip(s, 'M');
    expect(r.ok, `decode mismatch per "${s}": got=${r.got} exp=${r.exp}`).toBe(true);
  }
});
