// Geometria degli overlay che Filo posa a mano sopra la pagina: il menu del
// tasto destro e il riquadro della risposta di Filo.
//
// Sono le due superfici che CRESCONO dopo essere state posate — dentro c'è la
// spiegazione dell'LLM, che arriva un pezzo alla volta. Misurarle una volta
// sola all'apertura vuol dire posarle su un numero che scade un secondo dopo:
// il fondo esce dalla finestra, e quello che resta tagliato è proprio la roba
// in coda (le ultime voci del menu, la riga del modello e il campo della
// domanda successiva). Il menu è #500, il riquadro della risposta #502: stesso
// difetto, stessa cura — ed è per questo che i numeri stanno qui e non in due
// copie che prima o poi divergono.
//
// Qui stanno solo i numeri, senza DOM, così i casi limite si provano in unit
// test; l'unica funzione che tocca il DOM (`applyCap`) fa una cosa sola e la
// fa allo stesso modo per tutti e due.

(function (global) {
  'use strict';

  // Margine minimo fra l'overlay e i bordi della finestra.
  const GAP = 8;

  // Tetto d'altezza, in px di LAYOUT (quelli che finiscono nello stile).
  // `null` = ci sta tutto: nessun tetto e nessuna barra di scorrimento.
  //
  // `scale` è il fattore della compensazione zoom: l'overlay è DISEGNATO
  // scalato, quindi sullo schermo occupa `h * scale` — è quella l'altezza da
  // confrontare col bordo, e il tetto va riportato in px di layout dividendo.
  function computeCap({ h, vh, scale, gap = GAP, min = 96 }) {
    const s = (Number.isFinite(scale) && scale > 0) ? scale : 1;
    if (h * s + 2 * gap <= vh) return null;
    return Math.max(min, vh - 2 * gap) / s;
  }

  // Dove posare l'overlay. Pura — solo numeri — così ribaltamento, ricrescita e
  // bordi si provano senza browser.
  //
  // - `visW`/`visH`: quanto occupa DAVVERO sullo schermo (tetto e zoom già
  //   applicati);
  // - `bias`: stacco dal punto di ancoraggio (il menu nasce attaccato al
  //   cursore, il riquadro della risposta un filo sotto);
  // - `from`: la posa attuale, passata solo quando l'overlay è GIÀ sullo
  //   schermo e ha cambiato altezza. In quel caso non si ribalta — salterebbe
  //   via da sotto il cursore mentre l'utente sta per cliccare — si scivola in
  //   su quel tanto che basta a rientrare.
  function computeOffset({ x, y, visW, visH, vw, vh, from, gap = GAP, bias = 0 }) {
    let left = from ? from.left : x;
    let top = from ? from.top : y + bias;
    if (left + visW + gap > vw) left = vw - visW - gap;
    // Prima posa: se sotto il punto d'ancoraggio non ci sta, si apre in alto.
    if (!from && top + visH + gap > vh) top = Math.max(gap, y - visH - bias);
    // Ricrescita (e ultima rete della prima posa): scivola in su quanto basta.
    if (top + visH + gap > vh) top = vh - visH - gap;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    return { left, top };
  }

  // Fattore della compensazione zoom applicato a questo overlay (1 se assente).
  function readScale(el) {
    const m = /scale\(\s*([0-9.]+)\s*\)/.exec((el && el.style && el.style.transform) || '');
    const v = m ? parseFloat(m[1]) : 1;
    return (Number.isFinite(v) && v > 0) ? v : 1;
  }

  // Rimette il tetto d'altezza misurando ADESSO, e dice con che scala.
  //
  // Il tetto messo dal giro precedente falserebbe la misura, e resterebbe
  // addosso anche a un overlay che nel frattempo si è ACCORCIATO (la
  // spiegazione che sparisce quando non c'è niente da spiegare): si toglie, si
  // misura l'altezza naturale, si rimette solo se serve ancora. Tutto nello
  // stesso giro sincrono, quindi non si vede nessuno sfarfallio.
  //
  // `limit` è un tetto ulteriore imposto dal chiamante, in px di layout: serve
  // a chi non può permettersi di spostare l'overlay (il riquadro trascinato a
  // mano) e deve tenerlo dentro facendolo scorrere invece che muovendolo.
  function applyCap(root, opts) {
    const o = opts || {};
    const gap = o.gap == null ? GAP : o.gap;
    const min = o.min == null ? 96 : o.min;
    root.style.maxHeight = '';
    root.style.overflowY = '';
    root.style.overscrollBehavior = '';
    const scale = readScale(root);
    const vh = window.innerHeight;
    let cap = computeCap({ h: root.offsetHeight, vh, scale, gap, min });
    if (o.limit != null && root.offsetHeight > o.limit) {
      cap = cap == null ? o.limit : Math.min(cap, o.limit);
    }
    if (cap != null) {
      root.style.maxHeight = `${cap}px`;
      root.style.overflowY = 'auto';
      // Lo scorrimento si ferma DENTRO l'overlay. Senza, arrivati in fondo alla
      // spiegazione il giro di rotella successivo passa alla pagina: la pagina
      // scorre, e uno scroll di pagina chiude il menu. Chi legge una
      // spiegazione lunga fino in fondo la perderebbe proprio lì — col trackpad
      // quasi sempre, perché l'inerzia continua da sola dopo che hai staccato
      // le dita.
      root.style.overscrollBehavior = 'contain';
      // `max-height` morde il box scelto dal CSS: con `content-box` — il valore
      // di partenza, e quello che si prende un overlay dentro una pagina che
      // non impone `box-sizing` — bordo e imbottitura restano FUORI dal conto,
      // e l'overlay resta più alto del tetto quel tanto che basta a sforare
      // comunque. La differenza si misura e si toglie.
      const extra = root.offsetHeight - cap;
      if (extra > 0) root.style.maxHeight = `${Math.max(48, cap - extra)}px`;
    }
    return { scale, cap };
  }

  // Quanto può essere alto un overlay che NON si può spostare perché l'utente
  // l'ha messo lì con le sue mani: cresce verso il basso finché tocca il bordo,
  // poi scorre. In px di layout, come `computeCap`.
  //
  // Il minimo è la rete: sotto quello il riquadro non serve più a niente, e
  // scivolare diventa il male minore — ci pensa `computeOffset`, che l'ultima
  // rientrata la fa comunque.
  function computePinnedLimit({ top, vh, scale, gap = GAP, min = 96 }) {
    const s = (Number.isFinite(scale) && scale > 0) ? scale : 1;
    return Math.max(min, (vh - top - gap) / s);
  }

  // Segue l'altezza di un overlay finché resta aperto: a ogni cambio ripete la
  // posa. Ritorna la funzione per staccarsi (no-op dove `ResizeObserver` non
  // esiste). Il confronto è con la misura dell'ULTIMA posa: senza, l'overlay si
  // riposerebbe all'infinito rispondendo al proprio stesso tetto.
  function observeGrowth(root, riposa) {
    if (typeof ResizeObserver !== 'function') return () => {};
    const misura = () => `${root.offsetWidth}x${root.offsetHeight}`;
    let posato = misura();
    const ro = new ResizeObserver(() => {
      if (misura() === posato) return;
      riposa();
      posato = misura();
    });
    ro.observe(root);
    return () => { try { ro.disconnect(); } catch (_) {} };
  }

  global.SN_PLACE = {
    GAP, computeCap, computeOffset, computePinnedLimit, readScale, applyCap, observeGrowth,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
