// Chi ha disegnato questo pezzo di pagina: il sito o Filo?
//
// Sulle pagine web Filo aggiunge roba SUA dentro al DOM del sito — menu del
// tasto destro, avvisi, popup, barra laterale, riquadri di conferma. Chi
// cammina sulla pagina per lavorarci (oggi "Traduci la pagina", e la sentinella
// che si accorge del testo arrivato dopo) deve poterla riconoscere e lasciarla
// stare: è già scritta nella lingua dell'utente, e tradurla vorrebbe dire
// pagare il modello per riscrivere il proprio menu.
//
// La risposta la dà un MARCHIO messo nel momento in cui l'elemento nasce, non
// il suo nome. Indovinarla dal nome — "comincia per sn- o per filo-" — sbaglia
// su siti veri: i portali costruiti con ServiceNow chiamano `sn-qualcosa` ogni
// loro pezzo, e "filo" è una parola italiana normale in un nome di classe. Su
// quei siti interi riquadri restavano in lingua originale sotto un avviso che
// dichiarava la pagina tradotta (#407): la stessa bugia da cui nasce la
// segnalazione. Un marchio che scriviamo noi non può collidere con niente.
//
// Regola per chi aggiunge UI a una pagina web: marca la RADICE del pezzo che
// attacchi al documento (chi cammina si ferma lì e non scende oltre), subito,
// nella stessa funzione che la crea.
//
//   SN_FILO_UI.mark(el)     → marca (ritorna l'elemento, si incatena)
//   SN_FILO_UI.is(el)       → è la radice di un pezzo di UI di Filo?
//   SN_FILO_UI.inside(el)   → sta dentro (o è) un pezzo di UI di Filo?
//   SN_FILO_UI.aperti()     → le radici NOSTRE attaccate al documento adesso
//   SN_FILO_UI.gestoVero(e) → l'evento viene dall'utente, non dal codice del sito?
//   SN_FILO_UI.soloGestiVeri(el) → i gesti fabbricati dallo script del sito non lo toccano
//   SN_FILO_UI.soloScritturaVera(el) → le sue caselle cambiano solo per l'utente o per Filo; valoreVero(c) le legge
//   SN_FILO_UI.ombra(host)  → shadow root chiuso di un riquadro; bersaglio(e) ci scende dentro
//
// L'attributo e l'elenco rispondono a due domande diverse, e la differenza è
// tutta nel mittente. Chi cammina sulla pagina chiede «questo pezzo lo salto?»:
// lì l'attributo basta, e se un sito se lo mette addosso l'unico effetto è che
// il suo testo non viene tradotto. Chi decide se un tasto era nostro chiede
// «questo pezzo l'ho disegnato IO?»: lì l'attributo non vale niente, perché il
// documento è del sito e un attributo se lo scrive anche lui. Un sito che si
// marcava un elemento invisibile e se lo toglieva a ogni Esc si teneva
// l'utente dentro allo schermo intero a tempo indeterminato (#514). L'elenco
// vive qui dentro, nel mondo isolato dei content script, e ci finisce solo chi
// passa da `mark()`: dalla pagina non ci si arriva.

