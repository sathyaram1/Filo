// Feedback #256, seconda metà: la cronologia appunti dev'essere raggiungibile
// SENZA passare dal menu del tasto destro.
//
// Il "×" per voce e "Svuota cronologia" esistevano già, ma solo dentro il
// sotto-menu della freccia accanto a "Incolla" — e quel menu compare solo se
// clicchi dentro un campo di testo. Chi copia una password mentre legge un
// articolo non ha nessun campo da cliccare: la cronologia con dentro la password
// c'è, ma non c'è modo di aprirla. Il passo (4) della segnalazione era proprio
// "cerca in Preferenze o altrove un modo per svuotarla: non si trova".
//
// Questi spec ASSERISCONO IL SUCCESSO dal punto di vista dell'utente:
//  - in Impostazioni → Sicurezza la cronologia si VEDE, voce per voce;
//  - "Rimuovi" toglie UNA voce e la toglie davvero (rileggendo lo storage non
//    c'è più, e le altre restano);
//  - "Svuota cronologia" chiede conferma e poi azzera tutto;
//  - a cronologia vuota la pagina lo dice invece di mostrare una lista vuota.
// Pre-fix: rossi già al primo assert (la sezione non esisteva).

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, CONFIRM_HOST } from './helpers/confirm.mjs';

const SENSITIVE = 'password-super-segreta-9F3';

// Semina la cronologia dal main, come fa un content script quando l'utente copia.
async function seed(app, texts) {
  await app.evaluate(async (_electron, list) => {
    const MSG = globalThis.SN_MSG.MSG;
    for (const text of list) {
      await globalThis.SN_HANDLE_MESSAGE(
        { type: MSG.PUSH_CLIPBOARD_ENTRY, entry: { type: 'text', text } },
        { url: 'https://example.com/page' },
      );
    }
  }, texts);
}

// Cronologia com'è DAVVERO (letta dal main, non dalla pagina).
async function stored(app) {
  return app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const res = await globalThis.SN_HANDLE_MESSAGE(
      { type: MSG.GET_CLIPBOARD_HISTORY },
      { url: 'filo://security/security.html' },
    );
    return (res.items || []).map((e) => e.text);
  });
}

test('Sicurezza: la cronologia appunti si vede e una singola voce si rimuove', async ({ app, shell, openTab }) => {
  void shell;
  // Ordine: prima copiata la password, poi altri due testi (la lista è dal più
  // recente al più vecchio).
  await seed(app, [SENSITIVE, 'secondo testo generico', 'terzo testo normale']);

  const page = await openTab('filo://security/');
  const list = page.locator('#sec-clip-list');
  await expect(page.locator('#sec-clip-title')).toHaveText(/Cronologia appunti/i, { timeout: 8_000 });
  await expect(list.locator('.sn-clip-item')).toHaveCount(3);
  await expect(list).toContainText(SENSITIVE);
  await page.locator('#sec-clipboard').scrollIntoViewIfNeeded();
  await page.locator('#sec-clipboard').screenshot({ path: 'tests/.shots/clipboard-history-page-list.png' });

  // Togli SOLO la voce sensibile.
  const row = list.locator('.sn-clip-item', { hasText: SENSITIVE });
  await expect(row).toHaveCount(1);
  await row.locator('.sn-clip-remove').click();

  await expect(list.locator('.sn-clip-item')).toHaveCount(2);
  await expect(list).not.toContainText(SENSITIVE);

  // È sparita davvero, non solo dalla pagina: e le altre due sono ancora lì.
  await expect.poll(() => stored(app)).toEqual(['terzo testo normale', 'secondo testo generico']);

  // E resta sparita anche ricaricando la pagina.
  await page.reload();
  await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(2);
  await expect(page.locator('#sec-clip-list')).not.toContainText(SENSITIVE);
});

test('Sicurezza: "Svuota cronologia" chiede conferma e azzera gli appunti', async ({ app, shell, openTab }) => {
  void shell;
  await seed(app, [SENSITIVE, 'secondo testo generico']);

  const page = await openTab('filo://security/');
  await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(2, { timeout: 8_000 });

  // Annullare la conferma non deve cancellare niente.
  await page.locator('#sec-clip-clear').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  await clickConfirm(page, 'cancel');
  await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(2);
  expect(await stored(app)).toHaveLength(2);

  // Confermare svuota davvero.
  await page.locator('#sec-clip-clear').click();
  await clickConfirm(page, 'ok');

  await expect(page.locator('#sec-clip-list .sn-clip-item')).toHaveCount(0);
  await expect.poll(() => stored(app)).toEqual([]);

  // A cronologia vuota la pagina lo dice, e non offre più "svuota".
  await expect(page.locator('#sec-clip-empty')).toBeVisible();
  await expect(page.locator('#sec-clip-clear')).toBeHidden();

  await page.screenshot({ path: 'tests/.shots/clipboard-history-page.png' });
});

test('Sicurezza: senza niente copiato la sezione lo dice invece di restare muta', async ({ shell, openTab }) => {
  void shell;
  const page = await openTab('filo://security/');
  await expect(page.locator('#sec-clip-empty')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#sec-clip-empty')).toContainText(/nessun testo o immagine/i);
  await expect(page.locator('#sec-clip-clear')).toBeHidden();
});
