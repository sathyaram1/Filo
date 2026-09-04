// Spec Playwright: la dashboard di gestione (filo://manage/) si aggiorna DA
// SOLA, senza ricaricare la pagina.
//
// Asserisce il SUCCESSO dal punto di vista dell'owner (rosso senza la feature):
//   - un feedback riscritto su Firestore cambia titolo in lista e nel pannello
//     aperto, senza ricaricare;
//   - un feedback nuovo compare in lista;
//   - un feedback sparito dalla pagina esce dalla lista;
//   - la selezione resta sulla scheda aperta.
// Firestore è sostituito da sorgenti finte (setLiveSources): lo spec verifica
// il cammino versioni → differenze → rilettura → fusione → ridisegno, che è
// tutto in pagina. La rete vera è provata dagli unit test di feedback.js.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fakeFb(id, name, text, extra = {}) {
  return {
    _id: id,
    _updateTime: 't1',
    text,
    name,
    seq: extra.seq || 1,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: extra.createdAt || '2026-09-01T10:00:00Z',
    images: [],
    pipeline: {
      action: 'block_attack',
      l1Category: 'dangerous',
      l2Class: 'attack',
      stage: 'L2',
      verdicts: [
        { judge: 'A', class: 'attack', reasoning: 'Tentativo di aggirare i filtri.' },
        { judge: 'B', class: 'attack', reasoning: 'Prompt injection.' },
      ],
      filoSummary: 'Contiene un tentativo di attacco.',
      decidedAt: '2026-09-01T10:01:00Z',
    },
    ...extra,
  };
}

test('la lista e il pannello si aggiornano da soli quando Firestore cambia', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());

  const A = fakeFb('live-a', 'Titolo vecchio', 'Testo vecchio del feedback A.', { seq: 11 });
  await page.evaluate((fb) => { window.__mgTest.setData([fb]); window.__mgTest.setTab('inbox'); }, A);
  await expect(page.locator('.mg-item-title')).toHaveText(['Titolo vecchio']);

  // Apro la scheda A: il pannello mostra il testo vecchio.
  await page.locator('.mg-item[data-id="live-a"]').click();
  await expect(page.locator('#mgDetail')).toContainText('Testo vecchio');

  // Firestore finto: A è stato riscritto (t2) e c'è un B nuovo, più recente.
  const A2 = fakeFb('live-a', 'Titolo nuovo', 'Testo NUOVO del feedback A.', { seq: 11, _updateTime: 't2' });
  const B = fakeFb('live-b', 'Nuovo arrivato', 'Testo del feedback B.', { seq: 12, createdAt: '2026-09-02T10:00:00Z' });
  await page.evaluate(({ A2, B }) => {
    window.__liveState = { versions: [{ _id: 'live-b', _updateTime: 't1' }, { _id: 'live-a', _updateTime: 't2' }], docs: { 'live-a': A2, 'live-b': B } };
    window.__mgTest.setLiveSources({
      listVersions: async () => window.__liveState.versions,
      getMany: async (ids) => ids.map((id) => window.__liveState.docs[id]).filter(Boolean),
    });
  }, { A2, B });

  const r1 = await page.evaluate(() => window.__mgTest.pollNow());
  expect(r1.changed).toBe(2);

  // Lista: B in cima (più recente), A col titolo nuovo. Nessun reload.
  await expect(page.locator('.mg-item-title')).toHaveText(['Nuovo arrivato', 'Titolo nuovo']);
  // La selezione è rimasta su A e il pannello mostra il testo nuovo.
  await expect(page.locator('.mg-item--selected')).toHaveAttribute('data-id', 'live-a');
  await expect(page.locator('#mgDetail')).toContainText('Testo NUOVO');
  await expect(page.locator('#mgDetail')).not.toContainText('Testo vecchio');

  // Secondo giro: B non è più in pagina → esce dalla lista; A invariato.
  await page.evaluate(() => { window.__liveState.versions = [{ _id: 'live-a', _updateTime: 't2' }]; });
  const r2 = await page.evaluate(() => window.__mgTest.pollNow());
  expect(r2.changed).toBe(1);
  await expect(page.locator('.mg-item-title')).toHaveText(['Titolo nuovo']);

  // Terzo giro: niente di nuovo → nessun documento riletto.
  const r3 = await page.evaluate(() => window.__mgTest.pollNow());
  expect(r3.changed).toBe(0);
});

test('mentre l\'owner scrive nel pannello, il pannello non si ridisegna (i dati sì)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());

  const A = fakeFb('live-a', 'Titolo vecchio', 'Testo vecchio.', { seq: 11 });
  // Da admin: è l'owner che scrive nel pannello, e la casella del commento c'è solo per lui.
  await page.evaluate((fb) => { window.__mgTest.setAdmin(true); window.__mgTest.setData([fb]); window.__mgTest.setTab('inbox'); }, A);
  await page.locator('.mg-item[data-id="live-a"]').click();
  await expect(page.locator('#mgDetail')).toContainText('Testo vecchio');

  // Metto il cursore in una casella di testo del pannello e ci scrivo.
  const box = page.locator('#mgDetail textarea:visible').first();
  await box.click();
  await box.fill('sto scrivendo…');

  const A2 = fakeFb('live-a', 'Titolo nuovo', 'Testo NUOVO.', { seq: 11, _updateTime: 't2' });
  await page.evaluate((A2) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: 'live-a', _updateTime: 't2' }],
      getMany: async () => [A2],
    });
  }, A2);
  await page.evaluate(() => window.__mgTest.pollNow());

  // La lista è aggiornata, il pannello no (e il testo scritto è ancora lì).
  await expect(page.locator('.mg-item-title')).toHaveText(['Titolo nuovo']);
  await expect(page.locator('#mgDetail')).toContainText('Testo vecchio');
  await expect(box).toHaveValue('sto scrivendo…');

  // Riaprendo la scheda, il pannello mostra il nuovo.
  await page.locator('.mg-item[data-id="live-a"]').click();
  await expect(page.locator('#mgDetail')).toContainText('Testo NUOVO');
});
