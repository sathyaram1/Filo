// #588.5 giro 3, rilievo 2: col puntatore sopra un avviso a tempo, l'avviso non deve sparire sotto la mano.
import { test, expect } from '../../fixtures/electron.mjs';

test('un avviso a tempo resta finché il puntatore ci sta sopra, e riparte quando esce', async ({ shell, avvisi }) => {
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', {
    durationSec: 2,
    actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }],
  }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await vista.locator('.shell-notif-msg').hover();
  await expect.poll(() => vista.evaluate(() => document.querySelector('.shell-notif:hover') !== null)).toBe(true);

  // Il doppio della sua durata col puntatore fermo sopra: l'avviso c'è ancora, e i suoi pulsanti si raggiungono.
  await shell.waitForTimeout(4000);
  await expect(shell.locator('.shell-notif:not([data-closing="1"])')).toHaveCount(1);
  await expect(vista.locator('.shell-notif.show .shell-notif-action', { hasText: 'Apri file' })).toBeVisible();

  // Tolto il puntatore, il tempo torna a correre e l'avviso se ne va da solo.
  await vista.mouse.move(2, 2);
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 8000 });
});
