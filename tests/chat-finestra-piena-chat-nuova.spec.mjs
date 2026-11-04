// #1596.2 — «Chat nuova» sotto l'errore di finestra piena rimette il messaggio com'era: il testo scritto (non le righe
// «File:» che partono col messaggio), l'immagine e il documento come anteprime, davanti alla bozza scritta intanto.
// Il modello è finto e rifiuta sempre per finestra piena, come OpenRouter.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/electron.mjs';
import { newtabPage, configureModel, ripristina } from './helpers/copione.mjs';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';

async function finestraSemprePiena(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__origStream) globalThis.__origStream = P.streamCompleteWithFallback;
    globalThis.__richieste = 0;
    P.streamCompleteWithFallback = async () => {
      globalThis.__richieste += 1;
      const e = new Error('OpenRouter 400: {"error":{"message":"This endpoint\'s maximum context length is 1000 tokens. However, you requested about 90000 tokens (80000 of text input, 10000 of output). Please reduce the length of either one.","code":400}}');
      e.status = 400;
      e.provider = 'openrouter';
      throw e;
    };
  });
}

async function incollaFoto(page, colore) {
  await page.evaluate(async (c) => {
    const cv = new OffscreenCanvas(16, 16);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 16, 16);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'sentiero.png', { type: 'image/png' }));
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, colore);
}

// Un documento lasciato sul campo, come un file trovato da Filo trascinato nella chat.
async function lasciaDocumento(page, percorso) {
  await page.evaluate((p) => {
    const dt = new DataTransfer();
    dt.setData('application/x-filo-file', p);
    document.getElementById('inputForm').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, percorso);
}

test('«Chat nuova» rimette testo, immagine e documento nella casella e tiene la bozza scritta dopo l\'errore', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('filo-test-chat-nuova-');
  const guide = join(dir, 'guide dei sentieri.pdf');
  writeFileSync(guide, '%PDF-1.4');
  try {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await configureModel(app);
    await finestraSemprePiena(app);

    await incollaFoto(page, '#3a7');
    await lasciaDocumento(page, guide);
    await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator('#imgPreviews .dash-file-chip')).toHaveText(/guide dei sentieri\.pdf/);
    await page.locator('#input').fill('cerca sentieri come quello della foto e leggimi le guide');
    await page.locator('#sendBtn').click();

    const errore = page.locator('.dash-bubble-filo', { hasText: 'chat nuova' });
    await expect(errore).toBeVisible({ timeout: 40_000 });
    await expect(page.locator('#imgPreviews .dash-img-preview, #imgPreviews .dash-file-chip')).toHaveCount(0);
    await page.locator('#input').fill('solo la prima guida');

    await errore.locator('button', { hasText: 'Chat nuova' }).click();
    const casella = page.locator('#input');
    await expect(casella).toHaveValue('cerca sentieri come quello della foto e leggimi le guide\nsolo la prima guida');
    await expect(casella).not.toHaveValue(/File:/);
    await expect(casella).toBeFocused();
    await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1);
    await expect(page.locator('#imgPreviews .dash-file-chip')).toHaveText(/guide dei sentieri\.pdf/);
    await expect(page.locator('#imgPreviews .dash-file-chip')).toHaveAttribute('title', guide);
    await page.screenshot({ path: 'tests/.shots/chat-finestra-piena-chat-nuova.png' });

    // Un secondo clic non raddoppia il messaggio rimesso.
    await errore.locator('button', { hasText: 'Chat nuova' }).click({ force: true });
    await expect(casella).toHaveValue('cerca sentieri come quello della foto e leggimi le guide\nsolo la prima guida');
    await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('anche dopo un «Riprova» che sbatte di nuovo, «Chat nuova» rimette l\'immagine col testo', async ({ app, shell }) => {
  test.setTimeout(90_000);
  try {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await configureModel(app);
    await finestraSemprePiena(app);
    await incollaFoto(page, '#c84');
    await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5_000 });
    await page.locator('#input').fill('che posto è?');
    await page.locator('#sendBtn').click();
    const errore = page.locator('.dash-bubble-filo', { hasText: 'chat nuova' });
    await expect(errore).toBeVisible({ timeout: 40_000 });
    const prima = await app.evaluate(() => globalThis.__richieste);
    await errore.locator('button', { hasText: 'Riprova' }).click();
    await expect.poll(() => app.evaluate(() => globalThis.__richieste), { timeout: 40_000 }).toBeGreaterThan(prima);
    await expect(errore).toBeVisible({ timeout: 40_000 });
    await expect(errore).toHaveCount(1);
    await errore.locator('button', { hasText: 'Chat nuova' }).click();
    await expect(page.locator('#input')).toHaveValue('che posto è?');
    await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1);
  } finally {
    await ripristina(app);
  }
});
