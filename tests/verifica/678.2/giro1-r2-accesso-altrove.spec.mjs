// #678.2 giro 1, rilievo 2: la bacheca segue l'account anche quando l'accesso
// avviene dal menu account della finestra, non solo dai suoi pulsanti.
import { test, expect } from '../../fixtures/electron.mjs';

const INDIRIZZO = 'filo://board/board.html';
const FIX = {
  _id: 'fb-a', name: 'Fix A', status: 'done', priority: 3, resolvedInVersion: '0.2.71',
  seq: 77, subSeq: 0, clientId: 'x@example.com', createdAt: '2026-06-20T10:00:00Z', votes: {},
};

async function apriBacheca(app, openTab) {
  await app.evaluate(({ shell }) => {
    globalThis.__aperture = [];
    shell.openExternal = async (u) => { globalThis.__aperture.push(u); };
  });
  const page = await openTab(INDIRIZZO);
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 15_000 });
  await page.evaluate((a) => { window.__boardTest.setReleasedVersion('0.2.71'); window.__boardTest.setData([a]); }, FIX);
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
  return page;
}

// Da qui il main fa riuscire l'accesso subito, senza browser, e conta le richieste.
async function accessoRiesceSubito(app) {
  await app.evaluate(() => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    let dentro = false;
    globalThis.__richieste = 0;
    ga.signIn = async () => { globalThis.__richieste++; dentro = true; return { email: 'u@example.com' }; };
    ga.isSignedIn = () => dentro;
    ga.getUid = async () => (dentro ? 'uid-1' : null);
    ga.getProfile = () => (dentro ? { email: 'u@example.com' } : null);
  });
}

test('bacheca aperta, accesso dal menu account: la bacheca lo vede e il voto non richiede un altro accesso', async ({ app, openTab, shell }) => {
  const page = await apriBacheca(app, openTab);
  await accessoRiesceSubito(app);
  const r = await shell.evaluate(() => window.filoShell.auth.signIn());
  expect(r && r.ok).toBe(true);
  await expect(page.locator('#bdAuthMsg')).toContainText('Sei connesso', { timeout: 5_000 });
  await page.locator('.bd-card[data-id="fb-a"] .bd-vote-works').click();
  await expect.poll(() => page.evaluate(() => window.__voti.slice())).toEqual(['fb-a:works']);
  expect(await app.evaluate(() => globalThis.__richieste)).toBe(1);
});

test('voto in attesa, accesso completato dal menu account: niente errore, il voto parte', async ({ app, openTab, shell }) => {
  const page = await apriBacheca(app, openTab);
  const card = page.locator('.bd-card[data-id="fb-a"]');
  await card.locator('.bd-vote-works').click();
  await expect(card.locator('.bd-card-msg')).toContainText('Completa');
  // L'utente chiede l'accesso dal menu account (accesso vero: chiude quello della bacheca)…
  shell.evaluate(() => window.filoShell.auth.signIn()).catch(() => {});
  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length)).toBe(2);
  // …e lo completa: da qui l'account è dentro.
  await accessoRiesceSubito(app);
  const r = await shell.evaluate(() => window.filoShell.auth.signIn());
  expect(r && r.ok).toBe(true);
  await expect(page.locator('#bdAuthMsg')).toContainText('Sei connesso', { timeout: 5_000 });
  await expect(card.locator('.bd-card-msg')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__voti.slice())).toEqual(['fb-a:works']);
});
