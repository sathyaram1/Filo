// Le misure delle strade (#1468): da dove parte un'azione, i tasti dei browser e le loro attese, le scorciatoie a vuoto,
// il menu nativo, il contesto del tasto destro, la cronologia, le pagine di Filo col loro tempo in vista e l'Aiuto.
// Passa nomi da elenchi chiusi e numeri al servizio dei contatori, che tiene interruttore e incognito. Forma: src/shared/contatoriStrade.js.

function crea(dip = {}) {
  const contatori = dip.contatori;
  const T = dip.T || globalThis.SN_CONTATORI_STRADE;
  const adesso = dip.adesso || (() => Date.now());

  // `incognito` vero salta; altrimenti decide il contesto della chiamata, come per ogni altro conto.
  const scrivi = (fn, incognito = false) => contatori.strade((ora) => fn(ora), { incognito: incognito ? true : null });

  // Lo stesso gesto visto da due porte nello stesso istante (la barra dei menu del Mac e la pagina) si conta una volta.
  const DOPPIO_MS = 80;
  const ultimi = new Map();
  function nuovo(chiave) {
    const t = adesso();
    const prima = ultimi.get(chiave);
    ultimi.delete(chiave);
    ultimi.set(chiave, t);
    if (ultimi.size > 64) ultimi.delete(ultimi.keys().next().value);
    return !(prima != null && t >= prima && t - prima < DOPPIO_MS);
  }

  function azione(id, via, { incognito = false } = {}) {
    const k = T.chiaveAzione(id, via);
    if (!k || !nuovo(`azione|${k}`)) return false;
    scrivi((ora) => T.registraAzione(ora, id, via), incognito);
    return true;
  }

  // Il nome del tasto, o '' se non è uno dei tasti dei browser.
  function tasto(input, { incognito = false, piattaforma } = {}) {
    const id = T.tastoDaBrowser(input, piattaforma);
    if (!id || !nuovo(`tasto|${id}`)) return '';
    scrivi((ora) => T.registraTasto(ora, id), incognito);
    return id;
  }
  // Il tasto già riconosciuto da altri: su Mac la barra dei menu lo vede prima della pagina.
  function tastoNome(id, { incognito = false } = {}) {
    if (!T.TASTI.includes(id) || !nuovo(`tasto|${id}`)) return '';
    scrivi((ora) => T.registraTasto(ora, id), incognito);
    return id;
  }

  function aVuoto(comando, motivo, { incognito = false } = {}) {
    if (!T.chiaveVuoto(comando, motivo)) return false;
    scrivi((ora) => T.registraVuoto(ora, comando, motivo), incognito);
    return true;
  }

  function nativo(voce, { incognito = false } = {}) {
    if (!T.VOCI_NATIVO.includes(voce)) return false;
    scrivi((ora) => T.registraNativo(ora, voce), incognito);
    return true;
  }

  function contesto(bandiere, { incognito = false } = {}) {
    if (!T.chiaveContesto(bandiere)) return false;
    scrivi((ora) => T.registraContesto(ora, bandiere), incognito);
    return true;
  }

  // Indietro e avanti contano anche fra le strade dell'azione, tranne l'elenco della barra (sceglie una pagina).
  function cronologia(verso, via, { posizione = null, incognito = false } = {}) {
    const k = T.chiaveCronologia(verso, via, posizione);
    if (!k || !nuovo(`cronologia|${k}`)) return false;
    const strada = T.AZIONE_DELLA_VIA[via];
    scrivi((ora) => {
      const fatto = T.registraCronologia(ora, verso, via, posizione);
      if (strada) T.registraAzione(ora, verso === 'avanti' ? 'forward' : 'back', strada);
      return fatto;
    }, incognito);
    return true;
  }

  function aiuto(via, { incognito = false } = {}) {
    if (!T.VIE_AIUTO.includes(via) || !nuovo(`aiuto|${via}`)) return false;
    scrivi((ora) => T.registraAiuto(ora, via), incognito);
    return true;
  }

  // ── La pagina di Filo aperta, e quanto resta davanti ─────────────────────
  // `finestra`: chi tiene le schede (il TabManager), per legare l'apertura alla pagina che le arriva davanti.
  const aperture = new WeakMap();
  const davanti = new WeakMap();
  const attese = new WeakMap();

  function pagina(url, via, { finestra = null, incognito = false } = {}) {
    if (!T.chiavePagina(url, via)) return false;
    scrivi((ora) => T.registraPagina(ora, url, via), incognito);
    if (finestra && typeof finestra === 'object') aperture.set(finestra, { pagina: T.paginaDi(url), t: adesso() });
    return true;
  }

  // La scheda davanti nella finestra è cambiata, o ha cambiato indirizzo. Il tempo in vista vale per la prima volta che
  // una pagina appena aperta sta davanti, fino a quando se ne va (un'altra scheda, un altro indirizzo, chiusa).
  function inVista(finestra, scheda, url, { incognito = false } = {}) {
    if (!finestra || typeof finestra !== 'object') return;
    const pag = scheda ? T.paginaDi(url) : '';
    const prima = davanti.get(finestra);
    if (prima && prima.scheda === scheda && prima.pagina === pag) return;
    if (prima) {
      davanti.delete(finestra);
      lasciata(prima);
    }
    if (!scheda) return;
    const ap = aperture.get(finestra);
    const misura = !!pag && !!ap && ap.pagina === pag && adesso() - ap.t <= T.APERTURA_MS;
    if (misura) aperture.delete(finestra);
    davanti.set(finestra, { scheda, pagina: pag, t0: adesso(), misura, incognito: !!incognito });
  }
  function lasciata(v) {
    const ms = adesso() - v.t0;
    if (v.misura) scrivi((ora) => T.registraVista(ora, v.pagina, ms), v.incognito);
    const a = attese.get(v.scheda);
    if (a && a.tasto === 'ctrl_l' && v.pagina === 'newtab') fineAttesa(v.scheda, !a.scritto);
  }

  // ── Le attese dei tasti dei browser: chi preme Ctrl+Shift+T o Ctrl+L e torna indietro subito ─────────────────
  // `scheda`: quella che il tasto ha dato (la riaperta, la home).
  function attesa(scheda, nome, { incognito = false } = {}) {
    if (!scheda || typeof scheda !== 'object' || !T.MANCATE.includes(nome)) return false;
    attese.set(scheda, { tasto: nome, t0: adesso(), scritto: false, caricata: false, incognito: !!incognito });
    return true;
  }
  function fineAttesa(scheda, mancata) {
    const a = attese.get(scheda);
    if (!a) return false;
    attese.delete(scheda);
    if (!mancata || adesso() - a.t0 > T.MANCATA_MS) return false;
    scrivi((ora) => T.registraMancata(ora, a.tasto), a.incognito);
    return true;
  }
  // Un tasto premuto nella scheda: sulla home, scrivere (anche incollare o mandare) toglie l'attesa di Ctrl+L.
  function inputScheda(scheda, input) {
    const a = scheda ? attese.get(scheda) : null;
    if (!a || a.tasto !== 'ctrl_l' || a.scritto || !input || input.type !== 'keyDown') return;
    const key = String(input.key || '');
    const mod = !!(input.control || input.meta);
    if ((!mod && !input.alt && key.length === 1) || key === 'Enter' || key === 'Backspace' || (mod && key.toLowerCase() === 'v')) a.scritto = true;
  }
  // La riaperta ha finito di caricarsi: da qui un indirizzo nuovo è una navigazione di chi la usa.
  function caricata(scheda) {
    const a = scheda ? attese.get(scheda) : null;
    if (a && a.tasto === 'ctrl_shift_t') a.caricata = true;
  }
  function navigata(scheda) {
    const a = scheda ? attese.get(scheda) : null;
    if (a && a.tasto === 'ctrl_shift_t' && a.caricata) attese.delete(scheda);
  }
  function chiusa(finestra, scheda) {
    const v = finestra && typeof finestra === 'object' ? davanti.get(finestra) : null;
    if (v && v.scheda === scheda) {
      davanti.delete(finestra);
      lasciata(v);
    }
    const a = scheda ? attese.get(scheda) : null;
    if (a) fineAttesa(scheda, a.tasto === 'ctrl_shift_t' || !a.scritto);
  }

  return {
    azione, tasto, tastoNome, aVuoto, nativo, contesto, cronologia, aiuto, pagina, inVista, attesa, inputScheda, caricata, navigata, chiusa,
  };
}

// Per gli agganci: una misura che non c'è o che si rompe non ferma mai chi la chiama.
function misura(nome, ...args) {
  try {
    const m = globalThis.SN_CONTATORI_STRADE_MAIN;
    return m && typeof m[nome] === 'function' ? m[nome](...args) : undefined;
  } catch (_) { return undefined; }
}

// L'incognito di chi ha il gesto: la finestra (`_filoIncognito`), il TabManager (`incognito`) o una WebContents.
function incognitoDi(x) {
  try {
    if (!x) return false;
    if (typeof x._filoIncognito === 'boolean') return x._filoIncognito;
    if (typeof x.incognito === 'boolean') return x.incognito;
    if (x.session && typeof x.session.isPersistent === 'function') return !x.session.isPersistent();
  } catch (_) {}
  return false;
}

module.exports = { crea, misura, incognitoDi };
