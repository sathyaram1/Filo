// I domini dei messaggi del main, elenco nato da handlers.js: ognuno registra i suoi tipi con on(tipo, fn).
// Ognuno si carica al suo turno, come prima della divisione: l'ordine è quello di registrazione, e un tipo
// registrato due volte ferma l'avvio (on() in handlers.js).
const DOMINI = [
  () => require('./nav'),
  () => require('./barra'),
  () => require('./stratoMenu'), // #1054 — il menu del tasto destro nello strato sopra la scheda
  () => require('./riquadri'), // #1509.1 — i riquadri di Filo su un sito nello strato sopra la scheda
  () => require('./tabs'),
  () => require('./storage'),
  () => require('./pages'),
  () => require('./ai'),
  () => require('./filo'),
  () => require('./auth'),
  () => require('./credits'),
  () => require('./wallet'), // #598 — chiave personale, inviti, registro d'uso
  () => require('./contatori'), // #969 — i contatori giornalieri anonimi
  () => require('./avvisoCrediti'), // #818 — l'avviso prima che i crediti finiscano, coi rimedi
  () => require('./board'),
  () => require('./decks'),
  () => require('./scryfall'),
  () => require('./safebrowse'),
  () => require('./adSkip'), // #737 — pubblicità dei video da saltare
  () => require('./propostaEmail'), // #1124 — l'email dell'account nei campi di accesso dei siti
  () => require('./testoDeiCampi'), // #2378 — il testo scritto nei campi dei siti che non si perde
  () => require('./menuDelSito'), // #975 — il menu che un sito si disegna da sé
  () => require('./filoSpento'), // #843 — Filo spento o riacceso su un sito dal tasto destro
  () => require('./redteam'),
  () => require('./inPausa'), // #1592 — Bacheca e Mazzi in pausa per chi non è owner
  () => require('./parolaOwner'), // #2070 — la parola d'ordine che «Discutiamone» copia
  () => require('./misc'),
  () => require('./file'), // #950 — nome sensato ai file dell'utente
  () => require('./trascini'), // #2300 — il contenuto dei trascinamenti interni, dietro un gettone
  () => require('./barraSiti'), // #1803 — la barra dei siti della nuova scheda
];

module.exports = function registraDomini(on, handlerCtx) {
  for (const dominio of DOMINI) dominio()(on, handlerCtx);
};
