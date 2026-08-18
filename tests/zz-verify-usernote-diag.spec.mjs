// DIAGNOSTICA TEMPORANEA (da cancellare).
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

test('diagnostica visibilità casella frase', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());

  const fb = {
    _id: 'fb-a', seq: 900, subSeq: 0, name: 'Feedback A', text: 'testo A',
    clientId: 'tester@example.com', createdAt: '2026-08-18T10:00:00Z', images: [],
    userNote: 'vecchia',
  };

  const info = await page.evaluate((f) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([f]);
    window.__mgTest.setTab('todo');
    window.__mgTest.openDetail('fb-a');
    const q = (id) => {
      const el = document.getElementById(id);
      if (!el) return { id, missing: true };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { id, hidden: el.hidden, display: cs.display, visibility: cs.visibility, w: r.width, h: r.height };
    };
    const chain = [];
    let el = document.getElementById('mgUserNoteText');
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      chain.push({ tag: el.tagName, id: el.id || '', cls: el.className || '', hidden: el.hidden, display: cs.display, vis: cs.visibility, w: Math.round(r.width), h: Math.round(r.height) });
      el = el.parentElement;
    }
    return {
      boxes: [q('mgDetail'), q('mgDetailEmpty'), q('mgUserNote'), q('mgUserNoteText'), q('mgManage'), q('mgBanner')],
      chain,
      tabs: [...document.querySelectorAll('.mg-item')].map((e) => e.dataset.id),
    };
  }, fb);

  console.log(JSON.stringify(info, null, 1));
  expect(true).toBe(true);
});
