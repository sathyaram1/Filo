// Il testo che l'utente immette nella pagina, in ogni frame, detto al main: un segreto che la pagina mostra ed è suo non
// è letto da fuori (#810.8). Dell'utente è la parte del valore cambiata da quando ci scrive, se è fatta dei caratteri che
// ci ha messo lui (tasti, incolla, inserimenti di Filo chiesti da lui); se no, solo quei caratteri in fila, nel campo e nel documento.

// Largo: un documento incollato intero resta dell'utente; oltre, si tiene la coda.
const MAX_TESTO = 1000000;
const ATTESA_MS = 150;
// Un incolla o un trascina porta testo che un sito può aver scelto (la copia riscritta): oltre questa misura non è
// dell'utente per intero, se no una fila con tutti i codici a sei cifre li coprirebbe tutti.
const MAX_INCOLLA = 1000;
// Di un incolla più lungo (una lettera con l'IBAN) restano dell'utente i segreti che contiene, se sono pochi.
const MAX_SEGRETI_INCOLLA = 10;
const MAX_SEGRETO = 100;
// I caratteri del sito attaccati a quello che l'utente scrive (il «IT» già nel campo dell'IBAN) restano con lui: pochi,
// così un sito non ci aggiunge un codice suo.
const ATTACCATI = 4;

const contaDi = (c) => c.toLowerCase();
const conta = /[\p{L}\p{N}]/u;

// Le lettere e cifre di `valore` stanno tutte, quante volte servono, fra quelle che l'utente ha messo nel campo: un sito
// che riscrive il valore (maschera, correzione in mezzo) non aggiunge niente di suo.
function fattoDiCaratteri(valore, conti) {
  const resto = new Map(conti);
  let qualcosa = false;
  for (const ch of String(valore || '')) {
    if (!conta.test(ch)) continue;
    const k = contaDi(ch);
    const n = resto.get(k) || 0;
    if (!n) return false;
    resto.set(k, n - 1);
    qualcosa = true;
  }
  return qualcosa;
}

function attaccati(s, dallaFine) {
  const ch = [...s];
  if (dallaFine) ch.reverse();
  let n = 0;
  let i = 0;
  for (; i < ch.length && n < ATTACCATI; i++) if (conta.test(ch[i])) n++;
  const presi = ch.slice(0, i);
  return (dallaFine ? presi.reverse() : presi).join('');
}

// Il valore meno l'inizio e la fine che c'erano già quando l'utente ha cominciato a scriverci (`base`): `nuova` è quello
// che è cambiato, `estesa` lo stesso coi pochi caratteri del sito attaccati.
function parteNuova(valore, base) {
  const v = String(valore || '');
  const b = String(base || '');
  const max = Math.min(v.length, b.length);
  let i = 0;
  while (i < max && v[i] === b[i]) i++;
  let j = 0;
  while (j < max - i && v[v.length - 1 - j] === b[b.length - 1 - j]) j++;
  const nuova = v.slice(i, v.length - j);
  return { nuova, estesa: attaccati(v.slice(0, i), true) + nuova + attaccati(v.slice(v.length - j), false) };
}

// Quello che di un incolla è dell'utente: tutto se è corto, se no solo i suoi segreti, se sono pochi.
function diUnIncolla(dati) {
  const t = String(dati || '');
  if (t.length <= MAX_INCOLLA) return t;
  if (!globalThis.SN_GUARDIANO_STATICO) { try { require('../shared/guardianoStatico.js'); } catch (_) { return ''; } }
  let segreti = [];
  try { segreti = globalThis.SN_GUARDIANO_STATICO.segretiNelTesto(t); } catch (_) { return ''; }
  if (!Array.isArray(segreti) || !segreti.length || segreti.length > MAX_SEGRETI_INCOLLA) return '';
  return segreti.map((x) => String((x && x.valore) || '')).filter((v) => v && v.length <= MAX_SEGRETO).join('\n');
}

function radiceModificabile(el) {
  let host = el;
  try { while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement; } catch (_) {}
  return host;
}

function valoreVero(el) {
  try {
    if (typeof el.matches === 'function' && el.matches('input, textarea')) return String(el.value || '');
    if (!el.isContentEditable) return null;
    return String(radiceModificabile(el).innerText || '');
  } catch (_) { return null; }
}

// Senza innerText, che a ogni tasto costerebbe un ricalcolo della pagina.
function vuoto(el) {
  try {
    if (typeof el.matches === 'function' && el.matches('input, textarea')) return !el.value;
    return !el.textContent;
  } catch (_) { return false; }
}

