import { test, expect } from './fixtures/electron.mjs';

test('resize: widen chat then shrink window', async ({ app, openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();

  // Enlarge the window so a wide chat column is a LEGITIMATE, persistable drag.
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1800, 900);
  });
  await page.waitForTimeout(300);

  // Drag left divider far right — legitimately widen chat on the big window.
  const dl = page.locator('#dividerLeft');
  const box = await dl.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 3 + 700, box.y + 200, { steps: 8 });
  await page.mouse.up();
  const wideLeft = await page.locator('#colChat').evaluate((el) => el.getBoundingClientRect().width);
  console.log('WIDE_LEFT', wideLeft);

  // Now shrink the window back to laptop size (persisted leftW stays large).
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1200, 800);
  });
  await page.waitForTimeout(300);

  const info = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect().width;
    return { vw: window.innerWidth, chat: r('colChat'), deck: r('colDeck'), detail: r('colDetail'),
             cols: getComputedStyle(document.getElementById('builderGrid')).gridTemplateColumns };
  });
  console.log('AFTER_SHRINK', JSON.stringify(info));

  // Reopen after shrink — loadLayout applies the persisted (now-too-wide) leftW.
  await page.goto('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('[data-deck-id]');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const reopened = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect().width;
    return { vw: window.innerWidth, chat: r('colChat'), deck: r('colDeck'),
             cols: getComputedStyle(document.getElementById('builderGrid')).gridTemplateColumns };
  });
  console.log('REOPENED', JSON.stringify(reopened));
  await page.screenshot({ path: 'tests/.shots/verify-330-shrunk.png' });
});
