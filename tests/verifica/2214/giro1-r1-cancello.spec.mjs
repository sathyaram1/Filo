// Verifica #2214 giro 1: dopo un rilascio, un ramo il cui solo rosso sulla fusione sono righe di novità nel blocco
// della versione appena uscita, che spostate in cima rendono gli unit verdi, non deve tornare in correzione al cancello.
import { test, expect } from '@playwright/test';
import { conNovita } from '../../../scripts/lib/unit-sulla-fusione.mjs';
import { campoEsito, codiceUscita } from '../../../scripts/unit-fusione-azione.mjs';

const RAMO = 'a'.repeat(40);
const MAIN = 'b'.repeat(40);
const NOVITA = { verso: '0.2.267', righe: [{ version: '0.2.266', chiave: 'features', riga: 'Schede dalla chat' }] };

test('r1 solo righe di novità sotto la versione uscita, verdi una volta spostate: il cancello non manda in correzione', () => {
  // Gli unit sulla fusione girati con le righe già spostate in cima sono verdi: è il caso della segnalazione (#1686).
  const prova = conNovita({ esito: 'verde', mainSha: MAIN }, NOVITA);
  const campo = campoEsito({ ramo: RAMO, main: MAIN, prova });
  expect(campo.esito, JSON.stringify(campo)).not.toBe('rosso_sulla_fusione');
  expect(codiceUscita(campo), 'la corsa dice al server che il ramo si fonde').toBe(0);
});

test('r1 rosso anche su main da solo, e verde quanto main una volta spostate: si fonde come senza righe di novità', () => {
  const prova = conNovita({ esito: 'rosso_anche_su_main', mainSha: MAIN, rossiMain: 2 }, NOVITA);
  const campo = campoEsito({ ramo: RAMO, main: MAIN, prova });
  expect(codiceUscita(campo), JSON.stringify(campo)).toBe(0);
});
