// Dashboard "Feedback alpha": una ricerca senza risultati NON deve dire
// "Nessun feedback in arrivo." (come se il tab fosse vuoto), ma dire chiaramente
// che nessun feedback corrisponde alla ricerca. Il tab conserva il suo conteggio
// reale (es. "Ricevuti (2)") mentre il centro mostra il messaggio giusto.
//
// Dati stubbati via SN_FEEDBACK.list (niente Firestore live). Precondizione senza
// il fix: cercando una parola inesistente il messaggio centrale sarebbe stato
// "Nessun feedback in arrivo." → l'assert su "Nessun risultato" diventa rosso.

import { test, expect } from './fixtures/electron.mjs';

const FAKE = [
  {
    _id: 'a', text: 'Il pulsante di copia non funziona su Windows', name: 'copia rotta',
    seq: 10, subSeq: 0, status: 'unlabeled',
    createdAt: '2026-06-22T11:00:00Z',
  },
  {
    _id: 'b', text: 'La finestra si apre troppo piccola al primo avvio', name: 'finestra piccola',
    seq: 11, subSeq: 0, status: 'unlabeled',
    createdAt: '2026-06-22T10:30:00Z',
  },
];

test('dashboard: ricerca senza risultati dice "Nessun risultato", non "Nessun feedback"', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined');
  await page.evaluate((items) => { SN_FEEDBACK.list = async () => items; }, FAKE);
  await page.click('#refresh');

  // Siamo su "Ricevuti" con 2 feedback: il tab lo conferma.
  const inboxTab = page.locator('[data-tab="inbox"]');
  await expect(inboxTab).toHaveText(/Ricevuti \(2\)/);
  await expect(page.locator('.fb-card')).toHaveCount(2);

  const empty = page.locator('#empty');

  // Cerco una parola che non compare in nessun feedback.
  await page.fill('#search', 'zzzqqq');

  // Nessuna card, ma il messaggio deve parlare di RICERCA, non di tab vuoto.
  await expect(page.locator('.fb-card')).toHaveCount(0);
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('Nessun risultato');
  await expect(empty).toContainText('zzzqqq');
  // La regressione da evitare: il testo del tab-vuoto durante una ricerca.
  await expect(empty).not.toContainText('Nessun feedback in arrivo');
  // Il tab NON perde il suo conteggio reale: continua a dire "Ricevuti (2)".
  await expect(inboxTab).toHaveText(/Ricevuti \(2\)/);
  await page.screenshot({ path: 'tests/.shots/feedback-search-empty.png' }).catch(() => {});

  // Controprova: svuotando la ricerca tornano le 2 card e sparisce il messaggio.
  await page.fill('#search', '');
  await expect(page.locator('.fb-card')).toHaveCount(2);
  await expect(empty).toBeHidden();

  // E una ricerca CHE matcha filtra correttamente (una sola card).
  await page.fill('#search', 'finestra');
  await expect(page.locator('.fb-card')).toHaveCount(1);
  await expect(empty).toBeHidden();
});
