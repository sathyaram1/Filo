// VERIFICA #678.1 giro 2 — un ritiro del voto che non riesce deve dire che il
// voto è rimasto, non che «non è stato registrato» (il pollice resta premuto).

import { test, expect } from '../../fixtures/electron.mjs';

const v = (x) => ({ vote: x, at: '2026-06-20T10:00:00Z', credibilitySnapshot: 1 });

test('ritiro del voto non riuscito: la frase non dice che il voto non è registrato', async ({ openTab }) => {
  const page = await openTab('filo://board/board.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.evaluate(() => {
    const vero = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => (msg && msg.type === 'board_clear_vote'
      ? { ok: false, error: 'Il voto non è stato registrato: riprova.' }
      : vero(msg));
  });
  await page.evaluate((votes) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setSignedIn('chi-vota');
    window.__boardTest.setData([{
      _id: 'fb-rt', name: 'Ritiro', status: 'done', resolvedInVersion: '0.2.70', seq: 960, subSeq: 0,
      createdAt: '2026-06-20T10:00:00Z', votes,
    }]);
  }, { a: v('works'), 'chi-vota': v('works') });
  const card = page.locator('.bd-card').first();
  await expect(card.locator('.bd-vote-works')).toHaveAttribute('aria-pressed', 'true');
  await card.locator('.bd-vote-works').click();
  await expect(card.locator('.bd-card-msg')).toBeVisible({ timeout: 10_000 });
  // Il voto è ancora lì: il pollice premuto e il conteggio lo dicono.
  await expect(card.locator('.bd-vote-works')).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('.bd-vote-works .bd-vote-count')).toHaveText('2');
  // La frase non deve dire il contrario.
  await expect(card.locator('.bd-card-msg')).not.toContainText('non è stato registrato');
});
