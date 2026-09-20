// Come partono le sessioni delle routine (doc config/routines): quante insieme,
// da quale account per prima, quali account sono esclusi.
// Logica pura: la pagina di gestione e il main rifiutano gli stessi valori.

(function (global) {
  'use strict';

  const CHIAVI = Object.freeze(['maxSessions', 'priorityAccount', 'accountAOff', 'accountBOff']);
  // Vuoto = si alternano, che è il comportamento senza il campo.
  const ACCOUNT = Object.freeze(['', 'A', 'B']);

  function limiti() {
    const A = (global.SN_CONST && global.SN_CONST.AUTOMATION) || {};
    return {
      min: Number.isFinite(A.MAX_SESSIONS_MIN) ? A.MAX_SESSIONS_MIN : 1,
      max: Number.isFinite(A.MAX_SESSIONS_MAX) ? A.MAX_SESSIONS_MAX : 20,
      predefinito: Number.isFinite(A.MAX_SESSIONS_DEFAULT) ? A.MAX_SESSIONS_DEFAULT : 1,
    };
  }

  /** Il documento come lo legge il server: campo assente = comportamento di oggi. */
  function leggiDoc(doc) {
    const d = doc && typeof doc === 'object' ? doc : {};
    const { min, max, predefinito } = limiti();
    const n = Math.round(Number(d.maxSessions));
    return {
      maxSessions: Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : predefinito,
      priorityAccount: ACCOUNT.includes(d.priorityAccount) ? d.priorityAccount : '',
      accountAOff: d.accountAOff === true,
      accountBOff: d.accountBOff === true,
    };
  }

  /**
   * I soli campi ricevuti, controllati. Un valore storto NON si aggiusta in
   * silenzio: si rifiuta dicendo l'intervallo, perché chi scrive sappia cosa
   * è rimasto sul server.
   * @returns {{ok:true, valori:Object}|{ok:false, testo:string}}
   */
  function valida(patch) {
    const p = patch && typeof patch === 'object' ? patch : {};
    const valori = {};
    if (p.maxSessions != null) {
      const { min, max } = limiti();
      const scritto = String(p.maxSessions).trim().replace(',', '.');
      const n = scritto === '' ? NaN : Number(scritto);
      if (!Number.isInteger(n) || n < min || n > max) {
        return { ok: false, testo: `Sessioni in parallelo: ci vuole un numero intero da ${min} a ${max}. Non salvato.` };
      }
      valori.maxSessions = n;
    }
    if (p.priorityAccount != null) {
      if (!ACCOUNT.includes(p.priorityAccount)) {
        return { ok: false, testo: 'Account prioritario: vale «A», «B», oppure niente (si alternano). Non salvato.' };
      }
      valori.priorityAccount = p.priorityAccount;
    }
    for (const chiave of ['accountAOff', 'accountBOff']) {
      if (p[chiave] == null) continue;
      if (typeof p[chiave] !== 'boolean') {
        return { ok: false, testo: `${chiave}: ci vuole vero o falso. Non salvato.` };
      }
      valori[chiave] = p[chiave];
    }
    return { ok: true, valori };
  }

  /** Esclusi tutti e due: nessuna sessione può partire. Non è un errore, ma va detto. */
  function nessunAccount(stato) {
    const s = stato && typeof stato === 'object' ? stato : {};
    return s.accountAOff === true && s.accountBOff === true;
  }

  global.SN_ROUTINE_SESSIONI = { CHIAVI, ACCOUNT, limiti, leggiDoc, valida, nessunAccount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
