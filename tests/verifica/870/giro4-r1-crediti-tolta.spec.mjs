// Verifica #870 giro 4, rilievo 1: la carta dei Crediti tolta si rimette senza disfare la disposizione dell'utente.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, ordineDestra } from './_comune.mjs';

test('tolta la carta dei Crediti, si rimette e la destra resta come l’ha disposta l’utente', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(page.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  const disposta = await ordineDestra(page);

  const crediti = page.locator('#accade .dash-carta[data-tipo="crediti"]');
  await crediti.click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: /^Togli/ }).click();
  await expect(crediti).toHaveCount(0);

  // Come ogni carta tolta, si ritrova in «altro» e da lì si rimette.
  const inAltro = page.locator('#altro .dash-altro-app', { hasText: 'Crediti' });
  await expect(inAltro).toHaveCount(1);
  await inAltro.click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Rimetti' }).click();
  await expect(crediti).toBeVisible();
  expect(await ordineDestra(page)).toEqual(disposta);
});
