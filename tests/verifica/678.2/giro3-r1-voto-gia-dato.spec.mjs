// #678.2 giro 3 — il voto promesso a chi accede non deve togliere quello che aveva già dato.
import { test, expect } from '../../fixtures/electron.mjs';

const INDIRIZZO = 'filo://board/board.html';
const FIX_A = {
  _id: 'fb-a', name: 'Fix A', status: 'done', priority: 3, resolvedInVersion: '0.2.71',
  seq: 77, subSeq: 0, clientId: 'x@example.com', createdAt: '2026-06-20T10:00:00Z',
  votes: { 'uid-1': { vote: 'works', at: '2026-06-21T10:00:00Z', credibilitySnapshot: 1 } },
};

async function apri(app, openTab) {
  await app.evaluate(({ shell }) => { globalThis.__aperture = []; shell.openExternal = async (u) => { globalThis.__aperture.push(u); }; });
  const page = await openTab(INDIRIZZO);
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 15_000 });
  await page.evaluate((a) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setData([a]);
    const vero = window.filo.message.bind(window.filo);
    window.__voti = [];
    window.filo.message = (m) => {
      if (m && (m.type === 'board_cast_vote' || m.type === 'board_clear_vote')) {
        window.__voti.push(`${m.type}:${m.id}:${m.vote || ''}`);
        return Promise.resolve({ ok: true, votes: m.type === 'board_clear_vote' ? {} : { 'uid-1': { vote: m.vote } } });
      }
      return vero(m);
    };
  }, FIX_A);
  return page;
}

async function accessoFinto(app) {
  await app.evaluate(() => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    let dentro = false;
    const attese = [];
    globalThis.__faiEntrare = () => { dentro = true; attese.splice(0).forEach((r) => r()); };
    ga.signIn = () => (dentro ? Promise.resolve() : new Promise((r) => attese.push(r))).then(() => ({ email: 'u@example.com' }));
    ga.isSignedIn = () => dentro;
    ga.getUid = async () => (dentro ? 'uid-1' : null);
    ga.getProfile = () => (dentro ? { email: 'u@example.com' } : null);
  });
}

test('voto già dato prima di uscire, lo stesso pollice da anonimo: dopo l\'accesso il voto resta', async ({ app, openTab }) => {
  const page = await apri(app, openTab);
  await accessoFinto(app);
  const card = page.locator('.bd-card[data-id="fb-a"]');
  await card.locator('.bd-vote-works').click();
  await expect(card.locator('.bd-card-msg')).toContainText('il voto parte da solo');
  await app.evaluate(() => globalThis.__faiEntrare());
  await expect(page.locator('#bdAuthMsg')).toContainText('Sei connesso');
  await page.waitForTimeout(800);
  // Chi aveva già votato «funziona» e lo ripreme da anonimo vuole ancora «funziona», non toglierlo.
  expect(await page.evaluate(() => window.__voti)).not.toContain('board_clear_vote:fb-a:');
  await expect(card.locator('.bd-vote-works')).toContainText('1');
});
