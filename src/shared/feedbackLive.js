// Aggiornamento continuo della lista dei feedback (dashboard di gestione).
//
// La dashboard non ricarica mai tutto: a ogni giro chiede a Firestore le sole
// VERSIONI (id + ultima scrittura, pochi byte), confronta con quello che ha
// già in mano, e riscarica soltanto i documenti cambiati o nuovi. Qui vive la
// logica pura — confronto e fusione — così si può provare senza rete.
//
// Espone SN_FEEDBACK_LIVE = { POLL_MS, diffVersions, applyChanges }.

(function (global) {
  'use strict';

  // Ogni quanto la dashboard chiede "cosa è cambiato?". Un giro costa una
  // lettura per feedback in pagina (500 al tetto), quindi il ritmo è anche una
  // spesa: un minuto tiene la lista al passo con le routine (che lavorano per
  // minuti, non secondi) per pochi euro al mese di letture.
  const POLL_MS = 60 * 1000;

  // Confronta la lista locale con le versioni appena lette.
  //   local:  documenti in mano (con `_id` e, se arrivano da Firestore, `_updateTime`)
  //   remote: [{ _id, _updateTime }] — l'elenco corrente, nell'ordine della pagina
  // Ritorna { changed, added, removed } (array di id):
  //   changed — presente in entrambi, ma scritto dopo l'ultima lettura
  //             (o senza versione locale: non sappiamo cos'abbiamo, rileggiamo);
  //   added   — nuovo, mai visto;
  //   removed — non più in pagina: cancellato, oppure scivolato oltre il tetto
  //             perché ne sono entrati di più recenti. In entrambi i casi un
  //             ricaricamento non lo mostrerebbe, quindi neanche noi.
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

  // Applica un giro alla lista: i documenti `fresh` sostituiscono (o
  // aggiungono) quelli con lo stesso id, gli id `removed` escono. Ritorna una
  // lista NUOVA, dal più recente al più vecchio come quella del caricamento
  // iniziale; la lista d'ingresso non viene toccata.
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
