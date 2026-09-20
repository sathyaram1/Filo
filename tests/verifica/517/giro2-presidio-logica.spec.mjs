// Verifica #517 — giro 2, sulla sola logica di riconoscimento (niente Electron).
//
// Due porte, sempre sulla stessa causa: COSA vale come copertura di una frase
// del tipo «l'ho già fatto».
//   1. basta che nel turno ci sia UNA QUALUNQUE azione perché il presidio
//      taccia su tutto il resto: la sveglia parte e l'appunto, dichiarato
//      nella stessa frase, non viene scritto — e nessuno lo dice;
//   2. le frasi in cui Filo non fa nulla perché la cosa chiesta È la risposta
//      («te l'ho scritta qui sotto») vengono prese per azioni mancate.
//
// E due buchi di riconoscimento sul cammino della segnalazione stessa.
//
// I test sono scritti per essere ROSSI finché la porta è aperta.

import { test, expect } from '@playwright/test';

let D;
test.beforeAll(async () => {
  await import('../../../src/shared/azioniDichiarate.js');
  D = globalThis.SN_AZIONI_DICHIARATE;
});

const ids = (testo, azioni = []) => D.rileva(testo, azioni).map((f) => f.id);

test('un\'azione di un\'altra specie non copre la cosa dichiarata', async () => {
  // La sveglia è partita; l'appunto no, e nella stessa frase Filo lo dà per
  // scritto. Oggi la sveglia «regge» anche l'appunto e il presidio tace.
  expect(ids('Ti ho messo la sveglia alle 19 e ti ho salvato l\'appunto con la lista della spesa.',
    [{ type: 'SVEGLIA' }])).toContain('appunto');
});

test('quello che Filo SCRIVE nella risposta non è un\'azione mancata', async () => {
  // La cosa chiesta è il testo, e il testo è lì: non esiste nessuno strumento
  // da chiamare, quindi non c'è niente da avvisare.
  expect(ids("Te l'ho scritta qui sotto:\n\nGentile Marco, mi scuso per il ritardo.")).toEqual([]);
  expect(ids("L'ho creata qui sotto, dimmi se ti piace.")).toEqual([]);
  expect(ids("Te l'ho aggiunta alla lista qui sopra.")).toEqual([]);
  // E la stessa cosa detta su un'immagine che l'utente ha mandato in chat:
  // leggerla non passa da nessuno strumento.
  expect(ids('Ho letto la bolletta che mi hai mandato: sono 84 euro.')).toEqual([]);
});

test('le forme normali con cui si dichiara una cosa mai fatta vengono viste', async () => {
  // Spazi doppi: un modello li produce, e il presidio non deve dipendere da
  // quanti ne ha messi.
  expect(ids('Ho  messo  la  sveglia alle 19.')).toContain('sveglia');
  // «Ho messo il promemoria» è italiano normalissimo e oggi non è nell'elenco.
  expect(ids('Ho messo il promemoria per domani.')).toContain('appunto');
});
