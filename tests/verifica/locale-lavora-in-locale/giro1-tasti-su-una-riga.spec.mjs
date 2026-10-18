// Verifica locale, giro 1: col tasto «Lavoro locale» in più, i tasti dei Ricevuti restano su una riga
// anche sul feedback che ne offre di più (il file sospetto), alla larghezza dello spec che lo tiene vero.

import { test, expect } from '../../fixtures/electron.mjs';

const BASE = { text: 'Non riesco a rimuovere un modello', name: 'Rimuovere un modello', subSeq: 0, clientId: 'tester@example.com',
  createdAt: '2026-08-18T10:00:00Z', images: [], notes: 'Report.', statusPublic: 'open' };

for (const [nome, over] of [
  ['file sospetto', { _id: 'fb-sosp', seq: 912, status: 'suspicious_file' }],
  ['feedback normale', { _id: 'fb-norm', seq: 913, status: 'unlabeled' }],
]) {
  test(`Ricevuti, ${nome}: i tasti stanno su una riga a 1600 pixel`, async ({ app, openTab }) => {
    const largo = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w.isMaximized()) w.unmaximize();
      const [, h] = w.getContentSize();
      w.setContentSize(1600, h);
      return w.getContentSize()[0];
    });
    expect(largo).toBe(1600);
    const page = await openTab('filo://manage/manage.html');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
    await page.evaluate(() => window.__mgTest.whenReady());
    await page.evaluate((fb) => {
      window.__mgTest.setAdmin(true); window.__mgTest.setData([fb]); window.__mgTest.setTab('inbox'); window.__mgTest.openDetail(fb._id);
    }, { ...BASE, ...over });
    await expect(page.locator('#mgActionsRow button', { hasText: 'Lavoro locale' })).toBeVisible();
    const righe = await page.evaluate(() => {
      const bs = [...document.querySelectorAll('#mgOwnerBar .mg-owner-row button')].filter((b) => b.offsetParent !== null);
      const centri = [];
      for (const b of bs) {
        const r = b.getBoundingClientRect();
        const c = r.top + r.height / 2;
        if (!centri.some((x) => Math.abs(x - c) <= r.height / 2)) centri.push(c);
      }
      return centri.length;
    });
    expect(righe).toBe(1);
  });
}
