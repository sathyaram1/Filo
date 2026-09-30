// Esplorazione della verifica #382 giro 2: si cancella prima della consegna.
import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, manyCards, deckWithCommander, send } from './_mock.mjs';

test('cronologia AI: quanto scrive una ricerca larga', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [175, 175, 175, 175, 175, 175, 175], relevant: [3] });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  const before = await app.evaluate(async () => {
    const items = await globalThis.SN_HISTORY.list();
    return { n: items.length, bytes: JSON.stringify(items).length };
  });
  const bubble = await send(page, 'carte che danno haste');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  const after = await app.evaluate(async () => {
    const items = await globalThis.SN_HISTORY.list();
    const A = globalThis.SN_CONST.ACTIONS;
    return {
      n: items.length, bytes: JSON.stringify(items).length,
      judge: items.filter((i) => i.action === A.DECKS_SEARCH_FILTER).length,
      limit: globalThis.SN_CONST.HISTORY_LIMIT_BYTES,
    };
  });
  console.log('HISTORY', JSON.stringify({ before, after }));
});

test('giudice cambiato nelle impostazioni: la stessa ricerca', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [30], relevant: [5] });
  await app.evaluate(() => {
    // Il primo giudice sbaglia (tiene Carta 1), quello nuovo tiene le giuste.
    const good = globalThis.__judge;
    globalThis.__judge = (prompt, model) => (/gemma/.test(model) ? good(prompt) : JSON.stringify({ keep: [1] }));
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  const first = await send(page, 'carte che danno haste');
  console.log('FIRST', await first.locator('.dk-row-name').allTextContents());
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({ models: { ...s.models, [C.ACTIONS.DECKS_SEARCH_FILTER]: 'gemma' } });
  });
  const again = await send(page, 'carte che danno haste');
  console.log('AGAIN', await again.locator('.dk-row-name').allTextContents(),
    await app.evaluate(() => globalThis.__judgeModels));
});

test('seguito senza filter: criterio', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [10], relevant: [2] });
  await app.evaluate(() => {
    let n = 0;
    globalThis.__chat = () => (++n === 1
      ? JSON.stringify({ query: '(o:"have haste" or o:haste)', filter: 'fa guadagnare haste ad altre creature' })
      : JSON.stringify({ query: '(o:"have haste" or o:haste) cmc<=2' }));
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await send(page, 'carte che danno haste');
  await send(page, 'e solo quelle che costano poco');
  const prompts = await app.evaluate(() => globalThis.__filterCalls.map((p) => p.split('\n').slice(0, 3).join(' | ')));
  console.log('PROMPTS', JSON.stringify(prompts));
});

test('commander nel giudice', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [10], relevant: [2] });
  await app.evaluate(() => {
    globalThis.__chat = () => JSON.stringify({ query: '(t:instant or t:sorcery or o:draw)', filter: 'carte che sinergizzano con il commander del mazzo' });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await send(page, 'carte in sinergia col mio commander');
  const p = await app.evaluate(() => globalThis.__filterCalls[0]);
  console.log('JUDGE-PROMPT-HEAD', p.split('CARTE CANDIDATE')[0]);
  console.log('HAS-NIV', /Niv-Mizzet/.test(p));
});

for (const theme of ['light', 'dark']) {
  test(`aspetto attesa e ? in tema ${theme}`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    await mockScryfall(app);
    await mockProvider(app);
    await manyCards(app, { pages: [175, 175, 30], relevant: [1, 51, 101, 200] });
    await app.evaluate(async (_e, theme) => {
      await globalThis.SN_STORAGE.updateSettings({ theme });
      globalThis.__judgeGate = new Promise((r) => { globalThis.__openGate = r; });
      const judge = globalThis.__judge;
      globalThis.__judge = (prompt) => (/Giusta 51 /.test(prompt) ? 'boh' : judge(prompt));
    }, theme);
    const page = await openTab('filo://decks/decks.html');
    await page.waitForLoadState('domcontentloaded');
    await deckWithCommander(page);
    await page.fill('#chatInput', 'carte che danno haste');
    await page.press('#chatInput', 'Enter');
    const bubble = page.locator('.dk-msg-bot').last();
    await expect(bubble.locator('.dk-progress')).toContainText('Controllo', { timeout: 15_000 });
    await page.screenshot({ path: `tests/.shots/v382-attesa-${theme}.png` });
    await app.evaluate(() => globalThis.__openGate());
    await expect(bubble.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 20_000 });
    await page.screenshot({ path: `tests/.shots/v382-fine-${theme}.png` });
    console.log('REPLY', theme, await bubble.locator('.dk-msg-text').allTextContents());
  });
}
