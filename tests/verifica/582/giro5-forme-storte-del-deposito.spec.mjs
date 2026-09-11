// Verifica #582, giro 5 — il confine del deposito, battuto con forme che i giri
// prima non avevano provato.
//
// Il giro 1 ha chiuso la porta per cui il gettone di chi riceve le segnalazioni
// partiva verso un deposito qualunque ospitato da Google. La domanda «questo
// indirizzo è un allegato di Filo?» decide due cose insieme — se scaricare e se
// firmare — quindi una risposta sbagliata in più vale come quella di allora.
// Qui la stessa domanda viene fatta con gli indirizzi storti che restavano: il
// nome di dominio col punto finale, la lettera cirillica che somiglia a una
// nostra, la barra rovesciata al posto della chiocciola, il percorso che risale
// di un livello e cambia deposito, il maiuscolo nel nome del deposito.
//
// Sono prove PURE: nessuna finestra da aprire, si vedono in millisecondi, e per
// questo si rilanciano davvero.

import { test, expect } from '@playwright/test';

await import('../../../src/shared/feedbackAttachTypes.js');
await import('../../../src/shared/feedback.js');

const FB = globalThis.SN_FEEDBACK;
const GETTONE = 'gettone-di-chi-riceve-le-segnalazioni';
const DEPOSITO = 'filo-8b9cb.firebasestorage.app';

// Indirizzi che SONO del deposito di Filo anche se scritti in modo insolito.
const DENTRO = [
  // Maiuscolo nel nome del servizio: il nome di dominio non distingue le
  // maiuscole, e infatti è lo stesso posto.
  `HTTPS://FIREBASESTORAGE.GOOGLEAPIS.COM/v0/b/${DEPOSITO}/o/feedback%2F1788891497000_3f2a1b0c-1111-4222-8333-444455556666.png?alt=media`,
  // Porta dichiarata per esteso: è la porta di sempre, è lo stesso posto.
  `https://firebasestorage.googleapis.com:443/v0/b/${DEPOSITO}/o/x.png?alt=media`,
];

// Indirizzi che NON sono del deposito di Filo, per quanto ci somiglino.
const FUORI = [
  // Punto finale del nome di dominio: un'altra scrittura dello stesso posto per
  // chi risolve i nomi, ma qui non la riconosciamo — e va bene così: davanti a
  // un dubbio la risposta deve cadere dal lato chiuso.
  `https://firebasestorage.googleapis.com./v0/b/${DEPOSITO}/o/x.png`,
  // Cirillico: la «о» di «googleapis» non è la nostra.
  `https://firebasestorage.googleapis.cом/v0/b/${DEPOSITO}/o/x.png`,
  // Barra rovesciata al posto della chiocciola: chi legge in fretta vede il
  // deposito di Filo, il percorso vero comincia dalla chiocciola.
  `https://firebasestorage.googleapis.com\\@sito-di-un-estraneo.invalid/v0/b/${DEPOSITO}/o/x.png`,
  // Il percorso risale di un livello e cambia deposito.
  `https://firebasestorage.googleapis.com/v0/b/${DEPOSITO}/../deposito-di-un-estraneo/o/x.png`,
  `https://storage.googleapis.com/${DEPOSITO}/../deposito-di-un-estraneo/x.png`,
  // Maiuscolo nel nome del DEPOSITO: lì le maiuscole contano, è un altro nome.
  `https://firebasestorage.googleapis.com/v0/b/${DEPOSITO.toUpperCase()}/o/x.png`,
  // Il deposito di Filo come parametro, non come posto dove si va.
  `https://sito-di-un-estraneo.invalid/x?deposito=https://firebasestorage.googleapis.com/v0/b/${DEPOSITO}/o/x.png`,
];

test('gli indirizzi insoliti che sono comunque del deposito di Filo restano riconosciuti', () => {
  for (const indirizzo of DENTRO) {
    expect(FB.isAttachmentUrl(indirizzo), indirizzo).toBe(true);
  }
});

test('le forme storte non si spacciano per il deposito di Filo, e il gettone non parte', () => {
  for (const indirizzo of FUORI) {
    expect(FB.isAttachmentUrl(indirizzo), indirizzo).toBe(false);
    expect(FB.attachmentFetchHeaders(indirizzo, GETTONE), indirizzo).toEqual({});
  }
});

test('la scritta di un collegamento non nomina mai un posto diverso da quello dove porta', () => {
  // Le esche dei giri prima, più quelle che nascono dalle forme qui sopra: la
  // scritta deve contenere il posto VERO, e mai spacciarne un altro.
  const esche = [
    ['https://sito-di-un-estraneo.invalid/accedi', 'sito-di-un-estraneo.invalid'],
    ['https://filo.app@sito-di-un-estraneo.invalid/accedi', 'sito-di-un-estraneo.invalid'],
    ['https://filo.app.sito-di-un-estraneo.invalid/accedi', 'filo.app.sito-di-un-estraneo.invalid'],
    [`https://sito-di-un-estraneo.invalid/${'x'.repeat(500)}`, 'sito-di-un-estraneo.invalid'],
  ];
  for (const [indirizzo, postoVero] of esche) {
    const scritta = FB.linkLabel(indirizzo);
    expect(scritta, indirizzo).toContain(postoVero);
    expect(scritta.length, `${indirizzo} → scritta lunga ${scritta.length}`).toBeLessThanOrEqual(FB.LINK_LABEL_MAX);
  }
  // Un indirizzo che non porta su un sito non diventa mai una scritta.
  for (const brutto of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', '']) {
    expect(FB.linkLabel(brutto), brutto).toBe('');
  }
});
