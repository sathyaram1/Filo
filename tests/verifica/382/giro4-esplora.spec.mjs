// #382 giro 4: esplorazione (righe non controllate, Riprova, uscita dal mazzo mentre controlla).

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, manyCards, deckWithCommander, send } from './_finti.mjs';

async function judgeFailsBatch(app) {
  await app.evaluate(() => {
    const orig = globalThis.__judge;
    globalThis.__failBatch = true;
    globalThis.__judge = (p, m) => (globalThis.__failBatch && /Carta 110\b/.test(p) ? 'boh' : orig(p, m));
  });
}

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}: righe con ? e Riprova`, async ({ app, openTab }) => {
    test.setTimeout(120_000);
    await mockScryfall(app);
    await mockProvider(app);
    await manyCards(app, { pages: [175, 175], relevant: [7, 57, 107, 157, 207, 257, 307] });
    await judgeFailsBatch(app);
    const page = await openTab('filo://decks/decks.html');
    await page.emulateMedia({ colorScheme: tema });
    await page.waitForLoadState('domcontentloaded');
    await deckWithCommander(page);
    const bubble = await send(page, 'carte che danno haste', 60_000);
    await page.screenshot({ path: `tests/.shots/382-g4-q-${tema}.png` });
    console.log('TESTO', (await bubble.innerText()).slice(0, 400));
    const calls0 = await app.evaluate(() => globalThis.__filterCalls.length);
    await app.evaluate(() => { globalThis.__failBatch = false; });
    await bubble.locator('[data-retry]').click();
    const b2 = page.locator('.dk-msg-bot').last();
    await expect(b2.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 60_000 });
    const calls1 = await app.evaluate(() => globalThis.__filterCalls.length);
    console.log('CHIAMATE riprova', calls1 - calls0, 'righe', await b2.locator('.dk-cardlist .dk-row').count(), 'q', await b2.locator('.dk-row-unchecked').count());
  });
}

test('esco dal mazzo mentre controlla e ci rientro', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [175, 175], relevant: [7, 57, 207] });
  await app.evaluate(() => { globalThis.__judgeMs = 2500; });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await page.fill('#chatInput', 'carte che danno haste');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-progress')).toBeVisible({ timeout: 15_000 });
  await page.click('#backToLibrary');
  await page.waitForTimeout(500);
  await page.locator('[data-deck-id]').first().click();
  await expect(page.locator('#screenBuilder')).toBeVisible();
  console.log('DURANTE', await page.locator('.dk-msg-bot').last().innerText());
  await page.waitForTimeout(8000);
  const bubble = page.locator('.dk-msg-bot').last();
  console.log('DOPO', await bubble.innerText());
  await page.screenshot({ path: 'tests/.shots/382-g4-rientro.png' });
});
