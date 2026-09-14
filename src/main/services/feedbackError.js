// Traduzione di un errore Firestore sul triage feedback in un messaggio
// AZIONABILE per l'utente. Modulo puro (niente electron) così è testabile in
// isolamento.
//
// Un 403/PERMISSION_DENIED ha DUE cause possibili, e confonderle costa caro:
//
//   1) l'account loggato non è admin LATO SERVER (manca il documento
//      admins/<email> nelle Firestore rules, o l'email non è verificata, o le
//      regole non sono deployate). Il gate client (cfg.adminEmails) può dire
//      "sei admin" mentre il server dissente: le due allowlist sono distinte.
//
//   2) l'account È admin, ma il CONTENUTO del feedback viola un vincolo di
//      forma delle regole — tipicamente la conversazione (`notes`) più lunga
//      del tetto consentito. Le regole validano il documento RISULTANTE: un
//      feedback già oltre il limite respinge QUALUNQUE scrittura, anche il solo
//      cambio di stato, e sembra "bloccato" senza motivo.
//
// Se il chiamante sa quale delle due è (opts.serverAdmin: true = admin
// confermato dal server), il messaggio punta dritto alla causa giusta invece di
// mandare l'owner a creare un documento admins che esiste già.

function permissionDeniedHelp(rawError, claims, opts) {
  const raw = String(rawError || '');
  if (!/\b403\b|PERMISSION_DENIED|insufficient permissions/i.test(raw)) return raw;
  const email = (claims && claims.email) || '';
  const who = email ? `"${email}"` : 'il tuo account';
  const serverAdmin = opts && Object.prototype.hasOwnProperty.call(opts, 'serverAdmin')
    ? opts.serverAdmin
    : null;

  // Caso 2 accertato: l'account è admin per il server → la colpa è del contenuto.
  if (serverAdmin === true) {
    return [
      'Firestore ha rifiutato la modifica anche se questo account è amministratore:',
      'il contenuto del feedback supera i limiti consentiti.',
      '',
      'Di solito è la conversazione: se le note del feedback sono cresciute oltre',
      'il tetto, il server respinge ogni scrittura su quel feedback — perfino un',
      'semplice cambio di stato. Accorcia le note del feedback (o lascia che il',
      'prossimo aggiornamento automatico tagli i turni più vecchi) e riprova.',
    ].join('\n');
  }

  const lines = [
    `Firestore ha negato l'operazione (403): ${who} non risulta amministratore lato server.`,
    '',
    'Per abilitare il triage dei feedback, nella console Firebase (progetto',
    'filo-8b9cb) → Firestore → collezione "admins" crea un documento con ID',
    email ? `esattamente uguale alla tua email: ${email}` : 'uguale alla tua email',
    '(i campi possono restare vuoti). Verifica anche che le regole Firestore',
    'siano deployate (firebase deploy --only firestore:rules).',
  ];
  if (claims && claims.email_verified === false) {
    lines.push('');
    lines.push('Attenzione: questo account risulta con email NON verificata, ma le');
    lines.push('regole richiedono email verificata. Accedi con un account la cui');
    lines.push('email è verificata.');
  }
  if (serverAdmin === null) {
    lines.push('');
    lines.push("Se invece l'account risulta già amministratore, la causa è il contenuto");
    lines.push('del feedback: una conversazione troppo lunga fa rifiutare qualunque');
    lines.push('modifica a quel feedback, anche il solo cambio di stato.');
  }
  return lines.join('\n');
}

// #582 — un 403 su un ALLEGATO è un'altra storia, e va detta in una riga sola:
// questo testo finisce nell'hover del segnaposto dell'immagine in dashboard,
// dove un messaggio su più righe non si legge.
//
// Da quando il deposito degli allegati non è più pubblico, un allegato si apre
// in due modi: col download token che sta nel link salvato nel feedback, o con
// le credenziali di un amministratore. Un 403 vuol dire che sono mancati
// entrambi, e le due mancanze hanno cure opposte — rifare l'accesso, oppure
// farsi mettere fra gli amministratori del progetto. Dire quale delle due è
// ciò che distingue un segnaposto muto da un problema che si risolve.
//
// @param {{ conIdentita?: boolean }} opts - `conIdentita` true = la richiesta
//   era firmata con un token valido (quindi il problema non è la sessione).
// @returns {string} una riga, senza a capo.
function attachmentForbiddenHelp(opts) {
  const conIdentita = !!(opts && opts.conIdentita);
  return conIdentita
    ? 'allegato non leggibile: il link non porta il token di download e questo account non è fra gli amministratori del progetto'
    : 'allegato non leggibile: accedi con l’account amministratore (la sessione è scaduta)';
}

// #582 — e poi c'è chi NON è l'owner: un utente qualunque che riapre le proprie
// segnalazioni e ritrova lo screenshot che ha mandato. Quell'immagine non la
// rivedrà: viaggia cifrata con la chiave di chi riceve le segnalazioni, ed è
// voluto. Quello che non va è mandargli un messaggio sui permessi di
// amministratore, che lo spedisce a cercare un problema suo dove non c'è niente
// da risolvere. Qui si dice invece l'unica cosa che gli serve sapere: l'allegato
// è arrivato dov'era diretto.
//
// La frase vale anche davanti all'allegato di UN ALTRO, e serve che valga:
// l'elenco dei feedback mostra a ogni tester le segnalazioni di tutti, quindi lo
// stesso segnaposto compare su roba che chi guarda non ha mandato. «Inviato»
// lì si leggeva come «l'hai mandato tu» (#582, giro 3).
//
// ⚠️ E NON dice che l'allegato è arrivato, né che viaggia cifrato (#582, giro
// 5). Le diceva, e non le aveva guardate. L'indirizzo di un allegato non lo
// sceglie Filo: sta dentro la segnalazione, e una segnalazione la manda
// chiunque, anche senza account. Il giro 4 ha tolto la parola agli indirizzi
// FUORI dal deposito di Filo; restava che bastasse scriverne uno nella FORMA
// del deposito — senza caricare niente — perché Filo dichiarasse consegnato, e
// cifrato con la chiave di chi riceve le segnalazioni, un file che non era mai
// entrato. Un allegato inventato diventava indistinguibile da uno vero, con la
// firma di Filo sopra.
//
// Da questo lato l'esistenza non si può controllare, e va bene così: senza il
// download token il deposito risponde 403 sia per un oggetto che c'è sia per uno
// che non c'è (verificato col motore vero delle regole). Quindi la cura non è
// indovinare: è dire soltanto ciò che è vero in ogni caso — chi apre quel file.
// Questo resta vero davanti a un allegato vero, a uno inventato e a quello di un
// altro, e non rimanda a nessun permesso da chiedere.
//
// @returns {string} una riga, senza a capo (finisce in un hover).
function attachmentNotForYouHelp() {
  return 'questo allegato lo apre solo chi riceve le segnalazioni';
}

module.exports = { permissionDeniedHelp, attachmentForbiddenHelp, attachmentNotForYouHelp };
