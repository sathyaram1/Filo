// Feedback alpha: un'azione rapida per il QR code della pagina, fra le icone in vista della barra laterale (non in
// «Altro…»). Il clic mostra un QR generato in locale con l'indirizzo della pagina; la codifica (src/shared/qr.js) dà una
// matrice valida che si rilegge negli stessi byte.

import { test, expect } from './fixtures/electron.mjs';
import { roundTrip, SN_QR } from './helpers/qr-decode.mjs';
import { barraPage, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo QR test</h1>
  <p id="p">Una pagina di cui fare il QR code.</p>
</body></html>`;

test('l\'azione "QR code" mostra un overlay con il QR e l\'URL della pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  const pageUrl = page.url();
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);

  // Fra le azioni rapide, non sepolto in «Altro…»: a cassetto chiuso l'icona c'è e si vede.
  await expect(barra.locator('#nav [data-altro]')).toHaveAttribute('aria-expanded', 'false');
  const qrBtn = barra.locator('#nav .ico[data-id="qrCode"]:not(.riserva)');
  await expect(qrBtn, 'qrCode deve essere fra le azioni rapide, non in "Altro…"').toBeVisible();
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

  // Feedback (riapertura): il box dev'essere coerente con lo stile di Filo —
  // sfondo della palette (NON più bianco fisso) e bottone primario con il
  // colore accento terracotta (--sn-accent = #c45a3b = rgb(196,90,59)).
  const card = overlay.locator('.sn-qr-card');
  const cardBg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(cardBg, 'la card non deve più essere bianca fissa').not.toBe('rgb(255, 255, 255)');
  // Il primo bottone (download) è il primario → sfondo accento Filo.
  const primaryBtnBg = await overlay.locator('button').first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(primaryBtnBg, 'il bottone primario deve usare il colore accento Filo')
    .toBe('rgb(196, 90, 59)');
  // Il QR in sé resta nero su bianco (scansionabilità): la tile che lo contiene
  // è bianca a prescindere dal tema.
  const tileBg = await img.evaluate((el) => getComputedStyle(el.parentElement).backgroundColor);
  expect(tileBg, 'la tile del QR resta bianca').toBe('rgb(255, 255, 255)');

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
