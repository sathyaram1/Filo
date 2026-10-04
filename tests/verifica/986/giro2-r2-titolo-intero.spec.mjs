// Verifica #986 giro 2, rilievo 2: aperta una riga, il titolo lungo resta tagliato coi puntini e non si legge per intero.
import { test, expect } from '../../fixtures/electron.mjs';

test('aperta la riga, il titolo lungo si legge per intero', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(() => globalThis.SN_SEGNALAZIONI_MIE.registra({
    id: 'lunga', testo: 'Testo', stato: 'inviata', num: '990',
    titolo: 'Il colore del bordo delle schede non cambia mai, qualunque cosa scelga nelle impostazioni avanzate, nemmeno dopo il riavvio di Filo e la pulizia della cache',
  }));
  const b = await openTab('filo://board/board.html#segnalazioni');
  const riga = b.locator('#bdMie .bd-mia').first();
  await riga.locator('.bd-mia-testa').click();
  const tagliato = await riga.locator('.bd-mia-titolo').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(tagliato).toBe(false);
});
