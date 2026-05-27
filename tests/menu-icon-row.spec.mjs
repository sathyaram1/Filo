// Verifica che il sotto-menu della freccetta "Altro…" (icon grid) resti aperto
// quando il cursore entra al suo interno (feedback alpha: prima si chiudeva
// dopo 500ms perché mancava attachSubmenuHover).
// Verifica anche che il logo Filo (newTab) apra una nuova tab.

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1>
  <p>Click destro qui per aprire il menu Filo con la riga icone.</p>
</body></html>`;

test('il sotto-menu icon-grid resta aperto quando il cursore entra dentro', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('p').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();

  // Hover sull'overflow ("Altro…") — apre il sotto-menu grid.
  const overflow = menu.locator('.sn-menu-row-overflow').first();
  await expect(overflow).toBeVisible();
  await overflow.hover();
  const grid = page.locator('.sn-menu-icon-grid');
  await expect(grid).toBeVisible({ timeout: 2000 });

  // Sposto il cursore dentro la griglia: il sotto-menu deve restare aperto
  // (prima si chiudeva dopo 500ms perché mancava attachSubmenuHover sul sub).
  await grid.hover();
  await page.waitForTimeout(800);
  await expect(grid).toBeVisible();
});

test('click sul logo Filo (newTab) apre una nuova tab', async ({ openTab, testServer, app }) => {
  const startCount = app.windows().length;
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('p').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  // Il newTab è nella riga primaria di default. data-sn-icon-id='newTab'.
  const newTabBtn = menu.locator('.sn-menu-row-btn[data-sn-icon-id="newTab"]');
  await expect(newTabBtn).toBeVisible();
  await newTabBtn.click();

  // Polling: attendo che compaia una nuova window di Filo (la newtab).
  const deadline = Date.now() + 5_000;
  let found = false;
  while (Date.now() < deadline) {
    const newtab = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (newtab) { found = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(found, 'newtab non aperta dopo click sul logo Filo').toBe(true);
});
