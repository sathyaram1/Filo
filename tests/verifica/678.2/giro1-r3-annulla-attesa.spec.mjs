// #678.2 giro 1, rilievo 3: chi chiude il browser senza accedere deve poter
// lasciar stare l'attesa, invece di tenersi dieci minuti di rotella.
import { test, expect } from '../../fixtures/electron.mjs';

const INDIRIZZO = 'filo://board/board.html';
const FIX = {
  _id: 'fb-a', name: 'Fix A', status: 'done', priority: 3, resolvedInVersion: '0.2.71',
  seq: 77, subSeq: 0, clientId: 'x@example.com', createdAt: '2026-06-20T10:00:00Z', votes: {},
};

test('voto da anonimo, browser chiuso: l attesa si può lasciar perdere e la bacheca torna com era', async ({ app, openTab }) => {
  await app.evaluate(({ shell }) => { shell.openExternal = async () => {}; });
  const page = await openTab(INDIRIZZO);
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 15_000 });
  await page.evaluate((a) => { window.__boardTest.setReleasedVersion('0.2.71'); window.__boardTest.setData([a]); }, FIX);
  const card = page.locator('.bd-card[data-id="fb-a"]');
  await card.locator('.bd-vote-works').click();
  await expect(page.locator('#bdAuthSpin')).toBeVisible();
  // Il browser è stato chiuso: nessuna risposta arriverà per dieci minuti.
  const lascia = page.locator('.bd-auth button, .bd-card[data-id="fb-a"] button')
    .filter({ hasText: /annulla|lascia|non ora|smetti/i });
  await expect(lascia.first(), 'serve un modo per smettere di aspettare').toBeVisible();
  await lascia.first().click();
  await expect(page.locator('#bdAuthSpin')).toBeHidden();
  await expect(page.locator('#bdAuthMsg')).not.toContainText('Completa');
  await expect(card.locator('.bd-card-msg')).not.toContainText('Completa');
});
