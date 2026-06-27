// Feedback #157 "Cambio funzione tasto invio": premendo Shift+Invio l'utente
// vuole andare a capo, NON inviare il messaggio. Invio da solo invia.
//
// Il test ASSERISCE il successo del comportamento, non l'assenza di un errore:
//   1. la barra è una <textarea> (può contenere più righe);
//   2. Shift+Invio inserisce un "a capo" e NON manda (nessuna bolla utente,
//      si resta in home, il valore contiene il \n);
//   3. Invio da solo manda davvero (compare la bolla utente, la barra si svuota).
//
// Senza il fix la barra era un <input type=text>: Invio inviava sempre e
// Shift+Invio non poteva nemmeno contenere un a capo → il punto 2 fallisce.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata entro 10s').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

test('Shift+Invio va a capo (non invia), Invio invia', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  // La barra è una textarea multilinea, non un input a riga singola.
  const tag = await page.locator('#input').evaluate((el) => el.tagName);
  expect(tag).toBe('TEXTAREA');

  // Scrivo due righe separate da Shift+Invio.
  await page.locator('#input').click();
  await page.keyboard.type('riga uno');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('riga due');

  // Shift+Invio ha inserito un a capo e NON ha inviato:
  //  - il valore contiene entrambe le righe con il \n in mezzo
  //  - non è comparsa nessuna bolla utente, siamo ancora in home
  await expect(page.locator('#input')).toHaveValue('riga uno\nriga due');
  await expect(page.locator('.dash-bubble-user')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.dataset.state || 'home')).not.toBe('thread');

  // Ora Invio da solo: invia davvero.
  await page.locator('#input').press('Enter');

  // È comparsa la bolla utente con il testo multilinea e la barra si è svuotata.
  await expect(page.locator('.dash-bubble-user')).toHaveCount(1, { timeout: 8_000 });
  await expect(page.locator('.dash-bubble-user')).toContainText('riga due');
  await expect(page.locator('#input')).toHaveValue('');
});
