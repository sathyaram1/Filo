// Le pagine aperte nelle schede diventano eventi di navigazione del filo (#866), uno per pagina e col suo titolo.
// Non decide dove si scrive né cosa resta in memoria: lo fa src/main/services/ilFilo.js con la finestra che dice
// se è incognito. Regole: patterns/il-filo-cresce-solo-in-coda-e-cancellare-e-un-evento.md

// Il titolo vero arriva col caricamento; una pagina che non finisce mai di caricarsi si scrive lo stesso.
const TETTO_CARICAMENTO = 15_000;
// Un cambio di indirizzo dentro la pagina (YouTube, Gmail) non si carica: il titolo nuovo arriva poco dopo.
const ATTESA_TITOLO_IN_PAGINA = 4_000;

const registrabile = (url) => /^(https?|file):/i.test(String(url || ''));
const senzaFrammento = (url) => String(url || '').split('#')[0];

class VisiteSchede {
  constructor({ incognito = false, registra } = {}) {
    this.incognito = !!incognito;
    this.registra = registra || ((visita, opts) => require('../services/ilFilo').registraVisita(visita, opts));
    this.inAttesa = new Map();
    this.ultime = new WeakMap();
  }

  // Ricaricare, o cambiare solo il frammento (#sezione), non è una pagina nuova.
  navigata(wc, scheda, url, { inPagina = false } = {}) {
    this.scrivi(wc, { titoloAttuale: false });
    if (!registrabile(url)) return;
    const prima = this.ultime.get(wc);
    if (prima && senzaFrammento(prima) === senzaFrammento(url)) return;
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
    const v = this.inAttesa.get(wc);
    if (!v || !titolo) return;
    v.titolo = String(titolo);
    if (v.inPagina) this.scrivi(wc);
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
    Promise.resolve()
      .then(() => this.registra({ url: v.url, titolo, scheda: v.scheda, ts: v.ts }, { incognito: this.incognito }))
      .catch((e) => console.warn('[Filo] pagina visitata non registrata:', e?.message || e));
  }
}

module.exports = { VisiteSchede, registrabile };
