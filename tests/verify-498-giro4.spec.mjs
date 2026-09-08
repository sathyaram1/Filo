// Verifica avversariale #498 — quarto giro: la pagina COME LA VEDE L'OWNER,
// con feedback veri iniettati, il dettaglio aperto e una conversazione lunga.
// È il caso della lamentela: «espandi le aree, fai partire le sezioni un poco
// più in alto».

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(i, { note = '', testo = null } = {}) {
  return {
    _id: `fb-${i}`,
    text: testo || `Segnalazione numero ${i}: qui l'utente racconta un problema.`,
    name: `Segnalazione ${i}`,
    seq: 100 + i,
    subSeq: 0,
    clientId: `tester${i}@example.com`,
    createdAt: '2026-06-22T10:00:00Z',
    images: [],
    notes: note,
    pipeline: {
      action: 'todo',
      l1Category: 'safe',
      l2Class: 'feature',
      stage: 'L2',
      verdicts: [
        { judge: 'A', class: 'feature', reasoning: `Richiesta di funzionalità numero ${i}.` },
        { judge: 'B', class: 'feature', reasoning: 'Concordo, è una richiesta legittima.' },
      ],
      filoSummary: `Riassunto del feedback numero ${i}. È una richiesta di funzionalità.`,
      decidedAt: '2026-06-22T10:01:00Z',
    },
  };
}

async function prepara(page, dati) {
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((d) => window.__mgTest.setData(d), dati);
  await page.waitForTimeout(300);
}

async function misura(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const q = (id) => document.getElementById(id);
    const box = (id) => {
      const el = q(id);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) };
    };
    const th = q('mgThread');
    const lb = q('mgListBody');
    return {
      tabs: box('mgTabs'),
      grid: box('mgReviewGrid'),
      detail: box('mgDetailCol'),
      viewportH: doc.clientHeight,
      scrollH: doc.scrollHeight,
      viewportW: doc.clientWidth,
      scrollW: doc.scrollWidth,
      threadScroll: th ? { s: th.scrollHeight, c: th.clientHeight } : null,
      listScroll: lb ? { s: lb.scrollHeight, c: lb.clientHeight } : null,
      threadBottom: th ? Math.round(th.getBoundingClientRect().bottom) : null,
      ownerBarVisibile: q('mgOwnerBar') ? !q('mgOwnerBar').hidden : null,
    };
  });
}

test('#498 owner con 40 segnalazioni e il dettaglio aperto', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await prepara(page, Array.from({ length: 40 }, (_, i) => fb(i)));

  await expect(page.locator('#mgTabs .mg-tab[data-tab="inbox"]')).toContainText('(40)');
  const m0 = await misura(page);
  console.log('LISTA 40', JSON.stringify(m0));
  expect(m0.tabs.top, 'le schede devono partire in alto').toBeLessThanOrEqual(20);
  expect(m0.scrollH, 'la pagina non deve scrollare').toBeLessThanOrEqual(m0.viewportH + 1);
  expect(m0.viewportH - m0.grid.bottom, 'le aree devono arrivare in fondo').toBeLessThanOrEqual(28);
  expect(m0.listScroll.s, 'la lista deve scorrere dentro la sua colonna').toBeGreaterThan(m0.listScroll.c);
  await page.screenshot({ path: 'tests/.shots/v498-owner-lista.png' });

  // Apro una segnalazione: il dettaglio si riempie.
  await page.locator('#mgListBody .mg-item').first().click();
  await page.waitForTimeout(400);
  const m1 = await misura(page);
  console.log('DETTAGLIO APERTO', JSON.stringify(m1));
  expect(m1.scrollH).toBeLessThanOrEqual(m1.viewportH + 1);
  expect(m1.viewportH - m1.grid.bottom).toBeLessThanOrEqual(28);
  await page.screenshot({ path: 'tests/.shots/v498-owner-dettaglio.png' });
});

test('#498 conversazione molto lunga: scorre la colonna, non esce dalla finestra', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // Note fitte di turni: la conversazione della lavorazione, quella che
  // l'owner legge davvero.
  const note = Array.from({ length: 40 }, (_, i) =>
    `[2026-06-2${i % 9} 10:0${i % 9}] worker: report del giro ${i}. `
    + 'Ho toccato la disposizione della pagina e verificato che le aree tengano. '
    + 'Segue una riga di dettaglio abbastanza lunga da mandare a capo la bolla più volte, '
    + 'così la conversazione diventa davvero alta e si vede se scorre dentro la colonna.').join('\n\n');

  await prepara(page, [fb(1, { note }), fb(2), fb(3)]);
  await page.locator('#mgListBody .mg-item').first().click();
  await page.waitForTimeout(600);

  const m = await misura(page);
  console.log('CONVERSAZIONE LUNGA', JSON.stringify(m));
  await page.screenshot({ path: 'tests/.shots/v498-conversazione.png' });

  expect(m.scrollH, 'la pagina non deve scrollare').toBeLessThanOrEqual(m.viewportH + 1);
  expect(m.threadScroll.s, 'la conversazione deve scorrere dentro la colonna').toBeGreaterThan(m.threadScroll.c);
  expect(m.threadBottom, 'la conversazione non deve uscire dalla finestra').toBeLessThanOrEqual(m.viewportH + 1);
  expect(m.viewportH - m.grid.bottom).toBeLessThanOrEqual(28);
});

test('#498 testo di 10.000 caratteri in una segnalazione aperta', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  const lungo = 'Parola '.repeat(1500);
  const senzaSpazi = 'x'.repeat(4000);
  await prepara(page, [fb(1, { testo: lungo + ' ' + senzaSpazi })]);
  await page.locator('#mgListBody .mg-item').first().click();
  await page.waitForTimeout(500);
  const m = await misura(page);
  console.log('10K CARATTERI', JSON.stringify(m));
  await page.screenshot({ path: 'tests/.shots/v498-10k.png' });
  expect(m.scrollW, 'niente scroll orizzontale').toBeLessThanOrEqual(m.viewportW + 2);
  expect(m.scrollH, 'niente scroll verticale della pagina').toBeLessThanOrEqual(m.viewportH + 1);
  expect(m.viewportH - m.grid.bottom).toBeLessThanOrEqual(28);
});

test('#498 finestra ridimensionata col dettaglio aperto', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await prepara(page, Array.from({ length: 12 }, (_, i) => fb(i)));
  await page.locator('#mgListBody .mg-item').first().click();
  await page.waitForTimeout(300);

  for (const [w, h] of [[1000, 700], [820, 560], [760, 500], [1600, 1100]]) {
    await app.evaluate(async ({ BrowserWindow }, [a, b]) => {
      BrowserWindow.getAllWindows()[0].setContentSize(a, b);
    }, [w, h]);
    await page.waitForTimeout(450);
    const m = await misura(page);
    console.log(`RESIZE ${w}x${h}`, JSON.stringify({
      viewportH: m.viewportH, scrollH: m.scrollH, gridBottom: m.grid.bottom,
      tabsTop: m.tabs.top, gridH: m.grid.h, scrollW: m.scrollW, viewportW: m.viewportW,
    }));
  }
  await page.screenshot({ path: 'tests/.shots/v498-resize-finale.png' });
});
