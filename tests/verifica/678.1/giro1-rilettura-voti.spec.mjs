// VERIFICA #678.1 giro 1 — il voto è stato scritto ma la rilettura dei voti
// non riesce (rete che cade fra le due chiamate): il conteggio non deve
// tornare indietro in silenzio. Il main vero (handler con finti intorno) dà la
// risposta, la pagina vera la mostra.

import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function rispostaDelMain() {
  const script = `
    const { join } = require('node:path');
    const R = ${JSON.stringify(ROOT)};
    const S = join(R, 'src', 'shared');
    require(join(S, 'constants.js')); require(join(S, 'messages.js')); require(join(S, 'chatErrors.js'));
    const auth = require(join(R, 'src', 'main', 'auth', 'google-auth.js'));
    auth.isSignedIn = () => true; auth.getIdToken = async () => 'tok'; auth.getUid = async () => 'chi-vota';
    globalThis.SN_CREDITS = { awardVoteOnce: async () => ({ awarded: false, credits: 0, balance: 100 }) };
    globalThis.SN_FEEDBACK = {
      castVote: async () => ({}), getPublic: async () => null, fsDocToObject: (d) => d,
      rest: { FIRESTORE_BASE: 'https://example.invalid/v1', API_KEY: 'k', VIEW_COLLECTION: 'feedback-public' },
    };
    globalThis.SN_MANAGE_REVIEW = { listBoardTab: (l) => l };
    // Il voto e' scritto (castVote finto riuscito); la rilettura cade.
    globalThis.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); };
    const h = new Map();
    require(join(R, 'src', 'main', 'services', 'handlers', 'board.js'))((t, f) => h.set(t, f), { MSG: globalThis.SN_MSG.MSG });
    h.get(globalThis.SN_MSG.MSG.BOARD_CAST_VOTE)({ id: 'fb-rl', vote: 'works' }, null, 'filo://board/board.html')
      .then((r) => { process.stdout.write(JSON.stringify(r)); });
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
}

test('voto scritto, rilettura caduta: il conteggio non torna indietro in silenzio', async ({ openTab }) => {
  const risposta = rispostaDelMain();
  expect(risposta.ok, 'il voto è stato scritto: il main lo dà per riuscito').toBe(true);

  const page = await openTab('filo://board/board.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.evaluate((r) => {
    const vero = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => (msg && msg.type === 'board_cast_vote' ? r : vero(msg));
  }, risposta);
  await page.evaluate(() => {
    const v = (x) => ({ vote: x, at: '2026-06-20T10:00:00Z', credibilitySnapshot: 1 });
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setSignedIn('chi-vota');
    window.__boardTest.setData([{
      _id: 'fb-rl', name: 'Rilettura', status: 'done', resolvedInVersion: '0.2.70', seq: 950, subSeq: 0,
      createdAt: '2026-06-20T10:00:00Z', votes: { a: v('works'), b: v('works'), c: v('broken') },
    }]);
  });
  const card = page.locator('.bd-card').first();
  await card.locator('.bd-vote-works').click();
  await page.waitForTimeout(800);
  // Successo per chi ha votato: il suo voto si vede e gli altri voti restano.
  await expect(card.locator('.bd-vote-works')).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('.bd-vote-works .bd-vote-count')).toHaveText('3');
  await expect(card.locator('.bd-vote-broken .bd-vote-count')).toHaveText('1');
});
