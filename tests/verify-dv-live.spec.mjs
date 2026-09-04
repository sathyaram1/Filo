// Sonda di verifica (temporanea): dashboard "viva".
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function mk(i, extra = {}) {
  return {
    _id: `vv-${i}`,
    _updateTime: `2026-09-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
    text: `Testo del feedback numero ${i}. `.repeat(40),
    name: `Feedback ${i}`,
    seq: 1000 + i,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, i)).toISOString(),
    images: [],
    status: 'done',
    statusPublic: 'closed',
    notes: 'Report della lavorazione.',
    ...extra,
  };
}

async function boot(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  const t0 = Date.now();
  await page.evaluate(() => window.__mgTest.whenReady());
  return Date.now() - t0;
}

async function seed(page, list, tab = 'resolved') {
  await page.evaluate(({ list, tab }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(list);
    window.__mgTest.setTab(tab);
  }, { list, tab });
}

async function useSources(page, versions, docs) {
  await page.evaluate(({ versions, docs }) => {
    window.__vvCalls = { versions: 0, getMany: [] };
    window.__mgTest.setLiveSources({
      listVersions: async () => { window.__vvCalls.versions++; return versions; },
      getMany: async (ids) => { window.__vvCalls.getMany.push(ids.slice()); return docs.filter((d) => ids.includes(d._id)); },
    });
  }, { versions, docs });
}

const titles = (page) => page.locator('#mgList .mg-item .mg-item-title').allInnerTexts();

test('1. caricamento iniziale con Firestore vera: tempo, live acceso, giro reale senza churn', async ({ openTab }) => {
  const page = await openTab(URL);
  const ms = await boot(page);
  console.log('WHENREADY_MS', ms);
  const n = await page.locator('#mgList .mg-item').count();
  console.log('REAL_ITEMS', n);
  expect(await page.evaluate(() => window.__mgTest.isLiveOn())).toBe(true);
  // giro reale: nulla cambiato → nessuna rilettura di documenti
  await page.evaluate(() => {
    window.__vvGM = [];
    const real = window.SN_FEEDBACK;
    window.__mgTest.setLiveSources({
      listVersions: (o) => real.listVersions(o),
      getMany: (ids) => { window.__vvGM.push(ids.length); return real.getMany(ids); },
    });
  });
  const t1 = Date.now();
  const r = await page.evaluate(() => window.__mgTest.pollNow());
  console.log('REAL_POLL_MS', Date.now() - t1, JSON.stringify(r), 'getMany calls', JSON.stringify(await page.evaluate(() => window.__vvGM)));
  expect(r.changed).toBe(0);
  expect(await page.evaluate(() => window.__vvGM)).toEqual([]);
  // due giri contemporanei = uno solo
  const both = await page.evaluate(async () => {
    const a = window.__mgTest.pollNow(); const b = window.__mgTest.pollNow();
    return a === b;
  });
  expect(both).toBe(true);
  expect(n).toBeGreaterThan(0);
});

test('2. riscritto / nuovo / sparito: la lista cambia da sola', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page);
  const base = [mk(1), mk(2), mk(3)];
  await seed(page, base);
  expect(await titles(page)).toEqual(['Feedback 3', 'Feedback 2', 'Feedback 1']);
  expect(await page.locator('.mg-tab[data-tab="resolved"]').innerText()).toBe('Risolti (3)');

  // 2 riscritto, 4 nuovo
  const v2 = { ...mk(2), _updateTime: '2026-09-02T00:00:00Z', name: 'Feedback 2 RISCRITTO' };
  const d4 = mk(4);
  await useSources(page, [d4, mk(3), v2, mk(1)].map((d) => ({ _id: d._id, _updateTime: d._updateTime })), [d4, v2]);
  const r = await page.evaluate(() => window.__mgTest.pollNow());
  expect(r.changed).toBe(2);
  expect(await page.evaluate(() => window.__vvCalls.getMany)).toEqual([['vv-4', 'vv-2']].map((a) => expect.arrayContaining(a)));
  expect(await titles(page)).toEqual(['Feedback 4', 'Feedback 3', 'Feedback 2 RISCRITTO', 'Feedback 1']);
  expect(await page.locator('.mg-tab[data-tab="resolved"]').innerText()).toBe('Risolti (4)');

  // 1 sparito
  await useSources(page, [d4, mk(3), v2].map((d) => ({ _id: d._id, _updateTime: d._updateTime })), []);
  const r2 = await page.evaluate(() => window.__mgTest.pollNow());
  expect(r2.changed).toBe(1);
  expect(await titles(page)).toEqual(['Feedback 4', 'Feedback 3', 'Feedback 2 RISCRITTO']);
  expect(await page.locator('.mg-tab[data-tab="resolved"]').innerText()).toBe('Risolti (3)');

  // cambio di stato: da risolto a in coda → cambia scheda
  const v3 = { ...mk(3), _updateTime: '2026-09-02T00:00:01Z', status: 'queued', statusPublic: 'open' };
  await useSources(page, [d4, v3, v2].map((d) => ({ _id: d._id, _updateTime: d._updateTime })), [v3]);
  await page.evaluate(() => window.__mgTest.pollNow());
  expect(await titles(page)).toEqual(['Feedback 4', 'Feedback 2 RISCRITTO']);
  console.log('TABS', await page.locator('.mg-tabs, .mg-tab').allInnerTexts());
});

test('3. selezione e scorrimento restano; pannello aperto aggiornato e col suo scroll', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page);
  const list = Array.from({ length: 80 }, (_, i) => mk(i + 1));
  await seed(page, list);
  await page.evaluate(() => window.__mgTest.openDetail('vv-40'));
  await expect(page.locator('#mgList .mg-item--selected')).toHaveAttribute('data-id', 'vv-40');
  const before = await page.evaluate(() => {
    const els = [document.getElementById('mgList'), document.getElementById('mgList').parentElement];
    const sc = els.find((e) => e.scrollHeight > e.clientHeight + 5) || els[0];
    sc.scrollTop = 1234;
    const d = document.getElementById('mgDetail');
    const dsc = d.scrollHeight > d.clientHeight + 5 ? d : Array.from(d.querySelectorAll('*')).find((e) => e.scrollHeight > e.clientHeight + 5);
    if (dsc) dsc.scrollTop = 300;
    return { scroller: sc.id || sc.className, top: sc.scrollTop, dtop: dsc ? dsc.scrollTop : null, dsel: dsc ? (dsc.id || dsc.className) : null };
  });
  console.log('BEFORE', JSON.stringify(before));
  expect(before.top).toBeGreaterThan(0);
  const v40 = { ...mk(40), _updateTime: '2026-09-02T00:00:00Z', name: 'Feedback 40 NUOVO TITOLO', notes: 'Report aggiornato dal cloud.' };
  const v7 = { ...mk(7), _updateTime: '2026-09-02T00:00:00Z', name: 'Feedback 7 NUOVO' };
  await useSources(page, [...list.map((d) => (d._id === 'vv-40' ? v40 : d._id === 'vv-7' ? v7 : d)), mk(81)].map((d) => ({ _id: d._id, _updateTime: d._updateTime })), [v40, v7, mk(81)]);
  await page.evaluate(() => window.__mgTest.pollNow());
  const after = await page.evaluate(() => {
    const els = [document.getElementById('mgList'), document.getElementById('mgList').parentElement];
    const sc = els.find((e) => e.scrollHeight > e.clientHeight + 5) || els[0];
    const d = document.getElementById('mgDetail');
    const dsc = d.scrollHeight > d.clientHeight + 5 ? d : Array.from(d.querySelectorAll('*')).find((e) => e.scrollHeight > e.clientHeight + 5);
    return { top: sc.scrollTop, dtop: dsc ? dsc.scrollTop : null, sel: document.querySelector('#mgList .mg-item--selected')?.dataset.id, detail: d.innerText };
  });
  console.log('AFTER', JSON.stringify(after));
  expect(after.sel).toBe('vv-40');
  expect(after.top).toBe(before.top);
    expect(after.detail).toContain('Report aggiornato dal cloud.');
  expect(await page.locator('#mgList .mg-item[data-id="vv-40"] .mg-item-title').innerText()).toBe('Feedback 40 NUOVO TITOLO');
  if (before.dtop != null) console.log('DETAIL_SCROLL', before.dtop, '->', after.dtop);
});

test('4. mentre scrivo nel pannello non mi viene ridisegnato sotto le dita', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page);
  const list = [mk(1), mk(2), mk(3)];
  await seed(page, list);
  await page.evaluate(() => window.__mgTest.openDetail('vv-2'));
  const campo = page.locator('#mgUserNoteText');
  await expect(campo).toBeVisible();
  await campo.click();
  await campo.type('sto scrivendo una bozza');
  const v2 = { ...mk(2), _updateTime: '2026-09-02T00:00:00Z', name: 'Feedback 2 CAMBIATO', notes: 'report nuovo 1', userNote: 'frase arrivata dal cloud' };
  await useSources(page, [mk(3), v2, mk(1)].map((d) => ({ _id: d._id, _updateTime: d._updateTime })), [v2]);
  await page.evaluate(() => window.__mgTest.pollNow());
  await expect(campo).toHaveValue('sto scrivendo una bozza');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('mgUserNoteText');
  await campo.type(' e continuo');
  await expect(campo).toHaveValue('sto scrivendo una bozza e continuo');
  // la lista intanto è aggiornata
  expect(await page.locator('#mgList .mg-item[data-id="vv-2"] .mg-item-title').innerText()).toBe('Feedback 2 CAMBIATO');
  // ma il pannello no (per scelta): il titolo nel dettaglio è ancora quello vecchio?
  const det = await page.locator('#mgDetail').innerText();
  console.log('DETAIL_WHILE_TYPING has new report:', det.includes('report nuovo 1'));
  // quando smetto di scrivere e arriva un altro cambio, il pannello si aggiorna
  await page.evaluate(() => document.activeElement.blur());
  const v2b = { ...v2, _updateTime: '2026-09-02T00:00:05Z', name: 'Feedback 2 CAMBIATO ANCORA', notes: 'report nuovo 2' };
  await useSources(page, [mk(3), v2b, mk(1)].map((d) => ({ _id: d._id, _updateTime: d._updateTime })), [v2b]);
  await page.evaluate(() => window.__mgTest.pollNow());
  const det2 = await page.locator('#mgDetail').innerText();
  expect(det2).toContain('report nuovo 2');
  console.log('AFTER_BLUR userNote field:', await campo.inputValue());
  // riaprendo la scheda a mano, il pannello mostra la versione fresca
  await page.evaluate(() => window.__mgTest.openDetail('vv-1'));
  await page.evaluate(() => window.__mgTest.openDetail('vv-2'));
  await expect(campo).toHaveValue('frase arrivata dal cloud');
});

test('5. stress: giri ripetuti, sorgente che lancia, dati vuoti, selezionato che sparisce', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page);
  const list = Array.from({ length: 30 }, (_, i) => mk(i + 1));
  await seed(page, list);
  await page.evaluate(() => window.__mgTest.openDetail('vv-10'));
  await useSources(page, list.map((d) => ({ _id: d._id, _updateTime: d._updateTime })), []);
  const html0 = await page.locator('#mgList').innerHTML();
  for (let i = 0; i < 25; i++) {
    const r = await page.evaluate(() => window.__mgTest.pollNow());
    expect(r.changed).toBe(0);
  }
  expect(await page.locator('#mgList').innerHTML()).toBe(html0);
  expect(await page.evaluate(() => window.__vvCalls.getMany)).toEqual([]);

  // sorgente che lancia (rete giù)
  await page.evaluate(() => {
    window.__mgTest.setLiveSources({ listVersions: async () => { throw new Error('rete giù'); } });
  });
  for (let i = 0; i < 3; i++) {
    const err = await page.evaluate(() => window.__mgTest.pollNow().then(() => null, (e) => String(e.message)));
    expect(err).toContain('rete giù');
  }
  expect(await page.locator('#mgList .mg-item').count()).toBe(30);
  await expect(page.locator('#mgList .mg-item--selected')).toHaveAttribute('data-id', 'vv-10');
  // getMany che lancia a metà
  await page.evaluate(() => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: 'vv-10', _updateTime: 'x' }, ...Array.from({ length: 29 }, (_, i) => ({ _id: `vv-${i + 2 + (i >= 8 ? 1 : 0)}`, _updateTime: `2026-09-01T00:00:${String((i + 2 + (i >= 8 ? 1 : 0)) % 60).padStart(2, '0')}Z` }))],
      getMany: async () => { throw new Error('batch giù'); },
    });
  });
  const err2 = await page.evaluate(() => window.__mgTest.pollNow().then(() => null, (e) => String(e.message)));
  expect(err2).toContain('batch giù');
  expect(await page.locator('#mgList .mg-item').count()).toBe(30);
  // poi la rete torna
  const v10 = { ...mk(10), _updateTime: 'x', name: 'Feedback 10 TORNATO' };
  await useSources(page, list.map((d) => (d._id === 'vv-10' ? v10 : d)).map((d) => ({ _id: d._id, _updateTime: d._updateTime })), [v10]);
  await page.evaluate(() => window.__mgTest.pollNow());
  expect(await page.locator('#mgList .mg-item[data-id="vv-10"] .mg-item-title').innerText()).toBe('Feedback 10 TORNATO');

  // il selezionato sparisce dal server
  await useSources(page, list.filter((d) => d._id !== 'vv-10').map((d) => ({ _id: d._id, _updateTime: d._updateTime })), []);
  await page.evaluate(() => window.__mgTest.pollNow());
  expect(await page.locator('#mgList .mg-item').count()).toBe(29);
  const state = await page.evaluate(() => ({ sel: document.querySelector('#mgList .mg-item--selected')?.dataset.id || null, detail: document.getElementById('mgDetail').innerText.slice(0, 200) }));
  console.log('SELECTED_REMOVED', JSON.stringify(state));

  // tutto vuoto
  await useSources(page, [], []);
  await page.evaluate(() => window.__mgTest.pollNow());
  expect(await page.locator('#mgList .mg-item').count()).toBe(0);
  await expect(page.locator('#mgListEmpty')).toBeVisible();
  console.log('EMPTY_TEXT', await page.locator('#mgListEmpty').innerText());
  // e poi torna qualcosa
  await useSources(page, [{ _id: 'vv-99', _updateTime: 'z' }], [{ ...mk(99), _updateTime: 'z' }]);
  await page.evaluate(() => window.__mgTest.pollNow());
  expect(await titles(page)).toEqual(['Feedback 99']);
  // sorgente che risponde spazzatura
  await page.evaluate(() => { window.__mgTest.setLiveSources({ listVersions: async () => null, getMany: async () => null }); });
  const r = await page.evaluate(() => window.__mgTest.pollNow().then((x) => x, (e) => ({ err: e.message })));
  console.log('NULL_SOURCE', JSON.stringify(r), await titles(page));
});

test('6. da zero (setData vuoto) un nuovo feedback arriva da solo, in Ricevuti', async ({ openTab }) => {
  const page = await openTab(URL);
  await boot(page);
  await seed(page, [], 'inbox');
  await expect(page.locator('#mgListEmpty')).toBeVisible();
  const nuovo = mk(5, { status: undefined, statusPublic: undefined, notes: undefined, pipeline: { action: 'block_attack', l1Category: 'dangerous', l2Class: 'attack', stage: 'L2', verdicts: [], filoSummary: 'x', decidedAt: '2026-06-22T10:01:00Z' } });
  await useSources(page, [{ _id: 'vv-5', _updateTime: nuovo._updateTime }], [nuovo]);
  await page.evaluate(() => window.__mgTest.pollNow());
  expect(await titles(page)).toEqual(['Feedback 5']);
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (1)');
});
