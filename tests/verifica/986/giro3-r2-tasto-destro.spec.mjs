// Giro 3, rilievo 2: il tasto destro su una riga delle proprie segnalazioni offre ciò che si fa con quella segnalazione.
import { test, expect } from '../../fixtures/electron.mjs';

test('tasto destro su una riga: copiarne il testo e toglierla', async ({ app, openTab }) => {
  await app.evaluate(() => globalThis.SN_SEGNALAZIONI_MIE.registra({ id: 'r1', testo: 'Il tasto Salva non salva', stato: 'inviata', num: '990' }));
  const b = await openTab('filo://board/board.html#segnalazioni');
  const riga = b.locator('#bdMie .bd-mia').first();
  await expect(riga).toBeVisible();
  await riga.locator('.bd-mia-titolo').click({ button: 'right' });
  await expect(b.getByText(/copia/i).first()).toBeVisible({ timeout: 3_000 });
  await expect(b.getByText(/togli/i).first()).toBeVisible();
});
