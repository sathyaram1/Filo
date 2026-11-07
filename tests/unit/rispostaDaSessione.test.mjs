// #2007 (SPEC-DOMANDE §3.6): una risposta che una sessione locale registra dalla chat vale come dell'owner, col segno.
// La regola sta in SN_DOMANDE.mittenteRisposta; domanda.mjs mostra la stampa così al compito «Gestisci la risposta».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { formattaDomanda } from '../../scripts/domanda.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const D = globalThis.SN_DOMANDE;

const SESSIONE = { tipo: 'biglietto', ruolo: 'sessione', fiducia: 'non_fidato' };

test('mittenteRisposta: owner da qui, sessione dalla chat, nessuno per gli altri', () => {
  assert.equal(D.mittenteRisposta({ autore: { tipo: 'owner' }, tipo: 'risposta' }), 'owner');
  assert.equal(D.mittenteRisposta({ autore: SESSIONE, tipo: 'risposta', testo: 'Sì, caldo' }), 'sessione');
  assert.equal(D.mittenteRisposta({ autore: { tipo: 'biglietto', ruolo: 'x' }, tipo: 'risposta', registrataDa: 'sessione' }), 'sessione');
  // Solo la risposta: un chiarimento o una nota di un biglietto di sessione restano parole d'agente.
  assert.equal(D.mittenteRisposta({ autore: SESSIONE, tipo: 'chiarimento' }), '');
  assert.equal(D.mittenteRisposta({ autore: { tipo: 'biglietto', ruolo: 'risposta' }, tipo: 'risposta' }), '');
  assert.equal(D.mittenteRisposta({ autore: { tipo: 'biglietto', ruolo: 'resolver' }, tipo: 'risposta' }), '');
  assert.equal(D.mittenteRisposta({ autore: { tipo: 'server' }, tipo: 'risposta' }), '');
  for (const x of [null, undefined, 'owner', 3, {}, { tipo: 'risposta' }]) assert.equal(D.mittenteRisposta(x), '');
});

test('domanda.mjs mostra: la risposta di una sessione arriva al compito come dell\'owner, col segno e la fiducia', () => {
  const testo = formattaDomanda({
    id: 'D-250', stato: 'in_lavorazione', titolo: 't',
    conversazione: [
      { autore: SESSIONE, tipo: 'risposta', testo: 'Va bene la seconda, come detto in chat.', ora: 1 },
      { autore: { tipo: 'biglietto', ruolo: 'risposta', fiducia: 'non_fidato' }, tipo: 'chiarimento', testo: 'Quale?', ora: 2 },
    ],
  }, {}, { quando: () => 'ora' });
  assert.match(testo, /ora owner, registrata da una sessione \(non fidata\) · risposta/);
  assert.match(testo, /ora biglietto risposta \(non fidata\) · chiarimento/);
});

test('il ruolo del compito tiene la regola: la risposta di una sessione non chiede conferma all\'owner', () => {
  const ruolo = readFileSync(join(ROOT, 'routines', 'roles', 'risposta.md'), 'utf8');
  assert.match(ruolo, /registrata da una sessione/);
  assert.match(ruolo, /non chiedergli di confermarla/);
});
