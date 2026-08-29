// Verifica avversariale #495 — secondo giro: onestà dei numeri quando il dato
// non c'è, il tetto, e la superficie gemella (pagina dei feedback).

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';

function fb(id, status, extra = {}) {
  return {
    _id: id, seq: Number(String(id).replace(/\D/g, '')) || 1, subSeq: 0,
    text: `testo di ${id}`, name: `titolo ${id}`, status,
    clientId: 'tester@example.com', createdAt: '2026-06-22T10:00:00Z', images: [],
    ...extra,
  };
}

test('#495 — caricamento fallito: nessun numero, e il guasto non evapora al primo click', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());

  for (const t of ['inbox', 'queue', 'resolved', 'archived']) {
    await page.click(`.mg-tab[data-tab="${t}"]`);
    const txt = await page.locator(`.mg-tab[data-tab="${t}"]`).innerText();
    expect(txt, `scheda ${t} non deve dire "(0)" quando il dato manca`).not.toMatch(/\(\d/);
    // Il riquadro vuoto deve dire il guasto, non "qui non c'è niente".
    await expect(page.locator('#mgListEmpty')).not.toHaveText(/^Nessun feedback/);
  }
});

test('#495 — al tetto anche lo zero è un minimo: "(0+)"', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  const tanti = [];
  for (let i = 0; i < 500; i++) tanti.push(fb(`x${i}`, 'todo'));
  await page.evaluate((d) => window.__mgTest.setData(d), tanti);
  await expect(page.locator('.mg-tab[data-tab="queue"]')).toHaveText('In coda (500+)');
  // Le sezioni davvero vuote, al tetto, non possono affermare lo zero.
  await expect(page.locator('.mg-tab[data-tab="archived"]')).toHaveText('Archiviati (0+)');
  await page.click('.mg-tab[data-tab="archived"]');
  await expect(page.locator('#mgListEmpty')).toHaveText(/non sono in pagina/);
});

test('#495 — riordinare la lista non cambia i numeri', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setData([
    { _id: 'q1', seq: 1, status: 'todo', name: 'a', createdAt: '2026-01-01T00:00:00Z', priority: 3 },
    { _id: 'q2', seq: 2, status: 'todo', name: 'b', createdAt: '2026-02-01T00:00:00Z', priority: 1 },
    { _id: 'i1', seq: 3, status: 'unlabeled', name: 'c', createdAt: '2026-03-01T00:00:00Z' },
  ]));
  await expect(page.locator('.mg-tab[data-tab="queue"]')).toHaveText('In coda (2)');
  for (const m of ['num', 'priority', 'smart']) {
    await page.evaluate((mm) => window.__mgTest.setSortMode(mm), m);
    await expect(page.locator('.mg-tab[data-tab="queue"]')).toHaveText('In coda (2)');
    await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (1)');
  }
});

test('#495 — superficie gemella: anche la pagina dei feedback dice quante ne ha ogni sezione', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest);
  // Prima dei dati: solo i nomi.
  const prima = await page.locator('.fb-tab[data-tab="inbox"]').innerText();
  expect(prima).not.toMatch(/\(\d/);

  await page.evaluate(() => window.__fbTest.setData([
    { _id: 'n1', seq: 1, status: 'unlabeled', text: 'uno', createdAt: '2026-01-01T00:00:00Z' },
    { _id: 'n2', seq: 2, status: 'unlabeled', text: 'due', createdAt: '2026-01-02T00:00:00Z' },
    { _id: 't1', seq: 3, status: 'todo', text: 'tre', createdAt: '2026-01-03T00:00:00Z' },
    { _id: 'd1', seq: 4, status: 'done', text: 'quattro', createdAt: '2026-01-04T00:00:00Z' },
  ]));
  await expect(page.locator('.fb-tab[data-tab="inbox"]')).toHaveText('Ricevuti (2)');
  await expect(page.locator('.fb-tab[data-tab="queue"]')).toHaveText('In coda (1)');
  await expect(page.locator('.fb-tab[data-tab="resolved"]')).toHaveText('Risolti (1)');
  await expect(page.locator('.fb-tab[data-tab="archived"]')).toHaveText('Archiviati (0)');
});

test('#495 — gemella: filtrando col campo di ricerca, il numero della scheda non mente su cosa si vede', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest);
  await page.evaluate(() => window.__fbTest.setData([
    { _id: 'n1', seq: 1, status: 'unlabeled', text: 'mela', createdAt: '2026-01-01T00:00:00Z' },
    { _id: 'n2', seq: 2, status: 'unlabeled', text: 'pera', createdAt: '2026-01-02T00:00:00Z' },
    { _id: 'n3', seq: 3, status: 'unlabeled', text: 'pesca', createdAt: '2026-01-03T00:00:00Z' },
  ]));
  await expect(page.locator('.fb-tab[data-tab="inbox"]')).toHaveText('Ricevuti (3)');
  await page.fill('#search', 'mela');
  await page.waitForTimeout(300);
  const righe = await page.locator('#list .fb-item, #list > *').count();
  const badge = await page.locator('.fb-tab[data-tab="inbox"]').innerText();
  const contatore = await page.locator('#count').innerText();
  // Traccia per il verdetto: quante righe restano, cosa dice la scheda, cosa
  // dice il contatore della barra.
  console.log(`[495] ricerca "mela": righe=${righe} scheda="${badge}" contatore="${contatore}"`);
  // Almeno UNA delle due scritte deve dire quante ne ha trovate la ricerca.
  expect(`${badge} ${contatore}`).toMatch(/\b1\b/);
});
