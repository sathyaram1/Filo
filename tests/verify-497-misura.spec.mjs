// Misure della riga dei tasti (#497) su tutti gli stati e a più larghezze.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(over) {
  return {
    _id: 'x', text: 'Il bottone non fa niente', name: 'Bottone morto',
    seq: 700, subSeq: 0, clientId: 'tester@example.com',
    createdAt: '2026-09-01T10:00:00Z', images: [],
    status: 'todo', statusPublic: 'open', notes: '', ...over,
  };
}
const CASI = [
  ['ricevuto', fb({ _id: 'c1', status: null }), 'inbox'],
  ['file sospetto', fb({ _id: 'c2', status: 'suspicious_file' }), 'inbox'],
  ['in coda', fb({ _id: 'c3', status: 'todo' }), 'queue'],
  ['risolto', fb({ _id: 'c5', status: 'done', statusPublic: 'closed' }), 'resolved'],
  ['archiviato', fb({ _id: 'c6', status: 'archived', statusPublic: 'closed' }), 'archived'],
  ['cifrato', fb({ _id: 'c7', status: 'enc:v1:qq' }), 'inbox'],
];

test('misure', async ({ openTab, shell }) => {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((l) => window.__mgTest.setData(l), CASI.map(([, f]) => f));

  const dim = await page.evaluate(() => ({
    win: [window.innerWidth, window.innerHeight],
    detail: document.getElementById('mgDetailCol').getBoundingClientRect().width,
    lista: document.getElementById('mgListCol') ? document.getElementById('mgListCol').getBoundingClientRect().width : null,
  }));
  console.log('DIM', JSON.stringify(dim));

  for (const [nome, f, tab] of CASI) {
    await page.evaluate(({ i, t }) => { window.__mgTest.setTab(t); window.__mgTest.openDetail(i); }, { i: f._id, t: tab });
    const info = await page.evaluate(() => {
      const bar = document.getElementById('mgOwnerBar');
      const bs = [...bar.querySelectorAll('button')].filter((b) => b.offsetParent !== null);
      const row = bar.querySelector('.mg-owner-row').getBoundingClientRect();
      return {
        row: { w: Math.round(row.width), h: Math.round(row.height) },
        b: bs.map((b) => ({ t: b.textContent.trim().slice(0, 16), y: Math.round(b.getBoundingClientRect().top), w: Math.round(b.getBoundingClientRect().width) })),
      };
    });
    const ys = [...new Set(info.b.map((b) => b.y))];
    console.log(nome, '| righe:', ys.length, '| rowW:', info.row.w, '| somma tasti:', info.b.reduce((a, b) => a + b.w, 0) + 10 * (info.b.length - 1), '|', JSON.stringify(info.b));
  }
});
