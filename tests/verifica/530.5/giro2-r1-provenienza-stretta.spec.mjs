// Verifica #530.5 giro 2, rilievo 1: a finestra stretta l'etichetta di provenienza della fusione
// («automazione · feedback #700») esce dalla scheda ed è tagliata, il numero del feedback non si legge.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);

const FB = {
  _id: 'fb-5305-r1', text: 'Il menu della copertina perde metà delle voci.', name: 'Menu copertina',
  seq: 700, subSeq: 0, status: 'revision_security', clientId: 'tester@example.com',
  createdAt: '2026-09-10T10:00:00Z', images: [],
  pipeline: { action: 'human_review', l1Category: 'clean', l2Class: 'aligned', expectedJudges: [], verdicts: [], stage: 'L2' },
};
const RICHIESTA = {
  id: 'ab12cd34ef56ab12cd34ef56', branch: 'claude/menu-copertina', sha: SHA, who: 'secaudit · notturna',
  num: '#700', origin: 'routine',
  blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
  createdAtMs: Date.now() - 120_000, expiresAtMs: Date.now() + 86_400_000, expired: false, used: false, discarded: false,
};

for (const larghezza of [700, 560]) {
  test(`r1 finestra larga ${larghezza}: la provenienza della fusione resta dentro la scheda`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    await page.setViewportSize({ width: larghezza, height: 800 });
    await page.waitForFunction(() => window.__mgTest && window.filo);
    await page.evaluate(() => window.__mgTest.whenReady());
    await page.evaluate((pending) => {
      const orig = window.filo.message.bind(window.filo);
      window.filo.message = async (msg) => {
        const t = msg && msg.type;
        if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
        if (t === 'merge_approvals_get') return { ok: true, pending, failed: [], recent: [], preapproved: [], ttlMs: 604_800_000 };
        return orig(msg);
      };
    }, [RICHIESTA]);
    await page.evaluate(() => window.__mgTest.setAdmin(true));
    await page.evaluate((fbs) => window.__mgTest.setData(fbs), [FB]);
    await page.evaluate(() => window.__mgTest.loadMergeApprovals());
    await page.evaluate((id) => window.__mgTest.openDetail(id), FB._id);
    await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
    const scheda = page.locator('#mgSideBody .sn-mac-card').first();
    const origine = scheda.locator('.sn-mac-origin').first();
    await expect(origine).toContainText('#700');
    const [s, o] = await Promise.all([scheda.boundingBox(), origine.boundingBox()]);
    expect(o.x + o.width, 'l’etichetta di provenienza esce a destra della scheda').toBeLessThanOrEqual(s.x + s.width + 0.5);
  });
}
