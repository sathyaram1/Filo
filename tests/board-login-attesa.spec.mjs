// #678.2 — l'accesso dalla bacheca col main vero e il browser finto: un solo
// accesso alla volta, condiviso da tutti i gesti e da tutte le superfici; un
// gesto in attesa parte appena l'account è dentro, da dovunque ci entri.

import { test, expect } from './fixtures/electron.mjs';

const INDIRIZZO = 'filo://board/board.html';
const FIX_A = {
  _id: 'fb-a', name: 'Fix A', status: 'done', priority: 3, resolvedInVersion: '0.2.71',
  seq: 77, subSeq: 0, clientId: 'x@example.com', createdAt: '2026-06-20T10:00:00Z', votes: {},
};
const FIX_B = { ...FIX_A, _id: 'fb-b', name: 'Fix B', seq: 78 };

// Il browser di sistema è finto: registra le pagine aperte, o rifiuta di aprirsi.
async function apriBacheca(app, openTab, { browserRotto = false } = {}) {
  await app.evaluate(({ shell }, rotto) => {
    globalThis.__aperture = [];
    shell.openExternal = async (u) => {
      if (rotto) throw new Error('Failed to open');
      globalThis.__aperture.push(u);
    };
  }, browserRotto);
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

// Da qui il main fa entrare l'account senza Google: subito, o quando il test chiama __faiEntrare().
async function accessoFinto(app, { subito }) {
  await app.evaluate((_, immediato) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    let dentro = false;
    const attese = [];
    globalThis.__richieste = 0;
    globalThis.__faiEntrare = () => { dentro = true; attese.splice(0).forEach((r) => r()); };
    ga.signIn = () => {
      globalThis.__richieste++;
      if (immediato) globalThis.__faiEntrare();
      return (dentro ? Promise.resolve() : new Promise((r) => attese.push(r))).then(() => ({ email: 'u@example.com' }));
    };
    ga.isSignedIn = () => dentro;
    ga.getUid = async () => (dentro ? 'uid-1' : null);
    ga.getProfile = () => (dentro ? { email: 'u@example.com' } : null);
  }, subito);
}

async function rispondiDalBrowser(app, i, query) {
  const u = new URL(await app.evaluate((_, n) => globalThis.__aperture[n], i));
  const state = encodeURIComponent(u.searchParams.get('state'));
  return fetch(`${u.searchParams.get('redirect_uri')}/?${query}&state=${state}`).then((r) => r.status);
}

const scheda = (page, id) => page.locator(`.bd-card[data-id="${id}"]`);

test('doppio clic sul pollice: una sola pagina di accesso, e risponde', async ({ app, openTab }) => {
  const page = await apriBacheca(app, openTab);
  await scheda(page, 'fb-a').locator('.bd-vote-works').dblclick();
  await expect(scheda(page, 'fb-a').locator('.bd-card-msg')).toContainText('Completa');
  await page.waitForTimeout(500);
  expect(await app.evaluate(() => globalThis.__aperture.length)).toBe(1);
  expect(await rispondiDalBrowser(app, 0, 'error=access_denied')).toBe(200);
  await expect(scheda(page, 'fb-a').locator('.bd-card-msg')).toHaveText('Accesso annullato nel browser: riprova quando vuoi.');
});

