// Verifica locale «lavori locali», giro 4, rilievo 3: una pratica di lavoro locale presa in carico non deve dire
// all'owner cose da routine che per lei non valgono (nessuna routine la riprende, il server non la rimette in coda).
import { test, expect } from './../../fixtures/electron.mjs';

test('nei Lavori locali una pratica «In lavorazione» non dice che rientra in coda da sola', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  const da = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  const pratica = {
    _id: 'loc-w', name: 'Un lavoro della sessione', text: 'x', seq: 9401, subSeq: 0,
    status: 'working', statusPublic: 'open', workingSince: da,
    clientId: 'local:claude', senderProof: 'admin', localOnly: { by: 'local:claude', at: 1790000000000 },
    createdAt: '2026-09-30T08:00:00Z', images: [],
  };
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setTab('local'); }, [pratica]);
  const scheda = page.locator('.mg-item[data-id="loc-w"]');
  await expect(scheda).toBeVisible();
  await page.evaluate((id) => window.__mgTest.openDetail(id), 'loc-w');
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/rientra in coda da solo/i);
});
