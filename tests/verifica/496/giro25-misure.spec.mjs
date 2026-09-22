// VERIFICA #496 — giro 25. Misure: la scheda sborda dal suo contenitore?
import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

test('#496 giro25 — misure di larghezza', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const feedbacks = [];
  for (let i = 0; i < 40; i++) {
    feedbacks.push(fb({ _id: 'x' + i, seq: 100 + i, createdAt: g(1 + (i % 25)), name: 't' + i,
      status: ['todo', 'working', 'done', 'archived', 'design'][i % 5] }));
  }
  const workerLog = [];
  for (let i = 0; i < 20; i++) {
    workerLog.push({ role: 'fixer', startedAt: g(2 + (i % 10)), num: String(100 + i) });
    for (let k = 0; k <= i % 4; k++) workerLog.push({ role: 'verifier', startedAt: g(2 + (i % 10)), num: String(100 + i) });
  }
  await apriStatistiche(page, { feedbacks, workerLog }, feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();
  const m = await page.evaluate(() => {
    const out = {};
    const q = (s) => document.querySelector(s);
    for (const [nome, sel] of [['root', '#mgFsRoot'], ['body', '#mgFsBody'], ['tiles', '#mgFsTiles'],
      ['altro', '#mgFsAltro'], ['trend', '#mgFsTrend'], ['axis', '#mgFsTrendAxis'], ['panel', '#panel-fbstats']]) {
      const n = q(sel);
      if (n) out[nome] = { cw: n.clientWidth, sw: n.scrollWidth, rect: Math.round(n.getBoundingClientRect().width), of: getComputedStyle(n).overflowX };
    }
    out.doc = { cw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth };
    const ultimo = document.querySelectorAll('#mgFsAltro .mg-tile');
    out.ultimoTile = ultimo.length ? Math.round(ultimo[ultimo.length - 1].getBoundingClientRect().right) : null;
    out.nTile = ultimo.length;
    return out;
  });
  console.log('MISURE %j', m);
  expect(m.doc.sw).toBeLessThanOrEqual(m.doc.cw);
});