test('«Riapri il browser» riapre la stessa pagina: risponde anche la prima scheda', async ({ app, openTab }) => {
  const page = await apriBacheca(app, openTab);
  await scheda(page, 'fb-a').locator('.bd-vote-works').click();
  await page.locator('#bdSignIn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length)).toBe(2);
  const [prima, seconda] = await app.evaluate(() => globalThis.__aperture.slice());
  expect(seconda).toBe(prima);
  expect(await rispondiDalBrowser(app, 0, 'error=access_denied')).toBe(200);
  await expect(scheda(page, 'fb-a').locator('.bd-card-msg')).toContainText('annullato');
});

test('voti su due schede durante l\'attesa: ad accesso fatto partono tutti e due', async ({ app, openTab }) => {
  const page = await apriBacheca(app, openTab);
  await accessoFinto(app, { subito: false });
  await scheda(page, 'fb-a').locator('.bd-vote-works').click();
  await scheda(page, 'fb-b').locator('.bd-vote-broken').click();
  await expect(scheda(page, 'fb-a').locator('.bd-card-msg')).toContainText('Completa');
  await expect(scheda(page, 'fb-b').locator('.bd-card-msg')).toContainText('Completa');
  expect(await app.evaluate(() => globalThis.__richieste)).toBe(1);
  await app.evaluate(() => globalThis.__faiEntrare());
  await expect.poll(() => page.evaluate(() => window.__voti.slice().sort())).toEqual(['fb-a:works', 'fb-b:broken']);
  await expect(page.locator('#bdAuthMsg')).toContainText('Sei connesso');
});

test('stessa scheda, pollice e «Ancora rotto?» durante l\'attesa: ad accesso fatto parte il voto e si apre il modulo', async ({ app, openTab }) => {
  const page = await apriBacheca(app, openTab);
  await accessoFinto(app, { subito: false });
  const card = scheda(page, 'fb-a');
  await card.locator('.bd-vote-broken').click();
  await card.locator('.bd-reopen-link').click();
  await expect(card.locator('.bd-card-msg')).toContainText('il voto parte da solo');
  await expect(card.locator('.bd-card-msg')).toContainText('scrivi qui cosa non va');
  await app.evaluate(() => globalThis.__faiEntrare());
  await expect(page.locator('#bdAuthMsg')).toContainText('Sei connesso');
  await expect.poll(() => page.evaluate(() => window.__voti.slice())).toEqual(['fb-a:broken']);
  await expect(card.locator('textarea')).toBeVisible();
});

test('accesso fatto dal menu account a bacheca aperta: la bacheca lo vede e il voto parte senza un altro accesso', async ({ app, openTab, shell }) => {
  const page = await apriBacheca(app, openTab);
  await accessoFinto(app, { subito: true });
  expect((await shell.evaluate(() => window.filoShell.auth.signIn())).ok).toBe(true);
  await expect(page.locator('#bdAuthMsg')).toContainText('Sei connesso');
  await scheda(page, 'fb-a').locator('.bd-vote-works').click();
  await expect.poll(() => page.evaluate(() => window.__voti.slice())).toEqual(['fb-a:works']);
  expect(await app.evaluate(() => globalThis.__richieste)).toBe(1);
});

test('voto in attesa e accesso completato dal menu account: niente errore, il voto parte', async ({ app, openTab, shell }) => {
  const page = await apriBacheca(app, openTab);
  const card = scheda(page, 'fb-a');
  await card.locator('.bd-vote-works').click();
  await expect(card.locator('.bd-card-msg')).toContainText('Completa');
  // Il menu account chiede lo stesso accesso: il browser si riapre sulla stessa pagina.
  shell.evaluate(() => window.filoShell.auth.signIn()).catch(() => {});
  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length)).toBe(2);
  await expect(card.locator('.bd-card-msg')).toContainText('Completa');
  await accessoFinto(app, { subito: true });
  expect((await shell.evaluate(() => window.filoShell.auth.signIn())).ok).toBe(true);
  await expect(page.locator('#bdAuthMsg')).toContainText('Sei connesso');
  await expect.poll(() => page.evaluate(() => window.__voti.slice())).toEqual(['fb-a:works']);
  await expect(card.locator('.bd-card-msg')).toHaveCount(0);
});

test('browser chiuso senza accedere: «Lascia stare» chiude l\'attesa e la scheda dice che non è partito niente', async ({ app, openTab }) => {
  const page = await apriBacheca(app, openTab);
  const card = scheda(page, 'fb-a');
  await card.locator('.bd-vote-works').click();
  await expect(page.locator('#bdAuthSpin')).toBeVisible();
  await page.locator('#bdAuthLascia').click();
  await expect(page.locator('#bdAuthSpin')).toBeHidden();
  await expect(page.locator('#bdAuthLascia')).toBeHidden();
  await expect(page.locator('#bdAuthMsg')).toHaveText('Accedi per votare i miglioramenti.');
  await expect(page.locator('#bdSignIn')).toHaveText('Accedi');
  await expect(card.locator('.bd-card-msg')).toHaveText('Senza accesso non è partito niente: riprova quando vuoi.');
  await expect(card.locator('.bd-card-msg')).toHaveClass(/bd-card-msg-info/);
  // L'accesso lasciato stare che poi fallisce nel browser non riempie la scheda di rosso.
  expect(await rispondiDalBrowser(app, 0, 'error=access_denied')).toBe(200);
  await page.waitForTimeout(500);
  await expect(card.locator('.bd-card-msg')).toHaveText('Senza accesso non è partito niente: riprova quando vuoi.');
  expect(await page.evaluate(() => window.__voti.length)).toBe(0);
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await card.locator('.bd-vote-broken').click();
    await page.mouse.move(5, 5);
    await page.screenshot({ path: `tests/.shots/678.2-lascia-stare-${tema}.png` });
    await page.locator('#bdAuthLascia').click();
  }
});

test('«Ancora rotto?» con un browser che non si apre: il perché è il browser, non il servizio', async ({ app, openTab }) => {
  const page = await apriBacheca(app, openTab, { browserRotto: true });
  const msg = scheda(page, 'fb-a').locator('.bd-card-msg');
  await scheda(page, 'fb-a').locator('.bd-reopen-link').click();
  await expect(msg).toContainText('aprire il browser');
  await expect(msg).not.toContainText('servizio');
  await expect(page.locator('#bdAuthSpin')).toBeHidden();
});

test('menu account, accesso non riuscito: lo dice una notifica di Filo, non una finestra di sistema', async ({ app, shell }) => {
  await app.evaluate(({ shell: s }) => { s.openExternal = async () => { throw new Error('Failed to open'); }; });
  let dialogo = null;
  shell.on('dialog', (d) => { dialogo = d.message(); d.dismiss().catch(() => {}); });
  await app.evaluate(({ BrowserWindow }, url) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL() === url);
    w.webContents.send('shell:menu-action', 'auth-signin');
  }, shell.url());
  await expect(shell.locator('.shell-notif.show .shell-notif-msg')).toContainText('aprire il browser');
  expect(dialogo).toBeNull();
});