(function (global) {
  'use strict';

  // `data-sn-ui`: un attributo, non una classe. Le classi le tocca anche il
  // sito (un framework che rifà la lista delle classi cancellerebbe il
  // marchio), e un attributo `data-` non entra in nessun foglio di stile.
  const ATTR = 'data-sn-ui';
  const SELECTOR = '[' + ATTR + ']';

  // Le radici che abbiamo disegnato noi, in ordine di nascita. Non è una WeakSet
  // perché va PERCORSA: la domanda è «quali di queste sono ancora attaccate?».
  const nostre = new Set();
  // Tetto di sicurezza: `mark()` arriva anche prima che l'elemento sia
  // attaccato, quindi la potatura non può guardare `isConnected` qui. Si tiene
  // il numero sotto controllo buttando le più vecchie, che è la direzione
  // sicura: una radice dimenticata vale «non è successo niente», mai «è
  // successo qualcosa».
  const TETTO = 256;

  // Chi vuole sapere che è appena nato un pezzo nostro. Serve a chi deve
  // preparare qualcosa PRIMA che l'utente prema un tasto: sopra lo schermo
  // pieno di un sito l'Esc va chiesto al browser mentre un nostro riquadro è
  // aperto, o quel tasto non arriva mai al documento (#514, giro 10).
  const osservatori = new Set();
  function onMark(fn) {
    if (typeof fn !== 'function') return () => {};
    osservatori.add(fn);
    return () => osservatori.delete(fn);
  }

  function mark(el) {
    try { if (el && el.setAttribute) el.setAttribute(ATTR, '1'); } catch (_) {}
    try {
      if (el) {
        nostre.add(el);
        while (nostre.size > TETTO) nostre.delete(nostre.values().next().value);
      }
    } catch (_) {}
    for (const fn of osservatori) { try { fn(el); } catch (_) {} }
    return el;
  }

  // Quelle attaccate al documento adesso. Non si pota qui: `mark()` arriva anche
  // un istante prima dell'inserimento, e una potatura fatta in mezzo butterebbe
  // via un riquadro che stava per nascere. A tenere corto l'elenco pensa il
  // tetto di `mark()`.
  function aperti() {
    const vive = [];
    try {
      for (const el of nostre) if (el && el.isConnected) vive.push(el);
    } catch (_) {}
    return vive;
  }

  function is(el) {
    try { return !!(el && el.getAttribute && el.getAttribute(ATTR) !== null); } catch (_) { return false; }
  }

  // Anche gli antenati: un nodo che compare in fondo a un nostro popup è
  // nostro quanto il popup. `closest` si ferma al confine di un componente
  // isolato, che è esattamente ciò che vogliamo — dentro lo shadow di un
  // riquadro di Filo la radice marcata è l'host, e chi cammina non ci entra.
  function inside(el) {
    try {
      if (is(el)) return true;
      return !!(el && el.closest && el.closest(SELECTOR));
    } catch (_) { return false; }
  }

  // Un clic o un tasto dell'utente, non del codice del sito: i nostri pezzi nel suo documento li preme
  // anche lui. Chi fa avanzare qualcosa di Filo da lì passa di qui (#592.6).
  function gestoVero(e) {
    return !!(e && e.isTrusted === true);
  }

  // Lo script del sito raggiunge ogni nodo del suo documento e sa fabbricarci sopra clic, passaggi e tasti:
  // a un pezzo di Filo arrivano solo quelli dell'utente (#589.8). Il cancello sta su OGNI nodo, non sulla radice:
  // un pulsante che il sito sposta fuori dal pezzo se lo porta dietro. Si chiama prima di attaccare al documento.
  const GESTI = ['click', 'dblclick', 'auxclick', 'contextmenu', 'mousedown', 'mouseup', 'mousemove',
    'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'pointerdown', 'pointerup', 'pointermove',
    'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'keydown', 'keyup', 'keypress',
    'beforeinput', 'input', 'change', 'wheel', 'dragstart', 'dragenter', 'dragover', 'drop',
    'touchstart', 'touchmove', 'touchend'];
  // Un evento fabbricato da codice nostro (l'Incolla del menu che scrive in un campo, la correzione) passa: lo
  // segniamo nel mondo isolato, dove l'oggetto che vede il sito è un altro e la sua copia non entra nell'elenco.
  const nostri = new WeakSet();
  function nostro(ev) { try { nostri.add(ev); } catch (_) {} return ev; }
  function veroONostro(e) { return !!(e && (e.isTrusted || nostri.has(e))); }
  function fermaIFinti(e) { if (!veroONostro(e)) e.stopImmediatePropagation(); }
  const chiusi = new WeakSet();
  function chiudi(n) {
    if (!n || n.nodeType !== 1 || chiusi.has(n)) return;
    chiusi.add(n);
    for (const t of GESTI) n.addEventListener(t, fermaIFinti, true);
  }
  function chiudiAlbero(n) {
    chiudi(n);
    if (n && n.querySelectorAll) for (const d of n.querySelectorAll('*')) chiudi(d);
  }
  // Ciò che entra dopo nel pezzo (contenuti che arrivano in ritardo) lo chiude l'osservatore: è la rete, non la
  // strada principale, perché un osservatore del sito creato prima del nostro viene avvisato per primo.
  const osservati = new WeakSet();
  function soloGestiVeri(el) {
    try {
      chiudiAlbero(el);
      if (!osservati.has(el) && typeof MutationObserver === 'function') {
        osservati.add(el);
        new MutationObserver((ms) => {
          for (const m of ms) for (const n of m.addedNodes) chiudiAlbero(n);
        }).observe(el, { childList: true, subtree: true });
      }
    } catch (_) {}
    return el;
  }

  // Una casella di Filo in un sito cambia solo per un inserimento dell'utente o per mano di Filo (#1071.1): un
  // `execCommand` del sito scrive nella casella che ha il fuoco anche dentro un riquadro chiuso, e la casella dell'Aiuto
  // sta nel suo documento. Il browser annuncia ogni inserimento dell'utente (tasti, incolla, dettatura, correttore del
  // sistema) con un `beforeinput` fidato, quello da script no; Filo scrive dal mondo isolato, dove setter ed
  // `execCommand` sono suoi. Ogni altro cambio si annulla. Prova: tests/caselle-solo-utente.spec.mjs.
  const SCRITTURA_GUARDATA = (() => {
    try { return !!global.document && typeof global.HTMLTextAreaElement === 'function' && global.location.protocol !== 'filo:'; } catch (_) { return false; }
  })();
  const CASELLE = 'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="password"], input[type="number"]';
  const caselle = new WeakMap();
  const daGuardare = new Set();
  const TETTO_CASELLE = 64;
  let nostraScrittura = 0;
  let patchate = false;
  let giroCaselle = 0;
  function patchaScritture() {
    if (patchate) return;
    patchate = true;
    for (const C of [global.HTMLTextAreaElement, global.HTMLInputElement]) {
      const proto = C && C.prototype;
      if (!proto) continue;
      const d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d && d.set && d.configurable) {
        Object.defineProperty(proto, 'value', {
          configurable: true, enumerable: d.enumerable, get: d.get,
          set(v) { d.set.call(this, v); scrittaDaFilo(this); },
        });
      }
      const srt = proto.setRangeText;
      if (typeof srt === 'function') proto.setRangeText = function (...a) { const r = srt.apply(this, a); scrittaDaFilo(this); return r; };
      for (const m of ['setSelectionRange', 'select']) {
        const f = proto[m];
        if (typeof f === 'function') proto[m] = function (...a) { const r = f.apply(this, a); selezioneDaFilo(this); return r; };
      }
      for (const k of ['selectionStart', 'selectionEnd', 'selectionDirection']) {
        const ds = Object.getOwnPropertyDescriptor(proto, k);
        if (!ds || !ds.set || !ds.configurable) continue;
        Object.defineProperty(proto, k, {
          configurable: true, enumerable: ds.enumerable, get: ds.get,
          set(v) { ds.set.call(this, v); selezioneDaFilo(this); },
        });
      }
    }
    const D = global.Document && global.Document.prototype;
    const ex = D && D.execCommand;
    if (typeof ex === 'function') {
      D.execCommand = function (...a) {
        const c = attivo();
        const st = c && caselle.get(c);
        const prima = st ? st.filo : null;
        if (st) {
          if (c.value !== st.buono && !inConsegna(st)) { const s = selezioneDi(c); ripristina(c, st); rimettiSelezione(c, s); }
          const tipo = COMANDI[String(a[0] || '').toLowerCase()];
          st.filo = tipo ? { tipo, dato: tipo === 'insertText' ? String(a[2] ?? '') : null, valore: c.value, sel: selezioneDi(c), riga: c.tagName !== 'TEXTAREA' } : null;
        }
        nostraScrittura++;
        try { return ex.apply(this, a); } finally { nostraScrittura--; if (st) st.filo = prima; }
      };
    }
  }
  // Un comando di Filo dice cosa scrive, come un annuncio dell'utente: il sito che cambia il testo mentre lo si consegna
  // non passa per Filo (#1340, giro 3). Un comando fuori elenco non scrive nelle caselle.
  const COMANDI = { inserttext: 'insertText', delete: 'deleteContentBackward', forwarddelete: 'deleteContentForward' };
  function selezioneDi(c) {
    try { return [c.selectionStart, c.selectionEnd]; } catch (_) { return null; }
  }
  // Annulla e rifai riportano la casella a un testo che ha già avuto: un testo che non c'è mai stato l'ha scritto il sito
  // (#1340). Si tiene l'impronta di ogni testo buono, non il testo: tenuti interi, con un log di centomila caratteri ne
  // restavano una ventina e Ctrl+Z non tornava più indietro. Il seme sta nel mondo isolato, quindi il sito non può
  // cercare un testo con la stessa impronta. Il tetto supera di molto la pila dell'annulla del browser.
  const TETTO_STORIA = 200_000;
  const SEME = (() => {
    try { const a = new Uint32Array(2); global.crypto.getRandomValues(a); return a; } catch (_) { return [Math.random() * 2 ** 32 >>> 0, Math.random() * 2 ** 32 >>> 0]; }
  })();
  function impronta(s) {
    let h1 = 0xdeadbeef ^ SEME[0], h2 = 0x41c6ce57 ^ SEME[1];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return `${s.length}:${h1 >>> 0}:${h2 >>> 0}`;
  }
  function vale(st, v) {
    st.buono = v;
    const k = impronta(v);
    if (st.storia.has(k)) { st.storia.delete(k); st.storia.add(k); return; }
    st.storia.add(k);
    while (st.storia.size > TETTO_STORIA) st.storia.delete(st.storia.values().next().value);
  }
  function scrittaDaFilo(c) {
    const st = caselle.get(c);
    if (!st) return;
    st.vigila = null;
    vale(st, c.value);
    st.sel = selezioneDi(c);
    fotografa(c, st);
  }
  function selezioneDaFilo(c) {
    const st = caselle.get(c);
    if (st && c.value === st.buono) { st.vigila = null; st.sel = selezioneDi(c); fotografa(c, st); }
  }
  // Una mossa di Filo mentre un tasto o un annuncio dell'utente sono in volo è il punto da cui l'utente riparte.
  function fotografa(c, st) {
    if (st.tasto) st.tasto.sel = selezioneDi(c);
    if (st.annuncio) { st.annuncio.valore = c.value; st.annuncio.sel = selezioneDi(c); }
  }
  // Un inserimento dell'utente è l'annuncio applicato al testo e alla selezione di quel momento (#1340): un cambio
  // del sito fatto dentro l'annuncio (il valore riscritto, la selezione allargata), o dopo uno che non ha scritto
  // niente, non combacia. Le cancellazioni tolgono soltanto, attaccate al cursore; annulla e gli altri non si prevedono.
  const ESATTI = /^(insertText|insertCompositionText|insertFromPaste|insertFromPasteAsQuotation|insertLineBreak|insertParagraph)$/;
  // Backspace e Canc tolgono al più un carattere come lo vede l'utente (un'emoji composta, una lettera accentata).
  function grafema(v, s, indietro) {
    const pezzo = indietro ? v.slice(Math.max(0, s - 64), s) : v.slice(s, s + 64);
    try {
      const g = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(pezzo)];
      const x = indietro ? g[g.length - 1] : g[0];
      return x ? x.segment.length : 0;
    } catch (_) { return Math.min(pezzo.length, 2); }
  }
  const UN_PASSO = /^deleteContent(Backward|Forward)$/;
  function atteso(a) {
    const [s, e] = a.sel;
    if (UN_PASSO.test(a.tipo) && s === e) {
      const indietro = a.tipo.endsWith('Backward');
      const g = grafema(a.valore, s, indietro);
      return indietro ? a.valore.slice(0, s - g) + a.valore.slice(e) : a.valore.slice(0, s) + a.valore.slice(e + g);
    }
    if (/^delete/.test(a.tipo) && a.tipo !== 'deleteByDrag' && s !== e) return a.valore.slice(0, s) + a.valore.slice(e);
    const d = typeof a.dato === 'string' ? a.dato.replace(/\r\n?/g, '\n') : (/^insert(LineBreak|Paragraph)$/.test(a.tipo) ? '\n' : null);
    // Una casella di una riga toglie gli a capo a modo suo: lì vale solo che testa e coda restino.
    if (d === null || (a.riga && d.includes('\n'))) return null;
    return a.valore.slice(0, s) + d + a.valore.slice(e);
  }
  // Quanto `n` ha in comune con `v` in testa e in coda (le due parti non si sovrappongono in `n`).
  function bordi(v, n) {
    let p = 0;
    while (p < v.length && p < n.length && v[p] === n[p]) p++;
    let q = 0;
    while (q < v.length - p && q < n.length - p && v[v.length - 1 - q] === n[n.length - 1 - q]) q++;
    return [p, q];
  }
  // `n` è `v` con un pezzo (vuoto se `soloAggiunto`) sostituito da `d`, in qualunque punto: il rilascio cade dove sta il
  // puntatore, il correttore cambia la parola sbagliata e non la selezione.
  function sostituito(v, n, d, soloAggiunto) {
    const fuori = n.length - d.length;
    if (fuori < 0 || (soloAggiunto && fuori !== v.length)) return false;
    let p = 0;
    while (p < v.length && p < n.length && v[p] === n[p]) p++;
    let q = 0;
    while (q < v.length && q < n.length && v[v.length - 1 - q] === n[n.length - 1 - q]) q++;
    for (let i = Math.max(0, fuori - q); i <= Math.min(p, fuori); i++) {
      if (v.length - (fuori - i) >= i && n.startsWith(d, i)) return true;
    }
    return false;
  }
  function combacia(a, n, st) {
    const v = a.valore;
    // Annulla e rifai non si prevedono, ma tornano sempre a un testo già avuto dalla casella.
    if (/^history(Undo|Redo)$/.test(a.tipo)) return st.storia.has(impronta(n));
    if (a.tipo === 'insertFromDrop' || a.tipo === 'insertReplacementText') {
      let d = typeof a.dato === 'string' ? a.dato : a.trasferito;
      if (typeof d !== 'string') return false;
      d = d.replace(/\r\n?/g, '\n');
      if (a.riga) d = d.replace(/\n/g, '');
      return sostituito(v, n, d, a.tipo === 'insertFromDrop');
    }
    if (a.tipo === 'deleteByDrag') {
      const [p, q] = bordi(v, n);
      return n.length < v.length && p + q >= n.length;
    }
    const [s, e] = a.sel || [];
    if (typeof s !== 'number' || typeof e !== 'number') return true;
    const testa = v.slice(0, s);
    const coda = v.slice(e);
    if (ESATTI.test(a.tipo)) {
      const x = atteso(a);
      return x !== null ? n === x : (n.length >= s + coda.length && n.startsWith(testa) && n.endsWith(coda));
    }
    if (!/^delete/.test(a.tipo)) return true;
    const tolti = v.length - n.length;
    if (tolti < 0) return false;
    if (UN_PASSO.test(a.tipo) && s === e && tolti > grafema(v, s, a.tipo.endsWith('Backward'))) return false;
    if (s !== e) return n === testa + coda;
    if (/Backward$/.test(a.tipo)) return tolti <= s && n === v.slice(0, s - tolti) + coda;
    if (/Forward$/.test(a.tipo)) return n === testa + v.slice(e + tolti);
    for (let da = Math.max(0, s - tolti); da <= s; da++) if (n === v.slice(0, da) + v.slice(da + tolti)) return true;
    return false;
  }
  // La selezione da rimettere con il testo è l'ultima mossa dall'utente (mouse, frecce, Ctrl+A) o da Filo: un `selectAll`
  // del sito prima del suo inserimento lascerebbe tutto selezionato, e il tasto dopo dell'utente lo cancellerebbe.
  function ripristina(c, st) {
    const sel = st.sel;
    c.value = st.buono;
    try {
      if (sel && typeof sel[0] === 'number') {
        const n = c.value.length;
        c.setSelectionRange(Math.min(sel[0], n), Math.min(sel[1], n));
      }
    } catch (_) {}
    st.sel = sel;
  }
  // L'inserimento accettato più interno ancora in consegna: chi arriva mentre lo si consegna viene da un suo
  // ascoltatore, e vale solo se è Filo che ha appena scritto (il correttore che corregge mentre l'utente batte).
  function inConsegna(st) {
    while (st.inCorso.length && st.inCorso[st.inCorso.length - 1].e.eventPhase === 0) st.inCorso.pop();
    return st.inCorso[st.inCorso.length - 1] || null;
  }
  function guardaCasella(c) {
    if (caselle.has(c)) return;
    const st = { buono: '', storia: new Set(), sel: selezioneDi(c), annuncio: null, tasto: null, componendo: false, inCorso: [], visto: false, gesto: false };
    vale(st, c.value);
    caselle.set(c, st);
    c.addEventListener('beforeinput', (e) => {
      if (!e.isTrusted) return;
      if (c.value !== st.buono && !inConsegna(st)) ripristina(c, st);
      // Fra il tasto e il suo annuncio, o durante l'annuncio, nessun gesto dell'utente sposta la selezione: chi l'ha
      // spostata è il sito. Rilascio, correttore e annulla mettono il testo dove dicono loro.
      const t = st.tasto;
      const sel = t && t.sel ? t.sel : (st.prima && st.prima.e === e ? st.prima.sel : null);
      if (sel && !st.componendo && !e.isComposing && !SELEZIONE_PROPRIA.test(e.inputType) && c.value === st.buono) rimettiSelezione(c, sel);
      let trasferito = null;
      try { if (e.dataTransfer) trasferito = e.dataTransfer.getData('text/plain'); } catch (_) {}
      const a = { e, tipo: e.inputType, dato: e.data, trasferito, valore: c.value, sel: selezioneDi(c), riga: c.tagName !== 'TEXTAREA' };
      st.annuncio = a;
      setTimeout(() => { if (st.annuncio === a) st.annuncio = null; }, 0);
    }, true);
    c.addEventListener('input', (e) => {
      const madre = inConsegna(st);
      const a = st.annuncio;
      const annunciato = !madre && e.isTrusted && !!a && a.e.eventPhase === 0 && !a.e.defaultPrevented && a.tipo === e.inputType;
      const diFilo = madre ? nostraScrittura > madre.livello : nostraScrittura > 0;
      const voluto = diFilo ? st.filo : (annunciato ? a : null);
      if (voluto ? combacia(voluto, c.value, st) : diFilo) {
        if (voluto === a) st.annuncio = null;
        st.inCorso.push({ e, livello: nostraScrittura });
        vale(st, c.value);
        st.sel = st.dopo && st.dopo.e === e ? st.dopo.sel : selezioneDi(c);
        return;
      }
      // L'annuncio vero, o la scrittura di Filo, con un cambio del sito dentro: resta quello annunciato, applicato al testo.
      const x = voluto ? atteso(voluto) : null;
      if (annunciato) st.annuncio = null;
      if (x !== null) {
        const fine = voluto.tipo === 'deleteContentForward' ? voluto.sel[0] : x.length - (voluto.valore.length - voluto.sel[1]);
        c.value = x;
        try { c.setSelectionRange(fine, fine); } catch (_) {}
        st.inCorso.push({ e, livello: nostraScrittura });
        return;
      }
      if (c.value === st.buono) return;
      ripristina(c, st);
      e.stopImmediatePropagation();
    }, true);
    // Solo la composizione vera: una finta del sito spegnerebbe il ritorno della selezione (#1340, giro 3).
    c.addEventListener('compositionstart', (e) => { if (e.isTrusted) { st.componendo = true; st.tasto = null; } }, true);
    c.addEventListener('compositionend', (e) => { if (e.isTrusted) st.componendo = false; }, true);
    // Di riserva, dove il ponte di page-preload non c'è; nei riquadri il tasto arriva come copia nostra.
    const qui = (e) => { if (!global.__snPrimiAscolti && veroONostro(e)) gestoSu(c, st, e); };
    for (const t of GESTI_CASELLA) c.addEventListener(t, qui, true);
    daGuardare.add(c);
    while (daGuardare.size > TETTO_CASELLE) daGuardare.delete(daGuardare.values().next().value);
    if (!giroCaselle) giroCaselle = global.requestAnimationFrame(controllaCaselle);
  }
  // Tasti e puntatore si guardano prima del sito (#1340): il ponte di page-preload, a document_start, chiama
  // `primaDelSito` prima di ogni suo ascolto. Dal campo, il sito in cattura sulla finestra avrebbe già spostato la selezione.
  const INIZI = ['keydown', 'pointerdown', 'mousedown', 'touchstart'];
  // Incolla e taglia arrivano anche senza un tasto che la pagina veda (Incolla del menu dell'app, che su Mac è la strada
  // di Cmd+V): la selezione da cui partono è quella che hanno trovato, prima che il sito li ascolti (#1340, giro 4).
  const APPUNTI = ['paste', 'cut'];
  const GESTI_CASELLA = [...INIZI, 'keyup', 'pointerup', 'mouseup', 'touchend', 'click', ...APPUNTI];
  const TASTI_CHE_MUOVONO = /^(Arrow|Home$|End$|Page)/;
  // La selezione spostata mentre il sito riceve un tasto o un inserimento dell'utente (fra l'ascolto di Filo, che viene
  // prima, e la fine del giro) l'ha spostata il sito: torna. Fuori da quei giri la sposta anche la barra dei menu (Cmd+A
  // su Mac), che la pagina non vede: lì resta il limite del pattern.
  // Un messaggio, non un timer: i timer di una scheda nascosta aspettano fino a un secondo, e il controllo cadrebbe
  // sopra il gesto seguente.
  const coda = [];
  let canale = null;
  function dopoIlGiro(f) {
    try {
      if (!canale) {
        canale = new MessageChannel();
        canale.port1.onmessage = () => { const g = coda.shift(); if (g) g(); };
      }
      coda.push(f);
      canale.port2.postMessage(0);
    } catch (_) { setTimeout(f, 0); }
  }
  function vigila(c, st, sel) {
    const v = { sel };
    st.vigila = v;
    dopoIlGiro(() => {
      if (st.vigila !== v) return;
      st.vigila = null;
      torna(c, st, v.sel);
    });
  }
  // Il gesto seguente dell'utente può arrivare prima del controllo (il browser passa i tasti avanti ai tempi): lo fa lui.
  function sciogli(c, st) {
    const v = st.vigila;
    st.vigila = null;
    if (v) torna(c, st, v.sel);
  }
  // Il clic dentro una selezione la chiude in quel punto, e il browser lo fa anche dopo aver mandato il clic.
  function torna(c, st, sel) {
    const ora = selezioneDi(c);
    if (c.value === st.buono && !st.componendo && !(ora && sel && chiusaDalRilascio(sel, ora))) rimettiSelezione(c, sel);
  }
  // Fra il rilascio del mouse e il clic il browser può solo chiudere in un punto la selezione su cui si è cliccato:
  // ogni altro spostamento l'ha fatto il sito nei suoi ascolti del rilascio e del clic (#1340, giro 3).
  function chiusaDalRilascio(r, ora) {
    return r[0] !== r[1] && ora[0] === ora[1] && ora[0] >= r[0] && ora[0] <= r[1];
  }
  function rilascio(c, st, e) {
    const ora = selezioneDi(c);
    const r = st.rilascio;
    const libera = c.value === st.buono && !st.componendo;
    if (e.type !== 'click') {
      if (e.type === 'pointerup' || !r) st.rilascio = ora;
      else if (libera) rimettiSelezione(c, r);
      return;
    }
    st.rilascio = null;
    if (libera && r && ora && !(ora[0] === r[0] && ora[1] === r[1]) && !chiusaDalRilascio(r, ora)) rimettiSelezione(c, r);
    if (libera) { vigila(c, st, selezioneDi(c)); st.sel = selezioneDi(c); }
  }
  function gestoSu(c, st, e) {
    sciogli(c, st);
    if (!INIZI.includes(e.type)) {
      st.tasto = null;
      if (e.type === 'keyup' && !st.componendo) vigila(c, st, selezioneDi(c));
      if (/^(pointerup|mouseup|click)$/.test(e.type)) rilascio(c, st, e);
      if (e.type === 'click' || !st.gesto) return;
      st.gesto = false;
      if (c.value === st.buono) st.sel = selezioneDi(c);
      return;
    }
    if (e.type === 'keydown') {
      // Un tasto che passa dal metodo di scrittura (229, Process, i tasti morti) sposta la selezione da sé.
      const ime = e.isComposing || e.keyCode === 229 || e.key === 'Process' || e.key === 'Dead';
      const t = ime ? null : { e, sel: selezioneDi(c) };
      st.tasto = t;
      if (t) setTimeout(() => { if (st.tasto === t) st.tasto = null; }, 0);
    } else {
      st.tasto = null;
      st.rilascio = null;
    }
    if (e.type !== 'keydown' || TASTI_CHE_MUOVONO.test(e.key) || e.ctrlKey || e.metaKey || e.altKey) st.gesto = true;
  }
  function attivo() {
    let el = null;
    try { el = document.activeElement; } catch (_) {}
    for (let giri = 0; el && giri < 8; giri++) {
      const r = ombre.get(el);
      if (!r || !r.activeElement || r.activeElement === el) break;
      el = r.activeElement;
    }
    return el;
  }
  const SELEZIONE_PROPRIA = /^(insertFromDrop|deleteByDrag|insertReplacementText|historyUndo|historyRedo)$/;
  function rimettiSelezione(c, sel) {
    const ora = selezioneDi(c);
    if (!ora || !sel || typeof sel[0] !== 'number' || (ora[0] === sel[0] && ora[1] === sel[1])) return;
    const n = c.value.length;
    try { c.setSelectionRange(Math.min(sel[0], n), Math.min(sel[1], n)); } catch (_) {}
  }
  function primaDelSito(e) {
    try {
      if (!SCRITTURA_GUARDATA || !e || !e.isTrusted) return;
      if (e.type === 'beforeinput' || e.type === 'input') {
        const c = bersaglio(e);
        const st = c && caselle.get(c);
        if (!st) return;
        sciogli(c, st);
        // La selezione a cui l'annuncio si applica, e dove l'inserimento ha lasciato il cursore.
        if (e.type === 'beforeinput') st.prima = { e, sel: selezioneDi(c) };
        else {
          st.dopo = { e, sel: selezioneDi(c) };
          if (!st.componendo && !e.isComposing) vigila(c, st, st.dopo.sel);
        }
        return;
      }
      if (!GESTI_CASELLA.includes(e.type)) return;
      let c = bersaglio(e);
      // Il mouse rilasciato fuori dalla casella chiude lo stesso la selezione cominciata dentro.
      if (!caselle.has(c) && !INIZI.includes(e.type)) c = attivo();
      const st = c && caselle.get(c);
      if (st) gestoSu(c, st, e);
    } catch (_) {}
  }
  // Un `value` scritto dal sito non manda eventi (l'Aiuto sta nel suo documento): si rimette a ogni fotogramma.
  function controllaCaselle() {
    giroCaselle = 0;
    for (const c of daGuardare) {
      const st = caselle.get(c);
      if (!c.isConnected) { if (st.visto) daGuardare.delete(c); continue; }
      st.visto = true;
      if (c.value !== st.buono && !inConsegna(st)) ripristina(c, st);
    }
    if (daGuardare.size) giroCaselle = global.requestAnimationFrame(controllaCaselle);
  }
  // Le caselle di `el` (o `el` stesso), anche quelle che entrano dopo.
  const osservateScrittura = new WeakSet();
  function soloScritturaVera(el) {
    if (!SCRITTURA_GUARDATA || !el || el.nodeType !== 1) return el;
    try {
      patchaScritture();
      if (el.matches(CASELLE)) guardaCasella(el);
      for (const c of el.querySelectorAll(CASELLE)) guardaCasella(c);
      if (!osservateScrittura.has(el) && typeof MutationObserver === 'function') {
        osservateScrittura.add(el);
        new MutationObserver((ms) => {
          for (const m of ms) {
            for (const n of m.addedNodes) {
              if (n.nodeType !== 1) continue;
              if (n.matches(CASELLE)) guardaCasella(n);
              for (const c of n.querySelectorAll(CASELLE)) guardaCasella(c);
            }
          }
        }).observe(el, { childList: true, subtree: true });
      }
    } catch (_) {}
    return el;
  }
  // Il testo da mandare: quello che ha scritto l'utente, anche se il sito l'ha appena cambiato senza eventi.
  function valoreVero(c) {
    const st = c && caselle.get(c);
    if (st && c.value !== st.buono && !inConsegna(st)) ripristina(c, st);
    return c ? c.value : '';
  }

  // Un riquadro che porta parole dell'utente o di un modello sta in uno shadow root chiuso (#1071): l'host è l'unico
  // nodo che il documento vede. L'attributo dice a chi chiede «si sta scrivendo?» da fuori (anche dal main, che
  // non vede dentro) che il fuoco lì dentro è in un campo nostro; la radice resta raggiungibile solo da qui.
  const RIQUADRO = 'data-sn-riquadro';
  const ombre = new WeakMap();
  function ombra(host) {
    const radice = host.attachShadow({ mode: 'closed' });
    ombre.set(host, radice);
    try { host.setAttribute(RIQUADRO, ''); } catch (_) {}
    return radice;
  }
  function ombraDi(el) {
    try { return (el && (el.shadowRoot || ombre.get(el))) || null; } catch (_) { return null; }
  }

  // Il nodo vero sotto un evento. Chi ascolta su window o sul documento vede l'host di un riquadro chiuso, non il
  // campo o il collegamento toccati: si scende col punto del puntatore, o col fuoco quando il gesto è da tastiera.
  function bersaglio(e) {
    let t = null;
    try { t = (typeof e.composedPath === 'function' && e.composedPath()[0]) || e.target || null; } catch (_) { t = null; }
    for (let giri = 0; t && giri < 8; giri++) {
      const r = ombre.get(t);
      if (!r) break;
      let giu = null;
      const x = Number(e.clientX);
      const y = Number(e.clientY);
      const colPuntatore = Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0) && e.detail !== 0;
      try { if (colPuntatore || e.type === 'contextmenu') giu = r.elementFromPoint(x, y); } catch (_) { giu = null; }
      if (!giu || giu === t) giu = r.activeElement;
      if (!giu || giu === t) break;
      t = giu;
    }
    return t;
  }

  // Da fuori un tasto scritto in un riquadro chiuso parte dall'host, che per il sito non è una casella: le sue scorciatoie,
  // anche in cattura, si prenderebbero quello che l'utente scrive (#1071). Lo ferma il primo ascolto della pagina (il ponte
  // in page-preload, a document_start) e al campo arriva una copia nostra che non esce dallo shadow; l'Esc resta di tutti (#514).
  function tastoNelRiquadro(e) {
    try {
      if (!e || !e.isTrusted || e.key === 'Escape') return;
      const host = (typeof e.composedPath === 'function' && e.composedPath()[0]) || e.target;
      if (!host || !ombre.has(host)) return;
      const campo = bersaglio(e);
      if (!campo || campo === host) return;
      e.stopImmediatePropagation();
      const copia = nostro(new KeyboardEvent(e.type, {
        key: e.key, code: e.code, location: e.location, repeat: e.repeat, isComposing: e.isComposing,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
        keyCode: e.keyCode, charCode: e.charCode, which: e.which,
        bubbles: true, cancelable: true, composed: false, view: e.view,
      }));
      campo.dispatchEvent(copia);
      if (copia.defaultPrevented) e.preventDefault();
    } catch (_) {}
  }

  // La chiave di una bozza scritta in un riquadro: resta al sito dove è nata, e il main concede a ogni riquadro solo
  // quella con la sua origine (BOZZE_PER_SITO in impostazioniPerOrigine.js). Senza origine non c'è bozza (null).
  function chiaveDiBozza(nome) {
    try {
      if (location.protocol === 'filo:') return nome;
      return location.origin && location.origin !== 'null' ? `${nome}@${location.origin}` : null;
    } catch (_) { return null; }
  }

  const _test = {
    // Il primo nodo che risponde al selettore, nel documento o dentro un riquadro nostro (anche chiuso).
    trova(sel) { return trovaTutti(sel)[0] || null; },
    trovaTutti,
    // Il nodo più profondo sotto un punto, scendendo nei riquadri nostri.
    daPunto(x, y) {
      let el = document.elementFromPoint(x, y);
      for (let giri = 0; el && ombre.has(el) && giri < 8; giri++) {
        const giu = ombre.get(el).elementFromPoint(x, y);
        if (!giu || giu === el) break;
        el = giu;
      }
      return el;
    },
  };
  function trovaTutti(sel) {
    const out = [];
    try {
      out.push(...document.querySelectorAll(sel));
      for (const host of document.querySelectorAll('[' + RIQUADRO + ']')) {
        const r = ombre.get(host);
        if (r) out.push(...r.querySelectorAll(sel));
      }
    } catch (_) {}
    return out;
  }

  global.SN_FILO_UI = {
    ATTR, SELECTOR, RIQUADRO, mark, is, inside, aperti, onMark, soloGestiVeri, gestoVero, nostro, veroONostro,
    soloScritturaVera, valoreVero, primaDelSito, ombra, ombraDi, bersaglio, tastoNelRiquadro, chiaveDiBozza, _test,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
