// Verifica #517 — giro 9, la parte deterministica del presidio.
//
// Tre porte, tutte sulla stessa domanda dei giri prima — cosa vale come prova
// che una cosa è stata fatta — richiusa ogni volta su una forma sola:
//
//   1. IL TESTO CONSEGNATO DENTRO LA RISPOSTA, raccontato col pronome. Il
//      giro 3 ha stabilito che quando Filo consegna un testo nella risposta
//      non c'è nessuno strumento che possa averlo scritto, e ha messo fra le
//      frasi che non si smentiscono quelle che nominano la FORMA del testo
//      («te l'ho messa in ordine», «te l'ho aggiunta alla lista», «più
//      breve»). Le stesse identiche consegne dette con le altre parole di
//      tutti i giorni — «te l'ho tolta», «te l'ho messa al plurale», «te
//      l'ho messa in inglese», «te l'ho spostata in cima» — restano
//      un'accusa: la risposta già comparsa viene cancellata, rifatta con una
//      seconda chiamata al modello e poi smentita.
//   2. LE CONFERME CORTE, quelle senza «ho», che il giro 7 ha aggiunto
//      apposta perché sono il modo più breve di confermare. Basta una
//      qualunque azione della stessa specie fatta PRIMA nella conversazione
//      perché tacciano, anche quando la frase racconta una cosa appena
//      fatta. Il giro 6 ha chiuso questa porta per la forma con «ho»,
//      pretendendo che la frase guardi indietro; la forma corta quel
//      controllo non lo fa affatto.
//   3. IL TITOLO DI UN APPUNTO CHE ESISTE. Il giro 3 lo ha messo fra le
//      prove, e da allora qualunque frase che contenga quel titolo non viene
//      più guardata. I titoli sono quelli dei file dell'editor: uno che si
//      chiami «lista» o «spesa» zittisce ogni appunto raccontato dopo.
//
// I test sono scritti per essere ROSSI finché le porte sono aperte.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const RADICE = path.resolve(QUI, '..', '..', '..');

