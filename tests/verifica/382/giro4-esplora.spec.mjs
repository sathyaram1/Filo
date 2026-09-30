// #382 giro 4: esplorazione (screenshot della bolla in attesa e delle righe non controllate, pagina 2 che fallisce).

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, manyCards, deckWithCommander, send } from './_finti.mjs';

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}: bolla in attesa e righe con ?`, async ({ app, openTab }) => {
    test.setTimeout(120_000);
    await mockScryfall(app);
    await mockProvider(app);
    await manyCards(app, { pages: [175, 175], relevant: [7, 57, 107, 157, 207, 257, 307] });
    await app.evaluate(() => {
      globalThis.__judgeMs = 1500;
      const orig = globalThis.__judge;
      let n = 0;
      globalThis.__judge = (p, m) => { n += 1; return n === 3 ? 'boh' : orig(p, m); };
    });
    const page = await openTab('filo://decks/decks.html');
    await page.emulateMedia({ colorScheme: tema });
    await page.waitForLoadState('domcontentloaded');
    await deckWithCommander(page);
    await page.fill('#chatInput', 'carte che danno haste');
    await page.press('#chatInput', 'Enter');
    await expect(page.locator('.dk-progress')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `tests/.shots/382-g4-attesa-${tema}.png` });
    const bubble = page.locator('.dk-msg-bot').last();
    await expect(bubble.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 60_000 });
    await page.screenshot({ path: `tests/.shots/382-g4-fine-${tema}.png` });
    console.log('TESTO', await bubble.innerText());
  });
}

test('pagina 2 di Scryfall che fallisce', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [175, 175, 175], relevant: [7, 207, 407] });
  await app.evaluate(() => {
    const SC = globalThis.SN_SCRYFALL;
    // Riprendo il fetch finto e faccio fallire la pagina 2 una volta.
    let failed = false;
    const pages = globalThis.__pages;
    SC._setFetch(async (url) => {
      const u = new URL(String(url));
      if (u.pathname === '/cards/search') {
        const n = Number(u.searchParams.get('page') || '1');
        if (n === 2 && !failed) { failed = true; return { ok: false, status: 503, json: async () => ({}) }; }
        return { ok: true, status: 200, json: async () => ({ data: pages[n - 1] || [], has_more: n < pages.length, total_cards: 525 }) };
      }
      if (u.pathname === '/cards/niv-1') return { ok: true, status: 200, json: async () => ({ id: 'niv-1', name: 'Niv-Mizzet, Parun', mana_cost: '{U}{R}', cmc: 6, type_line: 'Legendary Creature', color_identity: ['U', 'R'], colors: ['U', 'R'], prices: { eur: '1' }, legalities: { commander: 'legal' } }) };
      if (u.pathname === '/symbology') return { ok: true, status: 200, json: async () => ({ data: [] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  const bubble = await send(page, 'carte che danno haste', 60_000);
  console.log('TESTO-P2', await bubble.innerText());
  console.log('RIPROVA', await bubble.locator('[data-retry]').count());
});
