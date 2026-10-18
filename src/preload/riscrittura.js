// Il mondo isolato di Filo si segna i suoi ascoltatori su finestra e documento: li rimette se la pagina si riscrive
// (document.open) e consegna loro l'Esc prima degli script del sito (#859). Va installato prima di ogni altro ascoltatore.
// Regole: patterns/un-documento-riscritto-non-spegne-filo.md e patterns/esc-chiude-prima-il-riquadro-aperto-poi-la-modalita.md.

// I segni che Filo tiene sulla radice (tema, moduli pronti); quelli dello zoom
// descrivono una modalità che col documento vecchio si è chiusa.
const SEGNO = /^data-(sn|filo)-/;
const SEGNO_ZOOM = /^data-filo-zoom-/;

module.exports = function tieniFiloNellaRiscrittura() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof EventTarget === 'undefined') return null;
  const proto = EventTarget.prototype;
  const aggiungi = proto.addEventListener;
  const togli = proto.removeEventListener;
  const segnati = [];
  const dopo = [];

  const cattura = (o) => !!(o === true || (o && typeof o === 'object' && o.capture));
  const nostro = (t) => t === window || t === document;
  const trova = (t, tipo, fn, o) => segnati.findIndex((s) => s.t === t && s.tipo === tipo && s.fn === fn && s.cattura === cattura(o));
  const anticipati = new WeakSet();

  // Gli ascolti in cattura di Filo dopo `da` vedono `e` adesso, in una copia che rispetta la propagazione, e il giro vero
  // li salta: la cattura del sito sulla finestra non arriva più prima di loro. True se uno l'ha fermato.
  function anticipa(e, da) {
    let fermato = false;
    let subito = false;
    let corrente = null;
    let fase = 0;
    let passivo = false;
    const copia = new Proxy(e, {
      get(t, k) {
        if (k === 'currentTarget') return corrente;
        if (k === 'eventPhase') return fase;
        if (k === 'cancelBubble') return fermato;
        if (k === 'stopPropagation') return () => { fermato = true; };
        if (k === 'stopImmediatePropagation') return () => { fermato = true; subito = true; };
        if (k === 'preventDefault') return () => { if (!passivo) t.preventDefault(); };
        const v = Reflect.get(t, k);
        return typeof v === 'function' && k !== 'constructor' ? v.bind(t) : v;
      },
      set(t, k, v) {
        if (k === 'cancelBubble') { if (v) fermato = true; return true; }
        if (k === 'returnValue') { if (v === false && !passivo) t.preventDefault(); return true; }
        return Reflect.set(t, k, v);
      },
    });
    const tappe = e.target === window ? [window] : [window, document];
    for (const t of tappe) {
      if (fermato) break;
      corrente = t;
      fase = e.target === t ? 2 : 1;
      let qui = segnati.filter((s) => s.t === t && s.tipo === e.type && s.cattura);
      if (t === window) {
        const io = qui.findIndex((s) => s.fn === da);
        qui = qui.slice(io + 1);
      }
      for (const s of qui) {
        if (subito) break;
        // Tolto da un ascolto di prima, o col segnale annullato: il browser non lo chiamerebbe più.
        if (!segnati.includes(s)) continue;
        if (s.o && typeof s.o === 'object' && s.o.signal && s.o.signal.aborted) continue;
        passivo = !!(s.o && typeof s.o === 'object' && s.o.passive);
        try { s.fn.call(t, copia); } catch (err) {
          try { (globalThis.reportError || console.error)(err); } catch (_) {}
        }
        if (s.o && typeof s.o === 'object' && s.o.once) { try { proto.removeEventListener.call(t, s.tipo, s.fn, s.o); } catch (_) {} }
      }
    }
    anticipati.add(e);
    return fermato;
  }

  proto.addEventListener = function (tipo, fn, o) {
    if (!nostro(this) || typeof fn !== 'function') return aggiungi.call(this, tipo, fn, o);
    // Già segnato: lo si rimette com'era (la riscrittura può averlo appena cancellato).
    const gia = trova(this, tipo, fn, o);
    if (gia >= 0) return aggiungi.call(this, tipo, segnati[gia].chiama, o);
    const s = { t: this, tipo, fn, o, cattura: cattura(o), chiama: fn };
    const unaVolta = !!(o && typeof o === 'object' && o.once);
    if (unaVolta || s.cattura) {
      s.chiama = function (e) {
        // Un tasto già consegnato in anticipo non si consegna due volte.
        if (s.cattura && anticipati.has(e)) return undefined;
        // Un ascoltatore «una volta» già scattato non si rimette.
        if (unaVolta) {
          const i = segnati.indexOf(s);
          if (i >= 0) segnati.splice(i, 1);
        }
        return fn.call(this, e);
      };
    }
    segnati.push(s);
    return aggiungi.call(this, tipo, s.chiama, o);
  };
  proto.removeEventListener = function (tipo, fn, o) {
    if (nostro(this)) {
      const i = trova(this, tipo, fn, o);
      if (i >= 0) {
        const [s] = segnati.splice(i, 1);
        return togli.call(this, tipo, s.chiama, o);
      }
    }
    return togli.call(this, tipo, fn, o);
  };

  function rimetti() {
    for (const s of segnati.slice()) {
      const segnale = s.o && typeof s.o === 'object' ? s.o.signal : null;
      if (segnale && segnale.aborted) {
        const i = segnati.indexOf(s);
        if (i >= 0) segnati.splice(i, 1);
        continue;
      }
      try { aggiungi.call(s.t, s.tipo, s.chiama, s.o); } catch (_) {}
    }
  }

  function ricopiaSegni(da, a) {
    if (!da || !a || da === a || !da.attributes) return;
    for (const { name, value } of Array.from(da.attributes)) {
      if (!SEGNO.test(name) || SEGNO_ZOOM.test(name) || a.hasAttribute(name)) continue;
      try { a.setAttribute(name, value); } catch (_) {}
    }
  }

  let radice = document.documentElement;
  let ultima = radice;
  try {
    new MutationObserver(() => {
      const nuova = document.documentElement;
      if (nuova === radice) return;
      radice = nuova;
      rimetti();
      if (!nuova) return;
      ricopiaSegni(ultima, nuova);
      ultima = nuova;
      for (const fn of dopo) { try { fn(); } catch (_) {} }
    }).observe(document, { childList: true });
  } catch (_) {}

  return {
    // Chi aveva messo qualcosa nel documento vecchio (i fogli di stile) lo rimette qui.
    allaRiscrittura(fn) { if (typeof fn === 'function') dopo.push(fn); },
    anticipa,
  };
};