const sorgente = fs.readFileSync(path.join(RADICE, 'src/shared/azioniDichiarate.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function('globalThis', sorgente)(globalThis);
const D = globalThis.SN_AZIONI_DICHIARATE;

const STATO = (o = {}) => ({ orariSveglie: [], titoliAppunti: [], contiAzioni: {}, ...o });
// Lo stato come lo costruiscono le due chat quando l'utente ha scritto QUESTO.
const DOPO = (messaggio, o = {}) => STATO({
  domandaUtente: D.domandaSuCosaFatta(messaggio),
  richiestaAzione: D.richiestaDiAzione(messaggio),
  ...o,
});

test('un testo consegnato dentro la risposta non diventa «non è partito niente»', () => {
  // Le consegne che il giro 3 ha già chiuso: restano chiuse.
  expect(D.rileva('Te l\'ho messa in ordine alfabetico.', new Set(), STATO()).length).toBe(0);
  expect(D.rileva('Te l\'ho scritta qui sotto.', new Set(), STATO()).length).toBe(0);

  // Quello che l'utente aveva chiesto: sistemare un testo, non fare una cosa
  // che passa da uno strumento.
  const sulTesto = DOPO('nella frase «il gatto grigio dorme sul divano» togli la parola grigio');

  // Le stesse consegne dette con le parole di tutti i giorni. Sono le
  // risposte normali a «togli quella parola», «mettila al plurale»,
  // «traducimela», «spostala in cima»: il testo è nella risposta e si legge.
  const consegne = [
    'Ecco la frase senza quella parola:\n\nIl gatto dorme sul divano.\n\nTe l\'ho tolta.',
    'Ecco la frase al plurale:\n\nI gatti dormono.\n\nTe l\'ho messa al plurale.',
    'Ecco il testo tradotto:\n\nThe cat sleeps.\n\nTe l\'ho messa in inglese.',
    'Ecco il testo con la data in cima:\n\n12 marzo — Il gatto dorme.\n\nTe l\'ho spostata in cima.',
    'Ecco la lista completa:\n\n- pane\n- uova\n- latte\n\nLe ho aggiunte tutte.',
    'Ecco la frase con la citazione:\n\n«Il gatto dorme».\n\nTe l\'ho messa tra virgolette.',
  ];
  for (const testo of consegne) {
    expect(D.rileva(testo, new Set(), sulTesto), testo).toEqual([]);
  }

  // La controprova: una cosa che Filo può fare solo chiamando uno strumento,
  // detta con lo stesso pronome, resta una dichiarazione da verificare.
  const perLaSveglia = DOPO('mettimi la sveglia alle 19 per stasera');
  expect(D.rileva('Te l\'ho messa alle 19.', new Set(), perLaSveglia).length).toBeGreaterThan(0);
  const perIlFeedback = DOPO('manda un feedback: la barra in alto sparisce');
  expect(D.rileva('Sì, te l\'ho mandata.', new Set(), perIlFeedback).length).toBeGreaterThan(0);
  // …e una richiesta scritta come domanda resta una richiesta.
  const conDomanda = DOPO('mi segni anche la lista della spesa: pane, uova, latte?');
  expect(D.rileva('Te l\'ho segnata.', new Set(), conDomanda).length).toBeGreaterThan(0);
  // L'ora promessa vale comunque, qualunque cosa avesse chiesto l'utente.
  expect(D.rileva('Te l\'ho messa alle 19.', new Set(), sulTesto).length).toBeGreaterThan(0);
});

test('la conferma corta non viene coperta da una cosa fatta in un turno prima', () => {
  // Una cosa della stessa specie fatta prima nella conversazione, raccontata
  // adesso come appena fatta: la forma con «ho» viene vista (giro 6), la
  // forma corta deve comportarsi allo stesso modo.
  const casi = [
    ['Appunto salvato.', 'SALVA_APPUNTO'],
    ['Segnalazione inviata.', 'INVIA_FEEDBACK'],
    ['Evento aggiunto al calendario.', 'EVENTO_CALENDARIO'],
    ['Sveglia impostata.', 'SVEGLIA'],
    ['Timer avviato.', 'TIMER'],
    ['Promemoria creato.', 'SALVA_APPUNTO'],
  ];
  for (const [frase, tipo] of casi) {
    const stato = STATO({
      tipiPrecedenti: new Set([tipo]),
      contiPrecedenti: { [tipo]: 1 },
    });
    expect(D.rileva(frase, new Set(), stato).length, frase).toBeGreaterThan(0);
  }

  // Quello che deve restare vero: se la frase GUARDA INDIETRO, un'azione di
  // un turno prima la regge, come per la forma lunga.
  const indietro = STATO({
    tipiPrecedenti: new Set(['SALVA_APPUNTO']),
    contiPrecedenti: { SALVA_APPUNTO: 1 },
  });
  expect(D.rileva('Te l\'avevo già salvato l\'appunto della spesa.', new Set(), indietro).length).toBe(0);
  // …e una cosa fatta ADESSO regge la conferma corta, come prima.
  expect(D.rileva('Appunto salvato.', new Set(['SALVA_APPUNTO']), STATO()).length).toBe(0);
});

test('un appunto che esiste non zittisce un appunto diverso raccontato adesso', () => {
  // I titoli sono quelli dei file dell'editor. Uno che si chiami «lista» o
  // «spesa» compare dentro quasi ogni frase che racconta un appunto.
  const conLista = STATO({ titoliAppunti: ['lista'] });
  expect(D.rileva('Ti ho salvato l\'appunto con la lista della spesa.', new Set(), conLista).length)
    .toBeGreaterThan(0);
  const conSpesa = STATO({ titoliAppunti: ['spesa'] });
  expect(D.rileva('Ti ho salvato l\'appunto con la lista della spesa.', new Set(), conSpesa).length)
    .toBeGreaterThan(0);

  // Quello che deve restare vero: la frase che GUARDA INDIETRO a un appunto
  // che c'è davvero non è un'accusa — è la porta chiusa dal giro 3, e in
  // una chat nuova è l'unica prova disponibile.
  expect(D.rileva('Sì, te l\'avevo già salvato l\'appunto della spesa.', new Set(), conSpesa).length)
    .toBe(0);
});

test('i modi normali di dichiarare una cosa mai fatta vengono visti', () => {
  const mute = [
    'Ho avviato il blocco note.',
    'Ti ho lanciato il blocco note.',
    'Ho fatto una segnalazione agli sviluppatori.',
    'Ho riportato il problema agli sviluppatori.',
    'Ho abilitato il tema scuro.',
    'Ti ho tolto le notifiche.',
    'Ho calendarizzato la riunione.',
    'Ho messo la suoneria alle 19.',
    'Ho trascritto la lista della spesa.',
  ];
  for (const frase of mute) {
    expect(D.rileva(frase, new Set(), STATO()).length, frase).toBeGreaterThan(0);
  }
});
