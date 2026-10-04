// Giro 3, rilievo 1: chi scrive «/feedback» nella home cercando le sue segnalazioni ci deve arrivare, non solo leggere dove sono.
import { test, expect } from '../../fixtures/electron.mjs';

test('«/feedback» nella home porta chi non gestisce i feedback alle sue segnalazioni', async ({ app, openTab }) => {
  await app.evaluate(() => globalThis.SN_SEGNALAZIONI_MIE.registra({ id: 'mia', testo: 'Il tasto Salva non salva', stato: 'inviata', num: '990' }));
  const home = await openTab('filo://newtab/');
  const box = home.locator('#searchInput, #q, textarea, input[type=text]').first();
  await expect(box).toBeVisible({ timeout: 10_000 });
  await box.fill('/feedback');
  await box.press('Enter');
  const bacheca = () => app.windows().find((w) => { try { return w.url().startsWith('filo://board/'); } catch (_) { return false; } });
  await home.waitForTimeout(1500);
  if (!bacheca()) {
    const link = home.locator('a[href*="board"]').first();
    if (await link.count()) await link.click();
  }
  await expect.poll(() => !!bacheca(), { timeout: 8_000 }).toBe(true);
  await expect(bacheca().locator('#bdMie .bd-mia')).toHaveCount(1);
});
