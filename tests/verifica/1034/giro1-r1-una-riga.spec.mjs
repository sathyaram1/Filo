import { test, expect } from '../../fixtures/electron.mjs';

// #1034: alla misura di serie della finestra i tasti dell'owner devono stare su una riga anche nei Ricevuti
// di uno spam (c'è «Conferma spam») e di un feedback col prefisso dell'owner ancora senza prova (c'è «È mio»).
const URL = 'filo://manage/manage.html';
const BASE = { text: 'Testo.', name: 'Prova', seq: 12, subSeq: 0, createdAt: '2026-06-22T10:00:00Z', images: [] };
const CASI = [
  ['spam nei Ricevuti', { ...BASE, _id: 'r1-spam', status: 'spam', clientId: 'tester@example.com' }],
  ['mittente da riconoscere nei Ricevuti', { ...BASE, _id: 'r1-mio', status: 'new', clientId: 'owner:abc' }],
];

for (const [nome, fb] of CASI) {
  test(`#1034 giro 1 — ${nome}: tutti i tasti sulla stessa riga`, async ({ openTab }) => {
    const page = await openTab(URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
    await page.evaluate((f) => {
      window.__mgTest.setAdmin(true);
      window.__mgTest.setData([f]);
      window.__mgTest.setTab('inbox');
      window.__mgTest.openDetail(f._id);
    }, fb);
    await expect(page.locator('#mgPreapproveBtn')).toBeVisible();
    const tasti = await page.evaluate(() => [...document.querySelectorAll('#mgOwnerBar .mg-owner-row button')]
      .filter((b) => !b.hidden && b.getClientRects().length > 0)
      .map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), c: r.top + r.height / 2 }; }));
    expect(tasti.length).toBeGreaterThanOrEqual(7);
    for (const t of tasti) expect(Math.abs(t.c - tasti[0].c), t.t).toBeLessThan(6);
  });
}
