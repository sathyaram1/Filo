// Rilevatore di esfiltrazione dati via URL (sicurezza NAVIGA).
//
// Filo apre i link DIRETTAMENTE in una scheda (NAVIGA, livello 1, nessuna
// conferma). Una pagina ostile può però iniettare istruzioni nel modello
// (prompt injection) per fargli aprire un URL che PORTA FUORI dati sensibili
// che il modello aveva nel contesto — memoria/profilo dell'utente, appunti,
// documenti aperti dal disco, output dei comandi appena eseguiti — codificandoli
// nella query/path/sottodominio. È una GET silenziosa verso il server
// dell'attaccante.
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
  // Soglie del ripiego strutturale. Si contano SOLO i pezzi illeggibili, e si
  // misurano contro gli indirizzi veri: il pezzo opaco più lungo che un sito
  // normale mette in un link è l'identificativo di un documento di Google, 44
  // caratteri (un ASIN di Amazon ne fa 10, un brano di Spotify 22, un post su X
  // 19, un identificativo di sessione di Booking 32). Sopra quella misura un
  // tratto illeggibile non è più il modo in cui un sito nomina le sue cose: è
  // roba che qualcuno ci ha messo dentro.
  const STRUCT_CARRIER = 96; // somma dei pezzi illeggibili → payload spezzato
  const STRUCT_BLOB = 56;   // singolo pezzo illeggibile e indecifrabile → payload
  const STRUCT_TESTO = 16;  // pezzo illeggibile che però si RIAPRE come testo
  const STRUCT_HOST_BLOB = 24; // etichetta opaca nel sottodominio: nessun sito vero

  // Quante parole comuni servono perché un indirizzo sia un "dump" di dati. Erano
  // due, e una delle due era gratis: se il materiale protetto conteneva un link —
  // cioè quasi sempre, appena Filo legge un documento o un appunto — fra le
  // parole protette finiva «https», che sta dentro ogni indirizzo. Da lì bastava
  // una parola qualunque in comune col link e l'avviso compariva su sei link
  // veri su venti (#587, giro 4). Adesso «https» non conta più (vedi
  // PAROLE_DI_OGNI_INDIRIZZO), le parole comuni contano solo se stanno nel
  // CARICO del link e non nel nome del sito, e ne servono tre.
  const HITS_DEBOLI = 3;

  // Le parole che stanno dentro QUALUNQUE indirizzo: non sono dati di nessuno,
  // e nel corpus ci finiscono appena il materiale protetto cita un link.
  const PAROLE_DI_OGNI_INDIRIZZO = new Set([
    'https', 'http', 'index', 'html', 'htm', 'shtml', 'aspx', 'jsp', 'php',
  ]);

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

  // Decodifica un blob ESADECIMALE che si riapre come testo stampabile. È il
  // travestimento più a portata di mano dopo il base64 — `?d=5365677265746f…` —
  // e sotto i 56 caratteri il ripiego strutturale non lo vedeva nemmeno, quindi
  // una password corta usciva in chiaro sotto mentite spoglie (#587, giro 4).
  function tryHex(tok) {
    if (tok.length < 16 || tok.length % 2 !== 0) return '';
    if (!/^[0-9a-fA-F]+$/.test(tok)) return '';
    let out = '';
    let printable = 0;
    for (let i = 0; i < tok.length; i += 2) {
      const c = parseInt(tok.slice(i, i + 2), 16);
      if (Number.isNaN(c)) return '';
      out += String.fromCharCode(c);
      if (c >= 32 && c < 127) printable++;
    }
    return printable / (tok.length / 2) > 0.85 ? out : '';
  }

  // Il CARICO di un indirizzo: quello che il link PORTA, senza il nome del sito
  // verso cui va. I pezzi del percorso, i valori dei parametri, il frammento e
  // le etichette del sottodominio (dove un dato si può nascondere), ma non lo
  // schema né il dominio: che un articolo di giornale si chiami «energia» come
  // la bolletta che Filo ha appena letto non vuol dire che la stia portando
  // fuori. Serve alla regola delle parole comuni, non a quella dei dati forti:
  // un dato riconoscibile va fermato dovunque stia nell'indirizzo.
  function caricoAlnum(url) {
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
      const pezzi = [valoriUniti(url)];
      const labels = String(u.hostname || '').split('.');
      for (const lbl of labels.slice(0, Math.max(0, labels.length - 2))) pezzi.push(lbl);
      const testo = pezzi.filter(Boolean).join(' ');
      let dec = testo;
      try { dec = decodeURIComponent(testo.replace(/\+/g, ' ')); } catch (_) {}
      return `${testo} ${dec}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
    } catch (_) { return ''; }
  }

  // Tutto il testo "esposto" da un URL: stringa grezza + urldecode (anche doppio)
  // + decodifica dei segmenti base64 lunghi. Lo restituiamo normalizzato in sola
  // forma alfanumerica minuscola, così "Mario_Rossi", "mario.rossi" e
  // "MarioRossi" collassano sulla stessa chiave e i separatori non aiutano a
  // evadere il match.
  // I soli VALORI di un indirizzo, incollati fra loro: i pezzi del percorso, i
  // valori dei parametri, il frammento — senza i nomi dei parametri e senza i
  // separatori. Serve perché chi compone l'indirizzo può TAGLIARE il dato e
  // rimetterlo in due parametri: `?a=Segreto&b=Netrc2026` porta fuori la stessa
  // password di `?d=SegretoNetrc2026`, ma in mezzo ci finisce la `b` del secondo
  // nome e il confronto non trovava più niente (#587, giro 3). Incollando i soli
  // valori il dato torna intero — e con lui torna leggibile anche un base64
  // spezzato a metà fra due parametri.
  function valoriUniti(url) {
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
      const pezzi = [];
      for (const seg of String(u.pathname || '').split('/')) if (seg) pezzi.push(seg);
      try {
        for (const [, v] of u.searchParams) if (v) pezzi.push(v);
      } catch (_) {}
      const frammento = String(u.hash || '').replace(/^#/, '');
      if (frammento) pezzi.push(frammento);
      return pezzi.join('');
    } catch (_) { return ''; }
  }

  function exposedAlnum(url) {
    const raw = String(url || '');
    const pieces = [raw];
    const valori = valoriUniti(raw);
    if (valori) {
      pieces.push(valori);
      try {
        const dec = decodeURIComponent(valori.replace(/\+/g, ' '));
        if (dec !== valori) pieces.push(dec);
      } catch (_) {}
    }
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
        const h = tryHex(tok);
        if (h) pieces.push(h);
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
      if (w.length >= MIN_TOKEN && !PAROLE_DI_OGNI_INDIRIZZO.has(w)) out.add(w);
    }
    return out;
  }

  // Lo stesso dato scritto all'indietro è lo stesso dato. Riconoscerlo costa una
  // riga; non riconoscerlo costava la password, perché rovesciarla è la prima
  // cosa che prova chi ha letto come funziona il controllo (#587, giro 4).
  function rovescia(s) {
    return String(s).split('').reverse().join('');
  }

  // Un token combacia "forte" da solo? (lungo, NON stopword) oppure contiene una
  // cifra (nomi+numeri, token, id) → segnale specifico, non parola comune.
  function isStrong(tok) {
    if (/[0-9]/.test(tok) && tok.length >= MIN_TOKEN) return true;
    return tok.length >= STRONG_TOKEN && !STOPWORDS.has(tok);
  }

  // ── Il dato spezzettato dentro l'indirizzo ────────────────────────────────
  //
  // Incollare i soli valori (vedi valoriUniti) rimette insieme il dato tagliato
  // fra due parametri. Resta l'altro modo di spezzarlo: infilare qualche
  // carattere IN MEZZO a un valore solo — `/xSegretoNyetrc2026z`. Per quello il
  // confronto deve tollerare un po' di spazzatura: si accetta un dato lungo
  // ritrovato in due o tre tronconi, ognuno abbastanza lungo da non essere un
  // caso, separati da pochi caratteri. Le misure sono strette apposta: un dato
  // corto o tronconi minuscoli combacerebbero per sbaglio dentro un indirizzo
  // vero, e un avviso falso si clicca senza leggerlo.
  // Le misure erano tarate su un dato tagliato in due o tre tronconi: tolleravano
  // due tagli. Bastava allora infilare una lettera OGNI TRE O QUATTRO caratteri
  // — `Segrxetoxnetxrc2x026` — perché i tagli diventassero cinque e il dato
  // uscisse lo stesso (#587, giro 4). Adesso i tagli tollerati crescono col dato:
  // quello che resta fisso è la lunghezza di ogni troncone (tre caratteri esatti,
  // di fila) e il fatto che il dato sia lungo e riconoscibile — un dato corto o
  // tronconi minuscoli combacerebbero per sbaglio dentro un indirizzo vero, e un
  // avviso falso si clicca senza leggerlo.
  const SPEZZ_MIN = 10;   // solo per i dati abbastanza lunghi
  const SPEZZ_RUN = 3;    // ogni troncone, almeno tanti caratteri di fila
  const buchiMax = (len) => Math.max(2, Math.ceil(len / SPEZZ_RUN));
  const junkMax = (len) => Math.max(10, len);
  function daPosizione(exposed, tok, p) {
    const maxBuchi = buchiMax(tok.length);
    const maxJunk = junkMax(tok.length);
    let i = 0;
    let j = p;
    let buchi = 0;
    let junk = 0;
    while (i < tok.length) {
      if (j < exposed.length && exposed[j] === tok[i]) { i++; j++; continue; }
      if (buchi >= maxBuchi) return false;
      // Coda più corta di un troncone: del dato è già stato ritrovato tutto
      // tranne un paio di caratteri, con i tagli e la spazzatura già contati.
      // Pretendere un altro troncone intero qui vorrebbe dire lasciar passare
      // proprio i dati spezzettati fino in fondo.
      if (tok.length - i < SPEZZ_RUN) return true;
      const prossimo = tok.slice(i, i + SPEZZ_RUN);
      let salto = -1;
      for (let k = 1; k <= maxJunk - junk; k++) {
        if (exposed.startsWith(prossimo, j + k)) { salto = k; break; }
      }
      if (salto < 0) return false;
      j += salto;
      junk += salto;
      buchi++;
    }
    return true;
  }
  function combaciaSpezzato(exposed, tok) {
    if (tok.length < SPEZZ_MIN) return false;
    const testa = tok.slice(0, SPEZZ_RUN);
    for (let da = exposed.indexOf(testa); da >= 0; da = exposed.indexOf(testa, da + 1)) {
      if (daPosizione(exposed, tok, da)) return true;
    }
    return false;
  }

  // Taint-match: l'URL contiene dati del corpus sensibile?
  function taint(url, corpus) {
    const exposed = exposedAlnum(url);
    if (!exposed) return null;
    // Ogni forma in cui lo stesso dato può comparire nell'indirizzo: com'è, e
    // scritto all'indietro.
    const forme = [exposed, rovescia(exposed)];
    const carico = caricoAlnum(url);
    const caricoForme = carico ? [carico, rovescia(carico)] : [];
    const dentro = (t) => forme.some((f) => f.includes(t));
    const nelCarico = (t) => caricoForme.some((f) => f.includes(t));
    const toks = corpusTokens(corpus);
    let hits = 0;
    let strong = false;
    let sample = '';
    for (const t of toks) {
      if (t.length < MIN_TOKEN) continue;
      if (!dentro(t)) {
        if (isStrong(t) && forme.some((f) => combaciaSpezzato(f, t))) {
          return { reason: `contiene un tuo dato, spezzettato ("${t}…")` };
        }
        continue;
      }
      if (isStrong(t)) { strong = true; sample = t; continue; }
      // Una parola comune conta solo se sta nel CARICO del link: nel nome del
      // sito non porta fuori niente (vedi caricoAlnum).
      if (nelCarico(t)) {
        hits++;
        if (!sample) sample = t;
      }
    }
    // Un token forte da solo, oppure abbastanza parole comuni da essere un dump.
    if (strong) return { reason: `contiene un tuo dato ("${sample}…")` };
    if (hits >= HITS_DEBOLI) return { reason: 'contiene più dati presi dalla tua memoria/contesto' };
    return null;
  }

  // Un pezzo di indirizzo "da parola": lettere sole (una parola di uno slug, di
  // un titolo, di una ricerca) o cifre sole abbastanza corte da essere una data,
  // un anno o un identificativo.
  function pezzoDaParola(p) {
    return p === '' || /^[A-Za-z]{1,14}$/.test(p) || /^[0-9]{1,12}$/.test(p);
  }

  // I PEZZI illeggibili di un tratto di indirizzo, cioè quelli che non si leggono
  // come parole. È la domanda che il ripiego strutturale deve porsi, e per due
  // volte non se l'è posta bene.
  //
  // La prima volta contava i caratteri e basta: visto che i separatori umani
  // (`/`, `-`, `_`, `+`) restavano dentro, `/wiki/Storia_della_matematica` era
  // «un blocco di dati codificato» lungo 28 (#587, giro 1).
  //
  // La seconda volta guardava il TRATTO intero appena un pezzo era illeggibile,
  // e misurava con un metro da 24 caratteri: così bastava l'identificativo che
  // ogni sito mette nei suoi indirizzi — un documento di Google, una scheda di
  // Amazon, un brano di Spotify, un post su X — perché l'avviso comparisse su due
  // link veri su cinque (#587, giro 2). E un avviso che compare su link innocui
  // si clicca senza leggerlo: si perde proprio la protezione che deve restare.
  //
  // Adesso si contano SOLO i pezzi illeggibili, e col metro tarato sugli
  // indirizzi veri (vedi le soglie in cima). Quello che resta fuori è il payload
  // in chiaro o in base64, che però non passa di qui: lo prende il taint-match,
  // che lo riconosce per quello che è invece che per la sua forma.
  function pezziOpachi(tratto) {
    return String(tratto).split(/[-_/+=.]/).filter((p) => !pezzoDaParola(p));
  }
  function opaco(tratto) {
    return pezziOpachi(tratto).length > 0;
  }

  // Fallback strutturale: payload corposo / blob opaco in un URL nato mentre nel
  // contesto c'era materiale NON FIDATO. Copre i dati cifrati o spezzati che il
  // taint-match non riconosce. Attivo solo con fromUntrusted per non infastidire
  // sui link legittimi con query lunghe (tracking, OAuth) nati da input diretto.
  function structural(url) {
    let u;
    try { u = new URL(url); } catch (_) {
      try { u = new URL('https://' + url); } catch (_) { return null; }
    }
    const search = u.search || '';
    const hash = u.hash || '';
    const path = (u.pathname && u.pathname !== '/') ? u.pathname : '';
    const tratti = (search + hash + path).split(/[^A-Za-z0-9+/_=-]+/);
    // Quanto materiale illeggibile porta il link. Le parole non contano — se no
    // il conto lo fa il titolo dell'articolo invece del payload — e nemmeno i
    // pezzi leggibili che stanno accanto a uno illeggibile.
    let carrier = 0;
    let piuLungo = '';
    for (const t of tratti) {
      for (const p of pezziOpachi(t)) {
        if (/^https?$/i.test(p)) continue;
        carrier += p.length;
        if (p.length > piuLungo.length) piuLungo = p;
        // Un pezzo illeggibile che si RIAPRE come testo non è il modo in cui un
        // sito nomina le sue cose: è qualcosa che qualcuno ha impacchettato. È
        // la riga di taglio che separa davvero i due mondi — provata su una
        // ventina di indirizzi veri, nessun identificativo di sito si riapre
        // (quello di un documento di Google, di un brano di Spotify, di una
        // sessione di Booking danno tutti rumore) — e costa poco anche sbagliata.
        if (p.length >= STRUCT_TESTO && tryBase64(p)) {
          return { reason: 'contiene un blocco di dati codificato' };
        }
      }
    }
    // Illeggibile e che non si riapre: può essere testo cifrato. Qui il metro è
    // largo, perché sotto ci sono gli identificativi veri dei siti.
    if (piuLungo.length >= STRUCT_BLOB) {
      return { reason: 'contiene un blocco di dati codificato' };
    }
    if (carrier >= STRUCT_CARRIER) {
      return { reason: 'porta una grande quantità di dati nel link' };
    }
    // Etichetta opaca nel sottodominio: un sito vero non ci mette mai un blocco
    // illeggibile, quindi qui il metro resta stretto.
    const host = u.hostname || '';
    const labels = host.split('.');
    for (const lbl of labels.slice(0, Math.max(0, labels.length - 2))) {
      if (lbl.length >= STRUCT_HOST_BLOB && opaco(lbl)) return { reason: 'usa un sottodominio anomalo' };
    }
    return null;
  }

  // Verdetto: { exfil, reason }. corpus = materiale sensibile che era nel
  // contesto del modello (memoria, appunti, documenti aperti, output dei comandi
  // appena eseguiti). fromUntrusted = nel contesto è entrato materiale NON
  // FIDATO — testo di una pagina web, risultati di ricerca, llms.txt, l'output di
  // un comando. Dipende da COSA è entrato nel contesto, non da CHI ha mandato il
  // messaggio: una chat `filo://` con mezza pagina ostile davanti è tanto pilotabile
  // quanto un agente che gira sulla pagina (#587). Lo calcola il main con
  // src/main/services/contextTaint.js.
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
