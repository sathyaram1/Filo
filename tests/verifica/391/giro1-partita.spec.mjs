// Verifica #391 giro 1: la Partita (stub) non ha porte dal Deck builder, da nessuna strada utente.
import { test, expect } from '../../fixtures/electron.mjs';

test('libreria: niente «Partita» visibile, in chiaro e in scuro, e il pulsante resta', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#newDeck')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Partita' })).toHaveCount(0);
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.screenshot({ path: `tests/.shots/391-libreria-${tema}.png` });
  }
});

test('dal mazzo aperto, un #/game scritto a mano e poi «indietro» non mostrano mai il segnaposto', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/game'; });
  await expect(page.locator('#screenLibrary')).toBeVisible();
  await expect(page.locator('#screenGame')).toBeHidden();
  await page.goBack();
  await expect(page.locator('#screenGame')).toBeHidden();
  await page.goForward().catch(() => {});
  await expect(page.locator('#screenGame')).toBeHidden();
  await expect(page.getByText('Il tavolo di gioco arriverà')).toBeHidden();
});

test('ricaricando su #/game si resta sui mazzi', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html#/game');
  await page.waitForLoadState('domcontentloaded');
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#screenLibrary')).toBeVisible();
  await expect(page.locator('#screenGame')).toBeHidden();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/');
});
