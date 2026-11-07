// #2217, porta del giro 2 riprovata al giro 3: nei Ricevuti un lavoro server non fidato fermo per la fiducia si rimette
// in coda solo rendendolo fidato, e il tasto che lo fa è quello principale.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function fb(over = {}) {
  return Object.assign({
    _id: 'srv-x', name: 'Il cancello non legge il registro dei rami', text: 'Tutto nel codice del server.',
    seq: 2299, subSeq: 0, status: 'design', statusReason: 'fidato', statusPublic: 'open',
    clientId: 'routine:manutentore', fiducia: 'non_fidato', localOnly: { by: 'routine', at: Date.parse('2026-11-06T03:00:00Z') },
    createdAt: '2026-11-06T03:00:00Z', images: [],
  }, over);
}

test('Ricevuti: il tasto principale su un lavoro server non fidato lo mette in coda e lo segna fidato', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__updates = []; window.__fiducia = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') { window.__updates.push(msg); return { ok: true, by: 'owner@esempio', at: 1790000000000 }; }
      if (t === 'fiducia_segna') { window.__fiducia.push(msg); return { ok: true, fiducia: 'fidato' }; }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [fb()]);
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.locator('.mg-item').click();
  const btn = page.locator('#mgAcceptLocalBtn');
  await expect(btn).toHaveText('💻 Lavoro server');
  await expect(btn).not.toHaveClass(/sn-btn-secondary/);
  // Nessun «In coda» che lo rimetterebbe in coda senza timbro.
  await expect(page.locator('#mgAcceptBtn')).toHaveCount(0);
  await btn.click();
  await expect(page.locator('.mg-tab[data-tab="queue"]')).toHaveText('In coda (1)');
  const updates = await page.evaluate(() => window.__updates);
  expect(updates.map((u) => [u.status, u.localOnly])).toEqual([['todo', true]]);
  expect(await page.evaluate(() => window.__fiducia)).toEqual([{ type: 'fiducia_segna', feedbackId: 'srv-x' }]);
});
