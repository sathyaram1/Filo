// Verifica #1329 giro 3, rilievo 1: dopo un salto finito col guasto di GitHub il server lascia la pratica
// ferma per il controllo (col segno «saltato») e accetta un secondo salto; la scheda di Filo deve offrirlo.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

// Com'è la pratica dopo «GitHub non risponde»: il segno del salto è scritto, stato e motivo non si muovono.
const FB_DOPO_GUASTO = {
  _id: 'fb-salto-guasto',
  text: 'Il pulsante di condivisione non fa niente.',
  name: 'Condivisione muta',
  seq: 702, subSeq: 0,
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
    l4: { esito: 'saltato', by: 'owner', at: '2026-09-12T12:05:00Z', testo: 'Il fix scrive nelle regole del database.' },
  },
};

test('r1 dopo «GitHub non risponde, ripremi» la scheda rilette offre ancora «Salta il controllo»', async ({ openTab }) => {
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
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 7 * 86400000 };
      if (t === 'livello4_salta') { window.__chiamate.push(msg); return { ok: true, esito: 'bloccato', requestId: 'r1', requestState: 'pending' }; }
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [FB_DOPO_GUASTO]);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate((id) => window.__mgTest.openDetail(id), FB_DOPO_GUASTO._id);
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l4"]').click();

  const btn = page.locator('#mgSaltaL4Btn');
  await expect(btn, 'il tasto per ripremere c’è, come promette il messaggio del guasto').toBeVisible({ timeout: 8_000 });
  await btn.click();
  await btn.click();
  await expect.poll(() => page.evaluate(() => window.__chiamate.length)).toBe(1);
});
