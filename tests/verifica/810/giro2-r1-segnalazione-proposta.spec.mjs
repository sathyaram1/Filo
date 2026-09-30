// Verifica #810 giro 2, rilievo 1: la segnalazione che Filo propone da sé dopo aver ammesso una
// mancanza è un INVIA_FEEDBACK come gli altri: un codice letto da fuori non esce nemmeno lì.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm } from '../../helpers/confirm.mjs';
import { CODICE, preparaModelli, modelloFinto, newtab } from './aiuti.mjs';

test('la segnalazione proposta da Filo non porta fuori il codice letto dall’output di un comando', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaModelli(app);
  await app.evaluate(() => {
    globalThis.__fbCalls = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__fbCalls.push(p); return { id: 'fb-prova' }; };
  });
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `echo "Il tuo codice monouso è ${CODICE}"` }) }] },
      { text: 'La banca ti ha mandato il codice di accesso.' },
      { text: `Non posso fare l’accesso al posto tuo con il codice ${CODICE}: inseriscilo tu nel sito.` },
    ],
  });
  await page.locator('#input').fill('leggi la notifica della banca');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'La banca ti ha mandato' })).toBeVisible({ timeout: 20_000 });

  await page.locator('#input').fill('puoi fare tu l’accesso?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Non posso fare' })).toBeVisible({ timeout: 20_000 });

  // La proposta apre il popup da sola; l'utente dice sì.
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await clickConfirm(page, 'ok');
  await page.waitForTimeout(1500);

  const inviati = JSON.stringify(await app.evaluate(() => globalThis.__fbCalls));
  expect(inviati, 'il codice letto dall’output del comando è partito nella segnalazione').not.toContain(CODICE);
});
