// Spec Playwright per la ricerca "a senso" (semantica) della dashboard di
// gestione (filo://manage/).
//
// Assert di COMPORTAMENTO (asserisce il SUCCESSO della feature, non l'assenza di
// un errore — vedi CLAUDE.md):
//   - la lente c'è nella barra delle schede e apre il campo di ricerca;
//   - con il modello stubbato, una ricerca mostra i feedback ORDINATI per
//     pertinenza, presi da QUALUNQUE scheda (inbox/risolti/archiviati), e il
//     click su un risultato apre la conversazione giusta;
//   - se il modello NON è disponibile, la ricerca RIPIEGA sulle parole e trova
//     comunque il feedback, dichiarandolo ("mostro i risultati per testo");
//   - la "x" e il tasto Esc chiudono la ricerca e riportano alla lista.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

// Feedback finti su schede diverse: provano che la ricerca è trasversale.
const FBS = [
  {
    _id: 'fb-sezioni', name: 'Dividi le sezioni per owner',
    text: 'Vorrei raggruppare le sezioni dell\'owner in un\'unica icona con le sotto voci.',
    seq: 300, subSeq: 0, status: 'archived',            // sta negli Archiviati
    clientId: 'tester@example.com', createdAt: '2026-06-01T10:00:00Z', images: [],
  },
  {
    _id: 'fb-audio', name: 'Schede con audio',
    text: 'Migliorare la visualizzazione delle schede che stanno riproducendo audio.',
    seq: 301, subSeq: 0, status: 'done',                // sta nei Risolti
    clientId: 'tester@example.com', createdAt: '2026-06-02T10:00:00Z', images: [],
  },
  {
    _id: 'fb-x', name: 'Pulsante X rotto',
    text: 'Il tasto di chiusura non fa nulla quando lo premo.',
    seq: 302, subSeq: 0, status: 'new',                 // sta nei Ricevuti
    clientId: 'tester@example.com', createdAt: '2026-06-03T10:00:00Z', images: [],
  },
];

test('la lente esiste nella barra delle schede e apre il campo di ricerca', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest);

  const toggle = page.locator('#mgSearchToggle');
  await expect(toggle).toBeVisible();
  // Icona lente iniettata (SVG nel tema, non un glifo emoji).
  await expect(toggle.locator('svg')).toHaveCount(1);

  // La barra parte nascosta; il click la apre e mette a fuoco il campo.
  await expect(page.locator('#mgSearchBar')).toBeHidden();
  await toggle.click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  await expect(page.locator('#mgSearchInput')).toBeFocused();
});

test('ricerca semantica: risultati ordinati per pertinenza da QUALUNQUE scheda; il click apre il dettaglio', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_SEARCH && window.filo);

  // Stub del modello: cattura la richiesta e torna una classifica JSON. Mette
  // "fb-sezioni" PRIMA di "fb-x" per provare che rispettiamo l'ordine del modello.
  await page.evaluate(() => {
    window.__ai = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'ai_request') {
        window.__ai.push(msg);
        return { ok: true, text: JSON.stringify([
          { id: 'fb-sezioni', reason: 'parla di raggruppare le sezioni dell\'owner' },
          { id: 'fb-x', reason: 'riferimento debole' },
        ]) };
      }
      return orig(msg);
    };
  });

  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); }, FBS);

  // Apri la ricerca e cerca "a senso" (parole diverse da quelle del feedback).
  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('quando chiedevo di unire le voci in una sola icona');
  await page.locator('#mgSearchInput').press('Enter');

  // Il modello è stato interrogato con la funzione PROPRIA della ricerca fra i
  // feedback (prima prendeva in prestito quella di «Categorizza», quindi non
  // aveva un modello impostabile per conto suo) e con messaggi custom.
  await expect.poll(() => page.evaluate(() => window.__ai.length)).toBe(1);
  const sent = await page.evaluate(() => window.__ai[0]);
  expect(sent.action).toBe('manage_search');
  expect(Array.isArray(sent.payload.messages)).toBe(true);

  // Due risultati, nell'ORDINE dato dal modello: fb-sezioni prima di fb-x.
  await expect(page.locator('.mg-item')).toHaveCount(2);
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.mg-item')).map((el) => el.dataset.id));
  expect(order).toEqual(['fb-sezioni', 'fb-x']);

  // Il primo risultato è un feedback ARCHIVIATO: la ricerca è trasversale alle
  // schede (siamo partiti dai Ricevuti). Il "perché" è nel tooltip.
  const firstTitle = await page.locator('.mg-item').first().getAttribute('title');
  expect(firstTitle).toContain('raggruppare le sezioni');

  // Click sul primo risultato → apre la conversazione GIUSTA (fb-sezioni).
  await page.locator('.mg-item').first().click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgThread')).toContainText('raggruppare le sezioni');
});

test('ripiego per parole quando il modello non è disponibile: trova comunque il feedback e lo dichiara', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_SEARCH && window.filo);

  // Stub: il modello FALLISCE (nessuna chiave / errore) → ok:false.
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'ai_request') return { ok: false, error: 'no_api_key' };
      return orig(msg);
    };
  });

  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); }, FBS);

  await page.locator('#mgSearchToggle').click();
  // Parola contenuta letteralmente nel feedback dei Risolti: il ripiego per
  // parole deve pescarlo pur essendo su un'altra scheda.
  await page.locator('#mgSearchInput').fill('audio schede');
  await page.locator('#mgSearchInput').press('Enter');

  // Il ripiego trova fb-audio e la UI lo dichiara.
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item').first()).toHaveAttribute('data-id', 'fb-audio');
  await expect(page.locator('#mgSearchMsg')).toContainText('per testo');
});

test('la "x" e il tasto Esc chiudono la ricerca e riportano alla lista della scheda', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);

  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); window.__mgTest.setTab('inbox'); }, FBS);

  // Nei Ricevuti c'è il feedback "new" (fb-x): un elemento in lista.
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item').first()).toHaveAttribute('data-id', 'fb-x');

  // Apri ricerca → chiudi con la "x": torna la lista dei Ricevuti.
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  await page.locator('#mgSearchClose').click();
  await expect(page.locator('#mgSearchBar')).toBeHidden();
  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti (1)');
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item').first()).toHaveAttribute('data-id', 'fb-x');

  // Riapri e chiudi con Esc (focus nel campo).
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  await page.locator('#mgSearchInput').press('Escape');
  await expect(page.locator('#mgSearchBar')).toBeHidden();
  await expect(page.locator('.mg-item')).toHaveCount(1);
});
