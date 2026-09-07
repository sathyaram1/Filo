// Verifica avversariale #498 — secondo giro: zoom, contenuto che deborda,
// riga "sezioni non disegnabili", e il caso dell'owner (senza banner).

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function misura(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
    const t = document.getElementById('mgTabs').getBoundingClientRect();
    const body = document.getElementById('mgListBody');
    const det = document.getElementById('mgDetailBody') || document.querySelector('#mgDetailCol .mg-col-body');
    return {
      tabsTop: Math.round(t.top),
      gridTop: Math.round(g.top),
      gridBottom: Math.round(g.bottom),
      gridH: Math.round(g.height),
      viewportH: doc.clientHeight,
      scrollH: doc.scrollHeight,
      scrollW: doc.scrollWidth,
      viewportW: doc.clientWidth,
      listScrollH: body ? body.scrollHeight : null,
      listClientH: body ? body.clientHeight : null,
      detScrollH: det ? det.scrollHeight : null,
      detClientH: det ? det.clientHeight : null,
    };
  });
}

test('#498 zoom della pagina: le aree restano nella finestra', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgReviewGrid')).toBeVisible();

  for (const z of [1, 1.25, 1.5, 2, 0.67]) {
    await page.evaluate((v) => { document.body.style.zoom = String(v); }, z);
    await page.waitForTimeout(300);
    const m = await misura(page);
    console.log(`ZOOM ${z}`, JSON.stringify(m));
  }
  await page.evaluate(() => { document.body.style.zoom = ''; });
});

test('#498 lista lunghissima: scrolla la colonna, non la pagina', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgReviewGrid')).toBeVisible();

  await page.evaluate(() => {
    const body = document.getElementById('mgListBody');
    body.innerHTML = '<div class="mg-list">' + Array.from({ length: 300 }, (_, i) =>
      `<div class="mg-item"><span>#${i}</span><span>Segnalazione di prova numero ${i}</span></div>`).join('') + '</div>';
  });
  await page.waitForTimeout(300);
  const m = await misura(page);
  console.log('LISTA LUNGA', JSON.stringify(m));
  expect(m.scrollH, 'la pagina non deve scrollare per colpa della lista').toBeLessThanOrEqual(m.viewportH + 1);
  expect(m.listScrollH).toBeGreaterThan(m.listClientH);
  expect(m.gridBottom).toBeLessThanOrEqual(m.viewportH + 1);
  await page.screenshot({ path: 'tests/.shots/v498-lista-lunga.png' });
});

test('#498 titolo di 10.000 caratteri e caratteri speciali non sfondano le colonne', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgReviewGrid')).toBeVisible();

  await page.evaluate(() => {
    const lungo = 'A'.repeat(10000);
    const senzaSpazi = 'x'.repeat(600);
    const body = document.getElementById('mgListBody');
    const it = (t) => {
      const d = document.createElement('div');
      d.className = 'mg-item';
      const s = document.createElement('span');
      s.textContent = t;
      d.appendChild(s);
      return d;
    };
    const w = document.createElement('div');
    w.className = 'mg-list';
    w.appendChild(it(lungo));
    w.appendChild(it(senzaSpazi));
    w.appendChild(it('🙂🙂🙂 <script>alert(1)</script> javascript:alert(2) 日本語テキストのながいながいながいタイトル'));
    body.innerHTML = '';
    body.appendChild(w);
  });
  await page.waitForTimeout(300);
  const m = await misura(page);
  console.log('TESTI LIMITE', JSON.stringify(m));
  expect(m.scrollW, 'niente scroll orizzontale della pagina').toBeLessThanOrEqual(m.viewportW + 2);
  expect(m.scrollH).toBeLessThanOrEqual(m.viewportH + 1);
  // Nessuno script deve essere eseguito: il testo resta testo.
  const dialoghi = [];
  page.on('dialog', (d) => { dialoghi.push(d.message()); d.dismiss(); });
  await page.waitForTimeout(300);
  expect(dialoghi).toHaveLength(0);
  await page.screenshot({ path: 'tests/.shots/v498-testi-limite.png' });
});

test('#498 riga "sezioni non disegnabili" visibile: le aree restano in finestra', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    const el = document.getElementById('mgNoSections');
    el.hidden = false;
    el.textContent = 'Le sezioni non si disegnano: su questo computer non c\'è la chiave per leggere lo stato delle segnalazioni.';
  });
  await page.waitForTimeout(250);
  const m = await misura(page);
  console.log('NO-SECTIONS', JSON.stringify(m));
  expect(m.scrollH).toBeLessThanOrEqual(m.viewportH + 1);
  expect(m.viewportH - m.gridBottom).toBeLessThanOrEqual(28);
});

test('#498 vista owner (senza banner) + ricerca aperta + schede a capo insieme', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(760, 640);
  });
  await page.waitForTimeout(500);
  const m = await misura(page);
  console.log('OWNER+RICERCA+STRETTA', JSON.stringify(m));
  await page.screenshot({ path: 'tests/.shots/v498-owner-stretta.png' });
  expect(m.tabsTop).toBeLessThanOrEqual(20);
  expect(m.scrollH).toBeLessThanOrEqual(m.viewportH + 2);
  expect(m.viewportH - m.gridBottom).toBeLessThanOrEqual(28);
});
