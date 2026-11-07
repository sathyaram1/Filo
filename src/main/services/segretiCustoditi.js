// I segreti che Filo custodisce (#810): chiavi dei servizi, credenziali del proxy, accesso, identità della copia,
// portafoglio, chiave dei feedback, parola d'ordine dell'owner. Servono solo a fermare un'uscita che li contiene e a oscurarli nei messaggi verso
// i modelli: mai a un prompt. Regole: src/shared/urlExfil.js (valutaUscita).

function costanti() {
  if (!globalThis.SN_CONST) require('../../shared/constants.js');
  return globalThis.SN_CONST;
}

function guardiano() {
  if (!globalThis.SN_GUARDIANO_STATICO) require('../../shared/guardianoStatico.js');
  return globalThis.SN_GUARDIANO_STATICO;
}

// `impostazioni`: le salvate e le effettive (queste aggiungono la chiave di fabbrica e la personale).
// `chiaveFeedback`: la privata dei feedback cifrati, se questo computer ce l'ha (chiaveFeedback.js).
// `env`: il proxy dell'ambiente vince su quello delle impostazioni (proxyTab.configFrom), e le sue credenziali valgono uguale.
function custoditi({ impostazioni = [], chiaveFeedback = null, env = process.env } = {}) {
  const G = guardiano();
  const out = [];
  const visti = new Set();
  // `segreto`: una stringa o { valore, password } (SN_CONST.segretiDelProxy).
  const metti = (segreto, tipo) => {
    const password = !!(segreto && segreto.password);
    const valore = segreto && typeof segreto === 'object' ? segreto.valore : segreto;
    const v = typeof valore === 'string' ? valore.trim() : '';
    if (v.length < G.segretoDi({ valore: v, password }).min || visti.has(v)) return;
    visti.add(v);
    if (password) G.segnaPassword(v);
    out.push(password ? { valore: v, tipo, password: true } : { valore: v, tipo });
  };
  // Prima i moduli che danno il nome giusto: la chiave personale sta anche fra le effettive.
  const da = (modulo, fn, tipo) => {
    try { for (const v of [].concat(require(modulo)[fn]() || [])) metti(v, tipo); } catch (_) {}
  };
  da('../auth/wallet-store', 'personalKey', 'portafoglio');
  da('../auth/google-auth', 'segreti', 'accesso');
  da('../auth/anon-auth', 'segreti', 'identita');
  da('./parolaOwner', 'segreti', 'chiave');
  metti(chiaveFeedback, 'feedback');
  const C = costanti();
  let dalAmbiente = null;
  try { dalAmbiente = { proxy: require('./proxyTab').configFrom({}, env || {}) }; } catch (_) {}
  // I posti dei segreti sono quelli di SN_CONST.campiSegreti: un posto nuovo lì è custodito anche qui.
  for (const s of [...impostazioni, dalAmbiente]) {
    for (const [o, k] of C.campiSegreti(s)) {
      // Del proxy solo utente e password, non l'host: le finestre del confronto fermerebbero una visita al fornitore.
      const valori = o === s.proxy ? C.segretiDelProxy(o[k]) : [o[k]];
      for (const x of valori) metti(x, 'chiave');
    }
  }
  return out;
}

module.exports = { custoditi };
