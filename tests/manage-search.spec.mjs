// Spec Playwright per la ricerca semantica dei feedback nella dashboard di
// gestione (filo://manage/) — feedback #378.
//
// Assert di COMPORTAMENTO (asserisce il SUCCESSO, non l'assenza di errore):
//   - l'icona a lente apre un campo di ricerca;
//   - lanciando una query, la lista mostra i feedback che il main ha ordinato
//     per pertinenza, NELL'ORDINE restituito e limitati ai pertinenti (di
//     qualunque tab), e cliccarne uno apre il dettaglio giusto;
//   - se il main non può fare la ricerca semantica (results:null), la pagina
//     ripiega sul filtro per sottostringa e trova comunque il feedback;
//   - la «×» azzera la ricerca e torna alla lista della tab.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

// Tre feedback finti di temi diversi, di tab diverse (uno risolto).
const FBS = [
  { _id: 's-colore', text: 'Vorrei cambiare il colore delle schede.', name: 'Colore schede',
    seq: 10, subSeq: 0, clientId: 'tester@example.com', createdAt: '2026-05-01T10:00:00Z', images: [] },
  { _id: 's-audio', text: 'La lettura ad alta voce non parte.', name: 'Audio rotto',
    seq: 11, subSeq: 0, clientId: 'tester@example.com', createdAt: '2026-05-02T10:00:00Z', images: [] },
  { _id: 's-sezioni', text: "dividere le sezioni per l'owner riorganizzandole in un'unica icona con le sotto voci",
    name: 'Riorganizza sezioni', seq: 12, subSeq: 0, clientId: 'tester@example.com',
    status: 'done', createdAt: '2026-05-03T10:00:00Z', images: [] },
];

test('la lente apre il campo di ricerca dei feedback', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest);

  await expect(page.locator('#mgSearchBar')).toBeHidden();
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  await expect(page.locator('#mgSearchInput')).toBeFocused();
});

test('la ricerca semantica mostra i feedback ordinati per pertinenza dal main', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);

  // Stub del canale: la ricerca semantica torna SOLO i due pertinenti, nell'ordine
  // deciso dal "modello" (prima sezioni, poi colore), scartando l'audio. Così il
  // test prova che la UI usa l'ordine RESTITUITO, non l'ordine naturale della lista.
  await page.evaluate((fbs) => {
    window.__mgTest.setData(fbs);
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_search') {
        window.__lastSearch = msg; // per ispezionare la query/catalogo
        return { ok: true, results: [
          { id: 's-sezioni', why: 'riorganizzazione sezioni owner' },
          { id: 's-colore', why: 'personalizzazione interfaccia' },
        ] };
      }
      return orig(msg);
    };
  }, FBS);

  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('dove chiedevo di raggruppare le sezioni in una sola icona');
  await page.locator('#mgSearchBtn').click();

  // La lista passa in modalità risultati e mostra i due pertinenti, in ordine.
  await expect(page.locator('#mgListHead')).toHaveText('Risultati');
  await expect(page.locator('.mg-item')).toHaveCount(2);
  const order = await page.evaluate(() => window.__mgTest.currentOrder());
  expect(order).toEqual(['s-sezioni', 's-colore']);
  await expect(page.locator('#mgSearchNote')).toContainText('pertinenza');

  // Il catalogo mandato al main contiene i feedback (id + testo) da ordinare.
  const sent = await page.evaluate(() => window.__lastSearch);
  expect(Array.isArray(sent.items)).toBe(true);
  expect(sent.items.length).toBe(3);
  expect(sent.query).toContain('sezioni');

  // Cliccare un risultato apre il dettaglio giusto.
  await page.locator('.mg-item[data-id="s-sezioni"]').click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgThread')).toContainText("dividere le sezioni");
});

test('senza ricerca semantica (results:null) ripiega sul filtro per testo', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);

  await page.evaluate((fbs) => {
    window.__mgTest.setData(fbs);
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_search') return { ok: true, results: null };
      return orig(msg);
    };
  }, FBS);

  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('colore');
  await page.locator('#mgSearchBtn').click();

  // Ripiego per sottostringa: trova il feedback col "colore" nel testo/titolo.
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item[data-id="s-colore"]')).toBeVisible();
  await expect(page.locator('#mgSearchNote')).toContainText('per testo');
});

test('la «×» azzera la ricerca e torna alla lista della tab', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);

  await page.evaluate((fbs) => {
    window.__mgTest.setData(fbs);
    window.__mgTest.setTab('inbox');
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_search') return { ok: true, results: [{ id: 's-colore', why: 'x' }] };
      return orig(msg);
    };
  }, FBS);

  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('colore');
  await page.locator('#mgSearchBtn').click();
  await expect(page.locator('#mgListHead')).toHaveText('Risultati');

  await page.locator('#mgSearchClear').click();
  // Torna alla tab Ricevuti (i due feedback non-risolti: colore + audio).
  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti');
  await expect(page.evaluate(() => window.__mgTest.isSearchActive())).resolves.toBe(false);
});
