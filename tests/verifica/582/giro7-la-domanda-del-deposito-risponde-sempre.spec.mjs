// Verifica #582, giro 7 — la domanda «questo indirizzo è un allegato di Filo?»
// deve RISPONDERE, non esplodere.
//
// Quella domanda decide due cose insieme: se scaricare e se firmare la
// richiesta con l'identità di chi riceve le segnalazioni. I giri 1 e 5 hanno
// provato che risponde «no» agli indirizzi storti. Qui si prova un'altra cosa:
// che risponda, punto.
//
// L'elenco degli inizi ammessi è una mappa indicizzata per nome di dominio, e
// il nome di dominio lo sceglie chi manda la segnalazione. Alcuni nomi non sono
// nomi qualunque: `__proto__` e `constructor` esistono già dentro ogni mappa di
// JavaScript, e chiedendo quelli si riceve roba che una mappa di indirizzi non
// ha mai contenuto. Il codice poi la tratta come un elenco, e lì si rompe.
//
// Chiude dal lato giusto (nessun gettone parte), quindi non è una porta aperta:
// è che la risposta diventa un'eccezione invece di un «no», e chi la chiama si
// ritrova un guasto generico al posto della frase che spiega cosa sta guardando.
//
// Prove PURE: nessuna finestra da aprire.

import { test, expect } from '@playwright/test';

await import('../../../src/shared/feedbackAttachTypes.js');
await import('../../../src/shared/feedback.js');

const FB = globalThis.SN_FEEDBACK;
const GETTONE = 'gettone-di-chi-riceve-le-segnalazioni';

// Nomi di dominio che sono anche chiavi di serie di una mappa JavaScript.
// `new URL` li accetta come nomi di dominio: l'underscore è ammesso.
const NOMI_DI_SERIE = [
  'https://__proto__/v0/b/filo-8b9cb.firebasestorage.app/o/x.png?alt=media',
  'https://constructor/v0/b/filo-8b9cb.firebasestorage.app/o/x.png?alt=media',
  'https://__proto__/',
  'https://constructor/x',
  // Le altre chiavi di serie rispondono già «no»: stanno qui perché la
  // risposta non cambi il giorno in cui si tocca la mappa.
  'https://toString/x',
  'https://valueOf/x',
  'https://hasOwnProperty/x',
];

for (const indirizzo of NOMI_DI_SERIE) {
  test(`«${indirizzo}» riceve un no, non un'eccezione`, () => {
    let risposta;
    expect(() => { risposta = FB.isAttachmentUrl(indirizzo); },
      `la domanda è esplosa invece di rispondere: ${indirizzo}`).not.toThrow();
    expect(risposta, indirizzo).toBe(false);
  });

  test(`«${indirizzo}» non si porta dietro il gettone, e non esplode`, () => {
    let intestazioni;
    expect(() => { intestazioni = FB.attachmentFetchHeaders(indirizzo, GETTONE); },
      `la firma è esplosa invece di rispondere: ${indirizzo}`).not.toThrow();
    expect(intestazioni, indirizzo).toEqual({});
  });
}

// La controprova: un allegato vero continua a essere riconosciuto e firmato.
test('un allegato vero resta riconosciuto e firmato', () => {
  const vero = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/'
    + 'feedback%2F1788891497000_3f2a1b0c-1111-4222-8333-444455556666.png?alt=media&token=abc';
  expect(FB.isAttachmentUrl(vero)).toBe(true);
  expect(FB.attachmentFetchHeaders(vero, GETTONE)).toEqual({ Authorization: `Bearer ${GETTONE}` });
});
