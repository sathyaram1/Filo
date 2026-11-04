// La domanda di fine sessione delle routine (routineClosingAdmin, ROUTINE-AUTH-SPEC § 13): gli slot, le risposte di
// orchestratori e worker in un elenco solo, e il testo coi caratteri di controllo resi visibili. Logica pura per
// Gestione → Automazioni e scripts/routine-domanda.mjs. Prove: tests/unit/strumentiOwner.test.mjs, domandaChiusura.test.mjs.

(function (global) {
  'use strict';

  // Gli slot li decide il server (gli altri li rifiuta con `bad_slot`): qui servono al menu e all'aiuto.
  const SLOT = Object.freeze(['tutti', 'orchestrator', 'worker', 'new-work', 'fixer', 'verifier', 'secaudit', 'compito']);

  /**
   * Il testo intero, coi caratteri di controllo resi visibili (tranne a capo e tab): le risposte vengono da sessioni
   * che leggono testo non fidato, e una sequenza ESC/OSC o un segno di direzione nasconde o rigira righe. PURA.
   */
  function visibile(testo) {
    const CONTROLLO = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
    return String(testo ?? '').replace(CONTROLLO, (c) => {
      const n = c.charCodeAt(0);
      return n <= 0xff ? `\\x${n.toString(16).padStart(2, '0')}` : `\\u${n.toString(16).padStart(4, '0')}`;
    });
  }

  /** Uno slot che il server può accettare: uno fisso, o «compito:<ricorrente>». PURA. */
  function slotValido(s) {
    const t = String(s || '').trim();
    return SLOT.includes(t) || /^compito:[a-z0-9][a-z0-9_-]{0,63}$/i.test(t);
  }

  /** Un istante in ms, o NaN se manca: il server scrive `null` per «non ancora», e `Number(null)` è 0. PURA. */
  function istante(v) {
    return v === null || v === undefined || v === '' ? NaN : Number(v);
  }

  /**
   * Le risposte di orchestratori e worker in un elenco solo, dal più recente: { t, chi, durata, domanda, answered,
   * risposta }, testi già resi visibili. PURA.
   */
  function vociRisposte(result) {
    const r = result || {};
    const voci = [];
    for (const o of Array.isArray(r.orchestrator) ? r.orchestrator : []) {
      if (!o) continue;
      voci.push({
        t: istante(o.askedAtMs), chi: `orchestratore · ${visibile(o.slug || '?')}`, durata: '',
        domanda: visibile(o.question || ''), answered: !!o.answered, risposta: visibile(o.answer || ''),
      });
    }
    for (const w of Array.isArray(r.workers) ? r.workers : []) {
      const c = w && w.closing;
      if (!c || !Number.isFinite(istante(c.askedAtMs))) continue;
      const inizio = istante(w.createdAtMs); const fine = istante(w.releasedAtMs);
      const durata = Number.isFinite(inizio) && Number.isFinite(fine) ? `${Math.round((fine - inizio) / 60000)} min` : 'non rilasciato';
      // Il server manda il numero già col cancelletto («#477»); uno solo in ogni caso.
      const num = w.num ? ` #${visibile(String(w.num).replace(/^#+/, ''))}` : '';
      voci.push({
        t: istante(c.askedAtMs), chi: `${visibile(w.role || 'worker')}${num} · ${visibile(w.slug || '?')}`, durata,
        domanda: visibile(c.question || ''), answered: typeof c.answer === 'string', risposta: visibile(c.answer || ''),
      });
    }
    return voci.sort((x, y) => (y.t || 0) - (x.t || 0));
  }

  /** Le domande impostate per slot, per nome, coi testi resi visibili, e il ripiego. PURA. */
  function domandeImpostate(result) {
    const r = result || {};
    const slots = r.slots && typeof r.slots === 'object' ? r.slots : {};
    return {
      slots: Object.keys(slots).sort().map((s) => ({ slot: s, testo: String((slots[s] && slots[s].text) || '') })),
      ripiego: String(r.default || ''),
    };
  }

  global.SN_ROUTINE_CHIUSURA = Object.freeze({ SLOT, visibile, slotValido, istante, vociRisposte, domandeImpostate });
})(typeof globalThis !== 'undefined' ? globalThis : this);
