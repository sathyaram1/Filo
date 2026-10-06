// Le pagine aperte nelle schede diventano eventi di navigazione del filo (#866), uno per pagina e col suo titolo.
// Non decide dove si scrive né cosa resta in memoria: lo fa src/main/services/ilFilo.js con la finestra che dice
// se è incognito. Regole: patterns/il-filo-cresce-solo-in-coda-e-cancellare-e-un-evento.md

// Il titolo vero arriva col caricamento; una pagina che non finisce mai di caricarsi si scrive lo stesso.
const TETTO_CARICAMENTO = 15_000;
// Un cambio di indirizzo dentro la pagina (YouTube, Gmail) non si carica: il titolo nuovo arriva poco dopo.
const ATTESA_TITOLO_IN_PAGINA = 4_000;
// Il titolo che la pagina si dà dopo (un'app web, «Caricamento…» che diventa il nome vero) vale quando resta fermo un
// attimo: nel primo mezzo minuto si scrive subito, dopo all'uscita, così un titolo che cambia di continuo non riempie il filo.
const ASSESTAMENTO_TITOLO = 1_500;
const FINESTRA_TITOLO = 30_000;

const registrabile = (url) => /^(https?|file):/i.test(String(url || ''));
const senzaFrammento = (url) => String(url || '').split('#')[0];

// history.replaceState non aggiunge voci né sposta quella attiva: è così che si distingue da una pagina nuova.
// La voce dietro serve a cronologia piena (50 voci): lì una pagina nuova toglie la più vecchia e indice e lunghezza restano.
function voceAttiva(wc) {
  try {
    const h = wc.navigationHistory;
    const i = h.getActiveIndex();
    const n = h.length();
    if (!Number.isInteger(i) || !Number.isInteger(n)) return null;
    const dietro = i > 0 ? String((h.getEntryAtIndex(i - 1) || {}).url || '') : '';
    return { i, n, dietro };
  } catch (_) { return null; }
}

class VisiteSchede {
  constructor({ incognito = false, registra, aggiorna, tempi } = {}) {
    this.incognito = !!incognito;
    this.tempi = { assestamento: ASSESTAMENTO_TITOLO, finestra: FINESTRA_TITOLO, ...(tempi || {}) };
    this.registra = registra || ((visita, opts) => require('../services/ilFilo').registraVisita(visita, opts));
    this.aggiorna = aggiorna || ((dato, opts) => require('../services/ilFilo').aggiornaTitolo(dato, opts));
    this.inAttesa = new Map();
    this.scritte = new WeakMap();
    this.ultime = new WeakMap();
    this.voci = new WeakMap();
  }

  // Ricaricare, o cambiare solo il frammento (#sezione), non è una pagina nuova.
  navigata(wc, scheda, url, { inPagina = false } = {}) {
    const voce = voceAttiva(wc);
    const vocePrima = this.voci.get(wc);
    if (voce) this.voci.set(wc, voce); else this.voci.delete(wc);
    // La pagina che riscrive la propria voce (una mappa spostata, un filtro) resta la stessa visita, come nei browser.
    if (inPagina && voce && vocePrima && voce.i === vocePrima.i && voce.n === vocePrima.n
      && voce.dietro === vocePrima.dietro) {
      if (!registrabile(url)) return;
      this.ultime.set(wc, url);
      const v = this.inAttesa.get(wc);
      if (v) v.url = url;
      return;
    }
    this.scrivi(wc, { titoloAttuale: false });
    if (!registrabile(url)) { this.lascia(wc); return; }
    const prima = this.ultime.get(wc);
    if (prima && senzaFrammento(prima) === senzaFrammento(url)) return;
    this.lascia(wc);
    this.ultime.set(wc, url);
    const v = { wc, url, scheda, ts: new Date().toISOString(), titolo: '', inPagina };
    v.timer = setTimeout(() => this.scrivi(wc), inPagina ? ATTESA_TITOLO_IN_PAGINA : TETTO_CARICAMENTO);
    if (v.timer && v.timer.unref) v.timer.unref();
    this.inAttesa.set(wc, v);
  }

  // Una scheda ripristinata dalla sessione di prima non è una visita: la sua pagina il filo l'ha già.
  giaVista(wc, url) {
    if (wc && registrabile(url)) this.ultime.set(wc, url);
  }

  titolo(wc, titolo) {
    if (!titolo) return;
    const v = this.inAttesa.get(wc);
    if (v) {
      v.titolo = String(titolo);
      if (v.inPagina) this.scrivi(wc);
      return;
    }
    const s = this.scritte.get(wc);
    if (!s) return;
    s.ultimo = String(titolo);
    s.cambiato = Date.now();
    clearTimeout(s.timer);
    s.timer = null;
    if (s.ultimo === s.scritto || Date.now() - s.nata > this.tempi.finestra) return;
    s.timer = setTimeout(() => this.fissaTitolo(s), this.tempi.assestamento);
    if (s.timer && s.timer.unref) s.timer.unref();
  }

  fissaTitolo(s) {
    clearTimeout(s.timer);
    s.timer = null;
    if (!s.ultimo || s.ultimo === s.scritto) return;
    const titolo = s.ultimo;
    s.scritto = titolo;
    s.id
      .then((visita) => (visita ? this.aggiorna({ visita, titolo }, { incognito: this.incognito }) : null))
      .catch((e) => console.warn('[Filo] titolo della pagina visitata non registrato:', e?.message || e));
  }

  // La pagina lascia la scheda. Un titolo cambiato un istante prima è già quello della pagina dopo (un sito che lo
  // scrive prima di cambiare indirizzo): vale solo uno rimasto fermo.
  lascia(wc) {
    const s = this.scritte.get(wc);
    if (!s) return;
    this.scritte.delete(wc);
    clearTimeout(s.timer);
    if (Date.now() - s.cambiato >= this.tempi.assestamento) this.fissaTitolo(s);
  }

  chiusa(wc) {
    this.scrivi(wc, { titoloAttuale: false });
    this.lascia(wc);
  }

  caricata(wc) {
    const v = this.inAttesa.get(wc);
    if (v && !v.inPagina) this.scrivi(wc);
  }

  // Alla navigazione dopo il titolo della scheda è già quello della pagina nuova: vale l'ultimo visto per questa.
  scrivi(wc, { titoloAttuale = true } = {}) {
    const v = this.inAttesa.get(wc);
    if (!v) return;
    this.inAttesa.delete(wc);
    clearTimeout(v.timer);
    let titolo = v.titolo;
    try { if (titoloAttuale && !wc.isDestroyed()) titolo = wc.getTitle() || titolo; } catch (_) {}
    const id = Promise.resolve()
      .then(() => this.registra({ url: v.url, titolo, scheda: v.scheda, ts: v.ts }, { incognito: this.incognito }))
      .then((ev) => (ev && ev.id) || null)
      .catch((e) => { console.warn('[Filo] pagina visitata non registrata:', e?.message || e); return null; });
    this.scritte.set(wc, { id, scritto: titolo, ultimo: titolo, cambiato: 0, nata: Date.now(), timer: null });
  }
}

module.exports = { VisiteSchede, registrabile };
