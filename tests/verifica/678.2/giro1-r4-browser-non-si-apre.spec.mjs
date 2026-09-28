// #678.2 giro 1, rilievo 4: se il browser non si apre, la frase lo dice; non
// incolpa il servizio di accesso (riprovare tra poco non servirebbe a niente).
import { test, expect } from '../../fixtures/electron.mjs';

const INDIRIZZO = 'filo://board/board.html';
const FIX = {
  _id: 'fb-a', name: 'Fix A', status: 'done', priority: 3, resolvedInVersion: '0.2.71',
  seq: 77, subSeq: 0, clientId: 'x@example.com', createdAt: '2026-06-20T10:00:00Z', votes: {},
};

test('«Ancora rotto?» da anonimo con un browser che non si apre: il perché è il browser', async ({ app, openTab }) => {
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => { throw new Error('Failed to open'); };
  });
  const page = await openTab(INDIRIZZO);
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 15_000 });
  await page.evaluate((a) => { window.__boardTest.setReleasedVersion('0.2.71'); window.__boardTest.setData([a]); }, FIX);
  const card = page.locator('.bd-card[data-id="fb-a"]');
  await card.locator('.bd-reopen-link').click();
  const msg = card.locator('.bd-card-msg');
  await expect(msg).not.toContainText('Completa', { timeout: 10_000 });
  await expect(msg).not.toContainText('servizio di accesso');
  await expect(msg).toContainText(/browser/i);
});
