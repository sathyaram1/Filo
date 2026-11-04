// L'ordine del manutentore (SPEC-MANUTENTORE § 3): i numeri dei feedback da accendere, nell'ordine dato. Logica pura
// per Gestione → Automazioni e scripts/manutentore.mjs; l'ultima parola resta al server. Prove: tests/unit/manutentore.test.mjs.

(function (global) {
  'use strict';

  // Lo stesso tetto del server (functions/src/routine/accensioni.js, ORDINE_MAX): oltre si rifiuta col numero.
  const ORDINE_MAX = 2000;

  /** «812, #815,815.2» → { ok, numeri } senza doppioni nell'ordine dato, o { ok:false, motivo }. PURA. */
  function leggiOrdine(testo) {
    const pezzi = String(testo || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    if (!pezzi.length) return { ok: false, motivo: 'accendi vuole i numeri in ordine (accendi 812,815) o --niente per svuotare l\'ordine' };
    const storti = pezzi.filter((x) => !/^#?[1-9]\d{0,6}(?:\.[1-9]\d{0,3})?$/.test(x));
    if (storti.length) return { ok: false, motivo: `non sono numeri di feedback: ${storti.slice(0, 5).join(', ')}` };
    const numeri = [...new Set(pezzi.map((x) => x.replace(/^#/, '')))];
    if (numeri.length > ORDINE_MAX) return { ok: false, motivo: `${numeri.length} numeri, il massimo è ${ORDINE_MAX}` };
    return { ok: true, numeri };
  }

  global.SN_MANUTENTORE_ORDINE = Object.freeze({ ORDINE_MAX, leggiOrdine });
})(typeof globalThis !== 'undefined' ? globalThis : this);