const scrivibile = (el) => {
  try { return !!el && ((typeof el.matches === 'function' && el.matches('input, textarea')) || !!el.isContentEditable); } catch (_) { return false; }
};

// Il valore è fatto dei caratteri dell'utente salvo al più ATTACCATI ai suoi bordi: il «IT» che una maschera mette
// davanti all'IBAN mentre lui scrive resta con lui, come quello che c'era già.
function fattoAiBordi(valore, conti) {
  const ch = [...String(valore || '')];
  if (ch.length > 4 * MAX_SEGRETO) return false;
  const conto = (i) => conta.test(ch[i]);
  for (let a = 0, i = 0; a <= ATTACCATI; a++) {
    for (let b = 0, j = ch.length; a + b <= ATTACCATI; b++) {
      if (i < j && fattoDiCaratteri(ch.slice(i, j).join(''), conti)) return true;
      do j--; while (j > i && !conto(j));
      if (j <= i) break;
    }
    do i++; while (i < ch.length && !conto(i - 1));
    if (i >= ch.length) break;
  }
  return false;
}

function ascoltaImmessi(invia) {
  if (typeof window === 'undefined' || typeof invia !== 'function') return;
  const principale = ascoltaIn(window, invia);
  // Quello che Filo mette nel campo per l'utente (incolla e cronologia degli appunti, dettatura, Accetta di una proposta)
  // la pagina non lo vede arrivare: lo dice chi lo inserisce, PRIMA di inserirlo. Sta nel mondo di Filo, il sito no.
  globalThis.SN_IMMESSI = Object.freeze({
    inserisce(el, testo) { principale.inserisce(el, testo); },
  });
}

