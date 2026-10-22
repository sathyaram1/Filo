// Il testo che l'utente immette nella pagina, in ogni frame, detto al main: un segreto che la pagina mostra ed è suo non
// è letto da fuori (#810.8). Dell'utente è il valore vero del campo se è fatto dei caratteri che lui ci ha messo con eventi
// veri; se no, solo quei caratteri in fila. Un sito non li produce. Regole: src/main/services/segretiLetti.js.

// Largo: un documento incollato intero resta dell'utente; oltre, si tiene la coda.
const MAX_TESTO = 1000000;
const ATTESA_MS = 150;
// Un incolla o un trascina porta testo che un sito può aver scelto (la copia riscritta): oltre questa misura non è
// dell'utente, se no una fila con tutti i codici a sei cifre li coprirebbe tutti. Password, carte e IBAN ci stanno larghi.
const MAX_INCOLLA = 1000;

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

function valoreVero(el) {
  try {
    if (typeof el.matches === 'function' && el.matches('input, textarea')) return String(el.value || '');
    if (!el.isContentEditable) return null;
    let host = el;
    while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement;
    return String(host.innerText || '');
  } catch (_) { return null; }
}

const scrivibile = (el) => {
  try { return !!el && ((typeof el.matches === 'function' && el.matches('input, textarea')) || !!el.isContentEditable); } catch (_) { return false; }
};

function ascoltaImmessi(invia) {
  if (typeof window === 'undefined' || typeof invia !== 'function') return;
  const testi = new WeakMap();
  const daDire = new Set();
  // Il numero di un elemento vale in questo documento: quello della pagina dopo, nella stessa scheda, non lo sostituisce.
  const documento = Math.random().toString(36).slice(2, 10);
  let numero = 0;
  let timer = null;

  function di() {
    timer = null;
    for (const el of daDire) {
      const t = testi.get(el);
      if (!t) continue;
      const v = valoreVero(el);
      // Anche la fila: la chat si svuota a ogni invio, e quello che c'era resta dell'utente.
      const testo = v && v.length <= MAX_TESTO && fattoDiCaratteri(v, t.conti) ? `${v}\u0001${t.testo}` : t.testo;
      if (testo) { try { invia(`${documento}.${t.n}`, testo); } catch (_) { /* il main è andato via */ } }
    }
    daDire.clear();
  }
  const presto = () => { if (!timer) timer = setTimeout(di, ATTESA_MS); };
  const bersaglio = (e) => {
    const p = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return p[0] || e.target;
  };

  function voce(el) {
    let t = testi.get(el);
    if (!t) { t = { n: ++numero, testo: '', conti: new Map(), quanti: 0 }; testi.set(el, t); }
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
  function aggiorna(el, fn, dati = '') {
    if (!el || typeof el !== 'object') return;
    const t = voce(el);
    if (dati) contati(t, dati);
    const nuovo = fn ? fn(t.testo) : t.testo;
    if (nuovo !== t.testo) t.testo = nuovo.length > MAX_TESTO ? nuovo.slice(-MAX_TESTO) : nuovo;
    daDire.add(el);
    presto();
  }

  window.addEventListener('beforeinput', (e) => {
    if (!e.isTrusted || e.isComposing) return;
    const tipo = String(e.inputType || '');
    if (tipo === 'deleteContentBackward') { aggiorna(bersaglio(e), (s) => s.slice(0, -1)); return; }
    if (/^delete/.test(tipo)) { aggiorna(bersaglio(e), null); return; }
    if (!/^insert/.test(tipo) || tipo === 'insertCompositionText') return;
    let dati = e.data;
    if (dati == null && e.dataTransfer) { try { dati = e.dataTransfer.getData('text/plain'); } catch (_) { dati = ''; } }
    if (dati == null && /^insert(LineBreak|Paragraph)$/.test(tipo)) dati = '\n';
    if (!dati) return;
    if (/^insertFrom(Paste|Drop|Yank)/.test(tipo) && dati.length > MAX_INCOLLA) return;
    aggiorna(bersaglio(e), (s) => s + dati, dati);
  }, true);
  window.addEventListener('compositionend', (e) => {
    if (e.isTrusted && e.data) aggiorna(bersaglio(e), (s) => s + e.data, e.data);
  }, true);
  // Un tasto conta anche se la pagina lo trattiene e scrive da sé il campo (le maschere di carte e telefoni).
  window.addEventListener('keydown', (e) => {
    if (!e.isTrusted) return;
    if (e.key === 'Enter') { subito(e); return; }
    if (e.isComposing || typeof e.key !== 'string' || [...e.key].length !== 1) return;
    if ((e.ctrlKey || e.metaKey) && !(e.getModifierState && e.getModifierState('AltGraph'))) return;
    const el = bersaglio(e);
    if (scrivibile(el)) aggiorna(el, null, e.key);
  }, true);
  // Un invio (Invio o un clic) porta con sé quello che l'utente ha appena scritto: il main lo sa prima di leggere la pagina.
  function subito(e) { if (e.isTrusted && daDire.size) { if (timer) clearTimeout(timer); di(); } }
  window.addEventListener('pointerdown', subito, true);
  // Per l'Accetta di una proposta dell'assistente: sta nel mondo di Filo, la pagina non la raggiunge.
  globalThis.SN_IMMESSI = Object.freeze({
    accettato(el, testo) {
      const dati = String(testo || '');
      if (dati && dati.length <= MAX_INCOLLA) aggiorna(el, (s) => s + dati, dati);
    },
  });
}

module.exports = ascoltaImmessi;
module.exports.fattoDiCaratteri = fattoDiCaratteri;
module.exports.MAX_INCOLLA = MAX_INCOLLA;
