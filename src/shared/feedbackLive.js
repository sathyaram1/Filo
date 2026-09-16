// Aggiornamento continuo della lista dei feedback (dashboard di gestione): qui sta la logica pura — confronto e fusione — così si prova senza rete.
// La dashboard non ricarica mai tutto: a ogni giro chiede le sole VERSIONI (id + ultima scrittura, pochi byte) e riscarica solo i documenti cambiati o nuovi.

(function (global) {
  'use strict';

  // Ogni quanto la dashboard chiede «cosa è cambiato?». Un giro costa una lettura per feedback in pagina (500 al tetto), quindi il ritmo è anche una spesa: un minuto tiene il passo con le routine (che lavorano per minuti, non secondi) per pochi euro al mese.
  const POLL_MS = 60 * 1000;

  // local: documenti in mano (`_id` e, se vengono da Firestore, `_updateTime`); remote: [{ _id, _updateTime }] nell'ordine della pagina. Ritorna { changed, added, removed } di id.
  // Senza versione locale si rilegge comunque: non sappiamo cosa abbiamo. `removed` copre sia il cancellato sia lo scivolato oltre il tetto — un ricaricamento non lo mostrerebbe, quindi neanche noi.
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

  // Ritorna una lista NUOVA, dal più recente al più vecchio come quella del caricamento iniziale; la lista d'ingresso non viene toccata.
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
