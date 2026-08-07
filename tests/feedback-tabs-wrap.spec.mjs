// La fila di schede in cima alla pagina dei feedback (Ricevuti, Agente, Bozze,
// Da risolvere, In revisione, Bloccati, Chiarimenti, Risolti, Verificati) deve
// adattarsi alla larghezza della finestra: su finestre strette va a capo invece
// di sforare il bordo destro e trascinare TUTTA la pagina in uno scorrimento
// orizzontale.
//
// Pre-condizione che senza il fix fallirebbe: con `.fb-tabs` a `display:flex`
// senza `flex-wrap`, i nove bottoni restano su una riga sola, il contenitore
// sfora e `documentElement.scrollWidth` supera `clientWidth` (misurato 777 vs
// 710 dall'utente). L'assert `scrollWidth <= clientWidth` sotto diventa rosso
// rimuovendo il `flex-wrap: wrap`.
//
// Stub di SN_FEEDBACK.list per restare offline: il layout delle tab non dipende
// da Firestore né dallo stato admin.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

test('con finestra stretta le schede vanno a capo, la pagina non scorre di lato', async ({ app, openTab }) => {
  // Restringe la BrowserWindow al caso segnalato (~720 punti di larghezza).
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setContentSize(720, 800);
  });

  const page = await openTab(FEEDBACK_URL);
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined');
  await page.evaluate(() => { SN_FEEDBACK.list = async () => []; });
  await page.setViewportSize({ width: 720, height: 800 });

  // Tutte e nove le schede sono presenti...
  const tabs = page.locator('.fb-tab');
  await expect(tabs).toHaveCount(9);

  // ...e il corpo della pagina NON produce scorrimento orizzontale.
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  // Le tab vanno a capo: l'ultima ("Verificati") sta su una riga più in basso
  // della prima ("Ricevuti"), non oltre il bordo destro.
  const geo = await page.evaluate(() => {
    const list = [...document.querySelectorAll('.fb-tab')];
    const first = list[0].getBoundingClientRect();
    const last = list[list.length - 1].getBoundingClientRect();
    return { firstTop: first.top, lastTop: last.top, lastRight: last.right, clientWidth: document.documentElement.clientWidth };
  });
  expect(geo.lastTop).toBeGreaterThan(geo.firstTop);
  // "Verificati" resta dentro il bordo destro visibile.
  expect(geo.lastRight).toBeLessThanOrEqual(geo.clientWidth + 1);

  // L'ultima scheda è cliccabile e diventa attiva (prima era tagliata/fuori).
  await tabs.last().click();
  await expect(tabs.last()).toHaveClass(/fb-tab--active/);

  await page.screenshot({ path: 'tests/.shots/feedback-tabs-wrap.png' }).catch(() => {});
});
