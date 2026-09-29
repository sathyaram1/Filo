// #787 giro 2, rilievo 2: su una chat salvata lunga (mille messaggi, sotto il tetto) la pagina resta fluida
// mentre il ragionamento di Filo scorre in diretta.

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, newDeck, reloadBuilder, seedChat } from './aiuti.mjs';

test('chat di mille messaggi: il ragionamento in diretta non blocca la pagina', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const prev = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (args) => {
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, 75));
        try { args.onReasoning && args.onReasoning(`pezzo ${i} del ragionamento `); } catch (_) {}
      }
      return prev({ ...args, onReasoning: null });
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  await seedChat(app, deckId, 1000, { reasoning: 1500, ids: 20 });
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-user')).toHaveCount(500);
  await page.evaluate(() => {
    window.__lt = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: false });
  });
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-cot-body')).toContainText('pezzo 10');
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-pending', { hasText: 'sta pensando' })).toHaveCount(0, { timeout: 60_000 });
  const lt = await page.evaluate(() => window.__lt);
  const blocked = lt.reduce((a, b) => a + b, 0);
  // Tre secondi di ragionamento: su una chat corta la pagina non ha compiti lunghi; qui ne tollera pochi e brevi.
  expect(blocked).toBeLessThan(300);
});
