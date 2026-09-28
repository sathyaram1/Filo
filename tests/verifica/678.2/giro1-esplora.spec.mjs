// Esplorazione #678.2 giro 1: accesso dalla bacheca col main vero, browser finto.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://board/board.html';
const FIX = {
  _id: 'fb-a', name: 'Fix A', status: 'done', priority: 3, resolvedInVersion: '0.2.71',
  seq: 77, subSeq: 0, clientId: 'x@example.com', createdAt: '2026-06-20T10:00:00Z', votes: {},
};
const FIX_B = { ...FIX, _id: 'fb-b', name: 'Fix B', seq: 78 };

async function apri(app, openTab, { offline = false } = {}) {
  await app.evaluate(({ shell, net }, off) => {
    globalThis.__aperture = [];
    shell.openExternal = async (u) => { globalThis.__aperture.push(u); };
    if (off) net.isOnline = () => false;
  }, offline);
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 15_000 });
  await page.evaluate(([a, b]) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setData([a, b]);
  }, [FIX, FIX_B]);
  return page;
}

async function aperture(app) { return app.evaluate(() => globalThis.__aperture.slice()); }

async function rispondiDalBrowser(app, query, n = 1) {
  await expect.poll(() => aperture(app).then((a) => a.length)).toBeGreaterThanOrEqual(n);
  const a = await aperture(app);
  const u = new URL(a[n - 1]);
  const redirect = u.searchParams.get('redirect_uri');
  const state = u.searchParams.get('state');
  const r = await fetch(`${redirect}/?${query}&state=${encodeURIComponent(state)}`).catch((e) => ({ err: String(e) }));
  return r;
}

const card = (page, id) => page.locator(`.bd-card[data-id="${id}"]`);

test('voto da anonimo, annullato nel browser', async ({ app, openTab }) => {
  const page = await apri(app, openTab);
  await card(page, 'fb-a').locator('.bd-vote-works').click();
  await expect(card(page, 'fb-a').locator('.bd-card-msg')).toContainText('Completa');
  console.log('HEAD in corso:', await page.locator('#bdAuthMsg').textContent(), '|', await page.locator('#bdSignIn').textContent());
  await page.screenshot({ path: 'tests/.shots/678-2-incorso.png' });
  await rispondiDalBrowser(app, 'error=access_denied');
  await expect(card(page, 'fb-a').locator('.bd-card-msg')).toContainText('annullato', { timeout: 10_000 });
  console.log('CARD:', await card(page, 'fb-a').locator('.bd-card-msg').textContent());
  console.log('HEAD:', await page.locator('#bdAuthMsg').textContent(), '|', await page.locator('#bdSignIn').textContent(), 'spin hidden', await page.locator('#bdAuthSpin').isHidden());
  await page.screenshot({ path: 'tests/.shots/678-2-annullato.png' });
});

test('accedi dalla testa, codice ricevuto ma scambio fallito', async ({ app, openTab }) => {
  const page = await apri(app, openTab);
  await page.locator('#bdSignIn').click();
  await rispondiDalBrowser(app, 'code=finto');
  await expect(page.locator('#bdAuthMsg')).not.toContainText('Completa', { timeout: 30_000 });
  console.log('HEAD dopo code finto:', await page.locator('#bdAuthMsg').textContent(), '|', await page.locator('#bdSignIn').textContent());
  await page.screenshot({ path: 'tests/.shots/678-2-testa-ko.png' });
});

test('ancora rotto offline', async ({ app, openTab }) => {
  const page = await apri(app, openTab, { offline: true });
  await card(page, 'fb-a').locator('.bd-reopen-link').click();
  await expect(card(page, 'fb-a').locator('.bd-card-msg')).toContainText('connessione', { timeout: 10_000 });
  console.log('CARD offline:', await card(page, 'fb-a').locator('.bd-card-msg').textContent());
  console.log('aperture offline:', (await aperture(app)).length);
});

test('doppio clic sul pollice', async ({ app, openTab }) => {
  const page = await apri(app, openTab);
  await card(page, 'fb-a').locator('.bd-vote-works').dblclick();
  await page.waitForTimeout(1500);
  console.log('aperture doppio clic:', (await aperture(app)).length);
  // il primo browser, se completato, dove va?
  const r = await rispondiDalBrowser(app, 'error=access_denied', 1);
  console.log('risposta primo browser:', r.err || r.status);
  await page.waitForTimeout(1000);
  console.log('CARD dopo primo browser:', await card(page, 'fb-a').locator('.bd-card-msg').allTextContents());
});

test('voto su A poi su B durante l accesso', async ({ app, openTab }) => {
  const page = await apri(app, openTab);
  await card(page, 'fb-a').locator('.bd-vote-works').click();
  await expect(card(page, 'fb-a').locator('.bd-card-msg')).toContainText('Completa');
  await card(page, 'fb-b').locator('.bd-vote-broken').click();
  await page.waitForTimeout(500);
  console.log('A:', await card(page, 'fb-a').locator('.bd-card-msg').allTextContents(), 'B:', await card(page, 'fb-b').locator('.bd-card-msg').allTextContents());
  await rispondiDalBrowser(app, 'error=access_denied', 2);
  await page.waitForTimeout(1000);
  console.log('dopo annullo A:', await card(page, 'fb-a').locator('.bd-card-msg').allTextContents(), 'B:', await card(page, 'fb-b').locator('.bd-card-msg').allTextContents());
});
