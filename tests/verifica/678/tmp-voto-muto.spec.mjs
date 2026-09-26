// USA E GETTA: serve solo a confermare cosa vede chi vota e il voto non passa.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://board/board.html';
const SHIPPED = {
  _id: 'fb-shipped',
  name: 'Migliorata la cattura schermo',
  status: 'done',
  resolvedInVersion: '0.2.70',
  seq: 42, subSeq: 0,
  createdAt: '2026-06-20T10:00:00Z',
  votes: {},
};

test('voto che non passa: cosa vede l\'utente', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW);
  await page.locator('#bdLoading').waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setSignedIn('me@example.com');
    window.__boardTest.setData([SHIPPED_IN]);
  });
  await page.evaluate((s) => { window.SHIPPED_IN = s; }, SHIPPED);
});

test('davvero: click sul voto con il main che dice no', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW);
  await page.locator('#bdLoading').waitFor({ state: 'hidden' });
  await page.evaluate((s) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setSignedIn('me@example.com');
    window.__boardTest.setData([s]);
  }, SHIPPED);

  const works = page.locator('.bd-card .bd-vote-works');
  await expect(works).toBeVisible();
  await works.click();
  await page.waitForTimeout(1500);

  // Che cosa è rimasto sullo schermo dopo il voto non riuscito?
  const stato = await page.evaluate(() => ({
    premuto: document.querySelector('.bd-vote-works')?.getAttribute('aria-pressed'),
    conteggio: document.querySelector('.bd-vote-works .bd-vote-count')?.textContent,
    toast: document.body.innerText.toLowerCase(),
  }));
  console.log('DOPO IL VOTO:', JSON.stringify(stato).slice(0, 800));
  expect(stato.premuto).toBe('false');
});
