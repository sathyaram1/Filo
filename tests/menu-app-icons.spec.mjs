// Le icone Impostazioni, Home e le app interne (Editor, Feedback) devono essere
// raggiungibili fra le icone del menu del tasto destro (feedback alpha). Di
// default vivono nella griglia "Altro…" (secondary).

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo test page</h1>
  <p>Click destro qui per aprire il menu Filo.</p>
</body></html>`;

async function openOverflowGrid(page) {
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

test('Impostazioni, Home, Editor e Feedback sono presenti fra le icone del menu', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  const grid = await openOverflowGrid(page);

  for (const id of ['openOptions', 'home', 'editorApp', 'feedbackApp']) {
    await expect(
      grid.locator(`.sn-menu-icon-btn[data-sn-icon-id="${id}"]`),
      `icona "${id}" mancante nel menu`,
    ).toBeVisible();
  }
});

test('click su Impostazioni apre la pagina Opzioni', async ({ openTab, testServer, app }) => {
  const page = await testServer.openReady(openTab, HTML);
  const grid = await openOverflowGrid(page);
  await grid.locator('.sn-menu-icon-btn[data-sn-icon-id="openOptions"]').click();

  const deadline = Date.now() + 5_000;
  let found = false;
  while (Date.now() < deadline) {
    if (app.windows().find((w) => w.url().startsWith('filo://options'))) { found = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(found, 'pagina Opzioni non aperta dopo click su Impostazioni').toBe(true);
});

test('click su Editor apre la app Editor', async ({ openTab, testServer, app }) => {
  const page = await testServer.openReady(openTab, HTML);
  const grid = await openOverflowGrid(page);
  await grid.locator('.sn-menu-icon-btn[data-sn-icon-id="editorApp"]').click();

  const deadline = Date.now() + 5_000;
  let found = false;
  while (Date.now() < deadline) {
    if (app.windows().find((w) => w.url().startsWith('filo://editor'))) { found = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(found, 'app Editor non aperta dopo click su Editor').toBe(true);
});
