// #788 esplorazione: riga di sintesi delle liste della chat dei mazzi (titolo, triangolino, tasto destro).

import { test, expect } from '../../fixtures/electron.mjs';

async function finti(app) {
  await app.evaluate(async () => {
    const mk = (id, name, cmc, eur) => ({
      id, name, mana_cost: '{R}', cmc, type_line: 'Instant', colors: ['R'], color_identity: ['R'],
      image_uris: { normal: `https://cards.test/${id}.jpg` }, prices: { eur }, legalities: { commander: 'legal' },
      scryfall_uri: `https://scryfall.com/card/${id}`,
    });
    const NIV = { ...mk('niv-1', 'Niv-Mizzet, Parun', 6, '3.21'), color_identity: ['U', 'R'], type_line: 'Legendary Creature — Dragon' };
    const CARDS = [mk('a-1', 'Zap', 3, '0.30'), mk('b-1', 'Bolt', 1, '1.10'), mk('c-1', 'Anvil', 2, null)];
    const BY = { 'niv-1': NIV };
    for (const c of CARDS) BY[c.id] = c;
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') body = { data: globalThis.__v_cards || CARDS, has_more: false };
      else if (BY[u.pathname.replace('/cards/', '')]) body = BY[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') body = { data: [] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const prompt = String(messages[messages.length - 1].content || '');
      if (/CARTE CANDIDATE/.test(prompt)) {
        const keep = (prompt.match(/^\d+(?=\. )/gm) || []).map(Number);
        return { text: JSON.stringify({ keep }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      }
      const text = /cerca/i.test(prompt)
        ? JSON.stringify({ reply: 'Eccole.', query: 'o:haste', filter: 'dà haste', ...(globalThis.__v_title !== undefined ? { title: globalThis.__v_title } : {}) })
        : JSON.stringify({ reply: 'Ok.' });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (args) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback(args);
      if (args.onDelta) args.onDelta(r.text);
      return r;
    };
  });
}

async function mazzo(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const id = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  await page.evaluate(async (deckId) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id: deckId, scryfallId: 'niv-1' }), id);
  return id;
}

async function chiedi(page, text, n) {
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot')).toHaveCount(n);
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-pending')).toHaveCount(0, { timeout: 15_000 });
}

test('titoli, triangolino, menu e tema scuro', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await finti(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await mazzo(page);

  const titoli = [];
  for (const [i, t] of [undefined, '12 carte che danno rapidità', 'Carte che danno rapidità', 'Rapidità: le migliori', 'o:haste id<=UR', '3 modi per vincere'].entries()) {
    await app.evaluate((_e, v) => { globalThis.__v_title = v; }, t);
    await chiedi(page, `cerca ${i}`, i + 1);
    titoli.push(await page.locator('.dk-msg-bot').last().locator('.dk-list-title').textContent());
  }
  console.log('TITOLI', JSON.stringify(titoli));

  await app.evaluate((_e) => { globalThis.__v_cards = undefined; globalThis.__v_title = 'carte veloci'; });
  const last = () => page.locator('.dk-msg-bot').last();
  // triangolino sull'ultima, molte volte di fila
  for (let k = 0; k < 5; k += 1) await last().locator('.dk-list-summary').click();
  await expect(last().locator('.dk-cardlist')).toBeHidden();
  await last().locator('.dk-list-summary').click();
  await expect(last().locator('.dk-cardlist .dk-row')).toHaveCount(3);

  // prezzo: senza prezzo in fondo
  await last().locator('.dk-list-summary').click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Ordina per prezzo' }).click();
  console.log('PREZZO', JSON.stringify(await last().locator('.dk-row-name').allTextContents()));
  await last().locator('.dk-list-summary').click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Ordina per nome' }).click();
  console.log('NOME', JSON.stringify(await last().locator('.dk-row-name').allTextContents()));

  // tastiera: menu contestuale dal tasto apposito sulla riga a fuoco
  await last().locator('.dk-list-summary').focus();
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(300);
  const box = await page.locator('.dk-ctxmenu').boundingBox().catch(() => null);
  const riga = await last().locator('.dk-list-summary').boundingBox();
  console.log('TASTIERA', JSON.stringify({ box, riga }));
  await page.keyboard.press('Escape');

  await last().locator('.dk-list-summary').click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Ordina per prezzo' }).hover();
  await page.screenshot({ path: 'tests/.shots/v788-chiaro.png' });
  await page.keyboard.press('Escape');

  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await expect(page.locator('.dk-msg-bot')).toHaveCount(6);
  await page.locator('.dk-msg-bot').last().locator('.dk-list-summary').click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Ordina per nome' }).hover();
  await page.screenshot({ path: 'tests/.shots/v788-scuro.png' });
  console.log('DOPO RICARICA', JSON.stringify(await page.locator('.dk-msg-bot').last().locator('.dk-row-name').allTextContents()));
});
