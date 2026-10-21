import { test } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';
import { domanda } from '../../helpers/gestioneMainFinto.mjs';

const MANAGE = 'filo://manage/manage.html';

test('esplora larghezze', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { window.__mgTest.setAdmin(true); window.__mgTest.setData([]); });
  await page.evaluate((l) => window.__mgTest.setDomande(l), [
    domanda(31, { fiducia: 'fidato' }), domanda(32, { fiducia: 'non_fidato' }),
    domanda(33, { fiducia: 'non_fidato', stato: 'in_lavorazione' }),
  ]);
  for (const w of [1280, 1100, 1000, 900, 800]) {
    await page.setViewportSize({ width: w, height: 500 });
    for (const s of ['domande', 'domande-lavoro']) {
      await apriScheda(page, s);
      const r = await page.evaluate(() => {
        const f = document.getElementById('mgDomandeFiduciaFiltro').getBoundingClientRect();
        const head = f.parentElement;
        const kids = [...head.children].filter((k) => k !== f.parentElement).map((k) => { const b = k.getBoundingClientRect(); return { id: k.id || k.className, x: b.x, r: b.right, y: b.y, h: b.height, txt: (k.textContent || '').slice(0, 30) }; });
        const col = head.getBoundingClientRect();
        return { f: [f.x, f.right, f.y], col: [col.x, col.right], kids };
      });
      console.log(w, s, JSON.stringify(r));
      await page.screenshot({ path: `tests/.shots/v1575-dq-${s}-${w}.png`, clip: { x: 0, y: 150, width: Math.min(w, 600), height: 120 } });
    }
  }
});
