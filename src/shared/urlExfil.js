// Rilevatore di esfiltrazione dati via URL (sicurezza NAVIGA).
//
// Filo apre i link DIRETTAMENTE in una scheda (NAVIGA, livello 1, nessuna
// conferma). Una pagina ostile può però iniettare istruzioni nel modello
// (prompt injection) per fargli aprire un URL che PORTA FUORI dati sensibili
// che il modello aveva nel contesto — memoria/profilo dell'utente, appunti,
// output di comandi — codificandoli nella query/path/sottodominio. È una GET
// silenziosa verso il server dell'attaccante.
//
// L'idea chiave: NON si prova a capire se un URL "sembra" sensibile (impossibile
// e fragile — un URL di ricerca legittimo è indistinguibile a occhio da uno di
// esfiltrazione). Si verifica invece la domanda BEN POSTA: "questo URL contiene
// pezzi del materiale sensibile che era nel contesto del modello?". Quella è
// verificabile (taint-match): si decodifica l'URL e si cerca la sovrapposizione
// col corpus sensibile. In più un fallback STRUTTURALE copre l'attaccante che
// cifra/spezza i dati per evadere il match diretto: un payload corposo in un URL
// nato da contenuto non fidato è sospetto a prescindere.
//
// Il verdetto NON blocca: alza il livello di NAVIGA a 2 (vedi actionLevels.js)
// così l'utente vede l'URL completo e conferma. Un falso positivo costa una
// conferma in più, mai un'esecuzione silenziosa indebita.

(function (global) {
  'use strict';

  // Soglie (tarate per il caso realistico: il modello, istruito a "metti i dati
  // nell'URL", li mette in chiaro o base64; non in forme cifrate sofisticate).
  const MIN_TOKEN = 5;      // lunghezza minima di un token del corpus per contare
  const STRONG_TOKEN = 12;  // un solo token così lungo che combacia → già sospetto
  const STRUCT_CARRIER = 80; // payload (query+fragment+path) per il fallback strutturale
  const STRUCT_BLOB = 24;   // singolo token opaco (sottodominio/segmento) → sospetto

  // Parole comuni (it/en) abbastanza lunghe da superare STRONG_TOKEN ma innocue:
  // evitano che un URL legittimo che le contiene scateni il match a token singolo.
  const STOPWORDS = new Set([
    'preferenze', 'preferences', 'informazioni', 'information', 'impostazioni',
    'settings', 'configurazione', 'configuration', 'utente', 'browser',
    'documento', 'document', 'pagina', 'risultati', 'results', 'application',
    'applicazione', 'navigazione', 'navigation', 'messaggio', 'message',
  ]);

  // Decodifica "best effort" un blob base64/base64url se sembra tale e produce
  // testo stampabile; altrimenti ''. Serve a smascherare ?d=<base64 dei segreti>.
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

  // Tutto il testo "esposto" da un URL: stringa grezza + urldecode (anche doppio)
  // + decodifica dei segmenti base64 lunghi. Lo restituiamo normalizzato in sola
  // forma alfanumerica minuscola, così "Mario_Rossi", "mario.rossi" e
  // "MarioRossi" collassano sulla stessa chiave e i separatori non aiutano a
  // evadere il match.
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
    // Decodifica base64 dei token lunghi (sulla forma già urldecodata).
    const joined = pieces.join(' ');
    for (const tok of joined.split(/[^A-Za-z0-9+/_=-]+/)) {
      if (tok.length >= 16) {
        const b = tryBase64(tok);
        if (b) pieces.push(b);
      }
    }
    return pieces.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  // Token sensibili del corpus: parole alfanumeriche (≥ MIN_TOKEN) + indirizzi
  // email (interi e parte locale). Normalizzate in minuscolo alfanumerico.
  function corpusTokens(corpus) {
    const text = String(corpus || '');
    const out = new Set();
    // email: forti, le aggiungiamo intere e come parte locale.
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

  // Un token combacia "forte" da solo? (lungo, NON stopword) oppure contiene una
  // cifra (nomi+numeri, token, id) → segnale specifico, non parola comune.
  function isStrong(tok) {
    if (/[0-9]/.test(tok) && tok.length >= MIN_TOKEN) return true;
    return tok.length >= STRONG_TOKEN && !STOPWORDS.has(tok);
  }

  // Taint-match: l'URL contiene dati del corpus sensibile?
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

  // Fallback strutturale: payload corposo / blob opaco in un URL nato da
  // contenuto NON fidato (es. l'agente sulla pagina). Copre i dati cifrati che
  // il taint-match non riconosce. Attivo solo con fromUntrusted per non infastidire
  // sui link legittimi con query lunghe (tracking, OAuth) nati da input diretto.
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

  // Verdetto: { exfil, reason }. corpus = materiale sensibile che era nel
  // contesto del modello (memoria, appunti, output comandi). fromUntrusted =
  // l'azione nasce da una superficie non fidata (agente su pagina web).
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
