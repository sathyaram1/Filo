import { test } from './fixtures/electron.mjs';

test('shot builder', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await page.locator('#screenBuilder').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/verify-330-builder.png' });
  const info = await page.evaluate(() => ({
    vw: window.innerWidth,
    builderW: document.getElementById('builderGrid').getBoundingClientRect().width,
    cols: getComputedStyle(document.getElementById('builderGrid')).gridTemplateColumns,
    backVisible: !!document.querySelector('.dk-col-head-chat #backToLibrary'),
  }));
  console.log('VERIFY_INFO', JSON.stringify(info));
});
