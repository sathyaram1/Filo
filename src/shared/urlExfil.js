// Rilevatore di esfiltrazione dati via URL (sicurezza NAVIGA): una pagina ostile può far
// aprire al modello un URL che porta fuori i dati del contesto. Non si indovina se «sembra»
// sensibile: si cerca il corpus dentro l'URL. Non blocca, alza NAVIGA a livello 2.

(function (global) {
  'use strict';

  // Soglie tarate sul caso realistico: il modello istruito a mettere i dati nell'URL li
  // mette in chiaro o base64, non in forme cifrate sofisticate.
  const MIN_TOKEN = 5;      // lunghezza minima di un token del corpus per contare
  const STRONG_TOKEN = 12;  // un solo token così lungo che combacia → già sospetto
  const STRUCT_CARRIER = 80; // payload (query+fragment+path) per il fallback strutturale
  const STRUCT_BLOB = 24;   // singolo token opaco (sottodominio/segmento) → sospetto

  // Parole comuni (it/en) lunghe ma innocue: evitano che un URL legittimo che le contiene
  // scateni il match a token singolo.
  const STOPWORDS = new Set([
    'preferenze', 'preferences', 'informazioni', 'information', 'impostazioni',
    'settings', 'configurazione', 'configuration', 'utente', 'browser',
    'documento', 'document', 'pagina', 'risultati', 'results', 'application',
    'applicazione', 'navigazione', 'navigation', 'messaggio', 'message',
  ]);

  // Smaschera ?d=<base64 dei segreti>; '' se non sembra base64 o non dà testo stampabile.
  function tryBase64(tok) {
    if (tok.length < 8 || tok.length % 4 === 1) return '';
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(tok)) return '';
    try {
      const norm = tok.replace(/-/g, '+').replace(/_/g, '/');
      const bin = (typeof atob === 'function')
        ? atob(norm.padEnd(Math.ceil(norm.length / 4) * 4, '='))
        : Buffer.from(norm, 'base64').toString('binary');
      // Accetta solo se per lo più stampabile (evita rumore binario).
      if (!bin || bin.length < 3) return '';
      let printable = 0;
      for (let i = 0; i < bin.length; i++) {
        const c = bin.charCodeAt(i);
        if (c >= 32 && c < 127) printable++;
      }
      return printable / bin.length > 0.85 ? bin : '';
    } catch (_) { return ''; }
  }

  // Normalizzato in sola forma alfanumerica minuscola: «Mario_Rossi», «mario.rossi» e
  // «MarioRossi» collassano sulla stessa chiave e i separatori non aiutano a evadere il match.
  function exposedAlnum(url) {
    const raw = String(url || '');
    const pieces = [raw];
    let cur = raw;
    for (let i = 0; i < 3; i++) {
      let dec = cur;
      try { dec = decodeURIComponent(cur.replace(/\+/g, ' ')); } catch (_) { dec = cur; }
      if (dec === cur) break;
      pieces.push(dec);
      cur = dec;
    }
    // `=` qui è un separatore (es. «p=<base64>»): il padding lo ripristina tryBase64.
    const joined = pieces.join(' ');
    for (const tok of joined.split(/[^A-Za-z0-9+/_-]+/)) {
      if (tok.length >= 16) {
        const b = tryBase64(tok);
        if (b) pieces.push(b);
      }
    }
    return pieces.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  // Token sensibili del corpus: parole alfanumeriche (≥ MIN_TOKEN) ed email, intere e
  // come parte locale.
  function corpusTokens(corpus) {
    const text = String(corpus || '');
    const out = new Set();
    const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
    let m;
    while ((m = emailRe.exec(text))) {
      const e = m[0].toLowerCase();
      out.add(e.replace(/[^a-z0-9]+/g, ''));
      const local = e.split('@')[0].replace(/[^a-z0-9]+/g, '');
      if (local.length >= MIN_TOKEN) out.add(local);
    }
    for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= MIN_TOKEN) out.add(w);
    }
    return out;
  }

  // Combacia «forte» se lungo e non stopword, oppure se contiene una cifra (nomi+numeri,
  // token, id): segnale specifico, non parola comune.
  function isStrong(tok) {
    if (/[0-9]/.test(tok) && tok.length >= MIN_TOKEN) return true;
    return tok.length >= STRONG_TOKEN && !STOPWORDS.has(tok);
  }

  function taint(url, corpus) {
    const exposed = exposedAlnum(url);
    if (!exposed) return null;
    const toks = corpusTokens(corpus);
    let hits = 0;
    let strong = false;
    let sample = '';
    for (const t of toks) {
      if (t.length < MIN_TOKEN) continue;
      if (exposed.includes(t)) {
        hits++;
        if (!sample) sample = t;
        if (isStrong(t)) { strong = true; sample = t; }
      }
    }
    // Un token forte da solo, oppure ≥2 token distinti (dump multi-parola).
    if (strong) return { reason: `contiene un tuo dato ("${sample}…")` };
    if (hits >= 2) return { reason: 'contiene più dati presi dalla tua memoria/contesto' };
    return null;
  }

  // Fallback strutturale: un payload corposo o un blob opaco copre i dati cifrati che il
  // taint-match non vede. Solo con fromUntrusted, per non infastidire sui link legittimi.
  function structural(url) {
    let u;
    try { u = new URL(url); } catch (_) {
      try { u = new URL('https://' + url); } catch (_) { return null; }
    }
    const search = u.search || '';
    const hash = u.hash || '';
    const path = (u.pathname && u.pathname !== '/') ? u.pathname : '';
    const carrier = search.length + hash.length + path.length;
    if (carrier >= STRUCT_CARRIER) {
      return { reason: 'porta una grande quantità di dati nel link' };
    }
    // Blob opaco singolo (no separatori umani) in sottodominio o segmenti.
    const host = u.hostname || '';
    const labels = host.split('.');
    for (const lbl of labels.slice(0, Math.max(0, labels.length - 2))) {
      if (lbl.length >= STRUCT_BLOB) return { reason: 'usa un sottodominio anomalo' };
    }
    for (const seg of (search + hash + path).split(/[^A-Za-z0-9+/_=-]+/)) {
      if (seg.length >= STRUCT_BLOB && !/^https?$/i.test(seg)) {
        return { reason: 'contiene un blocco di dati codificato' };
      }
    }
    return null;
  }

  // corpus = materiale sensibile che era nel contesto del modello (memoria, appunti,
  // output comandi). fromUntrusted = l'azione nasce da una superficie non fidata.
  function assess(url, { corpus = '', fromUntrusted = false } = {}) {
    const link = String(url || '').trim();
    if (!link) return { exfil: false, reason: '' };
    const t = taint(link, corpus);
    if (t) return { exfil: true, reason: t.reason };
    if (fromUntrusted) {
      const s = structural(link);
      if (s) return { exfil: true, reason: s.reason };
    }
    return { exfil: false, reason: '' };
  }

  global.SN_URL_EXFIL = { assess, taint, structural, exposedAlnum, corpusTokens };
})(typeof globalThis !== 'undefined' ? globalThis : self);
