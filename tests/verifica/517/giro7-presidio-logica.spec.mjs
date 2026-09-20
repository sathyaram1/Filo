// Verifica #517 — giro 7, la parte deterministica del presidio.
//
// Le porte che questo giro trova, provate sulla logica pura (millisecondi):
//
//   1. L'ALTRA CHAT (il pannello Aiuto) chiama lo stesso presidio con metà
//      delle informazioni e metà delle famiglie. Tre conseguenze:
//        a. un'azione emessa una volta nel pannello copre ogni dichiarazione
//           della sua specie raccontata dopo, per sempre, senza che la frase
//           debba nemmeno guardare indietro. Nella chat della home il giro 6
//           ha chiuso esattamente questo;
//        b. la conferma col PRONOME («sì, te l'ho mandata») non viene
//           guardata affatto, mentre nella chat della home è vista dal giro 3;
//        c. i titoli degli appunti non arrivano mai, quindi un appunto che
//           esiste davvero viene smentito.
//   2. Una richiesta scritta come DOMANDA («mi segni anche la spesa?») spegne
//      il controllo sulle azioni dei turni precedenti: da lì in poi qualunque
//      cosa fatta prima nella conversazione copre quella raccontata adesso.
//   3. Due forme di chiamata a strumento lasciate scritte nel testo non
//      vengono riconosciute: la LISTA di chiamate con «name» e «arguments» e
//      la busta `<function=NOME>` dei Llama.
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

const AIUTO = () => ({ famiglie: D.FAMIGLIE_AIUTO });
const STATO = (o = {}) => ({ orariSveglie: [], titoliAppunti: [], contiAzioni: {}, ...o });

test('nell\'Aiuto una cosa fatta una volta non copre quelle raccontate dopo', () => {
  // Nel pannello Aiuto le azioni emesse si accumulano in un insieme solo, che
  // vale come «fatto adesso» per sempre. Chiedi due feedback di fila: il primo
  // parte, il secondo il modello lo racconta e basta, e nessuno lo dice.
  const emesse = new Set(['INVIA_FEEDBACK']);
  const out = D.rileva('Ho mandato la segnalazione agli sviluppatori: ci penseranno loro.',
    emesse, { orariSveglie: [] }, AIUTO());
  expect(out.length).toBeGreaterThan(0);

  // Stessa cosa per l'appunto e per l'evento in calendario.
  expect(D.rileva('Ti ho salvato l\'appunto con la lista della spesa.',
    new Set(['SALVA_APPUNTO']), { orariSveglie: [] }, AIUTO()).length).toBeGreaterThan(0);
  expect(D.rileva('Ti ho aggiunto l\'evento in calendario per domani alle 10.',
    new Set(['EVENTO_CALENDARIO']), { orariSveglie: [] }, AIUTO()).length).toBeGreaterThan(0);
});

test('nell\'Aiuto la conferma col pronome viene guardata come nella chat della home', () => {
  // «Sì, te l'ho mandata» dopo «manda un feedback» è il modo normale di
  // rispondere quando la cosa l'ha appena nominata l'utente.
  const casa = D.rileva('Sì, te l\'ho mandata.', [], STATO());
  expect(casa.length).toBeGreaterThan(0);
  const aiuto = D.rileva('Sì, te l\'ho mandata.', new Set(), { orariSveglie: [] }, AIUTO());
  expect(aiuto.length).toBeGreaterThan(0);
});

test('un appunto che esiste davvero non viene smentito, con o senza i titoli', () => {
  // La chat della home guarda i titoli degli appunti dal giro 3, e lì la frase
  // vera resta muta. Il pannello Aiuto quei titoli non li passa mai: senza,
  // la stessa frase vera diventa un'accusa. La porta sta nel chiamante, e si
  // vede qui: cambia solo cosa gli si mette davanti.
  const frase = 'Sì, ti ho salvato l\'appunto con la lista della spesa.';
  expect(D.rileva(frase, [], STATO({ titoliAppunti: ['lista della spesa'] })).length).toBe(0);
  // Quello che l'Aiuto passa davvero: solo le sveglie.
  expect(D.rileva(frase, new Set(), { orariSveglie: [] }, AIUTO()).length).toBe(0);
});

test('una richiesta scritta come domanda non spegne il controllo sui turni prima', () => {
  // «Mi segni anche la lista della spesa?» è una richiesta, non la domanda
  // «l'hai già fatto?». Con il punto interrogativo, qualunque azione dei turni
  // precedenti copre la dichiarazione di adesso.
  const precedenti = new Set(['SALVA_APPUNTO']);
  const conDomanda = D.rileva('Ti ho salvato l\'appunto con la lista della spesa.',
    [], STATO({ tipiPrecedenti: precedenti, domandaUtente: true }));
  const senzaDomanda = D.rileva('Ti ho salvato l\'appunto con la lista della spesa.',
    [], STATO({ tipiPrecedenti: precedenti, domandaUtente: false }));
  expect(senzaDomanda.length).toBeGreaterThan(0);
  expect(conDomanda.length).toBeGreaterThan(0);
});

test('una domanda vera dell\'utente regge ancora la risposta che guarda indietro', () => {
  // La controprova: «l'hai mandata?» → «sì, l'ho mandata» deve restare muto.
  const out = D.rileva('Sì, l\'ho già mandata agli sviluppatori.',
    [], STATO({ tipiPrecedenti: new Set(['INVIA_FEEDBACK']), domandaUtente: true }));
  expect(out.length).toBe(0);
});

test('la lista di chiamate con «name» e «arguments» è formato interno', () => {
  const nomi = ['SVEGLIA', 'TIMER', 'SALVA_APPUNTO'];
  // Una chiamata sola in questa forma il giro 6 l'ha chiusa; la LISTA no, ed è
  // la forma con cui i modelli mandano più chiamate insieme.
  expect(D.formatoSospetto('{"name":"SVEGLIA","arguments":{"time":"19:00"}}', nomi)).toBe(true);
  expect(D.formatoSospetto('[{"name":"SVEGLIA","arguments":{"time":"19:00"}}]', nomi)).toBe(true);
  expect(D.formatoSospetto('Fatto.\n[{"name":"SVEGLIA","arguments":{"time":"19:00"}}]', nomi)).toBe(true);
});

test('la busta «function=» dei Llama è formato interno', () => {
  const nomi = ['SVEGLIA', 'TIMER', 'SALVA_APPUNTO'];
  expect(D.formatoSospetto('<function=SVEGLIA>{"time":"19:00"}</function>', nomi)).toBe(true);
  expect(D.formatoSospetto('Fatto.\n<function=SVEGLIA>{"time":"19:00"}</function>', nomi)).toBe(true);
});

test('una risposta normale non viene scambiata per formato interno', () => {
  // La controprova delle due sopra: niente di quello che scrive un assistente
  // deve diventare un turno buttato.
  const nomi = ['SVEGLIA', 'TIMER', 'SALVA_APPUNTO'];
  expect(D.formatoSospetto('Ti ho messo la sveglia alle 19.', nomi)).toBe(false);
  expect(D.formatoSospetto('La funzione f(x) = 2x è lineare.', nomi)).toBe(false);
  expect(D.formatoSospetto('Ecco un esempio di come si scrive:\n```json\n{"type":"SVEGLIA"}\n```', nomi)).toBe(false);
});
