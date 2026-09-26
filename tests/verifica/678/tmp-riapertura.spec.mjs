// USA E GETTA: cosa resta sullo schermo dopo una riapertura andata a buon fine.
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

test('riapertura riuscita: cosa vede chi ha appena pagato', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW);
  await page.locator('#bdLoading').waitFor({ state: 'hidden' });
  await page.evaluate((s) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setSignedIn('me@example.com');
    window.__boardTest.setData([s]);
    // Il main risponde SÌ: crediti scalati, feedback collegato creato.
    const vero = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'board_reopen') return { ok: true, feedbackId: 'nuovo', balance: 40 };
      return vero(msg);
    };
  }, SHIPPED);

  await page.locator('.bd-reopen-link').click();
  await page.locator('.bd-reopen-text').fill('Succede ancora quando ridimensiono.');
  await page.locator('.bd-reopen-send').click();
  await page.waitForTimeout(1200);

  const stato = await page.evaluate(() => ({
    schede: document.querySelectorAll('.bd-card').length,
    conferma: document.querySelector('.bd-reopen-done')?.textContent || null,
    vuoto: !document.getElementById('bdEmpty')?.hidden,
    testo: document.body.innerText.slice(0, 400),
  }));
  console.log('DOPO LA RIAPERTURA:', JSON.stringify(stato));
  expect(stato.schede).toBeGreaterThanOrEqual(0);
});
