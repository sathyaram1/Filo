// Verifica #678.2 giro 2: esplorazione dell'accesso dalla bacheca col main vero e il browser finto.

import { test, expect } from '../../fixtures/electron.mjs';

const INDIRIZZO = 'filo://board/board.html';
const FIX_A = {
  _id: 'fb-a', name: 'Fix A', status: 'done', priority: 3, resolvedInVersion: '0.2.71',
  seq: 77, subSeq: 0, clientId: 'x@example.com', createdAt: '2026-06-20T10:00:00Z', votes: {},
};
const FIX_B = { ...FIX_A, _id: 'fb-b', name: 'Fix B', seq: 78 };

async function apriBacheca(app, openTab) {
  await app.evaluate(({ shell }) => {
    globalThis.__aperture = [];
    shell.openExternal = async (u) => { globalThis.__aperture.push(u); };
  });
  const page = await openTab(INDIRIZZO);
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 15_000 });
  await page.evaluate(([a, b]) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setData([a, b]);
    const vero = window.filo.message.bind(window.filo);
    window.__voti = [];
    window.filo.message = (m) => {
      if (m && m.type === 'board_cast_vote') {
        window.__voti.push(`${m.id}:${m.vote}`);
        return Promise.resolve({ ok: true, votes: { 'uid-1': { vote: m.vote } } });
      }
      return vero(m);
    };
  }, [FIX_A, FIX_B]);
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

const scheda = (page, id) => page.locator(`.bd-card[data-id="${id}"]`);

test('stessa scheda: pollice e poi «Ancora rotto?» durante l\'attesa, ad accesso fatto partono tutti e due', async ({ app, openTab }) => {
  const page = await apriBacheca(app, openTab);
  await accessoFinto(app);
  const card = scheda(page, 'fb-a');
  await card.locator('.bd-vote-broken').click();
  await expect(card.locator('.bd-card-msg')).toContainText('il voto parte');
  await card.locator('.bd-reopen-link').click();
  await expect(card.locator('.bd-card-msg')).toContainText('Completa');
  await app.evaluate(() => globalThis.__faiEntrare());
  await expect(page.locator('#bdAuthMsg')).toContainText('Sei connesso');
  await expect(card.locator('textarea')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__voti.slice()), { timeout: 3000 }).toEqual(['fb-a:broken']);
});

test('aspetto: attesa e fallimento in testa, chiaro e scuro', async ({ app, openTab }) => {
  const page = await apriBacheca(app, openTab);
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.locator('#bdSignIn').click();
    await expect(page.locator('#bdAuthSpin')).toBeVisible();
    await page.mouse.move(5, 5);
    await page.screenshot({ path: `tests/.shots/v678.2-attesa-${tema}.png` });
    await page.locator('#bdAuthLascia').click();
  }
});
