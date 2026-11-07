// Esplorazione del giro 3: quali moduli su richiesta restano davvero in attesa a pagina pronta, e le strade che li usano.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const inAttesa = (page) => page.evaluate(() => (document.documentElement.dataset.filoSuRichiesta || '').split(',').filter(Boolean));

test('pagina con campo di testo e link: cosa resta in attesa', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><p id="p">Frase.</p><textarea id="t"></textarea><a id="a" href="https://example.com/x">link</a></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  console.log('A PRONTA:', JSON.stringify(await inAttesa(page)));
  await page.locator('#t').click();
  await page.keyboard.type('ciao come stai');
  await page.waitForTimeout(800);
  console.log('DOPO SCRITTURA:', JSON.stringify(await inAttesa(page)));
  await page.locator('#a').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 8000 });
  console.log('DOPO TASTO DESTRO LINK:', JSON.stringify(await inAttesa(page)));
  await page.keyboard.press('Escape');
  await page.locator('#p').click({ button: 'right' });
  await expect(menu.principale).toBeVisible({ timeout: 8000 });
  console.log('VOCI:', JSON.stringify(await menu.principale.locator('.sn-menu-item').allInnerTexts()));
  console.log('DOPO TASTO DESTRO TESTO:', JSON.stringify(await inAttesa(page)));
});
