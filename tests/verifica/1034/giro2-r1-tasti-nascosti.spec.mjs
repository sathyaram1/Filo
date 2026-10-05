import { test, expect } from '../../fixtures/electron.mjs';

// #1034 giro 2: sulla riga unica nessun tasto dell'owner deve restare nascosto oltre il bordo destro
// (con la riga che scorre di lato «È mio» e «Senza chiedere» non si vedono, o l'ultimo tasto con la finestra stretta).
const URL = 'filo://manage/manage.html';
const BASE = { text: 'Testo.', name: 'Prova', seq: 12, subSeq: 0, createdAt: '2026-06-22T10:00:00Z', images: [] };
const CASI = [
  [1280, 'file sospetto da riconoscere', { ...BASE, _id: 'g2-file', status: 'suspicious_file', clientId: 'owner:abc' }],
  [1000, 'feedback normale', { ...BASE, _id: 'g2-new', status: 'new', clientId: 'tester@example.com' }],
];

for (const [larghezza, nome, fb] of CASI) {
  test(`#1034 giro 2 — finestra ${larghezza}, ${nome}: ogni tasto della riga si vede senza scorrere`, async ({ openTab, app }) => {
    const page = await openTab(URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
    await app.evaluate(({ BrowserWindow }, w) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(w, win.getSize()[1]);
    }, larghezza);
    await page.waitForFunction((w) => Math.abs(window.outerWidth - w) < 40, larghezza);
    await page.evaluate((f) => {
      window.__mgTest.setAdmin(true);
      window.__mgTest.setData([f]);
      window.__mgTest.setTab('inbox');
      window.__mgTest.openDetail(f._id);
    }, fb);
    await expect(page.locator('#mgPreapproveBtn')).toBeVisible();
    const nascosti = await page.evaluate(() => {
      const riga = document.querySelector('#mgOwnerBar .mg-owner-row');
      const vis = (el) => el && !el.hidden && el.getClientRects().length > 0;
      const out = [];
      for (const b of riga.querySelectorAll('button')) {
        if (!vis(b)) continue;
        const r = b.getBoundingClientRect();
        let p = b.parentElement;
        while (p && p !== document.body) {
          const s = getComputedStyle(p);
          if (s.overflowX !== 'visible') {
            const c = p.getBoundingClientRect();
            if (r.right > c.right + 1 || r.left < c.left - 1) { out.push(b.textContent.trim()); break; }
          }
          p = p.parentElement;
        }
      }
      return out;
    });
    expect(nascosti).toEqual([]);
  });
}
