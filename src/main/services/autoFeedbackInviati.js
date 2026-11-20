// Il registro degli invii anonimi F4 già partiti, su disco: la regola (uno per voce e per versione) sta in
// src/shared/autoFeedback.js (primoInvio). Vale per tutte le finestre, incognito compresa: non è navigazione.
// Prove: tests/unit/autoFeedbackInviati.test.mjs.
'use strict';

const Storage = require('../shim/storage');

const CHIAVE = 'filo_auto_feedback_inviati';
// Una coda sola: tre turni ravvicinati leggono il registro uno dopo l'altro, non tutti e tre vuoto.
let coda = Promise.resolve();

// true se questo invio è il primo per la sua chiave nella versione data, e lo segna già: chi arriva dopo trova la voce.
function prenota(versione, chiave) {
  const AF = globalThis.SN_AUTO_FEEDBACK;
  const giro = coda.then(() => Storage.runNormale(async () => {
    const letto = (await Storage.get(CHIAVE))[CHIAVE];
    const r = AF.primoInvio(letto, versione, chiave);
    if (r.invia) await Storage.set({ [CHIAVE]: r.registro });
    return r.invia;
  }));
  coda = giro.catch(() => {});
  return giro;
}

module.exports = { prenota, CHIAVE };
