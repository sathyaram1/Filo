// Colonne ridimensionabili della dashboard di gestione (feedback #375):
// i due divisori fra lista / dettaglio / pannello laterale si trascinano,
// la misura scelta viene ricordata alla riapertura, il doppio clic la
// ripristina e la finestra stretta non fa collassare il dettaglio centrale.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function colWidth(page, sel) {
  return page.locator(sel).evaluate((el) => el.getBoundingClientRect().width);
}

async function dragDivider(page, sel, dx) {
  const box = await page.locator(sel).boundingBox();
  const y = box.y + Math.min(200, box.height / 2);
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 8 });
  await page.mouse.up();
}

test('trascinando il divisore sinistro la lista si allarga e la misura è ricordata', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgDividerLeft')).toBeVisible();

  const before = await colWidth(page, '#mgListCol');
  await dragDivider(page, '#mgDividerLeft', 140);
  const after = await colWidth(page, '#mgListCol');
  expect(Math.round(after - before)).toBeGreaterThan(110);
  // Traccia visiva ispezionabile della nuova disposizione (cartella gitignorata).
  await page.screenshot({ path: 'tests/.shots/manage-cols-resized.png' });

  // Riapertura della pagina: la larghezza scelta non torna al default.
  await page.goto(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgDividerLeft')).toBeVisible();
  await expect.poll(() => colWidth(page, '#mgListCol')).toBeGreaterThan(before + 110);
});

test('il divisore destro ridimensiona il pannello laterale', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const before = await colWidth(page, '#mgSideCol');
  // Trascinare verso SINISTRA allarga la colonna destra.
  await dragDivider(page, '#mgDividerRight', -120);
  const after = await colWidth(page, '#mgSideCol');
  expect(Math.round(after - before)).toBeGreaterThan(90);

  // Il dettaglio centrale resta il pannello flessibile: si è stretto, non è
  // uscito dal riquadro.
  const geom = await page.evaluate(() => ({
    grid: document.getElementById('mgReviewGrid').getBoundingClientRect().width,
    list: document.getElementById('mgListCol').getBoundingClientRect().width,
    detail: document.getElementById('mgDetailCol').getBoundingClientRect().width,
    side: document.getElementById('mgSideCol').getBoundingClientRect().width,
  }));
  expect(geom.detail).toBeGreaterThan(100);
  expect(geom.list + geom.detail + geom.side).toBeLessThanOrEqual(geom.grid + 4);
});

test('doppio clic sul divisore riporta la colonna alla misura iniziale', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const initial = await colWidth(page, '#mgListCol');
  await dragDivider(page, '#mgDividerLeft', 140);
  expect(await colWidth(page, '#mgListCol')).toBeGreaterThan(initial + 110);

  await page.locator('#mgDividerLeft').dblclick();
  await expect.poll(() => colWidth(page, '#mgListCol')).toBeLessThan(initial + 4);

  // Il ripristino è persistito quanto l'allargamento: riaprendo resta al default.
  await page.goto(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgDividerLeft')).toBeVisible();
  await expect.poll(() => colWidth(page, '#mgListCol')).toBeLessThan(initial + 4);
});

test('con le frecce da tastiera il divisore ridimensiona senza mouse', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const before = await colWidth(page, '#mgListCol');
  await page.locator('#mgDividerLeft').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(() => colWidth(page, '#mgListCol')).toBeGreaterThan(before + 50);
});

test('larghezze salvate più grandi della finestra non fanno sparire il dettaglio', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // Stato "colonne allargate su uno schermo grande, poi finestra piccola".
  await page.evaluate(async () => {
    const key = window.SN_CONST.STORAGE_KEYS.MANAGE_UI;
    await chrome.storage.local.set({ [key]: { leftW: 5000, rightW: 5000 } });
  });

  await page.goto(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgDividerLeft')).toBeVisible();

  const geom = await page.evaluate(() => ({
    grid: document.getElementById('mgReviewGrid').getBoundingClientRect().width,
    list: document.getElementById('mgListCol').getBoundingClientRect().width,
    detail: document.getElementById('mgDetailCol').getBoundingClientRect().width,
    side: document.getElementById('mgSideCol').getBoundingClientRect().width,
  }));
  // La conversazione al centro resta leggibile invece di collassare a zero…
  expect(geom.detail).toBeGreaterThan(280);
  // …e nessuna colonna trabocca fuori dal riquadro sovrapponendosi alle altre.
  expect(geom.list + geom.detail + geom.side).toBeLessThanOrEqual(geom.grid + 4);
  expect(geom.list).toBeLessThan(geom.grid);
});
