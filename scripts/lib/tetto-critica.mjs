// Il tetto di una critica del verificatore, per i due strumenti che la registrano (dispatch e verify-local).
// Conta i BYTE UTF-8 come il tetto della conversazione in cui la critica finisce (SN_FEEDBACK_THREAD.NOTES_MAX):
// a caratteri la stessa cifra valeva tre volte tanto in giapponese (#1333). Sentinella: tettiConversazione.test.mjs.

// Lo stesso del server (filo-security, routine/deliver.js). Oltre: rifiuto col numero, mai un taglio.
export const MAX_CRITIQUE_BYTES = 12000;

export function byteLen(testo) {
  return Buffer.byteLength(String(testo == null ? '' : testo), 'utf8');
}

/** '' se la critica sta nel tetto, altrimenti la frase del rifiuto col numero. PURA. */
export function criticaTroppoLunga(testo) {
  const n = byteLen(testo);
  if (n <= MAX_CRITIQUE_BYTES) return '';
  return `critica troppo lunga: ${n} byte, il massimo è ${MAX_CRITIQUE_BYTES} (byte UTF-8: una lettera accentata o cirillica ne vale 2, una giapponese 3). Accorcia il riassunto, non i rilievi.`;
}
