// Giro 1 di #1241, rilievo 1: un feedback fermo per un guasto ha in lista il rombo «la domanda dice cosa fare»,
// e nel dettaglio lo stesso rombo deve dire la stessa cosa (quale domanda), non «Nessuna segnalazione».
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const giudici = (cls) => ({
  action: 'human_review', l1Category: 'clean',
  expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
  verdicts: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: cls, reasoning: 'x' })),
});
const GUASTO = {
  clientId: 'routine:residuo', createdAt: '2026-09-11T08:00:00Z', images: [], subSeq: 0,
  _id: 'fb-gua', seq: 807, name: 'Fermo sul clone', text: 'g',
  status: 'design', statusReason: 'guasto', pipeline: giudici('aligned'),
  notes: "Report.\n\n--- Aggiornamento dell'agente del 16/10/26, 12:58 ---\nGuasto, non lavoro locale: guasto: filo-security. Domanda D-9.",
};

test('r1 fermo per un guasto: il rombo del dettaglio dice il guasto e la domanda, come il segno in lista', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [GUASTO]);
  await expect(page.locator('.mg-item', { hasText: 'Fermo sul clone' }).locator('.mg-segno-fermata'))
    .toHaveAttribute('title', /guasto/i);

  await page.evaluate((id) => window.__mgTest.openDetail(id), GUASTO._id);
  const rombo = page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]');
  await expect(rombo).not.toHaveClass(/mg-forma--vuota/);
  await expect(rombo).toHaveAttribute('title', /guasto/i);
  await rombo.click();
  const corpo = page.locator('#mgSideBody');
  await expect(corpo).not.toContainText('Nessuna segnalazione');
  await expect(corpo).toContainText('D-9');
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `tests/.shots/v1241-guasto-${tema}.png` });
  }
});
