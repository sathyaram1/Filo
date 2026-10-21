// Esplorazione del giro 2: le teste delle tre schede delle Domande, a varie larghezze e nei due temi.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';
import { domanda } from '../../helpers/gestioneMainFinto.mjs';

const MANAGE = 'filo://manage/manage.html';

const misura = (page) => page.evaluate(() => {
  const titolo = document.getElementById('mgDomandeTitolo');
  const r = document.createRange();
  r.selectNodeContents(titolo);
  const testo = [...r.getClientRects()];
  const col = document.getElementById('mgDomandeCol').getBoundingClientRect();
  const fuori = [];
  const head = titolo.parentElement.closest('.mg-col-head') || titolo.parentElement;
  for (const el of head.querySelectorAll('button, input, label, span')) {
    if (el.hidden || !el.offsetParent) continue;
    const b = el.getBoundingClientRect();
    if (b.right > col.right + 0.5) fuori.push(el.id || el.className);
  }
  const p = document.getElementById('mgDomandeFiduciaFiltro');
  const pb = p.getBoundingClientRect();
  const sotto = !p.hidden && testo.some((x) => x.right > pb.left + 1 && x.left < pb.right - 1 && x.bottom > pb.top + 1 && x.top < pb.bottom - 1);
  return { sotto, fuori, filtroVisibile: !p.hidden };
});

for (const w of [900, 1000, 1280, 1600]) {
  test(`esplora domande a ${w}`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.filo);
    await page.evaluate(() => window.__mgTest.whenReady());
    await page.evaluate(() => { window.__mgTest.setAdmin(true); window.__mgTest.setData([]); });
    const lungo = 'Una domanda dal titolo molto lungo che deve andare a capo senza uscire dalla colonna';
    await page.evaluate((l) => window.__mgTest.setDomande(l), [
      domanda(31, { fiducia: 'fidato', titolo: lungo }), domanda(32, { fiducia: 'non_fidato' }),
      domanda(33, { fiducia: 'non_fidato', stato: 'in_lavorazione', titolo: lungo }),
      domanda(34, { fiducia: 'fidato', stato: 'in_lavorazione' }),
      domanda(35, { fiducia: 'fidato', stato: 'chiusa', esito: { archiviata: true }, titolo: lungo }),
      domanda(36, { fiducia: 'non_fidato', stato: 'chiusa', esito: { archiviata: true } }),
    ]);
    await page.setViewportSize({ width: w, height: 700 });
    const esiti = {};
    for (const t of ['light', 'dark']) {
      await page.evaluate((x) => document.documentElement.setAttribute('data-sn-theme', x), t);
      for (const s of ['domande', 'domande-lavoro', 'domande-archivio']) {
        await apriScheda(page, s);
        await page.waitForTimeout(150);
        esiti[`${t}-${s}`] = await misura(page);
        if (s === 'domande') {
          await page.locator('#mgDomandeTutte').check();
          await page.waitForTimeout(150);
          esiti[`${t}-${s}-scelte`] = await misura(page);
          await page.locator('#mgDomandeFiduciaFiltro').click();
          await page.waitForTimeout(150);
          esiti[`${t}-${s}-scelte-filtro`] = await misura(page);
          await page.screenshot({ path: `tests/.shots/v1575-g2-dom-${w}-${t}-filtro.png` });
          await page.locator('#mgDomandeFiduciaFiltro').click();
          await page.locator('#mgDomandeTutte').uncheck();
        }
        await page.screenshot({ path: `tests/.shots/v1575-g2-dom-${w}-${t}-${s}.png` });
      }
    }
    console.log(w, JSON.stringify(esiti));
  });
}
