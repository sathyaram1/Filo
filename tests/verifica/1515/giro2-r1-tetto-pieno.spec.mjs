// Verifica #1515 giro 2: il server smette di giudicare quando speso + prenotato + la stima di un giudizio supera il
// tetto, quindi la spesa si ferma sotto il tetto. Gestione deve dire «Tetto raggiunto» in quello stato, non «riparte».
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
require(resolve(ROOT, 'src/shared/campoNumero.js'));
require(resolve(ROOT, 'src/shared/spesaGiudici.js'));
const SG = globalThis.SN_SPESA_GIUDICI;

test('r1 a 1,95 $ su 2 $ (il caso della segnalazione, dove il server non chiama più i giudici) Gestione dice che il tetto è raggiunto', () => {
  const ora = Date.now();
  // Il documento del contatore come lo lascia il server dopo l'ultimo giudizio ammesso: stima di fabbrica 0,10 $.
  const doc = { giorno: SG.giorno(ora), spesoUsd: 1.95, prenotatoUsd: 0, stimaUsd: 0.10 };
  const riga = SG.rigaSpesa(SG.spesaDiOggi(doc, ora), 2, ora);
  expect(riga.pieno).toBe(true);
  expect(riga.dettaglio).toMatch(/^Tetto raggiunto\./);
});

test('r1 con la stima del giorno salita a 0,30 $, a 1,75 $ su 2 $ il tetto è già raggiunto', () => {
  const ora = Date.now();
  const doc = { giorno: SG.giorno(ora), spesoUsd: 1.75, prenotatoUsd: 0, stimaUsd: 0.30 };
  const riga = SG.rigaSpesa(SG.spesaDiOggi(doc, ora), 2, ora);
  expect(riga.pieno).toBe(true);
});
