// Verifica #2371 giro 1. Rilievo 3: una funzione che esiste e ha il suo strumento, se l'assistente dice «non posso»,
// diventa ancora «funzione non disponibile». Rilievo 4: dopo una proposta rifiutata la stessa richiesta fa partire
// la segnalazione anonima della stessa funzione.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';
import { confirmText, clickConfirm } from '../../helpers/confirm.mjs';

async function spia(app) {
  await app.evaluate(() => {
    globalThis.__inviate = [];
    globalThis.SN_FEEDBACK.submit = async (voce) => { globalThis.__inviate.push(voce); return { id: 'fb' }; };
  });
}

test('r3 «salvala per dopo» e l\'assistente dice «non posso»: nessuna segnalazione di funzione mancante', async ({ app, avvisi }) => {
  test.setTimeout(60_000);
  const chat = await home(app);
  await spia(app);
  await modelloFinto(app, [{ text: 'Mi dispiace, non posso fare il salvataggio da qui. Usa «Salva la pagina per dopo» con Alt+S, '
    + 'la ritrovi poi in Aperti per dopo.' }]);
  await chiedi(chat, 'salvala per dopo');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Aperti per dopo' })).toBeVisible({ timeout: 15_000 });
  await chat.waitForTimeout(3_000);
  expect(await confirmText(chat), 'una funzione che esiste è stata proposta come mancante').not.toMatch(/sapesse fare|non può farlo/);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'segnalato a chi sviluppa Filo' }),
    'una funzione che esiste è partita come «non disponibile»').toHaveCount(0);
});

test('r4 proposta rifiutata, stessa richiesta: non parte la segnalazione anonima della stessa funzione', async ({ app, avvisi }) => {
  test.setTimeout(60_000);
  const chat = await home(app);
  await spia(app);
  const SPIEGA = 'Per aprire una finestra in incognito premi Ctrl+Shift+N oppure clicca l\'icona Nuova finestra '
    + 'incognito nella barra laterale: lì quello che visiti non resta.';
  await modelloFinto(app, [{ text: SPIEGA }, { text: SPIEGA }]);
  await chiedi(chat, 'aprimi una finestra in incognito');
  await expect.poll(() => confirmText(chat), { timeout: 15_000 }).toContain('Finestra in incognito');
  await clickConfirm(chat, 'cancel');
  await expect(chat.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await chiedi(chat, 'aprimi una finestra in incognito');
  await expect(chat.locator('.dash-bubble-filo')).toHaveCount(2, { timeout: 15_000 });
  await chat.waitForTimeout(3_000);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'segnalato a chi sviluppa Filo' }),
    'detto no alla proposta, la stessa segnalazione è partita lo stesso in forma anonima').toHaveCount(0);
});
