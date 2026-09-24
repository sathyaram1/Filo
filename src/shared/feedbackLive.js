// Aggiornamento continuo della lista dei feedback (dashboard di gestione):
// logica pura — confronto, fusione, decisione del giro — senza rete.
// La regola sta in patterns/chi-guarda-in-continuo-chiede-cosa-e-cambiato.md.

(function (global) {
  'use strict';

  // Ogni quanto la dashboard chiede "cosa è cambiato?". L'owner vuole la lista
  // al passo col lavoro delle routine, che si misura in minuti.
  const POLL_MS = 60 * 1000;

  // Ogni quanto ci si riallinea PER INTERO. Serve a due cose che una domanda
  // per data non sa dire: le cancellazioni (un documento che non c'è più non
  // compare in nessuna query) e le scritture fatte da un cammino che non firma
  // `updatedAt`. Raro perché costa una lettura per feedback in pagina: è la
  // rete di sicurezza, non il giro.
  const RECONCILE_MS = 30 * 60 * 1000;

  // Quanti feedback per volta si controllano con l'ora vera di Firestore. Le
  // routine lavorano una pratica alla volta, quindi in genere ne bastano zero o
  // una: il tetto è largo perché una coda insolita non lasci fuori proprio
  // quella che si sta muovendo, e costa una lettura per feedback SEGUITO, non
  // per feedback esistente.
  const SEGUITI_MAX = 40;

  // Quanto si torna indietro rispetto all'inizio del giro precedente. `updatedAt`
  // lo scrive chi scrive, con il SUO orologio: due minuti di margine assorbono
  // lo scarto fra le macchine senza far ripagare niente quando non cambia
  // niente (la domanda resta a vuoto, cioè una lettura).
  const OVERLAP_MS = 2 * 60 * 1000;

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

  // Il bordo della finestra: la data d'invio del più vecchio fra i feedback in
  // pagina, ma SOLO se la pagina è piena. Se ce ne stanno tutti non c'è nessun
  // bordo, e un feedback qualunque che cambia è roba che la lista mostra.
  function windowFloor(versions, pageSize) {
    const arr = Array.isArray(versions) ? versions : [];
    const cap = Number(pageSize) > 0 ? Number(pageSize) : 0;
    if (!cap || arr.length < cap) return null;
    let min = Infinity;
    for (const v of arr) {
      const t = createdMs(v);
      if (t && t < min) min = t;
    }
    return Number.isFinite(min) ? min : null;
  }

  // Un feedback che il caricamento non mostrerebbe non va aggiunto dal giro:
  // comparirebbe per un minuto e sparirebbe al riallineamento. Senza bordo (o
  // senza data d'invio: non si butta via per un campo assente) sta dentro.
  function inWindow(fb, floor) {
    if (!floor) return true;
    const t = createdMs(fb);
    return !t || t >= floor;
  }

  // Applica un giro alla lista: i documenti `fresh` sostituiscono (o
  // aggiungono) quelli con lo stesso id, gli id `removed` escono. Ritorna una
  // lista NUOVA, dal più recente al più vecchio come quella del caricamento
  // iniziale; la lista d'ingresso non viene toccata.
  //
  // Una riga più VECCHIA di quella in mano non vince: il giro vive nel main e
  // avvisa tutte le pagine, e una pagina appena caricata riceve anche l'ultimo
  // annuncio — che di quel feedback può avere una copia precedente.
  function applyChanges(list, { fresh = [], removed = [] } = {}) {
    const drop = new Set((removed || []).map(String));
    const byId = new Map();
    for (const fb of Array.isArray(list) ? list : []) {
      if (!fb || !fb._id) continue;
      const id = String(fb._id);
      if (drop.has(id)) continue;
      byId.set(id, fb);
    }
    for (const fb of Array.isArray(fresh) ? fresh : []) {
      if (!fb || !fb._id) continue;
      const id = String(fb._id);
      const mine = byId.get(id);
      if (mine && mine._updateTime && fb._updateTime && fb._updateTime < mine._updateTime) continue;
      byId.set(id, fb);
    }
    return Array.from(byId.values()).sort((a, b) => createdMs(b) - createdMs(a));
  }

  // ── Il giro, con l'I/O iniettato ─────────────────────────────────────────
  //
  // Vive nel processo main, uno solo: dieci schede di Gestione aperte sono
  // dieci pagine che ascoltano, non dieci giri che pagano.
  //
  // La domanda per data è la SCORCIATOIA, non la sola sorgente: `updatedAt` lo
  // scrive chi scrive, e chi non lo firma (il server delle routine) o lo firma
  // con un orologio indietro sparirebbe dal giro. Perciò ogni giro guarda
  // anche due segni che nessun orologio tocca: l'ora d'ultima scrittura che
  // Firestore tiene da sé, per i soli feedback che la dashboard sta seguendo,
  // e il contatore degli invii, che ogni invio fa avanzare.
  //
  // deps:
  //   listChangedSince({ since }) → { rows, complete }   i cambiati dopo `since`
  //   listVersions()              → [{ _id, _updateTime, createdAt }]
  //   seguiti()                   → [id] i feedback che le pagine stanno seguendo da vicino
  //   versionsOf(ids)             → [{ _id, _updateTime }] l'ora vera di Firestore
  //   readRows(ids)               → [documenti interi]
  //   submissionCount()           → intero | null  quanti invii in tutto
  //   broadcast(msg)              avvisa le pagine
  //   now()                       l'orologio (i test lo fissano)
  //
  // Il riallineamento manda le VERSIONI, non i documenti: chi ha in mano la
  // lista è la pagina, quindi è lei a sapere quali le mancano e a chiederli.
  // Il giro al minuto invece manda le righe già lette, una volta per tutte le
  // pagine — è il caso frequente, ed è lì che si paga.
  function makeWatcher({
    listChangedSince, listVersions, broadcast,
    seguiti = null, versionsOf = null, readRows = null, submissionCount = null,
    now = () => Date.now(), pollMs = POLL_MS, reconcileMs = RECONCILE_MS,
    overlapMs = OVERLAP_MS, pageSize = 500, onWarn = null, seguitiMax = SEGUITI_MAX,
  } = {}) {
    let floor = null;           // bordo della finestra (data d'invio)
    let lastTickAt = 0;         // inizio dell'ultimo giro riuscito
    let lastReconcileAt = 0;
    let inFlight = null;
    let versioniSeguite = new Map();  // id → ora d'ultima scrittura secondo Firestore
    let inviiVisti = null;            // valore del contatore all'ultimo giro

    function since() {
      const base = lastTickAt || (now() - overlapMs);
      return new Date(Math.max(0, base - overlapMs)).toISOString();
    }

    async function reconcile() {
      const startedAt = now();
      const remote = await listVersions();
      if (!Array.isArray(remote)) throw new Error('versioni non lette');
      floor = windowFloor(remote, pageSize);
      lastReconcileAt = startedAt;
      lastTickAt = startedAt;
      broadcast({ kind: 'reconcile', versions: remote });
      return { kind: 'reconcile', versions: remote.length };
    }

    async function incremental() {
      const startedAt = now();
      const out = await listChangedSince({ since: since() });
      const tutte = (out && Array.isArray(out.rows)) ? out.rows : [];
      // Il freno sulle pagine è scattato: non si finge che fosse tutto. Si
      // dice, e il riallineamento completo riparte al giro dopo.
      if (out && out.complete === false) {
        if (onWarn) onWarn('cambiati: troppe pagine, riallineamento completo al giro dopo');
        lastReconcileAt = 0;
      }
      const rows = tutte.filter((r) => inWindow(r, floor));
      lastTickAt = startedAt;
      if (rows.length) broadcast({ kind: 'changed', rows });
      return { kind: 'changed', changed: rows.length };
    }

    async function run(force) {
      if (!force && lastTickAt && (now() - lastTickAt) < pollMs / 2) return { kind: 'skipped' };
      if (!lastReconcileAt || (now() - lastReconcileAt) >= reconcileMs) return reconcile();
      return incremental();
    }

    /** Un giro per volta: una raffica si fonde nel giro già in corso. */
    function tick(opts) {
      if (inFlight) return inFlight;
      inFlight = run(!!(opts && opts.force)).finally(() => { inFlight = null; });
      return inFlight;
    }

    return {
      tick,
      /** Il prossimo giro è un riallineamento completo (apertura di una pagina). */
      forceReconcile() { lastReconcileAt = 0; },
      _state() { return { floor, lastTickAt, lastReconcileAt }; },
    };
  }

  global.SN_FEEDBACK_LIVE = {
    POLL_MS, RECONCILE_MS, OVERLAP_MS,
    diffVersions, applyChanges, windowFloor, inWindow, makeWatcher,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_FEEDBACK_LIVE;
}
