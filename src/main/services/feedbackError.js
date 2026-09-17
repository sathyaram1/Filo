// Traduce un errore Firestore del triage feedback in un messaggio AZIONABILE. Modulo puro.
// Un 403 ha due cause: l'account non è admin lato server, oppure il contenuto viola un
// vincolo di forma (notes oltre il tetto), e allora le regole respingono ogni scrittura.

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

// #582 — una riga sola, senza a capo: finisce nell'hover del segnaposto in dashboard.
// La causa è una sola: manca un token di download valido, e il deposito è chiuso a tutti.
function attachmentForbiddenHelp() {
  return 'allegato non leggibile: il link non porta un token di download valido (mancante o ritirato), e il deposito non lo apre a nessuno — resta raggiungibile solo dalla console del progetto';
}

// #582 — una riga (finisce in un hover) che NON dice che l'allegato è arrivato: l'indirizzo
// sta nella segnalazione, che manda chiunque, e senza token il 403 non distingue i casi.
function attachmentNotForYouHelp() {
  return 'questo allegato lo apre solo chi riceve le segnalazioni';
}

module.exports = { permissionDeniedHelp, attachmentForbiddenHelp, attachmentNotForYouHelp };
