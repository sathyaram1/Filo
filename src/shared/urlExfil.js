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
  // Ricopiatura da ciò che Filo ha letto, nella CODA dell'indirizzo (query,
  // frammento, sottodominio): è lì che i dati si portano fuori, e una
  // sessantina di caratteri ricopiati non è una coincidenza.
  // Si guarda ogni posizione, non una ogni otto: a salti la ricopiatura si
  // riconosceva o no secondo dove cadeva l'allineamento, e sullo stesso sito un
  // pezzo passava e quello dopo no (#553). Un indirizzo è corto, costa poco.
  const READ_RUN = 56;
  // Nel PERCORSO serve molto di più: il percorso di una pagina È il suo titolo,
  // su ogni sito di notizie, e il titolo Filo l'ha appena letto nell'indice che
  // rimandava lì. Confrontarlo con la stessa finestra faceva comparire l'avviso
  // di esfiltrazione sul cammino normale, leggi una pagina e poi aprine una
  // collegata, e un avviso che suona sulle cose normali insegna a dire sì
  // (#553). Un titolo lunghissimo sta sotto i 160 caratteri; un dump no.
  const READ_RUN_PATH = 160;

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

  // Forma normalizzata per il confronto con ciò che Filo ha LETTO: sole
  // lettere e cifre minuscole, come `exposedAlnum`, così separatori, maiuscole
  // e percentuali non aiutano a evadere.
  function alnum(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  // Un pezzo di quello che Filo ha letto (una pagina, un documento, l'uscita di
  // un comando) ricopiato dentro un indirizzo non è una coincidenza: è un
  // trasporto. Si cerca una sovrapposizione LUNGA e non i singoli token perché
  // il corpus qui è un testo intero: a token, una parola qualsiasi della pagina
  // farebbe scattare il freno su ogni link successivo.
  // Finestre da READ_RUN, a passi di metà: qualunque ricopiatura lunga il
  // doppio cade dentro una finestra allineata.
  function ricopiato(pezzo, hay, run) {
    const exposed = exposedAlnum(pezzo);
    if (exposed.length < run) return false;
    for (let i = 0; i + run <= exposed.length; i++) {
      if (hay.includes(exposed.slice(i, i + run))) return true;
    }
    return false;
  }

  function readTaint(url, read) {
    const hay = alnum(read);
    if (hay.length < READ_RUN) return null;
    let u = null;
    try { u = new URL(String(url || '')); } catch (_) {}
    // Indirizzo che non si legge come tale: si guarda tutto, con la soglia
    // stretta. Non c'è un percorso da scusare.
    const coda = u ? `${u.search}${u.hash} ${u.hostname.split('.').slice(0, -2).join(' ')}` : String(url || '');
    const percorso = u ? u.pathname : '';
    if (ricopiato(coda, hay, READ_RUN) || ricopiato(percorso, hay, READ_RUN_PATH)) {
      return { reason: 'si porta dietro un pezzo di quello che Filo ha appena letto' };
    }
    return null;
  }

  // Fallback strutturale: payload corposo / blob opaco in un URL nato da
  // contenuto NON fidato (es. l'agente sulla pagina). Copre i dati cifrati che
  // il taint-match non riconosce. Attivo solo con fromUntrusted per non infastidire
  // sui link legittimi con query lunghe (tracking, OAuth) nati da input diretto.
  //
  // `soloCoda` toglie dal conto il PERCORSO: per una lettura, che segue quasi
  // sempre una ricerca, il percorso di un articolo vero è lungo e illeggibile
  // per conto suo, e contarlo faceva chiedere conferma su letture innocenti. I
  // dati da portare fuori stanno nella coda dell'indirizzo.
  function structural(url, { soloCoda = false } = {}) {
    let u;
    try { u = new URL(url); } catch (_) {
      try { u = new URL('https://' + url); } catch (_) { return null; }
    }
    const search = u.search || '';
    const hash = u.hash || '';
    const path = (!soloCoda && u.pathname && u.pathname !== '/') ? u.pathname : '';
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

  // Verdetto: { exfil, reason }. corpus = materiale sensibile dell'utente
  // (memoria, profilo, appunti); letto = il testo che Filo ha LETTO su richiesta
  // del modello (pagine, documenti, uscita dei comandi), che nel corpus non può
  // stare perché è troppo grande per il confronto a token. fromUntrusted =
  // l'azione nasce da una superficie non fidata (agente su pagina web).
  function assess(url, { corpus = '', letto = '', fromUntrusted = false, soloCoda = false } = {}) {
    const link = String(url || '').trim();
    if (!link) return { exfil: false, reason: '' };
    const t = taint(link, corpus);
    if (t) return { exfil: true, reason: t.reason };
    const r = readTaint(link, letto);
    if (r) return { exfil: true, reason: r.reason };
    if (fromUntrusted) {
      const s = structural(link, { soloCoda });
      if (s) return { exfil: true, reason: s.reason };
    }
    return { exfil: false, reason: '' };
  }

  global.SN_URL_EXFIL = {
    assess, taint, readTaint, structural, exposedAlnum, corpusTokens, alnum, READ_RUN,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
