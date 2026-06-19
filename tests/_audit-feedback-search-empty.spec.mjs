// AUDIT (routine cloud) — riproduce un bug, non lo corregge.
//
// Bug: nella dashboard feedback, se scrivi nella casella "Cerca" un testo che
// non corrisponde a nessun feedback, l'area lista mostra il messaggio di tab
// vuota ("Nessun feedback in arrivo.") invece di "nessun risultato per la
// ricerca". È fuorviante: sembra che la tab sia vuota, quando in realtà ci
// sono feedback, solo nessuno che matcha la ricerca.
//
// Stesso pattern già segnalato per Archivio/Cronologia e "Aperti per dopo",
// ma su una pagina diversa (dashboard feedback dell'admin): qui lo confermo
// con dati iniettati (niente Firestore live) e screenshot.

import { test, expect } from './fixtures/electron.mjs';

const FAKE = [
  { _id: 'a', text: 'primo feedback', name: 'uno', status: 'new', priority: 1, createdAt: '2026-06-12T10:00:00Z' },
  { _id: 'b', text: 'secondo feedback', name: 'due', status: 'new', priority: 1, createdAt: '2026-06-12T11:00:00Z' },
];

test('AUDIT: ricerca senza risultati mostra messaggio fuorviante di tab vuota', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined');
  await page.evaluate((items) => { SN_FEEDBACK.list = async () => items; }, FAKE);
  await page.click('#refresh');

  // Ci sono 2 feedback nella tab "Ricevuti".
  await expect(page.locator('.fb-card')).toHaveCount(2);

  // Cerco una stringa che non matcha nulla.
  await page.fill('#search', 'zzzqqq-nessun-match');
  await expect(page.locator('.fb-card')).toHaveCount(0);

  const empty = page.locator('#empty');
  await expect(empty).toBeVisible();
  const txt = (await empty.textContent()) || '';
  await page.screenshot({ path: 'tests/.shots/audit-feedback-search-empty.png' }).catch(() => {});

  // BUG ATTUALE: mostra "Nessun feedback in arrivo." (messaggio di tab vuota),
  // non un messaggio che spiega che la ricerca non ha prodotto risultati.
  // Questo assert DOCUMENTA il bug (passa con il bug presente). Quando il bug
  // sarà corretto, andrà aggiornato per attendersi il messaggio "no results".
  expect(txt).toContain('Nessun feedback in arrivo');
});
