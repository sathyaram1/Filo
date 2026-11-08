// Il registro dei trascinamenti interni (#2300): gettone → contenuto, scritto dalla pagina di Filo che trascina e preso
// una volta sola da quella che riceve. Non controlla chi chiama: lo fa il suo handler (handlers/trascini.js). PURO.

// Un trascinamento può passare da una scheda all'altra e restare in mano a lungo: un'ora non si sfiora.
const DURATA_MS = 60 * 60 * 1000;
// Ogni dragstart ne scrive uno, e quelli lasciati cadere fuori restano fino alla scadenza.
const MASSIMO = 500;
// Il riferimento più grosso porta 30.000 caratteri più il titolo: il margine è per chi ne scriverà di nuovi.
const CARATTERI_MAX = 200000;
const COSE = Object.freeze(['riferimento', 'file']);
const GETTONE = /^[\w-]{16,64}$/;

function crea({ adesso = () => Date.now() } = {}) {
  const voci = new Map();
  const pulisci = () => {
    const t = adesso();
    for (const [g, v] of voci) if (v.scade <= t) voci.delete(g);
    while (voci.size > MASSIMO) voci.delete(voci.keys().next().value);
  };
  return {
    parte(gettone, cosa, dati) {
      if (typeof gettone !== 'string' || !GETTONE.test(gettone) || !COSE.includes(cosa)) return { ok: false, error: 'forma' };
      let peso = 0;
      try { peso = JSON.stringify(dati === undefined ? null : dati).length; } catch (_) { return { ok: false, error: 'forma' }; }
      if (peso > CARATTERI_MAX) return { ok: false, error: `troppo grande: ${peso} caratteri, il tetto è ${CARATTERI_MAX}` };
      voci.delete(gettone);
      voci.set(gettone, { cosa, dati, scade: adesso() + DURATA_MS });
      pulisci();
      return { ok: true };
    },
    arriva(gettone, cosa) {
      pulisci();
      const v = typeof gettone === 'string' ? voci.get(gettone) : null;
      if (!v || v.cosa !== cosa) return { ok: false, error: 'sconosciuto' };
      voci.delete(gettone);
      return { ok: true, dati: v.dati };
    },
  };
}

module.exports = { crea, DURATA_MS, MASSIMO, CARATTERI_MAX, COSE };
