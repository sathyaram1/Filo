// Feedback yqgFIs: i tasti "avanti" e "indietro" della riga icone sono
// correttamente grigi quando non avrebbero effetto, MA:
//   1. non si potevano trascinare per spostarli (l'attributo `disabled` nativo
//      azzerava i pointer event → niente drag);
//   2. spostando un'altra icona tornavano non grigi (il redraw post-drop girava
//      senza navState, quindi canBack/canFwd ripiombavano a `true`).
//
// Questo test apre il menu su una tab appena aperta (nessuna cronologia →
// avanti/indietro disabilitati), entra nella griglia "Altro…" e verifica:
//   - back/forward sono grigi (classe soft) ma NON hanno l'attributo `disabled`
//     nativo e restano trascinabili (data-sn-draggable="1");
//   - dopo aver trascinato un'altra icona, restano grigi.

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Filo drag test</h1>
  <p>Click destro qui.</p>
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

test('avanti/indietro grigi sono trascinabili (niente attributo disabled nativo)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  const grid = await openOverflowGrid(page);

  for (const id of ['back', 'forward']) {
    const btn = grid.locator(`.sn-menu-icon-btn[data-sn-icon-id="${id}"]`);
    await expect(btn).toBeVisible();
    // Grigio (classe soft), ma trascinabile e senza il `disabled` nativo che
    // bloccherebbe i pointer event.
    await expect(btn).toHaveClass(/sn-menu-btn-disabled/);
    await expect(btn).toHaveAttribute('data-sn-draggable', '1');
    const nativeDisabled = await btn.evaluate((el) => el.disabled === true);
    expect(nativeDisabled, `${id} non deve avere l'attributo disabled nativo`).toBe(false);
  }
});

test('trascinare un\'altra icona non fa tornare colorati avanti/indietro', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  const grid = await openOverflowGrid(page);

  const back = grid.locator('.sn-menu-icon-btn[data-sn-icon-id="back"]');
  const forward = grid.locator('.sn-menu-icon-btn[data-sn-icon-id="forward"]');
  await expect(back).toHaveClass(/sn-menu-btn-disabled/);
  await expect(forward).toHaveClass(/sn-menu-btn-disabled/);

  // Trascino un'altra icona (reload) verso colorPicker, dentro la stessa griglia.
  const source = grid.locator('.sn-menu-icon-btn[data-sn-icon-id="reload"]');
  const target = grid.locator('.sn-menu-icon-btn[data-sn-icon-id="colorPicker"]');
  const sBox = await source.boundingBox();
  const tBox = await target.boundingBox();
  expect(sBox && tBox).toBeTruthy();

  const sx = sBox.x + sBox.width / 2;
  const sy = sBox.y + sBox.height / 2;
  const tx = tBox.x + tBox.width / 2;
  const ty = tBox.y + tBox.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // Supera la soglia di drag (4px) e muoviti a step verso il target.
  await page.mouse.move(sx + 8, sy + 8, { steps: 3 });
  await page.mouse.move(tx, ty, { steps: 6 });
  await page.mouse.up();

  // La griglia si ridisegna in-place dopo il drop: avanti/indietro DEVONO
  // restare grigi (prima del fix tornavano colorati).
  const grid2 = page.locator('.sn-menu-icon-grid');
  await expect(grid2).toBeVisible();
  await expect(grid2.locator('.sn-menu-icon-btn[data-sn-icon-id="back"]')).toHaveClass(/sn-menu-btn-disabled/, { timeout: 3000 });
  await expect(grid2.locator('.sn-menu-icon-btn[data-sn-icon-id="forward"]')).toHaveClass(/sn-menu-btn-disabled/);
});
