// #678.2 giro 4 — esplorazione: accessi falliti dalla bacheca col main vero e il browser finto.

import { test, expect } from '../../fixtures/electron.mjs';

const INDIRIZZO = 'filo://board/board.html';
const FIX_A = {
  _id: 'fb-a', name: 'Fix A', status: 'done', priority: 3, resolvedInVersion: '0.2.71',
  seq: 77, subSeq: 0, clientId: 'x@example.com', createdAt: '2026-06-20T10:00:00Z', votes: {},
};
const FIX_B = { ...FIX_A, _id: 'fb-b', name: 'Fix B con un titolo abbastanza lungo da andare a capo su una finestra stretta', seq: 78 };

async function prepara(app) {
  await app.evaluate(({ shell }) => {
    globalThis.__aperture = [];
    shell.openExternal = async (u) => { globalThis.__aperture.push(u); };
  });
}

async function apriBacheca(openTab) {
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

async function rispondiDalBrowser(app, i, query) {
  const u = new URL(await app.evaluate((_, n) => globalThis.__aperture[n], i));
  const state = encodeURIComponent(u.searchParams.get('state'));
  return fetch(`${u.searchParams.get('redirect_uri')}/?${query}&state=${state}`).then((r) => r.status);
}

const scheda = (page, id) => page.locator(`.bd-card[data-id="${id}"]`);

test('senza rete: pollice, «Ancora rotto?» e «Accedi» dicono il perché', async ({ app, openTab }) => {
  await prepara(app);
  const scritto = await app.evaluate(({ net }) => {
    try { net.isOnline = () => false; } catch (e) { return String(e); }
    return net.isOnline();
  });
  console.log('isOnline patch →', scritto);
  const page = await apriBacheca(openTab);
  await scheda(page, 'fb-a').locator('.bd-vote-works').click();
  await expect(scheda(page, 'fb-a').locator('.bd-card-msg')).toContainText('connessione');
  await scheda(page, 'fb-b').locator('.bd-reopen-link').click();
  await expect(scheda(page, 'fb-b').locator('.bd-card-msg')).toContainText('connessione');
  await page.locator('#bdSignIn').click();
  await expect(page.locator('#bdAuthMsg')).toContainText('connessione');
  await expect(page.locator('#bdSignIn')).toHaveText('Riprova');
  expect(await app.evaluate(() => globalThis.__aperture.length)).toBe(0);
});

test('«Accedi» annullato nel browser: la testa lo dice, «Riprova» riapre', async ({ app, openTab }) => {
  await prepara(app);
  const page = await apriBacheca(openTab);
  await page.locator('#bdSignIn').click();
  await expect(page.locator('#bdAuthSpin')).toBeVisible();
  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length)).toBe(1);
  expect(await rispondiDalBrowser(app, 0, 'error=access_denied')).toBe(200);
  await expect(page.locator('#bdAuthMsg')).toContainText('annullato');
  await expect(page.locator('#bdSignIn')).toHaveText('Riprova');
  await page.locator('#bdSignIn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length)).toBe(2);
  await expect(page.locator('#bdAuthSpin')).toBeVisible();
});

test('errore del servizio dopo il browser: codice rifiutato allo scambio', async ({ app, openTab }) => {
  await prepara(app);
  const page = await apriBacheca(openTab);
  await scheda(page, 'fb-a').locator('.bd-vote-works').click();
  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length)).toBe(1);
  expect(await rispondiDalBrowser(app, 0, 'code=finto')).toBe(200);
  await expect(scheda(page, 'fb-a').locator('.bd-card-msg')).not.toContainText('Completa', { timeout: 30_000 });
  console.log('frase servizio →', await scheda(page, 'fb-a').locator('.bd-card-msg').textContent());
});

test('due schede della bacheca: il fallimento arriva a tutte e due', async ({ app, openTab }) => {
  await prepara(app);
  const p1 = await apriBacheca(openTab);
  const p2 = await apriBacheca(openTab);
  await scheda(p1, 'fb-a').locator('.bd-vote-works').click();
  await scheda(p2, 'fb-b').locator('.bd-vote-broken').click();
  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length)).toBe(2);
  expect(await rispondiDalBrowser(app, 1, 'error=access_denied')).toBe(200);
  await expect(scheda(p1, 'fb-a').locator('.bd-card-msg')).toContainText('annullato');
  await expect(scheda(p2, 'fb-b').locator('.bd-card-msg')).toContainText('annullato');
});

test('aspetto: attesa con due promesse, finestra stretta, chiaro e scuro', async ({ app, openTab }) => {
  await prepara(app);
  const page = await apriBacheca(openTab);
  const card = scheda(page, 'fb-b');
  await card.locator('.bd-vote-broken').click();
  await card.locator('.bd-reopen-link').click();
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.mouse.move(5, 5);
    await page.screenshot({ path: `tests/.shots/678.2-g4-attesa-${tema}.png` });
  }
  await page.setViewportSize({ width: 420, height: 700 }).catch(() => {});
  await page.screenshot({ path: 'tests/.shots/678.2-g4-attesa-stretta.png' });
  expect(await rispondiDalBrowser(app, 0, 'error=access_denied')).toBe(200);
  await expect(card.locator('.bd-card-msg')).toContainText('annullato');
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.screenshot({ path: `tests/.shots/678.2-g4-fallito-${tema}.png` });
  }
});
