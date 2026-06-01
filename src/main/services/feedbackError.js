// Traduzione di un errore Firestore sul triage feedback in un messaggio
// AZIONABILE per l'utente. Modulo puro (niente electron) così è testabile in
// isolamento.
//
// Un 403/PERMISSION_DENIED NON è un guasto opaco: significa che l'account
// loggato non è admin LATO SERVER (manca un documento admins/<email> nelle
// Firestore rules), oppure l'email non è verificata, o le regole non sono
// deployate. Il gate client (cfg.adminEmails) può dire "sei admin" mentre il
// server dissente: le due allowlist sono distinte. Mostriamo all'utente quale
// email creare e dove, invece del JSON grezzo di Firestore.

function permissionDeniedHelp(rawError, claims) {
  const raw = String(rawError || '');
  if (!/\b403\b|PERMISSION_DENIED|insufficient permissions/i.test(raw)) return raw;
  const email = (claims && claims.email) || '';
  const who = email ? `"${email}"` : 'il tuo account';
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
  return lines.join('\n');
}

module.exports = { permissionDeniedHelp };
