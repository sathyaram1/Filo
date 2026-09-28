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
  const STRUCT_BLOB = 24;   // singolo blocco opaco (sottodominio/segmento) → sospetto

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
    // Decodifica base64 dei token lunghi (sulla forma già urldecodata). `=` è un
    // separatore qui (es. "p=<base64>"): il padding lo ripristina tryBase64.
    const joined = pieces.join(' ');
    for (const tok of joined.split(/[^A-Za-z0-9+/_-]+/)) {
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

  // Taint-match: l'URL contiene dati del corpus sensibile? `soloForte` scarta il
  // segnale debole "≥2 parole comuni in comune": in una query di ricerca le
  // parole dell'utente coincidono spesso con appunti e profilo, e solo un token
  // specifico (email, chiave, id lungo) è davvero un segreto che esce.
  function taint(url, corpus, { soloForte = false } = {}) {
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
    if (!soloForte && hits >= 2) return { reason: 'contiene più dati presi dalla tua memoria/contesto' };
    return null;
  }

  // Fallback strutturale: un blocco di dati OPACO in un URL nato da contenuto NON
  // fidato (l'agente sulla pagina, l'output di un comando, una ricerca). Copre i
  // dati cifrati che il taint-match non riconosce. La firma di un carico
  // codificato è una LUNGA sequenza continua, con dentro cifre o maiuscole
  // (base64, esadecimale, token, id casuali): un indirizzo leggibile si spezza
  // su barre, trattini, punti e underscore in parole corte (`wiki`, `storia`,
  // `ricette`, `bollette`) e non lascia mai un blocco simile. Guardare la sola
  // LUNGHEZZA del carico invece scambiava ogni percorso un po' lungo per un
  // payload: è ciò che riportava l'avviso su Wikipedia, una ricetta, un articolo.
  function struttOpaca(seg) {
    return seg.length >= STRUCT_BLOB && /[0-9A-Z]/.test(seg) && !/^https?$/i.test(seg);
  }
  function structural(url) {
    let u;
    try { u = new URL(url); } catch (_) {
      try { u = new URL('https://' + url); } catch (_) { return null; }
    }
    const search = u.search || '';
    const hash = u.hash || '';
    const path = (u.pathname && u.pathname !== '/') ? u.pathname : '';
    for (const seg of (search + hash + path).split(/[^A-Za-z0-9]+/)) {
      if (struttOpaca(seg)) return { reason: 'contiene un blocco di dati codificato' };
    }
    // Blob opaco singolo (no separatori umani) come sottodominio.
    const host = u.hostname || '';
    const labels = host.split('.');
    for (const lbl of labels.slice(0, Math.max(0, labels.length - 2))) {
      if (lbl.length >= STRUCT_BLOB) return { reason: 'usa un sottodominio anomalo' };
    }
    return null;
  }

  // ── Quello che il modello ha LETTO nel turno (#587) ──────────────────────
  // Output di comandi, documenti, file, chat archiviate: dati dell'utente che una
  // pagina ostile può farsi spedire. Qui non si guarda parola per parola (un
  // `ls` è pieno di parole comuni): conta un pezzo lungo in comune, o un token
  // di lettere e cifre (password, chiavi, codici).
  const FINESTRA = 20;     // caratteri alfanumerici consecutivi in comune
  const TOKEN_MISTO = 8;   // lettere+cifre: abbastanza specifico da solo
  const MAX_LETTO = 2000000; // tetto di calcolo: i pezzi più recenti restano

  // Solo la parte che può portare dati: sottodomini, percorso, query, frammento.
  // Il dominio no, se no ogni sito citato in un file diventerebbe sospetto.
  function carrierAlnum(url) {
    let u;
    try { u = new URL(url); } catch (_) {
      try { u = new URL(`https://${url}`); } catch (_) { return exposedAlnum(url); }
    }
    const labels = (u.hostname || '').split('.');
    const sub = labels.slice(0, Math.max(0, labels.length - 2)).join('.');
    return exposedAlnum(`${sub} ${u.pathname || ''} ${u.search || ''} ${u.hash || ''}`);
  }

  // `esposto` = testo già ridotto a minuscolo alfanumerico (di un URL o di una
  // query). Combacia con ciò che è stato letto se ne porta un token misto
  // lettere+cifre (chiave, codice) o un pezzo di FINESTRA caratteri di fila.
  function confrontaLetto(esposto, letto) {
    const text = String(letto || '');
    if (!text || esposto.length < TOKEN_MISTO) return null;
    const reason = 'contiene dati letti dal tuo computer';
    const visti = new Set();
    for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length < TOKEN_MISTO || visti.has(w)) continue;
      visti.add(w);
      if (/[a-z]/.test(w) && /[0-9]/.test(w) && esposto.includes(w)) return { reason };
    }
    if (esposto.length >= FINESTRA) {
      const grams = new Set();
      for (let i = 0; i + FINESTRA <= esposto.length; i++) grams.add(esposto.substr(i, FINESTRA));
      const flat = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
      for (let i = 0; i + FINESTRA <= flat.length; i++) {
        if (grams.has(flat.substr(i, FINESTRA))) return { reason };
      }
    }
    return null;
  }

  function taintLetto(url, letto) {
    return confrontaLetto(carrierAlnum(url), letto);
  }

  // Come taintLetto, ma su un TESTO qualsiasi (la query di una ricerca web, che
  // esce dal computer verso il motore di ricerca esattamente come un URL).
  function taintTestoLetto(testo, letto) {
    return confrontaLetto(exposedAlnum(testo), letto);
  }

  // Un link come lo si confronta: senza frammento né barra finale, dominio minuscolo.
  function chiaveLink(url) {
    const raw = String(url || '').trim();
    try {
      const u = new URL(raw);
      return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
    } catch (_) { return raw.replace(/#.*$/, '').replace(/\/+$/, ''); }
  }

  // Cosa hanno portato nel contesto le azioni viste dal modello (turni passati
  // compresi): `letto` = dati del computer, `nonFidato` = è entrato testo scritto
  // da altri, `linkNoti` = gli indirizzi dei risultati di ricerca.
  function contestoDaAzioni(actions) {
    const pezzi = [];
    let nonFidato = false;
    const linkNoti = new Set();
    const testo = (v) => (typeof v === 'string' ? v : '');
    for (const a of Array.isArray(actions) ? actions : []) {
      const out = a && a._output;
      if (!out || typeof out !== 'object') continue;
      const type = String(a.type || '').toUpperCase();
      if (type === 'ESEGUI_COMANDO') {
        if (out.blocked) continue;
        const t = `${testo(out.stdout)}\n${testo(out.stderr)}`;
        if (t.trim()) { nonFidato = true; pezzi.push(t); }
      } else if (type === 'LEGGI_DOCUMENTO') {
        if (testo(out.text)) { nonFidato = true; pezzi.push(out.text); }
      } else if (type === 'LEGGI_FILE') {
        pezzi.push(testo(out.text));
      } else if (type === 'CERCA_CHAT') {
        nonFidato = true;
        pezzi.push(testo(out.title), testo(out.transcript));
        for (const r of Array.isArray(out.results) ? out.results : []) {
          if (r) pezzi.push(`${testo(r.title)}\n${testo(r.snippet)}`);
        }
      } else if (type === 'CERCA_WEB') {
        const results = Array.isArray(out.results) ? out.results : [];
        if (results.length) nonFidato = true;
        for (const r of results) if (r && r.url) linkNoti.add(chiaveLink(r.url));
      }
    }
    let letto = pezzi.filter(Boolean).join('\n');
    if (letto.length > MAX_LETTO) letto = letto.slice(-MAX_LETTO);
    return { letto, nonFidato, linkNoti };
  }

  // Verdetto: { exfil, reason }. corpus = memoria e appunti (dati personali
  // persistenti); letto = ciò che il modello ha letto dal computer nel turno.
  // fromUntrusted = nel contesto è entrato testo scritto da altri: allora anche
  // la forma dell'URL conta, salvo i link citati tali e quali da una ricerca
  // (aprirli non porta fuori niente che la ricerca non contenesse già).
  function assess(url, { corpus = '', letto = '', fromUntrusted = false, linkNoti = null } = {}) {
    const link = String(url || '').trim();
    if (!link) return { exfil: false, reason: '' };
    const t = taint(link, corpus) || taintLetto(link, letto);
    if (t) return { exfil: true, reason: t.reason };
    if (fromUntrusted && !(linkNoti && linkNoti.has(chiaveLink(link)))) {
      const s = structural(link);
      if (s) return { exfil: true, reason: s.reason };
    }
    return { exfil: false, reason: '' };
  }

  // NAVIGA nel turno: memoria + azioni viste dal modello + chi ha mandato.
  // `daPagina` = l'agente vive su una pagina web, che è già nel suo contesto.
  function valutaNaviga(url, { memoria = '', azioni = [], daPagina = false } = {}) {
    const ctx = contestoDaAzioni(azioni);
    return assess(url, {
      corpus: memoria,
      letto: ctx.letto,
      fromUntrusted: !!daPagina || ctx.nonFidato,
      linkNoti: ctx.linkNoti,
    });
  }

  global.SN_URL_EXFIL = {
    assess, valutaNaviga, contestoDaAzioni, taint, taintLetto, structural, exposedAlnum, corpusTokens,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
