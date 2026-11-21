// #2638 giro 1 — la richiesta corta («sono arrivato, password del wifi») non deve leggere come richiesta una frase che
// la password la nomina e basta: «password dimenticata» in chat, o l'etichetta «Password» di una pagina di accesso.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
require('../../../src/shared/novita.js');
require('../../../src/shared/riservatiNelTesto.js');
require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');
const P = globalThis.SN_PAVIMENTO;
const risposta = (campo, sopra) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra }).nuovo;

test('r1 un aggettivo che comincia come «di», «de», «per» dopo la password non è una richiesta', () => {
  for (const [sopra, campo] of [
    ['Marco: password dimenticata', 'nessun problema te la rimando stasera'],
    ['Marco: sono arrivato, password diversa', 'strano controlla meglio'],
    ['Marco: password persa', 'nessun problema domani'],
    ['Marco: password perfetta', 'grazie mille davvero'],
  ]) expect(risposta(campo, sopra), sopra).toBe(campo);
});

test('r2 l\'etichetta «Password» di una pagina non toglie al modello le righe sotto', () => {
  for (const p of [
    'Sicurezza\nPassword\nUltima modifica il 12/03/2024\nVerifica in due passaggi',
    'Impostazioni router\nPassword del wifi\nModello AX1800-Pro, firmware 3.2.1',
    'Accedi\nEmail\nPassword\nProblemi? Chiama il 800-123-456',
  ]) expect(P.oscura(p), p).toBe(p);
  expect(R.oscura('Sicurezza\nPassword\nUltima modifica tre mesi fa')).toBe('Sicurezza\nPassword\nUltima modifica tre mesi fa');
});

test('la richiesta del feedback resta riconosciuta', () => {
  expect(risposta('gattonero', 'Marco: sono arrivato, password del wifi')).toBe('[dato riservato]');
  expect(risposta('certo, gattonero', 'Marco: pw di casa')).toBe('certo, [dato riservato]');
  expect(P.oscura('Marco: sono arrivato, password del wifi\nIo: Gatto2024')).not.toContain('Gatto2024');
});
