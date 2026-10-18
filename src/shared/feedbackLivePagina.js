// Il giro dal vivo dalla parte della pagina, uno per Gestione e Feedback: orologio, vista, esiti del main, fusione
// delle righe, puntatore e scorrimento. Non disegna: cosa ridisegnare lo dice la pagina negli agganci di `crea`.
// Regole: patterns/dati-che-cambiano-altrove-cloud-si-chiede-la-versione.md; logica pura in feedbackLive.js.

(function (global) {
  'use strict';

  const LIVE = () => global.SN_FEEDBACK_LIVE;

  function tipi() {
    const M = (global.SN_MSG && global.SN_MSG.MSG) || {};
    return {
      SUB: M.FEEDBACK_LIVE_SUBSCRIBE || 'feedback_live_subscribe',
      CHANGED: M.FEEDBACK_LIVE_CHANGED || 'feedback_live_changed',
      VISTA: M.TAB_IN_VISTA || 'tab_in_vista',
      VISTA_GET: M.TAB_IN_VISTA_GET || 'tab_in_vista_get',
    };
  }

  function conTempo(promessa, ms) {
    let t = null;
    return Promise.race([
      promessa,
      new Promise((_, rej) => { t = setTimeout(() => rej(new Error('nessuna risposta')), ms); }),
    ]).finally(() => clearTimeout(t));
  }

  // Agganci (tutti facoltativi tranne invia/pronta/righe/sostituisci):
  //   invia(msg) → Promise         pronta() → la prima lista è arrivata
  //   righe() / sostituisci(lista) la lista in mano     carica() → rilegge la prima lista
  //   decifra() → si decifrano le righe       sezioneDi(fb) → sezione o null (per gli arrivi)
  //   seguiti() → id da seguire (di base: in mano alle routine)   finestra() → createdAt (ms) del più vecchio tenuto
  //   dopoFusione() subito, senza letture     ridisegna({ ids, righe, removed }) solo in vista (può leggere)
  //   senzaNovita({ giro })  rileggiFusioni()  avvisi(testo)  segno()  quandoInVista()
  function crea(opts) {
    const o = opts || {};
    const T = tipi();
    const nome = o.nome || 'pagina';
    const avvisa = (testo, e) => console.warn(`[${nome}] ${testo}`, e ? (e.message || e) : '');
    const chiama = (fn, ...a) => (typeof fn === 'function' ? fn(...a) : undefined);

    const giroDalMain = ({ watch, force } = {}) => o.invia({ type: T.SUB, giro: true, watch, force: !!force });
    const sorgenti = o.sorgenti || {};
    if (typeof sorgenti.giro !== 'function') sorgenti.giro = giroDalMain;
    const L = LIVE();
    const tempi = {
      pollMs: L ? L.POLL_MS : 60000,
      rientroMs: L ? L.RIENTRO_MIN_MS : 15000,
      clockMs: L ? L.CLOCK_MS : 5000,
      bloccatoMs: L ? L.GIRO_BLOCCATO_MS : 90000,
    };

    let acceso = false;
    let bloccato = false;   // dati finti iniettati: non riparte nemmeno se l'avvio finisce dopo
    let orologioId = null;
    let tick = null;        // il giro in corso: uno alla volta
    let tickDa = 0;
    let gen = 0;            // un giro abbandonato perché appeso non scrive più sulla lista
    let ultimoAt = 0;
    let riuscitoAt = 0;
    let inVista = true;     // lo dice il main: in una scheda `document.hidden` non cambia mai
    let agganciato = false;
    let seguitiInviati = '';
    // Fuori vista non si legge: quello che servirebbe leggere aspetta il rientro.
    let riallineamentoRimandato = null;
    let fusioniDaRileggere = false;
    let ridisegnoRimandato = null;
    const arrivate = new Set();
    let coda = Promise.resolve();

    function vistaOra() {
      const doc = global.document;
      return inVista && !(doc && doc.hidden);
    }

    // Le fusioni del giro e degli avvisi passano in fila: due sulla stessa lista si pesterebbero.
    function inCoda(fn) {
      const p = coda.then(fn, fn);
      coda = p.catch(() => {});
      return p;
    }

    function fotoSezioni(lista) {
      const out = new Map();
      if (typeof o.sezioneDi !== 'function') return out;
      for (const f of (lista || o.righe() || [])) if (f && f._id) out.set(String(f._id), o.sezioneDi(f));
      return out;
    }

    function segnaArrivi(prima, lista) {
      if (!L || typeof o.sezioneDi !== 'function') return;
      for (const id of L.arrivi(prima, lista, o.sezioneDi)) arrivate.add(id);
    }

    function rileggiFusioni() {
      if (typeof o.rileggiFusioni !== 'function') return;
      if (!vistaOra()) { fusioniDaRileggere = true; return; }
      fusioniDaRileggere = false;
      o.rileggiFusioni();
    }

    // Il ridisegno della pagina può leggere (il dettaglio aperto, le schede da completare): fuori vista si
    // accumula e parte al rientro.
    function ridisegnaInVista(ids, righe, removed) {
      if (!vistaOra()) {
        const r = ridisegnoRimandato || { ids: new Set(), righe: [], removed: [] };
        for (const id of ids) r.ids.add(id);
        r.righe = r.righe.concat(righe);
        r.removed = r.removed.concat(removed);
        ridisegnoRimandato = r;
        return;
      }
      chiama(o.ridisegna, { ids, righe, removed });
    }

    // Righe già lette. `fresche`: solo quelle scritte dopo la copia in mano (la domanda per data torna indietro
    // di qualche minuto e rimanda righe già viste: rifonderle ridisegnerebbe per niente).
    async function fondi(fresh, { removed = [], fresche = false, g = gen } = {}) {
      const inMano = new Map((o.righe() || []).map((f) => [String(f && f._id), f && f._updateTime]));
      let righe = (Array.isArray(fresh) ? fresh : []).filter((r) => {
        if (!r || !r._id) return false;
        if (!fresche) return true;
        const mio = inMano.get(String(r._id));
        return !mio || !r._updateTime || r._updateTime > mio;
      });
      if (righe.length === 0 && removed.length === 0) {
        chiama(o.senzaNovita, { giro: true });
        return { changed: 0 };
      }
      if (righe.length > 0 && chiama(o.decifra)) {
        try {
          const r = await conTempo(o.invia({ type: 'feedback_decrypt_fields', list: righe }), 30000);
          if (r && r.ok && Array.isArray(r.list)) righe = r.list;
        } catch (_) { /* come al caricamento: valori cifrati piuttosto che niente */ }
      }
      if (g !== gen) return { changed: 0 };
      const attuali = o.righe() || [];
      const ids = righe.map((f) => f && f._id).filter(Boolean);
      const prima = fotoSezioni(attuali);
      const statiMossi = L.statoCambiato(attuali, righe);
      o.sostituisci(L.applyChanges(attuali, { fresh: righe, removed }));
      segnaArrivi(prima, righe);
      if (statiMossi) rileggiFusioni();
      chiama(o.dopoFusione);
      ridisegnaInVista(new Set(ids), righe, removed);
      aggiornaSeguiti();
      return { changed: ids.length + removed.length };
    }

    // Versioni → differenze → rilettura dei soli cambiati. Una lettura interrotta non fa uscire nessuno:
    // «non l'ho visto» non vuol dire «non c'è».
    async function riallinea(remote, { complete = true, g = gen } = {}) {
      if (!Array.isArray(remote)) throw new Error('versioni non lette');
      const { changed, added, removed } = L.diffVersions(o.righe() || [], remote);
      const ids = changed.concat(L.nellaFinestra(added, remote, chiama(o.finestra) || null));
      const fresh = ids.length > 0 ? await sorgenti.getMany(ids) : [];
      if (g !== gen) return { changed: 0 };
      return fondi(fresh, { removed: complete ? removed : [], g });
    }

    function applicaEsito(esito, g = gen) {
      return inCoda(async () => {
        if (!esito || !o.pronta()) return { changed: 0 };
        if (Array.isArray(esito.avvisi) || esito.kind === 'changed' || esito.kind === 'reconcile') {
          const testo = (Array.isArray(esito.avvisi) ? esito.avvisi : []).filter(Boolean).join(' · ');
          if (testo) avvisa(`giro: ${testo}`);
          chiama(o.avvisi, testo);
        }
        if (esito.kind === 'reconcile') {
          if (!vistaOra()) { riallineamentoRimandato = esito; return { changed: 0 }; }
          return riallinea(esito.versions, { complete: esito.complete !== false, g });
        }
        if (esito.kind === 'changed') return fondi(esito.rows, { fresche: true, g });
        chiama(o.senzaNovita, { giro: false });
        return { changed: 0 };
      });
    }

    // L'esito di un giro chiesto da un'altra pagina: le sue righe valgono anche fuori vista (il cursore del
    // main è andato avanti), le letture che servirebbero aspettano il rientro.
    function daAltraPagina(m) {
      if (!acceso || bloccato || !o.pronta()) return;
      applicaEsito(m).catch((e) => avvisa('aggiornamento:', e));
    }

    // Un giro: si chiede al main, si fonde l'esito. Ritorna { changed }; uno già in corso si riusa.
    function giro({ force = false } = {}) {
      if (tick) return tick;
      const g = ++gen;
      tickDa = Date.now();
      tick = (async () => {
        const watch = seguitiOra();
        seguitiInviati = watch.join(',');
        const r = await sorgenti.giro({ watch, force });
        if (g !== gen) return { changed: 0 };
        if (!r || r.ok !== true) throw new Error((r && r.error) || 'giro non riuscito');
        if (r.scartati) avvisa(`giro: ${r.scartati} seguiti oltre il tetto`);
        const out = await applicaEsito(r.giro || { kind: 'skipped' }, g);
        riuscitoAt = Date.now();
        return out;
      })().finally(() => {
        if (g === gen) { tick = null; tickDa = 0; }
        ultimoAt = Date.now();
        chiama(o.segno);
      });
      return tick;
    }

    // I feedback in mano alle routine: di loro il giro chiede l'ora di Firestore, perché chi li scrive può non
    // firmare la sua. Tutti, senza campione della coda: il prossimo lo dice al main il registro dei worker (#676.1).
    function seguitiOra() {
      const MR = global.SN_MANAGE_REVIEW;
      const ids = typeof o.seguiti === 'function' ? o.seguiti()
        : (o.righe() || []).filter((fb) => fb && fb._id && MR && MR.workProgress(fb)).map((fb) => fb._id);
      return Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
    }

    function inviaSeguiti() {
      const watch = seguitiOra();
      seguitiInviati = watch.join(',');
      return Promise.resolve().then(() => o.invia({ type: T.SUB, watch })).catch(() => {});
    }

    // Chi va seguito è cambiato: il main lo sa subito (costa un messaggio, non letture).
    function aggiornaSeguiti() {
      if (!acceso || bloccato || sorgenti.giro !== giroDalMain) return;
      if (seguitiOra().join(',') === seguitiInviati) return;
      inviaSeguiti();
    }

    function orologio(motivo) {
      if (!acceso || !L) return;
      const ora = Date.now();
      if (tick && ora - tickDa >= tempi.bloccatoMs) {
        avvisa('aggiornamento: un giro non ha avuto risposta, ne parte un altro');
        gen += 1;
        tick = null;
        tickDa = 0;
      }
      const scelta = L.decidiGiro({
        ora, motivo, inVista: vistaOra(), dataLoaded: !!o.pronta(),
        ultimoGiro: ultimoAt, giroDa: tick ? tickDa : 0,
        pollMs: tempi.pollMs, rientroMs: tempi.rientroMs,
      });
      chiama(o.segno);
      if (scelta === 'carica') {
        // La prima lista non è arrivata: si ritenta da soli invece di lasciare l'errore finché non si ricarica.
        ultimoAt = ora;
        Promise.resolve().then(() => chiama(o.carica)).catch(() => {});
      } else if (scelta === 'giro') {
        giro().catch((e) => avvisa('aggiornamento:', e));
      }
    }

    // Tornati in vista: quello che aspettava parte adesso.
    function recupera() {
      if (!vistaOra() || !o.pronta()) return;
      if (riallineamentoRimandato) {
        const e = riallineamentoRimandato;
        riallineamentoRimandato = null;
        applicaEsito(e).catch((err) => avvisa('aggiornamento:', err));
      }
      if (fusioniDaRileggere) rileggiFusioni();
      if (ridisegnoRimandato) {
        const r = ridisegnoRimandato;
        ridisegnoRimandato = null;
        chiama(o.ridisegna, r);
      }
      chiama(o.quandoInVista);
    }

    function impostaVista(v) {
      const era = vistaOra();
      inVista = v !== false;
      if (!era && vistaOra()) { orologio('rientro'); recupera(); } else chiama(o.segno);
    }

    function armaOrologio() {
      if (orologioId) clearInterval(orologioId);
      orologioId = setInterval(() => orologio('battito'), tempi.clockMs);
    }

    function aggancia() {
      if (agganciato) return;
      agganciato = true;
      const doc = global.document;
      if (doc && doc.addEventListener) {
        doc.addEventListener('visibilitychange', () => { orologio('rientro'); recupera(); });
      }
      if (global.filo && typeof global.filo.onBroadcast === 'function') {
        global.filo.onBroadcast((m) => {
          if (!m) return;
          if (m.type === T.VISTA) impostaVista(m.inVista);
          else if (m.type === T.CHANGED) daAltraPagina(m);
        });
      }
    }

    function start() {
      if (!L || acceso || bloccato) return;
      acceso = true;
      armaOrologio();
      aggancia();
      Promise.resolve().then(() => o.invia({ type: T.VISTA_GET }))
        .then((r) => { if (r && r.ok && typeof r.inVista === 'boolean') impostaVista(r.inVista); })
        .catch(() => {});
      if (sorgenti.giro === giroDalMain) inviaSeguiti();
    }

    function stop() {
      const era = acceso;
      acceso = false;
      if (orologioId) { clearInterval(orologioId); orologioId = null; }
      if (era) Promise.resolve().then(() => o.invia({ type: T.SUB, off: true })).catch(() => {});
    }

    if (typeof global.addEventListener === 'function') {
      global.addEventListener('pagehide', () => {
        Promise.resolve().then(() => o.invia({ type: T.SUB, off: true })).catch(() => {});
      });
    }

    return {
      start, stop, giro, applicaEsito, orologio, impostaVista, aggiornaSeguiti, fotoSezioni, segnaArrivi,
      arrivate, sorgenti, giroDalMain,
      seguiti: seguitiOra,
      inVista: vistaOra,
      acceso: () => acceso,
      okAt: () => riuscitoAt,
      ferma: () => !!L && L.listaFerma({ ora: Date.now(), inVista: vistaOra(), ultimoRiuscito: riuscitoAt }),
      // Una lettura completa appena fatta vale un giro riuscito.
      segnaRiuscito() { ultimoAt = Date.now(); riuscitoAt = ultimoAt; },
      blocca(v) { bloccato = v !== false; },
      // Gli spec accorciano le soglie: un giro vero ogni minuto farebbe aspettare minuti.
      tempi(t) { Object.assign(tempi, t || {}); if (acceso) armaOrologio(); },
      // Dopo dati finti uno spec che vuole il giro INTERO (main → pagina) lo riapre da qui.
      riprendi() { bloccato = false; sorgenti.giro = giroDalMain; stop(); start(); },
    };
  }

  // Il puntatore sulla lista: chi la sta usando non se la vede rimescolare sotto (LISTA_IN_USO_MS).
  // `azioni`: selettore dei pulsanti; col puntatore fermo sopra uno di quelli la lista aspetta (#509).
  function seguiPuntatore(el, { quandoLibera = null, azioni = null } = {}) {
    let mossaAt = 0;
    let premuta = false;
    let suAzione = false;
    let rimandata = null;
    const libera = () => { if (typeof quandoLibera === 'function') quandoLibera(); };
    if (el) {
      el.addEventListener('pointermove', (e) => {
        mossaAt = Date.now();
        if (azioni) suAzione = !!(e.target && e.target.closest && e.target.closest(azioni));
      });
      el.addEventListener('pointerdown', () => { premuta = true; mossaAt = Date.now(); });
      global.addEventListener('pointerup', () => { premuta = false; }, true);
      el.addEventListener('pointerleave', () => { mossaAt = 0; premuta = false; suAzione = false; libera(); });
    }
    return {
      occupata() {
        const L = LIVE();
        return !!L && L.listaInUso({ ora: Date.now(), ultimoMovimento: mossaAt, premuto: premuta || suAzione });
      },
      rimanda() {
        if (rimandata) return;
        const L = LIVE();
        rimandata = setTimeout(() => { rimandata = null; libera(); }, L ? L.LISTA_IN_USO_MS : 1500);
      },
      annulla() { if (rimandata) { clearTimeout(rimandata); rimandata = null; } },
    };
  }

  // Ridisegna tenendo lo scorrimento sulla prima voce visibile (non sui pixel: se ne esce una più su, la vista
  // non salta); chi è in cima resta in cima, o una voce arrivata lassù finirebbe fuori vista.
  // `voci`: selettore delle voci con `data-id`; `scorre()`: l'elemento che scorre, o null.
  function alSuoPosto({ lista, voci, scorre }, ridisegna) {
    const L = LIVE();
    const doc = global.document;
    const radice = doc && (doc.scrollingElement || doc.documentElement);
    const righe = (sc) => {
      const cima = sc === radice ? 0 : sc.getBoundingClientRect().top;
      const base = cima - sc.scrollTop;
      return Array.from(lista.querySelectorAll(voci)).map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.id, top: r.top - base, height: r.height };
      });
    };
    const sc = L && lista ? scorre() : null;
    const prima = sc ? sc.scrollTop : 0;
    const ancora = sc && prima > 0 ? L.ancoraScorrimento(righe(sc), prima) : null;
    ridisegna();
    const dopo = L && lista ? scorre() : null;
    if (dopo) dopo.scrollTop = L.scrollDaAncora(ancora, righe(dopo), prima);
  }

  global.SN_FEEDBACK_LIVE_PAGINA = { crea, seguiPuntatore, alSuoPosto };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_FEEDBACK_LIVE_PAGINA;
}
