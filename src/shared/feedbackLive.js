// Aggiornamento continuo della Gestione: la logica pura (confronto, fusione,
// quando girare, cosa è arrivato, dove tenere lo scorrimento), senza rete.
// Le regole: patterns/dati-che-cambiano-altrove-cloud-si-chiede-la-versione.md
// e patterns/chi-guarda-in-continuo-chiede-cosa-e-cambiato.md (#676).

(function (global) {
  'use strict';

  // Un giro a vuoto costa una lettura: un minuto tiene il passo con le routine.
  const POLL_MS = 60 * 1000;

  // L'orologio della pagina: decide soltanto, non legge niente.
  const CLOCK_MS = 5 * 1000;

  // Tornando in vista si rilegge subito, ma non per un'assenza più breve di
  // così: chi salta fra due schede non deve pagare un giro a ogni salto.
  const RIENTRO_MIN_MS = 15 * 1000;

  // Un giro appeso (una risposta che non torna) fermava tutti i successivi
  // per sempre: oltre questo tempo si abbandona e se ne fa uno nuovo.
  const GIRO_BLOCCATO_MS = 90 * 1000;

  // Oltre questo tempo senza un giro riuscito la lista lo dice: una lista
  // ferma che sembra viva fa credere che non sia successo niente.
  const FERMA_DOPO_MS = 3 * POLL_MS;

  // Chi sta puntando la lista non se la vede rimescolare sotto il cursore
  // (patterns/un-clic-una-scheda-nessuna-azione-ricompone-la-lista.md).
  const LISTA_IN_USO_MS = 1500;

  // Il riallineamento completo, raro: è l'unica domanda che vede le
  // cancellazioni e le scritture di chi non firma `updatedAt`.
  const RECONCILE_MS = 30 * 60 * 1000;

  // Margine sull'ora firmata da chi scrive: le macchine hanno orologi diversi.
  const OVERLAP_MS = 2 * 60 * 1000;

  // Seguiti da vicino (una lettura ciascuno a giro): largo e letto a pezzi;
  // sopra, il giro lo dice e si riallinea (#676.2).
  const SEGUITI_TETTO = 500;

  // Un feedback indicato dal registro dei worker resta seguito finché la
  // pagina non lo segue da sé, e al più per questo tempo.
  const REGISTRO_SEGUI_MS = 30 * 60 * 1000;

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

  // `createdAt` arriva come data o come testo ISO (sotto-feedback creati dal
  // server): l'ordine deve valere per tutti e due.
  function createdMs(fb) {
    const v = fb && fb.createdAt;
    if (v && typeof v === 'object') {
      const sec = Number(v.seconds != null ? v.seconds : v._seconds);
      if (Number.isFinite(sec)) return sec * 1000;
    }
    const t = new Date(v || 0).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  // Applica un giro alla lista: i documenti `fresh` sostituiscono (o
  // aggiungono) quelli con lo stesso id, gli id `removed` escono. Ritorna una
  // lista NUOVA, dal più recente al più vecchio come quella del caricamento
  // iniziale; la lista d'ingresso non viene toccata.
  // La riga appena riletta prende il posto di quella vecchia SOLO se ne sa
  // almeno altrettanto. Il giro rilegge una proiezione (niente conversazione,
  // niente allegati): lasciargliela sostituire buttava via il documento intero
  // già in mano e la nota che una lettura non era tornata, e la pagina le
  // ricomprava al primo clic mostrando intanto «Caricamento…» al posto di un
  // report che aveva già.
  function fondi(vecchio, nuovo) {
    if (!vecchio || !nuovo || !nuovo._proiezione) return nuovo;
    const fuso = { ...vecchio, ...nuovo };
    if (!vecchio._proiezione) {
      // Il documento c'è, ma sul server è cambiato: si mostra questo e si
      // rilegge quando serve, invece di svuotare il pannello adesso.
      delete fuso._proiezione;
      fuso._dettaglioVecchio = true;
    }
    // Una lettura che non è tornata resta tale finché non è l'utente a
    // riprovare: un giro in sottofondo che la dimentica la fa ricomprare a
    // ogni clic, che è il conto che non si voleva più pagare.
    if (vecchio._dettaglioMancato) fuso._dettaglioMancato = vecchio._dettaglioMancato;
    return fuso;
  }

  function applyChanges(list, { fresh = [], removed = [] } = {}) {
    const drop = new Set((removed || []).map(String));
    const byId = new Map();
    for (const fb of Array.isArray(list) ? list : []) {
      if (fb && fb._id && !drop.has(String(fb._id))) byId.set(String(fb._id), fb);
    }
    for (const fb of Array.isArray(fresh) ? fresh : []) {
      if (!fb || !fb._id) continue;
      const mia = byId.get(String(fb._id));
      // Una copia più vecchia di quella in mano non vince: il giro avvisa
      // tutte le pagine, e una appena caricata può ricevere un annuncio vecchio.
      if (mia && mia._updateTime && fb._updateTime && fb._updateTime < mia._updateTime) continue;
      byId.set(String(fb._id), fondi(mia, fb));
    }
    return Array.from(byId.values()).sort((a, b) => createdMs(b) - createdMs(a));
  }

  // Cosa fare a un battito dell'orologio. `motivo`: 'battito' | 'rientro'.
  //   'fermo'   — nessuno guarda: non si legge niente;
  //   'attendi' — l'ultimo giro è troppo recente;
  //   'carica'  — la prima lista non è mai arrivata: la si ritenta;
  //   'giro'    — si chiedono le versioni.
  // Un giro in corso da troppo si considera perso (vedi GIRO_BLOCCATO_MS).
  function decidiGiro({
    ora, inVista, dataLoaded, ultimoGiro, giroDa, motivo,
    pollMs = POLL_MS, rientroMs = RIENTRO_MIN_MS,
  } = {}) {
    if (!inVista) return 'fermo';
    const now = Number(ora) || 0;
    if (giroDa && now - giroDa < GIRO_BLOCCATO_MS) return 'attendi';
    const trascorso = now - (Number(ultimoGiro) || 0);
    if (trascorso < (motivo === 'rientro' ? rientroMs : pollMs)) return 'attendi';
    return dataLoaded ? 'giro' : 'carica';
  }

  // La lista va segnalata come ferma? Solo a chi la sta guardando.
  function listaFerma({ ora, inVista, ultimoRiuscito } = {}) {
    if (!inVista || !ultimoRiuscito) return false;
    return (Number(ora) || 0) - ultimoRiuscito >= FERMA_DOPO_MS;
  }

  // Gli id che un giro ha portato in una sezione DIVERSA da quella in cui li
  // si vedeva (o nuovi): sono quelli che l'owner deve notare. `prima` è una
  // Map id → sezione, `sezioneDi(fb)` la regola delle sezioni.
  function arrivi(prima, dopo, sezioneDi) {
    const out = new Set();
    const vecchie = prima instanceof Map ? prima : new Map();
    for (const fb of Array.isArray(dopo) ? dopo : []) {
      if (!fb || !fb._id) continue;
      const id = String(fb._id);
      const ora = sezioneDi(fb);
      if (!ora) continue;
      if (vecchie.get(id) !== ora) out.add(id);
    }
    return out;
  }

  // Un giro ha cambiato lo stato di qualcuno? Allora le richieste di fusione
  // vanno rilette: una pratica ferma al cancello senza la sua richiesta in
  // mano mostra il quadrato ma non i tasti per approvarla.
  function statoCambiato(vecchi, freschi) {
    const byId = new Map();
    for (const fb of Array.isArray(vecchi) ? vecchi : []) if (fb && fb._id) byId.set(String(fb._id), fb);
    for (const fb of Array.isArray(freschi) ? freschi : []) {
      if (!fb || !fb._id) continue;
      const v = byId.get(String(fb._id));
      if (!v) return true;
      if (String(v.status || '') !== String(fb.status || '')) return true;
      if (String(v.statusReason || '') !== String(fb.statusReason || '')) return true;
    }
    return false;
  }

  // Lo scorrimento si tiene sulla prima scheda visibile, non in pixel: se una
  // scheda sopra esce dalla sezione, i pixel farebbero saltare la vista.
  //   righe: [{ id, top }] (top relativo al contenuto della lista)
  function ancoraScorrimento(righe, scrollTop) {
    const top = Number(scrollTop) || 0;
    for (const r of Array.isArray(righe) ? righe : []) {
      if (r && r.id && Number(r.top) + (Number(r.height) || 0) > top) {
        return { id: String(r.id), delta: top - Number(r.top) };
      }
    }
    return null;
  }

  // Lo scorrimento che rimette l'ancora dov'era; se l'ancora è uscita, quello
  // di prima così com'è.
  function scrollDaAncora(ancora, righe, scrollPrima) {
    if (!ancora) return Number(scrollPrima) || 0;
    const r = (Array.isArray(righe) ? righe : []).find((x) => x && String(x.id) === ancora.id);
    if (!r) return Number(scrollPrima) || 0;
    return Math.max(0, Number(r.top) + ancora.delta);
  }

  // L'owner sta usando la lista adesso (tasto premuto, o puntatore mosso sopra
  // da poco)? Allora il ridisegno aspetta.
  function listaInUso({ ora, ultimoMovimento, premuto } = {}) {
    if (premuto) return true;
    if (!ultimoMovimento) return false;
    return (Number(ora) || 0) - ultimoMovimento < LISTA_IN_USO_MS;
  }


  // ── Il giro dei cambiati, con l'I/O iniettato (#676) ─────────────────────
  // Vive nel main, uno per tutte le Gestioni, e non ha un orologio suo: gira
  // solo quando una pagina IN VISTA lo chiede (decidiGiro). La domanda per data
  // è la scorciatoia; i segni senza orologio (ora di Firestore dei seguiti,
  // contatore degli invii, registro dei worker) coprono chi non firma l'ora.
  //
  // deps:
  //   listChangedSince({ since }) → { rows, complete }
  //   listVersions()              → { versions:[{ _id, _updateTime }], complete }
  //   seguiti()                   → [id] seguiti da vicino dalle pagine
  //   versionsOf(ids)             → [{ _id, _updateTime }] (a pezzi, tutti)
  //   readRows(ids)               → righe della lista
  //   submissionCount()           → intero | null
  //   avviiRoutine()              → [{ startedAt, num, role }]; lancia se illeggibile
  //   idDelNumero(num)            → id del feedback | null
  function makeWatcher({
    listChangedSince, listVersions,
    seguiti = null, versionsOf = null, readRows = null, submissionCount = null,
    avviiRoutine = null, idDelNumero = null,
    now = () => Date.now(), pollMs = POLL_MS, reconcileMs = RECONCILE_MS,
    overlapMs = OVERLAP_MS, seguitiTetto = SEGUITI_TETTO, registroSeguiMs = REGISTRO_SEGUI_MS,
    onWarn = null,
  } = {}) {
    let lastTickAt = 0;
    let lastReconcileAt = 0;
    let inFlight = null;
    let versioniSeguite = new Map();   // id → `_updateTime` visto
    let inviiVisti = null;
    let avviiVisti = null;             // chiavi del registro già viste; null = mai letto
    const daRegistro = new Map();      // id → quando il registro l'ha indicato
    let avvisi = [];

    function avvisa(m) {
      avvisi.push(m);
      if (onWarn) onWarn(m);
    }
    const motivo = (e) => (e && e.message ? e.message : String(e));

    // Il confine della domanda si prende dall'ora del SERVER (commit visti, ora della lettura), mai da quella del PC:
    // un PC avanti di tre minuti non vedeva più niente (verifica locale letture-delta, r2). Il PC solo finché manca.
    let oraServer = 0;
    function oraDi(r) {
      const t = Date.parse(r && r._updateTime);
      if (Number.isFinite(t)) return t;
      const u = Date.parse(r && r.updatedAt);
      return Number.isFinite(u) ? u : 0;
    }
    function vedi(righe, readTime) {
      for (const r of Array.isArray(righe) ? righe : []) oraServer = Math.max(oraServer, oraDi(r));
      const rt = Date.parse(readTime);
      if (Number.isFinite(rt)) oraServer = Math.max(oraServer, rt);
    }

    function since() {
      const base = oraServer || lastTickAt || (now() - overlapMs);
      return new Date(Math.max(0, base - overlapMs)).toISOString();
    }

    async function contaInvii(precedente) {
      if (typeof submissionCount !== 'function') return precedente;
      try {
        const n = await submissionCount();
        return Number.isInteger(n) ? n : precedente;
      } catch (e) {
        avvisa(`contatore invii non letto: ${motivo(e)}`);
        return precedente;
      }
    }

    // Le voci del registro mai viste prima. Un registro illeggibile non vale
    // «registro vuoto»: si tiene quello che si sapeva (#676.1).
    async function nuoviAvvii() {
      if (typeof avviiRoutine !== 'function') return [];
      let entries;
      try { entries = await avviiRoutine(); } catch (e) {
        avvisa(`registro dei worker non letto: ${motivo(e)}`);
        return [];
      }
      if (!Array.isArray(entries)) { avvisa('registro dei worker non letto'); return []; }
      const chiave = (e) => `${e && e.startedAt}|${e && e.num}|${e && e.role}`;
      const prima = avviiVisti;
      avviiVisti = new Set(entries.map(chiave));
      if (prima === null) return [];
      return entries.filter((e) => e && !prima.has(chiave(e)));
    }

    // Il registro dice QUALE feedback le routine hanno preso: lo si rilegge
    // subito e lo si mette fra i seguiti, invece di rileggere tutta la lista.
    async function dalRegistro() {
      const ids = [];
      for (const e of await nuoviAvvii()) {
        const num = String((e && e.num) || '').replace(/^#/, '').trim();
        if (!num || typeof idDelNumero !== 'function') continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          const id = await idDelNumero(num);
          if (id) { daRegistro.set(String(id), now()); ids.push(String(id)); }
        } catch (err) {
          // Senza id non lo si può seguire: lo trova il riallineamento.
          avvisa(`#${num} del registro non trovato: ${motivo(err)}`);
          lastReconcileAt = 0;
        }
      }
      if (ids.length === 0 || typeof readRows !== 'function') return [];
      const rows = await readRows(ids);
      vedi(rows);
      for (const r of Array.isArray(rows) ? rows : []) {
        if (r && r._id) versioniSeguite.set(String(r._id), r._updateTime || null);
      }
      return Array.isArray(rows) ? rows : [];
    }

    // Seguiti: quelli delle pagine (in mano alle routine) più quelli indicati
    // dal registro, finché la pagina non li segue da sé o non scadono. Sopra il
    // tetto non si taglia in silenzio: si dice e ci si riallinea (#676.2).
    async function daiSeguiti() {
      if (typeof versionsOf !== 'function' || typeof readRows !== 'function') return [];
      const dallePagine = typeof seguiti === 'function' ? (seguiti() || []).map(String).filter(Boolean) : [];
      const seguitiDallePagine = new Set(dallePagine);
      const ora = now();
      for (const [id, da] of daRegistro) {
        if (seguitiDallePagine.has(id) || ora - da > registroSeguiMs) daRegistro.delete(id);
      }
      const tutti = Array.from(new Set([...dallePagine, ...daRegistro.keys()]));
      const ids = tutti.slice(0, seguitiTetto);
      if (tutti.length > ids.length) {
        avvisa(`seguiti: ${tutti.length} sopra il tetto di ${seguitiTetto}, riallineamento completo al giro dopo`);
        lastReconcileAt = 0;
      }
      if (ids.length === 0) return [];
      const vers = await versionsOf(ids);
      const mossi = [];
      for (const v of Array.isArray(vers) ? vers : []) {
        if (!v || !v._id) continue;
        const id = String(v._id);
        const t = v._updateTime || null;
        if (!versioniSeguite.has(id)) versioniSeguite.set(id, t); // primo avvistamento: si prende nota
        else if (versioniSeguite.get(id) !== t) mossi.push([id, t]);
      }
      if (mossi.length === 0) return [];
      const rows = await readRows(mossi.map(([id]) => id));
      vedi(rows);
      // Segnata dopo la rilettura: se fallisce, il giro dopo riprova.
      for (const [id, t] of mossi) versioniSeguite.set(id, t);
      return Array.isArray(rows) ? rows : [];
    }

    async function reconcile() {
      const startedAt = now();
      const out = await listVersions();
      const versions = out && Array.isArray(out.versions) ? out.versions : null;
      if (!versions) throw new Error('versioni non lette');
      if (out.complete === false) avvisa('riallineamento: lettura interrotta dal freno sulle pagine');
      versioniSeguite = new Map(versions.map((v) => [String(v._id), v._updateTime || null]));
      vedi(versions, out.readTime);
      inviiVisti = await contaInvii(inviiVisti);
      await nuoviAvvii();
      lastReconcileAt = startedAt;
      lastTickAt = startedAt;
      return { kind: 'reconcile', versions, complete: out.complete !== false };
    }

    async function incremental() {
      const startedAt = now();
      const out = await listChangedSince({ since: since() });
      const tutte = (out && Array.isArray(out.rows)) ? out.rows : [];
      vedi(tutte, out && out.readTime);
      if (out && out.complete === false) {
        avvisa('cambiati: troppe pagine, riallineamento completo al giro dopo');
        lastReconcileAt = 0;
      }
      // Si CONTANO gli invii arrivati: «almeno uno» lascerebbe passare il
      // secondo di due, se quello aveva l'orologio indietro.
      const invii = await contaInvii(inviiVisti);
      if (Number.isInteger(invii) && Number.isInteger(inviiVisti) && invii > inviiVisti) {
        const arrivate = tutte.filter((r) => Number(r && r.seq) > inviiVisti).length;
        if (arrivate < invii - inviiVisti) lastReconcileAt = 0;
      }
      inviiVisti = invii;

      // Il margine rilegge le righe dei giri prima: una versione già vista non è un cambiamento.
      const perId = new Map();
      for (const r of tutte) {
        if (!r || !r._id) continue;
        const id = String(r._id);
        if (r._updateTime && versioniSeguite.get(id) === r._updateTime) continue;
        versioniSeguite.set(id, r._updateTime || null);
        perId.set(id, r);
      }
      for (const r of await dalRegistro()) if (r && r._id) perId.set(String(r._id), r);
      for (const r of await daiSeguiti()) if (r && r._id) perId.set(String(r._id), r);
      lastTickAt = startedAt;
      return { kind: 'changed', rows: Array.from(perId.values()) };
    }

    async function run(force) {
      avvisi = [];
      if (!force && lastTickAt && (now() - lastTickAt) < pollMs / 2) return { kind: 'skipped' };
      const pieno = !lastReconcileAt || (now() - lastReconcileAt) >= reconcileMs;
      const r = pieno ? await reconcile() : await incremental();
      return avvisi.length ? { ...r, avvisi: avvisi.slice() } : r;
    }

    return {
      /** Un giro per volta: una raffica si fonde nel giro già in corso. */
      tick(opts) {
        if (inFlight) return inFlight;
        inFlight = run(!!(opts && opts.force)).finally(() => { inFlight = null; });
        return inFlight;
      },
      // Una pagina ha appena letto tutto: vale come riallineamento. Il cursore
      // però non torna avanti se c'era già: una Gestione nascosta da ore deve
      // ricevere al rientro quello che è cambiato mentre non guardava.
      allineato(at) {
        const t = Number(at) || now();
        lastReconcileAt = Math.max(lastReconcileAt, t);
        if (!lastTickAt) lastTickAt = t;
      },
      forceReconcile() { lastReconcileAt = 0; },
      seguitiDalRegistro() { return Array.from(daRegistro.keys()); },
      _state() { return { lastTickAt, lastReconcileAt, inviiVisti }; },
    };
  }

  global.SN_FEEDBACK_LIVE = {
    POLL_MS, CLOCK_MS, RIENTRO_MIN_MS, GIRO_BLOCCATO_MS, FERMA_DOPO_MS, LISTA_IN_USO_MS,
    RECONCILE_MS, OVERLAP_MS, SEGUITI_TETTO, REGISTRO_SEGUI_MS, createdMs,
    diffVersions, applyChanges, decidiGiro, listaFerma, arrivi, statoCambiato,
    ancoraScorrimento, scrollDaAncora, listaInUso, makeWatcher,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_FEEDBACK_LIVE;
}
