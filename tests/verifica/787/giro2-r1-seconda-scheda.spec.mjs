// #787 giro 2, rilievo 1: due schede sullo stesso mazzo mentre Filo risponde in una delle due.
// L'altra non deve dire che la pagina si è chiusa (né offrire Riprova), e una chat svuotata lì resta vuota.

import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';
import { mockScryfall, mockProvider, newDeck, ask, storedChats } from './aiuti.mjs';

async function secondTab(app, shell) {
  const before = new Set(app.windows());
  await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.duplicate(snap.activeId);
  });
  let other = null;
  await expect.poll(() => {
    other = app.windows().find((w) => !before.has(w) && w.url().startsWith('filo://decks/')) || null;
    return Boolean(other);
  }).toBe(true);
  await other.waitForLoadState('domcontentloaded');
  return other;
}

test('mentre una scheda aspetta Filo, l\'altra non la dà per interrotta', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);
  await ask(page, 'prima domanda', 1);
  const other = await secondTab(app, shell);
  await expect(other.locator('.dk-msg-user')).toHaveText(['prima domanda']);

  await app.evaluate(() => { globalThis.__hang = true; });
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('sta pensando');
  await expect(other.locator('.dk-msg-user')).toHaveText(['prima domanda', 'creature con haste']);
  await other.waitForTimeout(800);
  await expect(other.locator('.dk-msg-bot').last()).not.toContainText('interrotta');
  await expect(other.locator('.dk-retry')).toHaveCount(0);

  await app.evaluate(() => { globalThis.__hang = false; globalThis.__release && globalThis.__release(); });
  await expect(other.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row')).toHaveCount(2);
});

test('svuotata in una scheda mentre l\'altra aspetta Filo, la chat resta vuota', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  await ask(page, 'prima domanda', 1);
  const other = await secondTab(app, shell);
  await expect(other.locator('.dk-msg-user')).toHaveText(['prima domanda']);

  await app.evaluate(() => { globalThis.__hang = true; });
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('sta pensando');
  await expect(other.locator('.dk-msg-user')).toHaveText(['prima domanda', 'creature con haste']);

  await other.click('#chatClear');
  await clickConfirm(other);
  await expect(other.locator('.dk-msg')).toHaveCount(0);

  await app.evaluate(() => { globalThis.__hang = false; globalThis.__release && globalThis.__release(); });
  await page.waitForTimeout(1500);
  await expect(other.locator('.dk-msg-user', { hasText: 'prima domanda' })).toHaveCount(0);
  const saved = await storedChats(app);
  const texts = ((saved[deckId] && saved[deckId].messages) || []).map((m) => m.text).filter(Boolean);
  expect(texts).not.toContain('prima domanda');
});
