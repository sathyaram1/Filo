// #1108 giro 5 — una copia dei feedback fatta dei soli campi nel formato di Firestore (senza name) va riconosciuta
// intera come lo è già tagliata a metà: contiene testo, user agent e identificativo.
import { test, expect } from '@playwright/test';
import { motivoCopiaTesto } from '../../../scripts/lib/copie-di-dati.mjs';

const campi = (i) => ({
  text: { stringValue: `il pulsante non va ${i}` },
  userAgent: { stringValue: 'Mozilla/5.0 (Windows NT 10.0) Filo/1.2' },
  clientId: { stringValue: `abc${i}` },
});

test('r1 elenco dei soli campi dei documenti, intero, riconosciuto come copia', () => {
  const lista = JSON.stringify([campi(1), campi(2), campi(3)], null, 2);
  expect(motivoCopiaTesto(lista.slice(0, -5))).not.toBe('');
  expect(motivoCopiaTesto(lista)).not.toBe('');
});

test('r1 mappa identificativo → campi dei documenti, intera, riconosciuta come copia', () => {
  const mappa = JSON.stringify({ id1: campi(1), id2: campi(2) }, null, 2);
  expect(motivoCopiaTesto(mappa)).not.toBe('');
});
