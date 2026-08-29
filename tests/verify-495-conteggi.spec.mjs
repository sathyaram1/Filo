// Verifica #495 — «puoi mostrare quanti feedback ci sono in ogni sezione?
// es: ricevuti (24) in coda (12)» su filo://manage/manage.html.
//
// Riproduzione BLACK-BOX del sintomo: si popolano le quattro sezioni-lista con
// un numero NOTO e DIVERSO di feedback ciascuna, poi si guarda la barra delle
// sezioni. Il successo dal punto di vista dell'utente è UNO: leggere quanti
// feedback ci sono in ogni sezione senza aprirla.
//
// Senza la feature questo spec è ROSSO (le etichette restano "Ricevuti",
// "In coda", … senza numero).

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';

// 3 Ricevuti, 2 In coda, 4 Risolti, 1 Archiviato — numeri tutti diversi fra
// loro, così un conteggio sbagliato non può somigliare a quello giusto.
const ATTESI = { inbox: 3, queue: 2, resolved: 4, archived: 1 };

function fb(id, status, i) {
  return {
    _id: `${id}-${i}`,
    text: `Feedback finto ${id} ${i}`,
    name: `Finto ${id} ${i}`,
    seq: 1000 + i,
    subSeq: 0,
    clientId: `tester${i}@example.com`,
    createdAt: `2026-06-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
    images: [],
    status,
  };
}

const DATI = [
  ...Array.from({ length: ATTESI.inbox }, (_, i) => fb('inbox', 'unlabeled', i)),
  ...Array.from({ length: ATTESI.queue }, (_, i) => fb('queue', 'todo', i)),
  ...Array.from({ length: ATTESI.resolved }, (_, i) => fb('resolved', 'done', i)),
  ...Array.from({ length: ATTESI.archived }, (_, i) => fb('archived', 'archived', i)),
];

async function preparaPagina(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((d) => window.__mgTest.setData(d), DATI);
  return page;
}

test('#495 — ogni sezione mostra quanti feedback contiene', async ({ openTab }) => {
  const page = await preparaPagina(openTab);

  // Traccia visiva: la barra delle sezioni come la vede l'owner.
  try { mkdirSync('tests/.shots', { recursive: true }); } catch (_) {}
  await page.locator('#mgTabs').screenshot({ path: 'tests/.shots/495-barra-sezioni.png' });
  await page.screenshot({ path: 'tests/.shots/495-manage-intera.png' });

  const etichette = await page.locator('.mg-tab').allTextContents();
  console.log('ETICHETTE SEZIONI:', JSON.stringify(etichette));

  // Il successo per l'utente: il numero di ciascuna sezione è LEGGIBILE
  // nella barra, senza aprire la sezione.
  for (const [tab, n] of Object.entries(ATTESI)) {
    const testo = await page.locator(`.mg-tab[data-tab="${tab}"]`).textContent();
    expect(testo, `la sezione "${tab}" non mostra il suo conteggio (${n}); si legge: "${testo}"`)
      .toMatch(new RegExp(`\\b${n}\\b`));
  }
});

test('#495 — il conteggio segue i dati quando cambiano', async ({ openTab }) => {
  const page = await preparaPagina(openTab);

  // Stato vuoto: nessun feedback da nessuna parte.
  await page.evaluate(() => window.__mgTest.setData([]));
  const vuote = await page.locator('.mg-tab').allTextContents();
  console.log('ETICHETTE A VUOTO:', JSON.stringify(vuote));

  // Poi un solo feedback nei Ricevuti: la sezione deve dire 1.
  await page.evaluate((d) => window.__mgTest.setData(d), [DATI[0]]);
  const inbox = await page.locator('.mg-tab[data-tab="inbox"]').textContent();
  expect(inbox, `dopo aver lasciato un solo Ricevuto la sezione dice: "${inbox}"`)
    .toMatch(/\b1\b/);
});