// Una finestra: la pagina, o un riquadro vuoto (about:blank) che la pagina scrive da sé, come gli editor delle webmail,
// dove il preload non gira. Li si segue da chi li ospita appena l'utente ci entra.
function ascoltaIn(w, invia) {
  const testi = new WeakMap();
  const daDire = new Set();
  // Il numero di un elemento vale in questo documento: quello della pagina dopo, nella stessa scheda, non lo sostituisce.
  const documento = Math.random().toString(36).slice(2, 10);
  let numero = 0;
  let timer = null;
  // Tutto quello che l'utente immette nel documento, in fila: un numero diviso in più caselle ci sta intero.
  const fila = { testo: '', detto: '' };

  function di() {
    timer = null;
    for (const el of daDire) {
      const t = testi.get(el);
      if (!t) continue;
      const v = valoreVero(el);
      let testo = t.testo;
      if (v && v.length <= MAX_TESTO) {
        const { nuova, estesa } = parteNuova(v, t.base);
        // Anche la fila: la chat si svuota a ogni invio, e quello che c'era resta dell'utente.
        if (fattoDiCaratteri(nuova, t.conti)) testo = `${estesa}\u0001${t.testo}`;
        else if (fattoAiBordi(nuova, t.conti)) testo = `${nuova}\u0001${t.testo}`;
      }
      if (testo) { try { invia(`${documento}.${t.n}`, testo, t.desde); } catch (_) { /* il main è andato via */ } }
    }
    daDire.clear();
    // Senza un inizio: toglie dal registro solo una lettura arrivata mentre questo testo era in viaggio.
    if (fila.testo && fila.testo !== fila.detto) {
      fila.detto = fila.testo;
      try { invia(`${documento}.0`, fila.testo, Date.now()); } catch (_) {}
    }
  }
  const presto = () => { if (!timer) timer = setTimeout(di, ATTESA_MS); };
  const bersaglio = (e) => {
    const p = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return p[0] || e.target;
  };

  // Si chiama PRIMA che il testo entri: `base` è quello che c'era, e a campo vuoto si riparte (la chat dopo un invio).
  // `desde` è quando l'utente ha cominciato questo valore: il main toglie dal registro solo i segreti letti da lì in poi.
  function voce(el) {
    let t = testi.get(el);
    if (!t) {
      t = { n: ++numero, testo: '', conti: new Map(), quanti: 0, base: valoreVero(el) || '', desde: Date.now() };
      testi.set(el, t);
    } else if (vuoto(el)) { t.base = ''; t.desde = Date.now(); }
    return t;
  }
  function contati(t, dati) {
    for (const ch of dati) {
      if (!conta.test(ch) || t.quanti >= MAX_TESTO) continue;
      const k = contaDi(ch);
      t.conti.set(k, (t.conti.get(k) || 0) + 1);
      t.quanti++;
    }
  }
  const taglia = (s) => (s.length > MAX_TESTO ? s.slice(-MAX_TESTO) : s);
  function aggiorna(el, fn, dati = '') {
    if (!el || typeof el !== 'object') return;
    if (el.isContentEditable) el = radiceModificabile(el);
    const t = voce(el);
    if (dati) contati(t, dati);
    const nuovo = fn ? fn(t.testo) : t.testo;
    if (nuovo !== t.testo) t.testo = taglia(nuovo);
    if (fn) fila.testo = taglia(fn(fila.testo));
    daDire.add(el);
    presto();
  }
  function incollato(el, dati) {
    const suo = diUnIncolla(dati);
    if (!suo) return;
    aggiorna(el, (s) => (suo === dati ? s + dati : `${s}\n${suo}\n`), suo);
  }

  w.addEventListener('beforeinput', (e) => {
    if (!e.isTrusted || e.isComposing) return;
    const tipo = String(e.inputType || '');
    if (tipo === 'deleteContentBackward') { aggiorna(bersaglio(e), (s) => s.slice(0, -1)); return; }
    if (/^delete/.test(tipo)) { aggiorna(bersaglio(e), null); return; }
    if (!/^insert/.test(tipo) || tipo === 'insertCompositionText') return;
    let dati = e.data;
    if (dati == null && e.dataTransfer) { try { dati = e.dataTransfer.getData('text/plain'); } catch (_) { dati = ''; } }
    if (dati == null && /^insert(LineBreak|Paragraph)$/.test(tipo)) dati = '\n';
    if (!dati) return;
    if (/^insertFrom(Paste|Drop|Yank)/.test(tipo)) { incollato(bersaglio(e), dati); return; }
    aggiorna(bersaglio(e), (s) => s + dati, dati);
  }, true);
  w.addEventListener('compositionstart', (e) => {
    if (e.isTrusted && scrivibile(bersaglio(e))) aggiorna(bersaglio(e), null);
  }, true);
  w.addEventListener('compositionend', (e) => {
    if (e.isTrusted && e.data) aggiorna(bersaglio(e), (s) => s + e.data, e.data);
  }, true);
  // Un tasto conta anche se la pagina lo trattiene e scrive da sé il campo (le maschere di carte e telefoni).
  w.addEventListener('keydown', (e) => {
    if (!e.isTrusted) return;
    if (e.key === 'Enter') { subito(e); return; }
    if (e.isComposing || typeof e.key !== 'string' || [...e.key].length !== 1) return;
    if ((e.ctrlKey || e.metaKey) && !(e.getModifierState && e.getModifierState('AltGraph'))) return;
    const el = bersaglio(e);
    if (scrivibile(el)) aggiorna(el, null, e.key);
  }, true);
  // Un invio (Invio o un clic) porta con sé quello che l'utente ha appena scritto: il main lo sa prima di leggere la pagina.
  function subito(e) { if (e.isTrusted && (daDire.size || fila.testo !== fila.detto)) { if (timer) clearTimeout(timer); di(); } }
  w.addEventListener('pointerdown', subito, true);

  // Un riquadro vuoto si segue quando è pronto (load) e quando l'utente ci entra (la finestra perde il fuoco). Una
  // pagina che lo riscrive con document.open toglie gli ascoltatori: chi non risponde più si rimette.
  const seguiti = new WeakMap();
  function segui(f) {
    try {
      if (!f || !/^i?frame$/i.test(f.localName || '')) return;
      const R = globalThis.SN_RIQUADRI_IN_ARRIVO;
      const cw = R && typeof R.finestra === 'function' ? R.finestra(f) : null;
      if (!cw || cw.SN_IMMESSI || !cw.document) return;
      const prima = seguiti.get(cw);
      if (prima && prima.vivo()) return;
      seguiti.set(cw, ascoltaIn(cw, invia));
    } catch (_) { /* d'altra origine: il suo preload c'è */ }
  }
  w.addEventListener('load', (e) => segui(e.target), true);
  w.addEventListener('blur', (e) => { if (e.target === w) segui(w.document.activeElement); });
  const eco = `filo-immessi-${documento}`;
  let sentito = false;
  w.addEventListener(eco, () => { sentito = true; });
  function vivo() {
    sentito = false;
    try { w.dispatchEvent(new w.Event(eco)); } catch (_) { return false; }
    return sentito;
  }

  return { vivo, inserisce(el, testo) { if (scrivibile(el)) incollato(el, String(testo || '')); } };
}

module.exports = ascoltaImmessi;
module.exports.fattoDiCaratteri = fattoDiCaratteri;
module.exports.fattoAiBordi = fattoAiBordi;
module.exports.parteNuova = parteNuova;
module.exports.diUnIncolla = diUnIncolla;
module.exports.MAX_INCOLLA = MAX_INCOLLA;
