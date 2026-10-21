// r1: nella testa delle Domande il tasto «Solo non fidate» si sovrappone al titolo della scheda e spinge
// «Applica il consiglio» fuori dalla colonna, alla larghezza normale della finestra.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';
import { domanda } from '../../helpers/gestioneMainFinto.mjs';

const MANAGE = 'filo://manage/manage.html';

const misura = (page) => page.evaluate(() => {
  const titolo = document.getElementById('mgDomandeTitolo');
  const r = document.createRange();
  r.selectNodeContents(titolo);
  const testo = [...r.getClientRects()].map((x) => ({ l: x.left, r: x.right, t: x.top, b: x.bottom }));
  const p = document.getElementById('mgDomandeFiduciaFiltro').getBoundingClientRect();
  const btn = document.getElementById('mgDomandeConsiglioSel');
  const b = btn.getBoundingClientRect();
  const col = btn.closest('.mg-col-head, #mgDomandeCol').getBoundingClientRect();
  const sovrapposto = testo.some((x) => x.r > p.left + 1 && x.l < p.right - 1 && x.b > p.top + 1 && x.t < p.bottom - 1);
  return { sovrapposto, tastoDentro: btn.hidden || b.right <= col.right + 0.5, btnScroll: btn.scrollWidth - btn.clientWidth };
});

for (const w of [1280, 1000]) {
  test(`r1 a ${w} px il titolo, «Solo non fidate» e «Applica il consiglio» stanno tutti nella testa delle Domande`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.filo);
    await page.evaluate(() => window.__mgTest.whenReady());
    await page.evaluate(() => { window.__mgTest.setAdmin(true); window.__mgTest.setData([]); });
    await page.evaluate((l) => window.__mgTest.setDomande(l), [domanda(31, { fiducia: 'fidato' }), domanda(32, { fiducia: 'non_fidato' })]);
    await page.setViewportSize({ width: w, height: 700 });
    await apriScheda(page, 'domande');
    await expect(page.locator('#mgDomandeFiduciaFiltro')).toBeVisible();
    // Le domande scelte per «Applica il consiglio»: il tasto compare accanto al filtro.
    await page.locator('#mgDomandeTutte').check();
    await expect(page.locator('#mgDomandeConsiglioSel')).toBeVisible();
    await page.screenshot({ path: `tests/.shots/v1575-r1-${w}.png` });
    const m = await misura(page);
    expect(m.sovrapposto, 'il titolo della scheda passa sotto «Solo non fidate»').toBe(false);
    expect(m.tastoDentro, '«Applica il consiglio» esce dalla colonna').toBe(true);
  });
}
