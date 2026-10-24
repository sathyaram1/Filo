// Come partono le sessioni delle routine (doc config/routines): quante insieme,
// da quale account per prima, quali account sono esclusi, e le pause in corso a parole.
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

  /**
   * Il prioritario è stato escluso: la priorità scelta non vale più e si lavora
   * sull'altro. Due controlli che dicono il contrario vanno spiegati, o chi
   * guarda non sa più quale account sta consumando.
   * @returns {''|'A'|'B'} l'account che resta, vuoto se la priorità vale ancora.
   */
  function prioritarioIgnorato(stato) {
    const s = leggiDoc(stato);
    if (!s.priorityAccount || nessunAccount(s)) return '';
    const escluso = s.priorityAccount === 'A' ? s.accountAOff : s.accountBOff;
    return escluso ? (s.priorityAccount === 'A' ? 'B' : 'A') : '';
  }

  // L'esito che ha messo in pausa un'accensione, a parole (#996); il codice resta accanto, fra parentesi.
  const MOTIVI_PAUSA = Object.freeze({
    http_429: 'troppe accensioni per claude.ai',
    http_402: 'crediti finiti',
    http_401: 'claude.ai rifiuta il token di accensione',
    http_403: 'claude.ai rifiuta il token di accensione',
    http_404: 'claude.ai non trova la routine',
    network: 'claude.ai non raggiungibile',
    dead_round: 'accesa, ma la sessione non è partita',
  });

  function motivoPausa(perche) {
    const p = typeof perche === 'string' ? perche : '';
    if (MOTIVI_PAUSA[p]) return p.startsWith('http_') ? `${MOTIVI_PAUSA[p]} (HTTP ${p.slice(5)})` : MOTIVI_PAUSA[p];
    const http = /^http_(\d{3})$/.exec(p);
    if (http) return Number(http[1]) >= 500 ? `claude.ai in errore (HTTP ${http[1]})` : `claude.ai ha rifiutato l'accensione (HTTP ${http[1]})`;
    return 'accensione non riuscita';
  }

  /**
   * Una pausa in corso (pauseDa del server) in parole: `testo` per la riga, `dettaglio` per il suo hover. Null se la
   * voce non è una pausa leggibile o è già scaduta a `nowMs`.
   * @param {string} chi «Account A», «La routine server»…
   */
  function pausaInParole(chi, voce, nowMs) {
    const v = voce && typeof voce === 'object' ? voce : null;
    const fino = v ? Number(v.finoMs) : NaN;
    if (!Number.isFinite(fino) || fino <= nowMs) return null;
    const ora = new Date(fino).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const stessoGiorno = new Date(fino).toDateString() === new Date(nowMs).toDateString();
    const domani = new Date(nowMs);
    domani.setDate(domani.getDate() + 1);
    const quando = stessoGiorno ? `alle ${ora}`
      : new Date(fino).toDateString() === domani.toDateString() ? `a domani alle ${ora}`
        : `al ${new Date(fino).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })} alle ${ora}`;
    const msg = typeof v.dettaglio === 'string' ? v.dettaglio.trim() : '';
    const testo = `${chi} in pausa fino ${quando}: ${motivoPausa(v.perche)}.${msg ? ` «${msg}»` : ''}`;
    const strikes = Math.max(1, Math.floor(Number(v.strikes) || 1));
    const oggi = Math.max(0, Math.floor(Number(v.oggi) || 0));
    // Un giro nato morto non è un rifiuto di claude.ai: l'accensione era passata.
    const [tanti, uno] = v.perche === 'dead_round' ? ['accensioni di fila senza sessione', 'fallimento'] : ['rifiuti di fila', 'rifiuto'];
    const righe = [
      strikes > 1 ? `${strikes} ${tanti}: la pausa raddoppia a ogni ${uno}, fino a un giorno.`
        : `La pausa raddoppia a ogni ${uno} di fila, fino a un giorno.`,
    ];
    // La routine server senza un account noto non ha un conto del giorno da dire.
    if (v.account === undefined || v.account === 'A' || v.account === 'B') righe.push(`Accensioni di oggi su quell'account: ${oggi}.`);
    return { testo, dettaglio: righe.join(' ') };
  }

  global.SN_ROUTINE_SESSIONI = {
    CHIAVI, ACCOUNT, limiti, leggiDoc, valida, nessunAccount, prioritarioIgnorato, motivoPausa, pausaInParole,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
