// Una pagina che si riscrive (document.open) cancella gli ascoltatori della finestra e del documento, e con la testa i fogli di stile di Filo.
// Qui il mondo isolato di Filo si segna i propri ascoltatori e li rimette appena la radice cambia, con i segni di Filo sulla radice.
// Va installato prima di ogni altro ascoltatore. Regole: patterns/un-documento-riscritto-non-spegne-filo.md.

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

  proto.addEventListener = function (tipo, fn, o) {
    if (!nostro(this) || typeof fn !== 'function') return aggiungi.call(this, tipo, fn, o);
    // Già segnato: lo si rimette com'era (la riscrittura può averlo appena cancellato).
    const gia = trova(this, tipo, fn, o);
    if (gia >= 0) return aggiungi.call(this, tipo, segnati[gia].chiama, o);
    const s = { t: this, tipo, fn, o, cattura: cattura(o), chiama: fn };
    // Un ascoltatore «una volta» già scattato non si rimette.
    if (o && typeof o === 'object' && o.once) {
      s.chiama = function (e) {
        const i = segnati.indexOf(s);
        if (i >= 0) segnati.splice(i, 1);
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
  };
};
