// PROBE temporaneo (audit prober): edge case sui mazzi.
import { test, expect } from './fixtures/electron.mjs';

test('probe decks: nomi limite', async ({ openTab }) => {
  test.setTimeout(120000);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForSelector('body');
  await page.waitForTimeout(1000);
  const html = await page.evaluate(() => document.body.innerHTML.slice(0, 3000));
  console.log('PROBE decks html:', html);
});
