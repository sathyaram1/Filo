// Logica pura per la sezione "Revisione" della dashboard di gestione.
// Espone SN_MANAGE_REVIEW = { classifyBlock, sortReview } su globalThis.
//
// Testabile via `npm run test:unit` (niente Electron, niente rete).
// Pattern IIFE su globalThis: vedi CLAUDE.md → "Convenzione di porting".

(function (global) {
  'use strict';

  // Motivi di blocco, in ordine di severità discendente.
  // color: usato come --mg-item-color nei CSS (border-left + badge).
  const REASONS = {
    attack: { label: 'Attacco',  color: '#c0392b', severity: 3 },
    spam:   { label: 'Spam',     color: '#e08e0b', severity: 2 },
    design: { label: 'Design',   color: '#5b6ee0', severity: 1 },
  };

  /**
   * Classifica un feedback nel pipeline di sicurezza.
   * @param {object} fb – oggetto feedback (con campo `pipeline` opzionale)
   * @returns {{ reason: string, color: string, severity: number, label: string }|null}
   *   null se il feedback non ha motivo di blocco (aligned / no pipeline).
   */
  function classifyBlock(fb) {
    // Override dell'owner: un feedback "accettato" (sbloccato a mano dalla
    // dashboard di revisione) NON è più un blocco — esce dalla colonna Bloccati
    // e rientra nel flusso normale. Vince su qualsiasi verdetto del pipeline.
    if (fb && fb.reviewDecision === 'accepted') return null;

    const p = fb && fb.pipeline;
    if (!p) return null;

    // Attack: la condizione più grave vince.
    if (
      p.action === 'block_attack' ||
      p.l1Category === 'dangerous' ||
      p.l2Class === 'attack'
    ) {
      return { reason: 'attack', ...REASONS.attack };
    }

    // Spam.
    if (
      p.action === 'block_spam' ||
      p.l1Category === 'spam' ||
      p.l2Class === 'spam'
    ) {
      return { reason: 'spam', ...REASONS.spam };
    }

    // Design.
    if (p.l2Class === 'design') {
      return { reason: 'design', ...REASONS.design };
    }

    // aligned / nessuna segnalazione → non appare in Revisione.
    return null;
  }

  /**
   * Ordina un array di feedback per la colonna Revisione:
   *   severità DESC (attack > spam > design), poi createdAt DESC.
   * I feedback senza blocco vengono esclusi automaticamente (restano nell'array
   * originale e non dovrebbero essere passati qui, ma per sicurezza vengono
   * trattati come severità 0).
   */
  function sortReview(feedbacks) {
    return feedbacks.slice().sort((a, b) => {
      const ca = classifyBlock(a);
      const cb = classifyBlock(b);
      const sa = ca ? ca.severity : 0;
      const sb = cb ? cb.severity : 0;
      if (sb !== sa) return sb - sa;
      // A parità di severità: più recenti prima.
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
  }

  global.SN_MANAGE_REVIEW = { classifyBlock, sortReview, REASONS };

})(typeof globalThis !== 'undefined' ? globalThis : self);
