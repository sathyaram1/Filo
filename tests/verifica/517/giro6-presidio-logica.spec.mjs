// Verifica #517 — giro 6, la logica del presidio, in millisecondi.
//
// Le porte di questo giro, tutte sulla stessa domanda dei giri prima — cosa
// vale come prova, e quali parole contano — richiusa ancora una forma per
// volta:
//
//   1. l'ORA scritta col punto («alle 19.30») o con la virgola («alle 19,30»)
//      non viene letta: si legge «19:00» e la sveglia delle 19:30 che esiste
//      viene smentita. Idem «alle 19 e trenta» (i minuti a parole);
//   2. nell'Aiuto lo stato non arriva mai, quindi l'ora non trova mai
//      riscontro e ogni frase con un'ora viene smentita;
//   3. la copertura presa dalla CRONOLOGIA vale per famiglia e basta: un
//      appunto, un evento, una segnalazione, un comando fatti una volta
//      coprono tutto quello che si racconta dopo;
//   4. la busta a `name`/`arguments` — il formato con cui i modelli
//      dichiarano una chiamata a funzione — non viene riconosciuta come
//      formato interno finito nel testo.
//
// I test sono scritti per essere ROSSI finché la porta è aperta.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/actionTools.js');
require('../../../src/shared/azioniDichiarate.js');
const AD = globalThis.SN_AZIONI_DICHIARATE;

const ids = (l) => l.map((f) => f.id).sort();

test('l\'ora scritta col punto è la stessa ora', () => {
  // La sveglia delle 19:30 c'è davvero.
  const stato = { orariSveglie: ['19:30'] };
  expect(AD.rileva('Ho messo la sveglia alle 19.30 per stasera.', [], stato)).toEqual([]);
  expect(AD.rileva('Ti ho messo la sveglia alle 7.30.', [], { orariSveglie: ['07:30'] })).toEqual([]);
  expect(AD.rileva('Te l\'ho messa alle 8.15.', [], { orariSveglie: ['08:15'] })).toEqual([]);
  // …e resta vera anche quando la frase finisce lì, col punto fermo attaccato.
  expect(AD.orariNelTesto('alle 19.30.')).toContain('19:30');
});

test('l\'ora con la virgola e i minuti a parole sono la stessa ora', () => {
  expect(AD.rileva('Ho messo la sveglia alle 19,30.', [], { orariSveglie: ['19:30'] })).toEqual([]);
  expect(AD.rileva('Ho messo la sveglia alle 19 e trenta.', [], { orariSveglie: ['19:30'] })).toEqual([]);
});

test('l\'ora sbagliata resta un avviso', () => {
  // La controprova: chiudendo il falso allarme il presidio deve restare acceso.
  expect(ids(AD.rileva('Ho messo la sveglia alle 19.30.', [], { orariSveglie: ['07:00'] }))).toEqual(['sveglia']);
  expect(ids(AD.rileva('Ho messo la sveglia alle 19.30.', [], { orariSveglie: [] }))).toEqual(['sveglia']);
});

test('nell\'Aiuto una sveglia messa dall\'Aiuto stesso non viene smentita', () => {
  // Il pannello Aiuto chiama il presidio con lo stato VUOTO: l'ora non trova
  // mai riscontro, quindi ogni frase con un'ora viene smentita — anche
  // quando l'azione è partita da lì un messaggio prima.
  const opt = { famiglie: AD.FAMIGLIE_AIUTO };
  expect(AD.rileva('Sì, ho messo la sveglia alle 19:00 come mi avevi chiesto.',
    new Set(['SVEGLIA']), {}, opt)).toEqual([]);
  expect(AD.rileva('Ho avviato il timer alle 19.',
    new Set(['TIMER']), {}, opt)).toEqual([]);
});

test('una cosa fatta una volta nella conversazione non copre quelle raccontate dopo', () => {
  const crono = (t) => AD.tipiDallaCronologia([{ role: 'filo', actions: [{ type: t, _executed: true }] }]);
  // Un appunto scritto prima nel thread, e adesso un SECONDO appunto solo
  // raccontato: della spesa non resta traccia da nessuna parte.
  expect(ids(AD.rileva('Ti ho salvato l\'appunto con la lista della spesa.', crono('SALVA_APPUNTO'), {})))
    .toEqual(['appunto']);
  // Stessa cosa per l'evento in calendario…
  expect(ids(AD.rileva('Ti ho aggiunto l\'evento in calendario per domani.', crono('EVENTO_CALENDARIO'), {})))
    .toEqual(['calendario']);
  // …e per la segnalazione agli sviluppatori.
  expect(ids(AD.rileva('Ho mandato la segnalazione agli sviluppatori.', crono('INVIA_FEEDBACK'), {})))
    .toEqual(['segnalazione']);
});

test('due cose della stessa specie nello stesso turno vogliono due azioni', () => {
  // Una sola SALVA_APPUNTO partita, due appunti raccontati.
  expect(ids(AD.rileva('Ti ho salvato l\'appunto della spesa e ti ho segnato anche quello del lavoro.',
    [{ type: 'SALVA_APPUNTO', _executed: true }], {}))).not.toEqual([]);
});

test('la chiamata a funzione con «name» e «arguments» è formato interno', () => {
  // È la forma con cui i modelli dichiarano una chiamata a strumento: se
  // finisce nel testo, in chat resta un blocco di codice e la sveglia non c'è.
  expect(AD.formatoSospetto('{"name":"SVEGLIA","arguments":{"time":"19:00"}}')).toBe(true);
  expect(AD.formatoSospetto('Fatto!\n{"name":"SVEGLIA","arguments":{"time":"19:00"}}')).toBe(true);
  // …ma un JSON qualunque, chiesto dall'utente, resta una risposta.
  expect(AD.formatoSospetto('{"nome":"Mario","eta":30}')).toBe(false);
});

test('qualche modo normale di dichiarare una cosa mai fatta', () => {
  // «Fissare» è IL verbo dell'appuntamento in italiano, e manca.
  expect(ids(AD.rileva('Ho fissato l\'appuntamento in calendario per domani alle 10.', [], {})))
    .toEqual(['calendario']);
  // «Inoltrare» è il verbo di chi manda avanti una segnalazione.
  expect(ids(AD.rileva('Ho inoltrato la segnalazione agli sviluppatori.', [], {})))
    .toEqual(['segnalazione']);
  // La perifrasi con l'infinito: «ho provveduto a metterti la sveglia».
  expect(AD.rileva('Ho provveduto a metterti la sveglia alle 19.', [], {})).not.toEqual([]);
  expect(AD.rileva('Sono riuscito a metterti la sveglia alle 19.', [], {})).not.toEqual([]);
  // Il calendario si nomina anche così, e «al calendario» non è fra le forme.
  expect(ids(AD.rileva('Ho aggiunto la riunione al calendario di domani.', [], {})))
    .toEqual(['calendario']);
  // Il trapassato, che è il tempo con cui si dice «l'avevo già fatto».
  expect(AD.rileva('Ti avevo messo la sveglia alle 19.', [], {})).not.toEqual([]);
  expect(AD.rileva('Te l\'avevo messa alle 19.', [], {})).not.toEqual([]);
  // Il grassetto in mezzo alla dichiarazione: i modelli scrivono in markdown.
  expect(AD.rileva('Ti ho **messo** la sveglia alle 19.', [], {})).not.toEqual([]);
  // L'apostrofo al posto dell'accento, che i modelli usano di continuo.
  expect(AD.rileva('Ti ho gia\' messo la sveglia alle 19.', [], {})).not.toEqual([]);
});
