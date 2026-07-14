import { test, expect } from './fixtures/electron.mjs';

test('stress: dividers clamp, no collapse, migration from centerW', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();

  // Drag left divider hard to the RIGHT (try to crush the center deck column).
  const dl = page.locator('#dividerLeft');
  let box = await dl.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 3 + 2000, box.y + 200, { steps: 6 });
  await page.mouse.up();

  // Drag right divider hard to the LEFT (crush center from the other side too).
  const dr = page.locator('#dividerRight');
  box = await dr.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 3 - 2000, box.y + 200, { steps: 6 });
  await page.mouse.up();

  const info = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect().width;
    return { chat: r('colChat'), deck: r('colDeck'), detail: r('colDetail'),
             cols: getComputedStyle(document.getElementById('builderGrid')).gridTemplateColumns };
  });
  console.log('CLAMP_INFO', JSON.stringify(info));
  // Center deck column must never collapse below its minimum.
  expect(info.deck).toBeGreaterThan(200);
  expect(info.cols).not.toContain('NaN');

  // Migration: simulate an OLD saved layout using the legacy `centerW` key
  // (no rightW). Reopen and confirm it loads with sane defaults, no crash.
  await page.evaluate(async () => {
    const key = window.SN_CONST.STORAGE_KEYS.DECKS_UI;
    await chrome.storage.local.set({ [key]: { leftW: 999999, centerW: 500, module: 'default' } });
  });
  await page.goto('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('[data-deck-id]');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const mig = await page.evaluate(() => ({
    cols: getComputedStyle(document.getElementById('builderGrid')).gridTemplateColumns,
    deck: document.getElementById('colDeck').getBoundingClientRect().width,
  }));
  console.log('MIGRATE_INFO', JSON.stringify(mig));
  expect(mig.cols).not.toContain('NaN');
  expect(mig.deck).toBeGreaterThan(200);
});
