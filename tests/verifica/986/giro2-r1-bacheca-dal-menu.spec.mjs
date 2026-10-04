// Verifica #986 giro 2, rilievo 1: chi ha già mandato segnalazioni prima di questa versione e apre la Bacheca
// dal menu (senza passare dal collegamento della pagina dei feedback) non trova nessuna sezione «Le tue segnalazioni».
import { test, expect } from '../../fixtures/electron.mjs';

test('bacheca aperta dal menu da chi ha segnalazioni di prima: la sezione c\'è e dice perché è vuota', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: 'cid-tester-di-settembre' });
    await globalThis.SN_FEEDBACK_MINE.ricordaId('fbDoc-vecchia');
  });
  const bacheca = await openTab('filo://board/board.html');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_SEGNALAZIONI_MIE.haPrecedenti()))).toBe(true);
  await expect(bacheca.locator('#bdMie')).toBeVisible({ timeout: 8_000 });
  await expect(bacheca.locator('#bdMieVuoto')).toContainText('prima di questa versione');
});
