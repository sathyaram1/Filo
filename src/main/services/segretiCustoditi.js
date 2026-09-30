// I segreti che Filo custodisce (#810): chiavi dei servizi AI, accesso, identità della copia,
// portafoglio. Servono solo a fermare un'uscita che li contiene e a oscurarli nei messaggi verso
// i modelli: mai a un prompt. Regole: src/shared/urlExfil.js (valutaUscita).

// `impostazioni`: le salvate e le effettive (queste aggiungono la chiave di fabbrica e la personale).
function custoditi({ impostazioni = [] } = {}) {
  const min = (globalThis.SN_GUARDIANO_STATICO && globalThis.SN_GUARDIANO_STATICO.SEGRETO_MIN) || 12;
  const out = [];
  const visti = new Set();
  const metti = (valore, tipo) => {
    const v = typeof valore === 'string' ? valore.trim() : '';
    if (v.length < min || visti.has(v)) return;
    visti.add(v);
    out.push({ valore: v, tipo });
  };
  // Prima i moduli che danno il nome giusto: la chiave personale sta anche fra le effettive.
  const da = (modulo, fn, tipo) => {
    try { for (const v of [].concat(require(modulo)[fn]() || [])) metti(v, tipo); } catch (_) {}
  };
  da('../auth/wallet-store', 'personalKey', 'portafoglio');
  da('../auth/google-auth', 'segreti', 'accesso');
  da('../auth/anon-auth', 'segreti', 'identita');
  for (const s of impostazioni) {
    const chiavi = s && s.apiKeys && typeof s.apiKeys === 'object' ? s.apiKeys : {};
    for (const v of Object.values(chiavi)) metti(v, 'chiave');
  }
  return out;
}

module.exports = { custoditi };
