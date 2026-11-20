// La tastiera della home (#2372): il fuoco sta nel campo (quello della chat, o della ricerca aperta) e ci torna quando
// cade su un punto vuoto; le prime due battute uguali lanciano l'azione assegnata alla lettera (doppioTocco.js).
// Non tocca niente con un riquadro aperto sopra la home o col fuoco in un altro campo di testo. Prove: tests/home-tastiera.spec.mjs
(function (global) {
  'use strict';

  let d = null;
  let tocco = null;
  let trattenuta = null;
  let timer = null;
  let premuto = false;

  // Un riquadro sopra la home ha preso il fuoco e lo tiene: niente gli passa sotto, e nessuna lettera è un comando.
  const SOVRAPPOSTI = '.sn-confirm-host, .sn-fb-overlay, .dash-recap-overlay, .dash-lightbox.open, .dash-menu, .sn-menu, [role="dialog"], [aria-modal="true"]';
  function sovrapposto() {
    for (const n of document.querySelectorAll(SOVRAPPOSTI)) {
      if (n.hidden || !n.isConnected) continue;
      const r = n.getBoundingClientRect();
      if (r.width || r.height || n.classList.contains('sn-confirm-host')) return true;
    }
    return false;
  }
  function scrivibile(n) {
    if (!n || n.nodeType !== 1) return false;
    if (n.isContentEditable) return true;
    const t = n.tagName;
    return t === 'TEXTAREA' || t === 'SELECT' || (t === 'INPUT' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(n.type));
  }
  const libero = (a) => !a || a === document.body || a === document.documentElement;
  const selezione = () => { const s = document.getSelection(); return !!s && !s.isCollapsed; };
  const campoDi = () => (d.campo && d.campo()) || d.input;
  const usabile = (c) => !!c && !c.disabled && c.isConnected && c.offsetParent !== null && !sovrapposto();

  // Il fuoco caduto su un punto vuoto torna nel campo; chi ha appena selezionato del testo lo tiene, per copiarlo.
  function rimettiFuoco() {
    if (!d || premuto || !libero(document.activeElement) || !document.hasFocus() || selezione()) return;
    const c = campoDi();
    if (usabile(c)) c.focus({ preventScroll: true });
  }

  // Scrive nel campo come la tastiera: con l'evento input e con l'annulla del campo.
  function scrivi(testo) {
    const campo = d.input;
    if (document.activeElement !== campo) campo.focus({ preventScroll: true });
    let ok = false;
    try { ok = document.execCommand('insertText', false, testo); } catch (_) { ok = false; }
    if (!ok) {
      campo.setRangeText(testo, campo.selectionStart, campo.selectionEnd, 'end');
      campo.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: testo }));
    }
  }
  function lasciaTrattenuta() {
    clearTimeout(timer);
    timer = null;
    const k = tocco.lascia() || trattenuta;
    trattenuta = null;
    if (k) scrivi(k);
  }

  function esegui(v) {
    if (v.tasto) { if (d.usa) d.usa(v.tasto); return; }
    if (v.url) d.send({ type: global.SN_MSG.MSG.OPEN_URL, url: v.url });
  }

  const MODIFICA = ['Backspace', 'Delete', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  // I tasti che il campo gestisce da sé (Invio manda, le frecce scelgono un risultato della ricerca).
  const SUOI = ['Enter', 'ArrowUp', 'ArrowDown'];
  // Un tasto che fuori da un campo non fa niente e dentro scrive lo riceve il campo. Col fuoco su un tasto della home
  // restano suoi Invio, spazio, frecce e Canc (lo mette nel «+»); una selezione nella pagina tiene Ctrl+A, C e X.
  function perIlCampo(e, mod, liberoOra) {
    if (!mod) return e.key.length === 1 ? liberoOra || e.key !== ' ' : liberoOra ? MODIFICA.includes(e.key) : e.key === 'Backspace';
    if (e.altKey) return false;
    const k = e.key.toLowerCase();
    if (e.key.length !== 1) return liberoOra && MODIFICA.includes(e.key) && e.key !== 'Enter';
    return k === 'v' || (liberoOra && (k === 'z' || k === 'y' || (k === 'a' && !selezione())));
  }

  function onKey(e) {
    if (!e.isTrusted || e.isComposing || e.defaultPrevented || typeof e.key !== 'string') return;
    const campo = campoDi();
    const chat = campo === d.input;
    // AltGr (Ctrl+Alt su Windows) scrive «@», «€», «[»: è una lettera, non una scorciatoia.
    const mod = (e.ctrlKey || e.metaKey || e.altKey) && !(e.getModifierState && e.getModifierState('AltGraph'));
    const fuori = e.target !== campo;
    if (fuori) {
      const a = document.activeElement;
      const liberoOra = libero(a);
      if (!liberoOra && !(d.dash.contains(a) && !scrivibile(a))) return;
      if (!perIlCampo(e, mod, liberoOra) || !usabile(campo)) return;
      // Il fuoco torna nel campo prima che il tasto agisca: il browser consegna la battuta a chi ha il fuoco adesso.
      campo.focus({ preventScroll: true });
    } else if (sovrapposto()) return;
    if (chat) {
      const cfg = d.impostazioni() && d.impostazioni().doppioTocco;
      const esito = tocco.battuta({ key: e.key, repeat: e.repeat, mod, t: e.timeStamp, vuoto: campo.value === '' }, cfg);
      if (esito && esito.scatta) {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(timer);
        timer = null;
        trattenuta = null;
        esegui(esito.scatta);
        return;
      }
      if (esito === 'lascia') lasciaTrattenuta();
      if (esito === 'trattieni') {
        // La prima lettera di una coppia possibile non si scrive subito: se arriva la seconda il campo non ha mai
        // mostrato niente, se no compare appena scade la soglia o arriva un altro tasto.
        e.preventDefault();
        trattenuta = e.key;
        clearTimeout(timer);
        timer = setTimeout(lasciaTrattenuta, global.SN_DOPPIO_TOCCO.normalizza(cfg).sogliaMs);
        return;
      }
    }
    // La battuta partita fuori non passa dai tasti del campo: quelli che gestisce da sé li riceve come suoi.
    if (fuori && !mod && SUOI.includes(e.key)) {
      const copia = new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, bubbles: true, cancelable: true });
      if (!campo.dispatchEvent(copia)) e.preventDefault();
    }
  }

  function init(deps) {
    d = deps;
    if (!global.SN_DOPPIO_TOCCO || !d.input) return;
    tocco = global.SN_DOPPIO_TOCCO.riconoscitore();
    document.addEventListener('keydown', onKey, true);
    // Il clic su un punto vuoto rimette il fuoco a tasto alzato: a tasto premuto si potrebbe star selezionando.
    document.addEventListener('mousedown', (e) => { if (e.button === 0) premuto = true; }, true);
    document.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      premuto = false;
      setTimeout(rimettiFuoco, 0);
    }, true);
    document.addEventListener('focusout', () => { setTimeout(rimettiFuoco, 0); }, true);
    // Il fuoco che lascia la pagina non perde la lettera trattenuta.
    global.addEventListener('blur', () => { premuto = false; if (trattenuta) lasciaTrattenuta(); });
  }

  global.SN_DASH_TASTIERA = { init };
})(typeof globalThis !== 'undefined' ? globalThis : window);
