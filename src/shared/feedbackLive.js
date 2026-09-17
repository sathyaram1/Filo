// Aggiornamento continuo della lista feedback: qui la logica pura, si prova senza rete.
// La dashboard non ricarica mai tutto: chiede le VERSIONI e riscarica solo ciò che cambia.

(function (global) {
  'use strict';

  // Un giro costa una lettura per feedback in pagina: il ritmo è anche una spesa.
  // Un minuto tiene il passo con le routine, che lavorano per minuti e non per secondi.
  const POLL_MS = 60 * 1000;

  // Senza versione locale si rilegge comunque: non sappiamo cosa abbiamo.
  // `removed` copre il cancellato e lo scivolato oltre il tetto: un ricarico non lo vedrebbe.
  function diffVersions(local, remote) {
    const seen = new Map();
    for (const fb of Array.isArray(local) ? local : []) {
      if (fb && fb._id) seen.set(String(fb._id), fb._updateTime || null);
    }
    const changed = [];
    const added = [];
    const remoteIds = new Set();
    for (const v of Array.isArray(remote) ? remote : []) {
      if (!v || !v._id) continue;
      const id = String(v._id);
      remoteIds.add(id);
      if (!seen.has(id)) { added.push(id); continue; }
      const mine = seen.get(id);
      if (!mine || mine !== (v._updateTime || null)) changed.push(id);
    }
    const removed = [];
    for (const id of seen.keys()) if (!remoteIds.has(id)) removed.push(id);
    return { changed, added, removed };
  }

  function createdMs(fb) {
    const t = new Date((fb && fb.createdAt) || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  // Lista NUOVA, dal più recente come il caricamento iniziale; l'ingresso non si tocca.
  function applyChanges(list, { fresh = [], removed = [] } = {}) {
    const drop = new Set((removed || []).map(String));
    const byId = new Map();
    for (const fb of Array.isArray(list) ? list : []) {
      if (fb && fb._id && !drop.has(String(fb._id))) byId.set(String(fb._id), fb);
    }
    for (const fb of Array.isArray(fresh) ? fresh : []) {
      if (fb && fb._id) byId.set(String(fb._id), fb);
    }
    return Array.from(byId.values()).sort((a, b) => createdMs(b) - createdMs(a));
  }

  global.SN_FEEDBACK_LIVE = { POLL_MS, diffVersions, applyChanges };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_FEEDBACK_LIVE;
}
