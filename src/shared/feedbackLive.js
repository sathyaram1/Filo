// Aggiornamento continuo della Gestione: la logica pura (confronto, fusione,
// quando girare, cosa è arrivato, dove tenere lo scorrimento), senza rete.
// Le regole: patterns/dati-che-cambiano-altrove-cloud-si-chiede-la-versione.md.

(function (global) {
  'use strict';

  // Un giro costa una lettura per feedback in pagina (500 al tetto): un minuto
  // tiene il passo con le routine, che lavorano per minuti.
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
      if (fb && fb._id) byId.set(String(fb._id), fondi(byId.get(String(fb._id)), fb));
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

  global.SN_FEEDBACK_LIVE = {
    POLL_MS, CLOCK_MS, RIENTRO_MIN_MS, GIRO_BLOCCATO_MS, FERMA_DOPO_MS, LISTA_IN_USO_MS,
    diffVersions, applyChanges, decidiGiro, listaFerma, arrivi, statoCambiato,
    ancoraScorrimento, scrollDaAncora, listaInUso,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_FEEDBACK_LIVE;
}
