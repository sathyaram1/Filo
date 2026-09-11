// Un 403 di Firestore sul triage feedback deve diventare un messaggio
// AZIONABILE, non il JSON grezzo "Missing or insufficient permissions".
//
// Sintomo (screenshot utente): admin loggato → sposta una card → alert opaco
// "PERMISSION_DENIED". Causa: l'allowlist client (cfg.adminEmails) dice "admin"
// ma il server (Firestore rules) richiede un documento admins/<email> che manca.
// Il messaggio nuovo deve dire QUALE email e DOVE crearla.
//
// Pre-condizione che senza il fix fallirebbe: prima `permissionDeniedHelp` non
// esisteva e l'handler ritornava la stringa grezza. Questi assert diventano
// rossi se si rimuove l'helper (la guida "admins"/email sparisce).

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { permissionDeniedHelp } = require('../src/main/services/feedbackError.js');

test('403 Firestore → messaggio azionabile con email e collezione admins', () => {
  const raw = '{ "error": { "code": 403, "message": "Missing or insufficient permissions.", "status": "PERMISSION_DENIED" } }';
  const msg = permissionDeniedHelp(raw, { email: 'tester@example.com', email_verified: true });

  // Deve citare l'email reale dell'utente e dirgli di crearla in admins.
  expect(msg).toContain('tester@example.com');
  expect(msg).toMatch(/admins/i);
  // Non deve restare il JSON grezzo incomprensibile.
  expect(msg).not.toContain('insufficient permissions');
});

test('403 con email non verificata → avvisa del requisito email verificata', () => {
  const raw = 'firestore update fallito (403): PERMISSION_DENIED';
  const msg = permissionDeniedHelp(raw, { email: 'nv@example.com', email_verified: false });
  expect(msg).toContain('nv@example.com');
  expect(msg).toMatch(/verificat/i); // "email NON verificata"
});

// Secondo sintomo (stesso 403, causa opposta): l'account È amministratore, ma
// il feedback ha una conversazione più lunga del tetto delle regole — e allora
// il server rifiuta QUALUNQUE modifica su quel feedback, anche il solo cambio di
// stato. Il messaggio vecchio mandava l'owner a creare un documento admins che
// esisteva già. Pre-condizione che senza il fix fallirebbe: prima l'helper
// ignorava `serverAdmin` e rispondeva sempre "non sei admin".
test('403 con admin confermato dal server → parla del contenuto, non dei permessi', () => {
  const raw = 'firestore update fallito (403): PERMISSION_DENIED';
  const msg = permissionDeniedHelp(raw, { email: 'owner@example.com', email_verified: true }, { serverAdmin: true });

  expect(msg).toMatch(/note|conversazione/i);       // indica la causa vera
  expect(msg).not.toMatch(/console Firebase/i);     // niente caccia al tesoro inutile
  expect(msg).not.toMatch(/non risulta amministratore/i);
});

test('403 con esito admin sconosciuto → cita entrambe le cause possibili', () => {
  const raw = 'firestore update fallito (403): PERMISSION_DENIED';
  const msg = permissionDeniedHelp(raw, { email: 'owner@example.com', email_verified: true }, { serverAdmin: null });
  expect(msg).toMatch(/admins/i);
  expect(msg).toMatch(/conversazione troppo lunga/i);
});

test('errori non-403 passano invariati (nessun falso positivo)', () => {
  const raw = 'Sessione scaduta: rifai l\'accesso.';
  const msg = permissionDeniedHelp(raw, { email: 'x@example.com', email_verified: true });
  expect(msg).toBe(raw); // invariato
});

// #582 — il 403 su un ALLEGATO. Da quando il deposito non è più pubblico, un
// allegato si apre col download token che sta nel link o con le credenziali di
// un amministratore: un 403 vuol dire che sono mancati entrambi. Le due cause
// hanno cure opposte (rifare l'accesso / farsi mettere fra gli amministratori),
// e il testo deve stare in UNA riga: finisce nell'hover del segnaposto
// dell'immagine, dove un messaggio a più righe non si legge.
test('403 su un allegato: dice quale delle due cause è, in una riga', () => {
  const { attachmentForbiddenHelp } = require('../src/main/services/feedbackError.js');

  const senzaSessione = attachmentForbiddenHelp({ conIdentita: false });
  expect(senzaSessione).toMatch(/accedi/i);
  expect(senzaSessione).not.toMatch(/\n/);

  const conSessione = attachmentForbiddenHelp({ conIdentita: true });
  expect(conSessione).toMatch(/amministratori/i);
  expect(conSessione).not.toMatch(/\n/);

  // Le due cause non si confondono: il messaggio di chi ha una sessione valida
  // non manda a rifare l'accesso, ed è il caso in cui si perdeva tempo.
  expect(conSessione).not.toMatch(/sessione è scaduta/i);
  expect(conSessione).not.toEqual(senzaSessione);

  // Nessun argomento = nessuna sessione: il default sbaglia dalla parte che non
  // accusa l'account di non essere amministratore.
  expect(attachmentForbiddenHelp()).toEqual(senzaSessione);
});

test('a chi NON riceve le segnalazioni il messaggio non parla di amministratori', () => {
  // Verifica #582, giro 1. Un utente qualunque riapre le proprie segnalazioni e
  // ritrova lo screenshot che ha mandato: non lo rivedrà (è cifrato con la
  // chiave di chi riceve le segnalazioni) e va bene così. Quello che non andava
  // era il messaggio, che gli parlava di permessi di amministratore e lo
  // mandava a cercare un problema suo dove non c'era niente da risolvere.
  const { attachmentNotForYouHelp } = require('../src/main/services/feedbackError.js');

  const msg = attachmentNotForYouHelp();
  expect(msg).not.toMatch(/amministrat/i);
  expect(msg).not.toMatch(/riservata/i);
  // Dice la cosa che serve sapere, ed è chi apre quell'allegato. Non «inviato»
  // (#582, giro 3): l'elenco dei feedback mostra a ogni tester le segnalazioni
  // di tutti, quindi questa frase si legge anche davanti all'allegato di un
  // altro, e lì «inviato» suonava come «l'hai mandato tu».
  expect(msg).toMatch(/lo apre solo chi riceve le segnalazioni/i);
  // E NON dice che è arrivato, né come viaggia (#582, giro 5): questa frase la
  // riceve anche un indirizzo scritto nella forma del deposito di Filo, che
  // Filo non ha aperto e che può non esistere affatto. Da questo lato
  // l'esistenza non si può controllare: senza il download token il deposito
  // risponde 403 sia per un oggetto che c'è sia per uno che non c'è.
  expect(msg).not.toMatch(/consegnat|arrivat|ricevut/i);
  expect(msg).not.toMatch(/cifrat/i);
  // Sta in un hover: una riga sola.
  expect(msg).not.toMatch(/\n/);
});
