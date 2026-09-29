// #787 giro 1, rilievo 1: riaperta la chat, «Aggiungi tutte al mazzo» deve seguire il mazzo di adesso.
// Lista incollata in chat, aggiunta in blocco, carte tolte dal mazzo, ricarica: il tasto deve tornare usabile.

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, newDeck, ask, reloadBuilder } from './aiuti.mjs';

test('import via chat: dopo la ricarica «Aggiungi tutte» riflette il mazzo di adesso', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const prev = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async (args) => {
      const last = String(args.messages[args.messages.length - 1].content || '');
      if (!/importa/i.test(last)) return prev(args);
      const text = JSON.stringify({ reply: 'Ecco la lista.', import: [{ name: 'Lightning Bolt', qty: 1 }] });
      return { text, model: args.attempts[0].model, provider: args.attempts[0].provider, usage: {} };
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);
  await ask(page, 'importa questa lista: 1 Lightning Bolt', 1);
  await page.locator('.dk-import-all').click();
  await expect(page.locator('#deckCount')).toHaveText('1/100 carte');

  const toggle = page.locator('.dk-msg-bot [data-add="bolt-1"]');
  await expect(toggle).toHaveAttribute('data-in', '1');
  await toggle.click();
  await expect(page.locator('#deckCount')).toHaveText('0/100 carte');

  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-bot [data-add="bolt-1"]')).toHaveAttribute('data-in', '0');
  const all = page.locator('.dk-import-all');
  await expect(all).toBeEnabled();
  await all.click();
  await expect(page.locator('#deckCount')).toHaveText('1/100 carte');
});
