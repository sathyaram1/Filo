// #1060 giro 1, rilievo 1: aperto il rombo azzurro, il pannello ripete «Richiede lavoro locale» tre volte
// (titolo, «In breve», prima frase del perché). Basta il titolo più una.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const giudici = {
  action: 'human_review', l1Category: 'clean',
  expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
  verdicts: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: 'aligned', reasoning: 'x' })),
};
const FB = {
  _id: 'fb-loc', seq: 906, subSeq: 0, name: 'Va finito in locale', text: 'x', images: [],
  clientId: 'utente@example.com', createdAt: '2026-09-28T08:00:00Z',
  status: 'design', statusReason: 'locale', pipeline: giudici,
  notes: "Report.\n\n--- Aggiornamento dell'agente del 06/10/26, 03:58 ---\nRichiede lavoro locale. openrouter.ai è bloccato dalla rete del contenitore.",
};

test('r1 il pannello del rombo azzurro non ripete tre volte «Richiede lavoro locale»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [FB]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), FB._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]').click();
  await expect(page.locator('#mgSideTitle')).toHaveText('Richiede lavoro locale');
  await expect(page.locator('#mgSideBody')).toContainText('openrouter.ai è bloccato');
  const pannello = (await page.locator('#mgSideTitle').innerText()) + '\n' + (await page.locator('#mgSideBody').innerText());
  const volte = pannello.match(/richiede lavoro locale/gi).length;
  expect(volte).toBeLessThanOrEqual(2);
});
