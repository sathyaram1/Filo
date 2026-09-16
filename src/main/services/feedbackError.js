// Traduce un errore Firestore del triage feedback in un messaggio AZIONABILE. Modulo puro (niente electron), testabile in isolamento.
// Un 403 ha DUE cause e confonderle costa caro: l'account non è admin LATO SERVER (il gate client cfg.adminEmails è un'allowlist distinta da quella delle regole), oppure È admin ma il CONTENUTO viola un vincolo di forma — tipicamente `notes` oltre il tetto, e allora le regole respingono QUALUNQUE scrittura, anche il solo cambio di stato.
// opts.serverAdmin dice quale delle due è, così il messaggio non manda l'owner a creare un documento admins che esiste già.

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

// #582 — una riga sola, senza a capo: questo testo finisce nell'hover del segnaposto dell'immagine in dashboard.
// La causa è una sola: il link non ha un token di download valido (mai avuto o ritirato). Le regole chiudono la lettura del deposito a chiunque, owner compreso, quindi mandare a «farsi mettere fra gli amministratori» manda a fare una cosa che non apre più niente.
function attachmentForbiddenHelp() {
  return 'allegato non leggibile: il link non porta un token di download valido (mancante o ritirato), e il deposito non lo apre a nessuno — resta raggiungibile solo dalla console del progetto';
}

// #582 — una riga sola (finisce in un hover), e NON dice che l'allegato è arrivato né che viaggia cifrato: l'indirizzo di un allegato sta dentro la segnalazione, che può mandare chiunque anche senza account, quindi basterebbe scriverne uno nella forma del deposito perché Filo dichiari consegnato e cifrato un file mai caricato.
// Senza token il deposito risponde 403 sia per un oggetto che c'è sia per uno che non c'è: da qui l'esistenza non si può controllare, quindi si dice solo ciò che è vero in ogni caso — chi apre quel file. Vale anche davanti all'allegato di un altro, che l'elenco mostra a ogni tester.
function attachmentNotForYouHelp() {
  return 'questo allegato lo apre solo chi riceve le segnalazioni';
}

module.exports = { permissionDeniedHelp, attachmentForbiddenHelp, attachmentNotForYouHelp };
