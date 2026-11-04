// Verifica #1700, giro 1, rilievo 1: «Chat nuova» sotto la finestra piena rimette il messaggio PRIMA della bozza, e
// vale anche per le foto: quella del messaggio rimesso viene prima di quella incollata nella bozza dopo l'errore.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel } from '../../helpers/copione.mjs';

async function finestraPiena(app) {
  await app.evaluate(async () => {
    const P = globalThis.SN_PROVIDERS;
    P.streamCompleteWithFallback = async () => {
      const e = new Error('This endpoint\'s maximum context length is 8192 tokens. However, you requested about 90000 tokens.');
      e.status = 400;
      throw e;
    };
  });
}

async function incollaFoto(page, colore) {
  const prima = await page.locator('#imgPreviews .dash-img-preview img').count();
  await page.evaluate(async (colore) => {
    const dt = new DataTransfer();
    const cv = new OffscreenCanvas(16, 16);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = colore;
    ctx.fillRect(0, 0, 16, 16);
    dt.items.add(new File([await cv.convertToBlob({ type: 'image/png' })], 'foto.png', { type: 'image/png' }));
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, colore);
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(prima + 1, { timeout: 5000 });
}

test('r1 Chat nuova: la foto del messaggio rimesso viene prima di quella della bozza, come il suo testo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await finestraPiena(app);
  await incollaFoto(page, '#c0392b');
  await page.locator('#input').fill('cerca sentieri come quello della foto');
  await page.locator('#sendBtn').click();
  const nuova = page.locator('button', { hasText: 'Chat nuova' });
  await expect(nuova).toBeVisible({ timeout: 20_000 });
  const originale = await page.locator('.dash-bubble-user .dash-bubble-img').first().getAttribute('src');
  await page.locator('#input').fill('e questa foto?');
  await incollaFoto(page, '#2980b9');
  await nuova.click();
  await expect(page.locator('#input')).toHaveValue('cerca sentieri come quello della foto\ne questa foto?');
  const anteprime = page.locator('#imgPreviews .dash-img-preview img');
  await expect(anteprime).toHaveCount(2);
  expect(await anteprime.first().getAttribute('src')).toBe(originale);
});
