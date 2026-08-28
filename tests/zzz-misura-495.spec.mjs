// TEMPORANEO — cattura visiva della barra delle schede di manage.
import { test } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(id, status) {
  return {
    _id: id, text: `Feedback ${id}`, name: `Feedback ${id}`,
    seq: Number(String(id).replace(/\D/g, '')) || 1, subSeq: 0,
    clientId: 'tester@example.com', createdAt: '2026-06-20T10:00:00Z',
    images: [], status,
  };
}

for (const larghezza of [720, 1100]) {
  test(`scatto ${larghezza}`, async ({ app, openTab }) => {
    await app.evaluate(async ({ BrowserWindow }, w0) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.setContentSize(w0, 820);
    }, larghezza);
    const page = await openTab(URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
    await page.evaluate(() => window.__mgTest.whenReady());
    await page.evaluate(() => window.__mgTest.setAdmin(true));
    await page.setViewportSize({ width: larghezza, height: 820 });
    await page.evaluate((items) => window.__mgTest.setData(items), [
      fb('i1', 'unlabeled'), fb('i2', 'unlabeled'), fb('i3', 'design'),
      fb('q1', 'todo'), fb('q2', 'working'),
      fb('r1', 'done'), fb('r2', 'done'),
      fb('z1', 'archived'),
    ]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/manage-tabs-${larghezza}.png` });
  });
}
