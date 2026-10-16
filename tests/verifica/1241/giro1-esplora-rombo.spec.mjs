// Esplorazione del giro 1 di #1241: cosa legge l'owner aprendo il rombo di un feedback fermo per un guasto.
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

test('esplora il rombo del guasto', async ({ openTab }) => {
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
  await page.evaluate((id) => window.__mgTest.openDetail(id), GUASTO._id);
  const rombo = page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]');
  await expect(rombo).toBeVisible();
  console.log('ROMBO title', await rombo.getAttribute('title'), 'class', await rombo.getAttribute('class'));
  await rombo.click();
  await page.waitForTimeout(300);
  console.log('SIDE TITLE', await page.locator('#mgSideTitle').innerText().catch(() => '?'));
  console.log('SIDE BODY', (await page.locator('#mgSideBody').innerText().catch(() => '?')).slice(0, 800));
  const bottoni = await page.locator('button:visible').evaluateAll((els) => els.map((e) => e.textContent.trim()).filter(Boolean));
  console.log('BOTTONI', JSON.stringify(bottoni));
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `tests/.shots/v1241-guasto-${tema}.png` });
  }
});
