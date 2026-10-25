// Verifica #1502 giro 2, rilievo 1: il salto registrato ma la pratica non passata alla fusione (il server risponde
// «Ripremi «Salta il controllo»», e la pratica resta all'owner col controllo segnato saltato): il tasto deve esserci.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'f00d'.repeat(10);

const FB_SALTATO_FERMO = {
  _id: 'fb-salto-fermo',
  text: 'Il pulsante di condivisione non fa niente.',
  name: 'Condivisione muta',
  seq: 702, subSeq: 0,
  // Il segno è scritto (l4 saltato), lo spostamento in revisione no: la pratica è ancora all'owner.
  status: 'design', statusReason: 'secaudit',
  clientId: 'tester@example.com',
  createdAt: '2026-09-11T08:00:00Z',
  images: [],
  pipeline: {
    action: 'human_review', l1Category: 'clean',
    expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
    verdicts: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: 'aligned', reasoning: 'Ok.' })),
  },
  livelli: {
    l4: { esito: 'saltato', by: 'owner', at: '2026-09-12T12:05:00Z', sha: SHA, testo: 'Il fix scrive nelle regole del database.' },
  },
};

test('r1 salto registrato e pratica rimasta all’owner: «Salta il controllo» si può ripremere, come dice il server', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__chiamate = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 7 * 24 * 60 * 60 * 1000 };
      if (t === 'livello4_salta') { window.__chiamate.push(msg); return { ok: true, esito: 'attesa_unit', sha: msg.sha }; }
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [FB_SALTATO_FERMO]);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate((id) => window.__mgTest.openDetail(id), FB_SALTATO_FERMO._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l4"]').click();

  await expect(page.locator('#mgSideBody')).toContainText('Saltato dall’owner', { timeout: 8_000 });
  const tasto = page.locator('#mgSaltaL4Btn');
  await expect(tasto).toBeVisible({ timeout: 4_000 });
  await tasto.click();
  await tasto.click();
  await expect.poll(() => page.evaluate(() => window.__chiamate.length)).toBe(1);
  expect(await page.evaluate(() => window.__chiamate[0].sha)).toBe(SHA);
});
