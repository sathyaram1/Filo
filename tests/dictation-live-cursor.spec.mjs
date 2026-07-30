// Regression per il feedback "Dettatura: il testo trascritto ignora dove sposti
// il cursore mentre registra".
//
// Sintomo: apri il menu del tasto destro (che cattura campo + posizione del
// cursore), scegli "Detta"; mentre la registrazione è aperta (fino a ~60s)
// continui a scrivere / sposti il cursore nello stesso campo; quando arriva la
// trascrizione il testo dettato viene inserito nel punto dove avevi APERTO il
// menu, non dove il cursore si trova ORA — spaccando ciò che avevi digitato.
//
// Non possiamo eseguire una vera registrazione (serve microfono + trascrizione
// AI), ma il difetto sta interamente nella logica di inserimento del testo
// dettato (insertDictatedText): riallineare il contesto di incolla alla
// posizione CORRENTE del cursore prima di inserire. Questo test guida quella
// funzione esatta con vere interazioni DOM.
//
// ASSERISCE IL SUCCESSO: il testo dettato atterra nella posizione corrente del
// cursore. Precondizione (bug presente / rimuovendo il riallineamento): il
// testo atterrerebbe alla posizione catturata all'apertura del menu → il valore
// finale sarebbe diverso e l'assert diventa rosso.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

test('Dettatura: il testo trascritto atterra dove il cursore si trova ORA, non dove era all\'apertura del menu', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 8_000 },
  );
  // La funzione di inserimento dettato deve essere esposta.
  await page.waitForFunction(
    () => typeof window.SN_ACTIONS?.insertDictatedText === 'function',
    null,
    { timeout: 8_000 },
  );

  // (1) Apri il menu del tasto destro sulla barra home VUOTA: questo cattura il
  //     campo e la posizione del cursore (qui: inizio campo, offset 0).
  await page.locator('#input').focus();
  await page.locator('#input').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-menu')).toHaveCount(0);

  // (2) Mentre la registrazione sarebbe aperta, l'utente scrive nel campo e
  //     sposta il cursore alla FINE (posizione diversa da quella catturata).
  await page.evaluate(() => {
    const el = document.querySelector('#input');
    el.focus();
    el.value = 'Hello world';
    el.setSelectionRange(11, 11); // cursore ORA a fine testo
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // (3) Arriva la trascrizione → inserimento del testo dettato.
  await page.evaluate(() => window.SN_ACTIONS.insertDictatedText('DICT '));

  // SUCCESSO: il testo dettato è nella posizione CORRENTE (fine), non a offset 0.
  const val = await page.evaluate(() => document.querySelector('#input').value);
  expect(val).toBe('Hello worldDICT ');
  // Guardia esplicita contro il regresso: NON deve essere finito all'inizio.
  expect(val).not.toBe('DICT Hello world');
});
