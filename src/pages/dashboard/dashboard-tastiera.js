// La tastiera della home (#2372): un campo solo, quello della chat, prende quello che si batte anche senza averci
// cliccato; e le prime due battute uguali lanciano l'azione assegnata a quella lettera (src/shared/doppioTocco.js).
// Non tocca niente con un riquadro aperto sopra la home o col fuoco in un altro campo di testo. Prove: tests/home-tastiera.spec.mjs
(function (global) {
  'use strict';

  let d = null;
  let tocco = null;
  let trattenuta = null;
  let timer = null;

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

  function onKey(e) {
    if (!e.isTrusted || e.isComposing || e.defaultPrevented || typeof e.key !== 'string') return;
    const campo = d.input;
    const nelCampo = e.target === campo;
    // AltGr (Ctrl+Alt su Windows) scrive «@», «€», «[»: è una lettera, non una scorciatoia.
    const mod = (e.ctrlKey || e.metaKey || e.altKey) && !(e.getModifierState && e.getModifierState('AltGraph'));
    if (!nelCampo) {
      const a = document.activeElement;
      const libero = !a || a === document.body || a === document.documentElement;
      if (!libero && !(d.dash.contains(a) && !scrivibile(a))) return;
      if (mod || e.key.length !== 1) return;
      // Lo spazio su un pulsante lo preme: resta suo.
      if (e.key === ' ' && !libero) return;
      if (campo.disabled || !campo.isConnected || campo.offsetParent === null || sovrapposto()) return;
    } else if (sovrapposto()) return;
    const cfg = d.impostazioni() && d.impostazioni().doppioTocco;
    const vuoto = campo.value === '';
    const esito = tocco.battuta({ key: e.key, repeat: e.repeat, mod: e.ctrlKey || e.metaKey || e.altKey, t: e.timeStamp, vuoto }, cfg);
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
      if (!nelCampo) campo.focus({ preventScroll: true });
      trattenuta = e.key;
      clearTimeout(timer);
      timer = setTimeout(lasciaTrattenuta, global.SN_DOPPIO_TOCCO.normalizza(cfg).sogliaMs);
      return;
    }
    if (!nelCampo) {
      e.preventDefault();
      scrivi(e.key);
    }
  }

  function init(deps) {
    d = deps;
    if (!global.SN_DOPPIO_TOCCO || !d.input) return;
    tocco = global.SN_DOPPIO_TOCCO.riconoscitore();
    document.addEventListener('keydown', onKey, true);
    // Il fuoco che lascia la pagina non perde la lettera trattenuta.
    global.addEventListener('blur', () => { if (trattenuta) lasciaTrattenuta(); });
  }

  global.SN_DASH_TASTIERA = { init };
})(typeof globalThis !== 'undefined' ? globalThis : window);
