// #787 giro 3 — esplorazione: apertura di chat salvate grandi, e cosa costa.

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, newDeck, reloadBuilder, seedChat } from './aiuti.mjs';

for (const n of [2000, 5000]) {
  test(`apertura di una chat di ${n} messaggi`, async ({ app, openTab }) => {
    test.setTimeout(180_000);
    await mockScryfall(app);
    await mockProvider(app);
    const page = await openTab('filo://decks/decks.html');
    await page.waitForLoadState('domcontentloaded');
    const deckId = await newDeck(page);
    await seedChat(app, deckId, n, { reasoning: 1500, ids: 20 });
    const t0 = Date.now();
    await reloadBuilder(page);
    await expect(page.locator('.dk-msg-user')).toHaveCount(n / 2, { timeout: 120_000 });
    const t1 = Date.now();
    console.log(`[esplora] ${n}: bolle visibili dopo ${t1 - t0} ms`);
    await page.evaluate(() => {
      window.__lt = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: false });
    });
    // Clic sul + dell'ultima lista.
    const t2 = Date.now();
    await page.locator('.dk-msg-bot').last().locator('.dk-add').first().click();
    await expect(page.locator('#deckCount')).toHaveText('1/100 carte');
    console.log(`[esplora] ${n}: + → mazzo in ${Date.now() - t2} ms; compiti lunghi ${JSON.stringify(await page.evaluate(() => window.__lt.map(Math.round)))}`);
    // Scrivere nel campo: ogni tasto costa?
    await page.evaluate(() => { window.__lt = []; });
    await page.locator('#chatInput').pressSequentially('creature con haste', { delay: 20 });
    console.log(`[esplora] ${n}: digitazione, compiti lunghi ${JSON.stringify(await page.evaluate(() => window.__lt.map(Math.round)))}`);
    const size = await app.evaluate(async () => {
      const k = globalThis.SN_CONST.STORAGE_KEYS.DECK_CHATS;
      const r = await chrome.storage.local.get(k);
      return JSON.stringify(r[k]).length;
    });
    console.log(`[esplora] ${n}: chat salvata ${Math.round(size / 1024)} KB`);
    // Un turno intero: quanto costa nel main (scrittura append + fill).
    await page.evaluate(() => { window.__lt = []; });
    const t3 = Date.now();
    await page.press('#chatInput', 'Enter');
    await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-pending', { hasText: 'sta pensando' })).toHaveCount(0, { timeout: 60_000 });
    console.log(`[esplora] ${n}: turno in ${Date.now() - t3} ms; compiti lunghi ${JSON.stringify(await page.evaluate(() => window.__lt.map(Math.round)))}`);
    await page.screenshot({ path: `tests/.shots/787-g3-lunga-${n}.png` });
  });
}
