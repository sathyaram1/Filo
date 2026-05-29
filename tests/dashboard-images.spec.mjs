// Feedback alpha (gestione immagini nella dashboard Filo):
//   1) le immagini allegate compaiono come anteprime SOPRA l'input;
//   2) si possono incollare PIÙ immagini e vengono mostrate tutte nella bolla;
//   3) cliccando un'immagine si ingrandisce (lightbox).
// Tutto offline: il paste è simulato con un DataTransfer di File PNG, la bolla
// e il lightbox sono puro DOM (nessuna chiamata di rete necessaria).

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// Simula un paste di `count` immagini sull'input form.
function pasteImages(page, count) {
  return page.evaluate((n) => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    for (let i = 0; i < n; i++) {
      dt.items.add(new File([arr], `img${i}.png`, { type: 'image/png' }));
    }
    const form = document.getElementById('inputForm');
    form.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, count);
}

test('dashboard: incollo più immagini → anteprime sopra l\'input', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await pasteImages(page, 2);

  const previews = page.locator('#imgPreviews .dash-img-preview img');
  await expect(previews).toHaveCount(2, { timeout: 3_000 });
  await expect(page.locator('#imgPreviews')).toBeVisible();
});

test('dashboard: invio mostra tutte le immagini nella bolla e si ingrandiscono al click', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await pasteImages(page, 2);
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(2, { timeout: 3_000 });

  await page.locator('#input').fill('ecco le immagini');
  await page.locator('#sendBtn').click();

  // La bolla utente contiene ENTRAMBE le immagini.
  const bubbleImgs = page.locator('.dash-bubble-user .dash-bubble-img');
  await expect(bubbleImgs).toHaveCount(2, { timeout: 3_000 });

  // Le anteprime sono state svuotate dopo l'invio.
  await expect(page.locator('#imgPreviews .dash-img-preview')).toHaveCount(0);

  // Click su un'immagine → lightbox aperto.
  await bubbleImgs.first().click();
  await expect(page.locator('.dash-lightbox.open')).toBeVisible({ timeout: 2_000 });
});
