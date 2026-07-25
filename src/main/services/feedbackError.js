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

module.exports = { permissionDeniedHelp };
