// Verifica #870 giro 4, rilievo 2: la home incognito parte dalla disposizione che l'utente ha scelto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, ordineDestra } from './_comune.mjs';

test('una finestra incognito mostra le carte di destra come le ha disposte l’utente', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const normale = await home(app);
  await normale.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await normale.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(normale.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  const disposta = await ordineDestra(normale);

  await shell.evaluate(() => window.filoShell.openIncognito());
  const inc = await home(app, normale);
  await expect.poll(() => ordineDestra(inc)).toEqual(disposta);
  await expect(inc.locator('#altro .dash-altro-app[data-id="mazzi"][data-tolta="1"]')).toBeVisible();
});
