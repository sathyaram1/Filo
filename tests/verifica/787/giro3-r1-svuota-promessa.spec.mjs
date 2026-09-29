// #787 giro 3, rilievo 1: «svuota la chat» chiesto a parole. Se la conferma non arriva (si è lasciato il mazzo mentre
// Filo rispondeva, o si è premuto Annulla), la bolla di Filo non deve restare a promettere che svuoterà «appena confermi».

import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';
import { mockScryfall, mockProvider, newDeck, ask, reloadBuilder } from './aiuti.mjs';

async function modelloCheSvuota(app, attesa) {
  await app.evaluate((_e, attesa) => {
    const prev = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async (args) => {
      const last = String(args.messages[args.messages.length - 1].content || '');
      if (!/svuota/i.test(last)) return prev(args);
      await new Promise((r) => setTimeout(r, attesa));
      return { text: '{"clearChat": true}', model: args.attempts[0].model, provider: args.attempts[0].provider, usage: {} };
    };
  }, attesa);
}

const confermaAperta = (page) => page.evaluate(() => !!(window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test.state()));

test('lasciato il mazzo mentre Filo risponde, al ritorno la richiesta non è persa né promessa a vuoto', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await modelloCheSvuota(app, 1500);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  await ask(page, 'creature con haste', 1);
  await page.fill('#chatInput', 'svuota la chat');
  await page.press('#chatInput', 'Enter');
  await page.click('#backToLibrary');
  await page.waitForTimeout(2500);
  await page.evaluate((id) => { location.hash = `#/deck/${encodeURIComponent(id)}`; }, deckId);
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await page.waitForTimeout(800);
  // O la conferma si apre al ritorno, o la bolla non promette una conferma che non arriverà.
  if (!(await confermaAperta(page))) {
    await expect(page.locator('.dk-msg-bot').last()).not.toContainText('appena confermi');
  }
});

test('premuto Annulla, la bolla non promette più di svuotare «appena confermi», nemmeno dopo la ricarica', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await modelloCheSvuota(app, 0);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);
  await ask(page, 'creature con haste', 1);
  await page.fill('#chatInput', 'svuota la chat');
  await page.press('#chatInput', 'Enter');
  await clickConfirm(page, 'cancel');
  await expect(page.locator('.dk-msg-user')).toHaveText(['creature con haste', 'svuota la chat']);
  await expect(page.locator('.dk-msg-bot').last()).not.toContainText('appena confermi');
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-bot').last()).not.toContainText('appena confermi');
});
