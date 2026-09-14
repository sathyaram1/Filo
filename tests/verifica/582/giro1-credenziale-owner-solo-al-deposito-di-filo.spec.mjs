// Verifica #582, giro 1 — dove finisce la credenziale dell'owner quando la
// dashboard apre un allegato.
//
// Il confine chiesto dalla segnalazione. Gli allegati dei feedback non sono più
// pubblici: li legge l'owner. Perché continui a vederli anche quando il
// collegamento salvato non porta più il suo lasciapassare monouso, la
// dashboard ora firma il download con l'IDENTITÀ dell'owner — cioè spedisce il
// suo gettone di accesso insieme alla richiesta.
//
// La porta che questo file prova. L'indirizzo dell'allegato NON lo sceglie
// l'owner: sta dentro la segnalazione, e una segnalazione la può scrivere
// chiunque, anche senza account. Quindi l'indirizzo su cui la dashboard spedirà
// il gettone dell'owner è, di fatto, scritto da uno sconosciuto. Il gettone
// dell'owner deve partire SOLO verso il deposito di Filo: se basta che
// l'indirizzo stia su un dominio di Google, uno sconosciuto può far recapitare
// la credenziale dell'owner a un deposito suo, semplicemente allegandone il
// collegamento a una segnalazione.
//
// Cosa deve restare vero (le due metà, insieme):
//   · verso il deposito di Filo il gettone parte — altrimenti gli allegati
//     storici, o quelli il cui lasciapassare è stato revocato, l'owner non li
//     vede più;
//   · verso QUALUNQUE altro deposito il gettone non parte, nemmeno se
//     l'indirizzo è ospitato dallo stesso servizio.

import { test, expect } from '@playwright/test';

// Il modulo si auto-registra su globalThis: qui non serve Electron, è logica
// pura, e una prova che si vede in millisecondi è una prova che si rilancia.
await import('../../../src/shared/feedbackAttachTypes.js');
await import('../../../src/shared/feedback.js');

const FB = globalThis.SN_FEEDBACK;
const GETTONE = 'gettone-di-accesso-dell-owner';

/** Il deposito di Filo, nelle due forme in cui un collegamento può arrivare. */
const DEPOSITO_DI_FILO = [
  'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1788891497000_3f2a1b0c-1111-4222-8333-444455556666.png?alt=media',
  'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1788891497000_3f2a1b0c-1111-4222-8333-444455556666.png?alt=media&token=abc',
];

/**
 * Depositi che NON sono di Filo, scritti come li scriverebbe chi manda una
 * segnalazione apposta per farsi recapitare il gettone dell'owner.
 */
const DEPOSITI_ESTRANEI = [
  'https://firebasestorage.googleapis.com/v0/b/deposito-di-un-estraneo.appspot.com/o/x.png?alt=media',
  'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app.di-un-estraneo.app/o/x.png?alt=media',
  'https://storage.googleapis.com/deposito-di-un-estraneo/x.png',
  'https://storage.googleapis.com/filo-8b9cb.firebasestorage.app-di-un-estraneo/x.png',
];

test('verso il deposito di Filo la dashboard firma il download con l’identità dell’owner', () => {
  for (const indirizzo of DEPOSITO_DI_FILO) {
    expect(FB.attachmentFetchHeaders(indirizzo, GETTONE), indirizzo)
      .toEqual({ Authorization: `Bearer ${GETTONE}` });
    expect(FB.isAttachmentUrl(indirizzo), indirizzo).toBe(true);
  }
});

test('verso un deposito che non è di Filo il gettone dell’owner non parte', () => {
  for (const indirizzo of DEPOSITI_ESTRANEI) {
    expect(FB.attachmentFetchHeaders(indirizzo, GETTONE), indirizzo).toEqual({});
  }
});

test('un allegato che punta fuori dal deposito di Filo non viene nemmeno scaricato', () => {
  // La stessa domanda decide due cose (il commento del modulo lo dice: una
  // risposta sola per il guardiano anti-rimbalzo e per la firma). Se il
  // guardiano dice «è un allegato» su un deposito estraneo, la dashboard ci va
  // comunque a scaricare, e basta quello a farne un recapito pilotato da chi
  // manda la segnalazione.
  for (const indirizzo of DEPOSITI_ESTRANEI) {
    expect(FB.isAttachmentUrl(indirizzo), indirizzo).toBe(false);
  }
});

test('senza sessione non si inventa una firma, e fuori da https non parte niente', () => {
  expect(FB.attachmentFetchHeaders(DEPOSITO_DI_FILO[0], '')).toEqual({});
  for (const indirizzo of [
    'http://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/x.png',
    'https://firebasestorage.googleapis.com.di-un-estraneo.app/v0/b/filo-8b9cb.firebasestorage.app/o/x.png',
    'file:///etc/passwd',
    '',
  ]) {
    expect(FB.attachmentFetchHeaders(indirizzo, GETTONE), indirizzo).toEqual({});
    expect(FB.isAttachmentUrl(indirizzo), indirizzo).toBe(false);
  }
});
