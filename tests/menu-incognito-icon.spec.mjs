// Feedback 31C6 (newtab): "aggiungi la modalità in incognito … deve poter
// essere attivata da impostazioni/sicurezza o con un'icona nel tasto destro
// (una delle icone nel menu secondario)".
//
// L'infrastruttura incognito (finestra effimera, sessione in RAM, voce nel menu
// Impostazioni) era già presente, ma l'ICONA nel menu del tasto destro — il
// secondo ingresso esplicitamente richiesto — non compariva mai: l'azione era
// nel registry ma assente dal layout di default delle icone, quindi nessun
// utente la vedeva. Questi test asseriscono che l'icona è ora presente nel menu
// secondario e che, cliccandola, si apre davvero una finestra incognito.
//
// Prima del fix: il menu secondario NON conteneva l'icona incognito → il primo
// expect fallirebbe.

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1>
  <p>Click destro qui per aprire il menu Filo con la riga icone.</p>
</body></html>`;

async function openSecondaryGrid(page) {
  await page.locator('p').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  const overflow = menu.locator('.sn-menu-row-overflow').first();
  await expect(overflow).toBeVisible();
  await overflow.hover();
  const grid = page.locator('.sn-menu-icon-grid');
  await expect(grid).toBeVisible({ timeout: 2000 });
  return grid;
}

test("l'icona incognito è presente nel menu secondario del tasto destro", async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  const grid = await openSecondaryGrid(page);
  const incognitoBtn = grid.locator('.sn-menu-icon-btn[data-sn-icon-id="incognito"]');
  await expect(incognitoBtn).toBeVisible();
});

test("cliccando l'icona incognito si apre una finestra incognito", async ({ openTab, testServer, app }) => {
  const page = await testServer.openReady(openTab, HTML);
  const grid = await openSecondaryGrid(page);
  const incognitoBtn = grid.locator('.sn-menu-icon-btn[data-sn-icon-id="incognito"]');
  await expect(incognitoBtn).toBeVisible();
  await incognitoBtn.click();

  // La finestra incognito carica filo://shell/shell.html?incognito=1.
  const deadline = Date.now() + 5_000;
  let found = false;
  while (Date.now() < deadline) {
    found = app.windows().some((w) => w.url().includes('incognito=1'));
    if (found) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(found, 'finestra incognito non aperta dopo click sull\'icona').toBe(true);
});
