// #678.2 giro 1, rilievo 1: un secondo gesto mentre l'accesso aspetta il browser
// non deve uccidere il primo (scheda del browser morta, voto perso senza una parola).
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
  }, [FIX_A, FIX_B]);
  return page;
}

const scheda = (page, id) => page.locator(`.bd-card[data-id="${id}"]`);

test('doppio clic sul pollice: il browser che risponde per primo viene ascoltato', async ({ app, openTab }) => {
  const page = await apriBacheca(app, openTab);
  await scheda(page, 'fb-a').locator('.bd-vote-works').dblclick();
  await expect(scheda(page, 'fb-a').locator('.bd-card-msg')).toContainText('Completa');
  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length)).toBeGreaterThanOrEqual(1);
  // L'utente risponde nella PRIMA scheda che gli si è aperta (qui: la annulla).
  const prima = new URL(await app.evaluate(() => globalThis.__aperture[0]));
  const redirect = prima.searchParams.get('redirect_uri');
  const state = prima.searchParams.get('state');
  const risposta = await fetch(`${redirect}/?error=access_denied&state=${encodeURIComponent(state)}`)
    .then((r) => r.status).catch(() => 'irraggiungibile');
  expect(risposta, 'la prima scheda del browser deve ancora arrivare a Filo').toBe(200);
  await expect(scheda(page, 'fb-a').locator('.bd-card-msg')).toContainText('annullato', { timeout: 10_000 });
});

test('voto su A e poi su B mentre l accesso aspetta: a login riuscito partono tutti e due', async ({ app, openTab }) => {
  const page = await apriBacheca(app, openTab);
  // Accesso che riesce quando il test lo decide, senza browser.
  await app.evaluate(() => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    let dentro = false;
    const attese = [];
    globalThis.__faiEntrare = () => { dentro = true; attese.splice(0).forEach((r) => r()); };
    ga.signIn = () => new Promise((r) => attese.push(r)).then(() => ({ email: 'u@example.com' }));
    ga.isSignedIn = () => dentro;
    ga.getUid = async () => (dentro ? 'uid-1' : null);
    ga.getProfile = () => (dentro ? { email: 'u@example.com' } : null);
  });
  await page.evaluate(() => {
    const vero = window.filo.message.bind(window.filo);
    window.__voti = [];
    window.filo.message = (m) => {
      if (m && m.type === 'board_cast_vote') {
        window.__voti.push(`${m.id}:${m.vote}`);
        return Promise.resolve({ ok: true, votes: { 'uid-1': { vote: m.vote } } });
      }
      return vero(m);
    };
  });
  await scheda(page, 'fb-a').locator('.bd-vote-works').click();
  await expect(scheda(page, 'fb-a').locator('.bd-card-msg')).toContainText('Completa');
  await scheda(page, 'fb-b').locator('.bd-vote-broken').click();
  await expect(scheda(page, 'fb-b').locator('.bd-card-msg')).toContainText('Completa');
  await app.evaluate(() => globalThis.__faiEntrare());
  await expect.poll(() => page.evaluate(() => window.__voti.slice().sort())).toEqual(['fb-a:works', 'fb-b:broken']);
});
