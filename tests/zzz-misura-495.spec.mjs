// TEMPORANEO — misura la barra delle schede di manage a finestra stretta.
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

test('misura', async ({ app, openTab }) => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setContentSize(720, 800);
  });
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.setViewportSize({ width: 720, height: 800 });
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('i1', 'unlabeled'), fb('q1', 'todo'), fb('r1', 'done'), fb('z1', 'archived'),
  ].map((o) => o));

  const geo = await page.evaluate(() => {
    const bar = document.getElementById('mgTabs');
    const tabs = [...document.querySelectorAll('.mg-tab')].filter((t) => !t.hidden);
    return {
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      barHeight: bar.getBoundingClientRect().height,
      tabs: tabs.map((t) => ({
        txt: t.textContent, w: Math.round(t.getBoundingClientRect().width),
        h: Math.round(t.getBoundingClientRect().height), top: Math.round(t.getBoundingClientRect().top),
      })),
    };
  });
  console.log(JSON.stringify(geo, null, 1));
});
