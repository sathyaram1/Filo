// Giro 4, rilievo 2: rimandata una segnalazione «non partita», nell'elenco resta una riga sola per quella segnalazione.
import { test, expect } from '../../fixtures/electron.mjs';

test('«Rimanda» non lascia indietro la riga «non partita»', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const M = globalThis.SN_SEGNALAZIONI_MIE;
    await M.registra({ id: 'ferma', testo: 'Il video si blocca', creataIl: '2026-10-04T07:00:00Z' });
    await M.nonPartita('ferma');
    globalThis.SN_FEEDBACK.submit = async () => ({ id: 'nuovo', seq: 1000, failed: [] });
  });
  const b = await openTab('filo://board/board.html#segnalazioni');
  const righe = b.locator('#bdMie .bd-mia');
  await expect(righe).toHaveCount(1);
  await righe.first().locator('.bd-mia-titolo').click({ button: 'right' });
  await b.locator('.bd-mia-menu').getByText('Rimanda').click();
  await expect(b.locator('.sn-fb-modal')).toBeVisible();
  await b.locator('.sn-fb-send').click();
  await expect(b.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 6_000 });
  await expect(righe.filter({ hasText: 'Il video si blocca' }).first()).toBeVisible();
  await b.waitForTimeout(1500);
  await expect(righe.filter({ hasText: 'Il video si blocca' })).toHaveCount(1);
  await expect(righe.locator('.bd-mia-stato', { hasText: 'non partita' })).toHaveCount(0);
});
