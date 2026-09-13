// Verifica #592, giro 6 — la quarta cautela, quella che alle lezioni manca.
//
// Il feedback chiede quattro cose per un testo libero che finisce nel prompt:
// un livello di rischio con la conferma, un tetto con rifiuto spiegato, un
// recinto prima della riga anti-inganno, e che resti «sempre visibile e
// cancellabile». Le prime tre, per le lezioni che Filo si appunta, ci sono.
//
// La quarta si prova qui: l'utente ha dove rileggere quello che Filo si è
// scritto su di lui, e dove toglierne una riga sola. Il codice dà la
// visibilità per scontata — è la ragione scritta per cui una lezione non
// chiede nessuna conferma — quindi va provata, non creduta.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINE = [
  'filo://preferences/preferences.html',
  'filo://options/options.html',
  'filo://history/history.html',
  'filo://transparency/transparency.html',
];

test('una lezione che Filo si appunta deve potersi rileggere da qualche parte', async ({ app, openTab }) => {
  // Filo si appunta la lezione, come fa da sé a fine conversazione.
  const esito = await app.evaluate(async () => globalThis.SN_EXECUTE_FILO_ACTION({
    type: 'SALVA_LEZIONE', testo: 'Zolfanello turchino: non parlare mai di caffe',
  }));
  expect(esito.executed).toBe(true);

  // Da adesso vale in ogni conversazione: è in memoria.
  const buffer = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.getLessonsBuffer());
  expect(buffer.some((l) => String(l.text || '').includes('Zolfanello'))).toBe(true);

  // L'utente va a cercarla dove la cercherebbe.
  const trovata = [];
  for (const url of PAGINE) {
    const page = await openTab(url);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(700);
    const testo = await page.evaluate(() => document.body.innerText || '');
    if (testo.includes('Zolfanello')) trovata.push(url);
  }

  expect(trovata, 'nessuna pagina di Filo mostra le lezioni che si è appuntato').not.toHaveLength(0);
});
