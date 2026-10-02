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
// conferma in più, mai un'esecuzione silenziosa indebita. Blocca solo un segreto
// che esce (valutaUscita, in fondo): lì non c'è conferma che tenga.

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
  // Ogni sequenza «%xx» si decodifica per conto suo: un solo «%» spaiato non deve spegnere la
  // decodifica dell'intero indirizzo (#810).
  function decodificaPercento(s) {
    return s.replace(/(?:%[0-9A-Fa-f]{2})+/g, (pezzo) => {
      try { return decodeURIComponent(pezzo); } catch (_) {
        return pezzo.replace(/%([0-9A-Fa-f]{2})/g, (m, h) => (parseInt(h, 16) < 128 ? String.fromCharCode(parseInt(h, 16)) : m));
      }
    });
  }

  function varianti(url) {
    const raw = String(url || '');
    const pieces = [raw];
    let cur = raw;
    for (let i = 0; i < 3; i++) {
      const dec = decodificaPercento(cur.replace(/\+/g, ' '));
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
    return pieces;
  }

  function exposedAlnum(url) {
    return varianti(url).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '');
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
  // codificato è una LUNGA sequenza CONTINUA di caratteri (base64, esadecimale,
  // token, id casuali). Un indirizzo leggibile si spezza sui separatori umani —
  // barre, trattini, punti, underscore, `+` — in parole corte (`wiki`, `storia`,
  // `ricette`, `bollette`): è per questo che si guardano i PEZZI separati, non la
  // lunghezza totale del carico, che scambiava ogni percorso un po' lungo per un
  // payload e riportava l'avviso su Wikipedia, una ricetta, un articolo.
  function structural(url) {
    let u;
    try { u = new URL(url); } catch (_) {
      try { u = new URL('https://' + url); } catch (_) { return null; }
    }
    const search = u.search || '';
    const hash = u.hash || '';
    const path = (u.pathname && u.pathname !== '/') ? u.pathname : '';
    for (const seg of (search + hash + path).split(/[^A-Za-z0-9]+/)) {
      if (seg.length >= STRUCT_BLOB && !/^https?$/i.test(seg)) {
        return { reason: 'contiene un blocco di dati codificato' };
      }
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
  // da altri, `linkNoti` = gli indirizzi dei risultati di ricerca, `esterni` = i
  // pezzi scritti da altri con da dove vengono (la riga di un blocco li nomina, #810).
  function contestoDaAzioni(actions) {
    const pezzi = [];
    let nonFidato = false;
    const linkNoti = new Set();
    const esterni = [];
    const testo = (v) => (typeof v === 'string' ? v : '');
    const daFuori = (t, fonte) => { if (t.trim()) esterni.push({ testo: t, fonte }); };
    for (const a of Array.isArray(actions) ? actions : []) {
      const out = a && a._output;
      if (!out || typeof out !== 'object') continue;
      const type = String(a.type || '').toUpperCase();
      if (type === 'ESEGUI_COMANDO') {
        if (out.blocked) continue;
        const t = `${testo(out.stdout)}\n${testo(out.stderr)}`;
        if (t.trim()) { nonFidato = true; pezzi.push(t); daFuori(t, "dall'output di un comando"); }
      } else if (type === 'LEGGI_DOCUMENTO') {
        if (testo(out.text)) { nonFidato = true; pezzi.push(out.text); daFuori(out.text, 'da un documento'); }
      } else if (type === 'LEGGI_FILE') {
        pezzi.push(testo(out.text));
      } else if (type === 'CERCA_CHAT') {
        nonFidato = true;
        const letti = [testo(out.title), testo(out.transcript)];
        for (const r of Array.isArray(out.results) ? out.results : []) {
          if (r) letti.push(`${testo(r.title)}\n${testo(r.snippet)}`);
        }
        pezzi.push(...letti);
        daFuori(letti.filter(Boolean).join('\n'), 'da una conversazione archiviata');
      } else if (type === 'CERCA_WEB') {
        const results = Array.isArray(out.results) ? out.results : [];
        if (results.length) nonFidato = true;
        for (const r of results) if (r && r.url) linkNoti.add(chiaveLink(r.url));
        daFuori(results.filter(Boolean).map((r) => `${testo(r.title)}\n${testo(r.url)}\n${testo(r.snippet)}`).join('\n'),
          'dai risultati di una ricerca');
      }
    }
    let letto = pezzi.filter(Boolean).join('\n');
    if (letto.length > MAX_LETTO) letto = letto.slice(-MAX_LETTO);
    return { letto, nonFidato, linkNoti, esterni };
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

  // CERCA_WEB nel turno: la query esce verso il motore di ricerca. Sospetta se
  // porta un segreto della memoria (solo un token forte: le parole comuni di una
  // query coincidono spesso con gli appunti) o un pezzo di ciò che è stato letto.
  // Niente ripiego strutturale: una query non ha la forma di un URL.
  function valutaRicerca(query, { memoria = '', azioni = [] } = {}) {
    const q = String(query || '').trim();
    if (!q) return { exfil: false, reason: '' };
    const ctx = contestoDaAzioni(azioni);
    const t = taint(q, memoria, { soloForte: true }) || taintTestoLetto(q, ctx.letto);
    return t ? { exfil: true, reason: t.reason } : { exfil: false, reason: '' };
  }

  // ── La porta unica delle uscite (#810) ───────────────────────────────────
  // Ogni azione che porta testo fuori da Filo passa da valutaUscita prima del gate dei
  // livelli, e ci passeranno le prossime (campi di una pagina, mail): la sentinella
  // tests/unit/usciteSegreti.test.mjs è rossa se una la salta. Un blocco qui è la voce
  // «far uscire un segreto» del capitolo 9: nessun livello e nessun OK lo sblocca.
  const USCITE = Object.freeze({
    NAVIGA: "non ho aperto l'indirizzo",
    CERCA_WEB: 'non ho fatto la ricerca',
    ESEGUI_COMANDO: 'non ho eseguito il comando',
    INVIA_FEEDBACK: 'non ho inviato il feedback',
  });

  // Cosa conteneva, per la riga che legge l'utente: mai il segreto stesso.
  const CUSTODITI = Object.freeze({
    chiave: 'una chiave di un servizio che custodisco',
    accesso: 'un token del tuo accesso a Filo',
    identita: "l'identità di questa copia di Filo",
    portafoglio: 'la chiave del tuo portafoglio',
  });
  const LETTI = Object.freeze({
    codice: 'un codice letto',
    password: 'una password letta',
    chiave: 'una chiave letta',
    iban: 'coordinate bancarie lette',
    carta: 'il numero di una carta letto',
  });

  // Tutto il testo che l'azione porta con sé, non solo il campo che l'esecuzione legge
  // oggi: un sinonimo nuovo non deve diventare una porta laterale.
  function testoUscente(action) {
    const out = [];
    const giro = (v, n) => {
      if (typeof v === 'string' || typeof v === 'number') { out.push(String(v)); return; }
      if (n > 4 || !v || typeof v !== 'object') return;
      if (Array.isArray(v)) { v.forEach((x) => giro(x, n + 1)); return; }
      for (const k of Object.keys(v)) if (!k.startsWith('_') && k !== 'type') giro(v[k], n + 1);
    };
    giro(action, 0);
    return out.join('\n');
  }

  // Un pezzo corto in base64 o in esadecimale: è lì che sta un codice di sei cifre («NDgyOTEz»,
  // «343832393133»). Conta solo se ne esce testo stampabile, così un hash o una parola restano sé stessi.
  const STAMPABILE = /^[\x20-\x7e]+$/;
  function decodificaCorta(tok) {
    const out = [];
    const b = tok.replace(/=+$/, '');
    if (b.length >= 6 && b.length % 4 !== 1 && /^[A-Za-z0-9+/_-]+$/.test(b)) {
      try {
        const norm = b.replace(/-/g, '+').replace(/_/g, '/');
        const pad = norm.padEnd(Math.ceil(norm.length / 4) * 4, '=');
        const bin = typeof atob === 'function' ? atob(pad) : Buffer.from(pad, 'base64').toString('binary');
        if (STAMPABILE.test(bin)) out.push(bin);
      } catch (_) { /* non era base64 */ }
    }
    if (tok.length >= 8 && tok.length % 2 === 0 && /^[0-9a-f]+$/i.test(tok)) {
      let h = '';
      for (let i = 0; i < tok.length; i += 2) h += String.fromCharCode(parseInt(tok.slice(i, i + 2), 16));
      if (STAMPABILE.test(h)) out.push(h);
    }
    return out;
  }

  // Le forme in cui un testo esce: grezza, decodificate, alfanumerica, e le cifre di fila. Tutte le cifre
  // solo in un testo corto, dove quelle sparse non combaciano per caso; quelle vicine («?a=482&b=913») sempre.
  function formeDi(testo) {
    const t = String(testo || '');
    const forme = varianti(t);
    const brevi = [];
    for (const tok of forme.join(' ').split(/[^A-Za-z0-9+_-]+/)) {
      if (tok.length >= 6 && tok.length < 64) brevi.push(...decodificaCorta(tok));
    }
    forme.push(...brevi);
    const vicine = forme.map((f) => (f.replace(/(\d)\D{1,4}(?=\d)/g, '$1').match(/\d{6,}/g) || []).join(' '));
    const cifre = (t.length <= 4000 ? forme.map((f) => f.replace(/\D+/g, '')) : []).concat(vicine.filter(Boolean));
    return { forme, alnum: forme.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ''), cifre };
  }

  // Un codice si cerca coi confini («4821» non sta dentro «348215»); `largo`, per ciò che esce, regge i
  // travestimenti («4.8.2.9.1.3», «?a=482&b=913», al contrario). Le parole dell'utente restano strette.
  function esce(valore, regola, u, largo = false) {
    const v = String(valore || '');
    if (regola === 'codice' || regola === 'password') {
      const chars = v.replace(/[^A-Za-z0-9]/g, '');
      if (chars.length < 4) return false;
      const soloCifre = /^\d+$/.test(chars);
      const giri = largo ? [chars, [...chars].reverse().join('')] : [chars];
      if (largo && soloCifre && chars.length >= 6 && giri.some((c) => u.cifre.some((f) => f.includes(c)))) return true;
      const confine = soloCifre ? '\\d' : '[A-Za-z0-9]';
      const sep = largo ? '[^A-Za-z0-9]{0,3}' : '[\\s-]?';
      return giri.some((c) => {
        if (!u.alnum.includes(c.toLowerCase())) return false;
        const re = new RegExp(`(?<!${confine})${c.split('').join(sep)}(?!${confine})`, 'i');
        return u.forme.some((f) => re.test(f));
      });
    }
    const norm = v.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (largo && regola === 'carta' && u.cifre.some((f) => f.includes(norm))) return true;
    return norm.length >= 8 && u.alnum.includes(norm);
  }

  // `pagina` = { testo, host } che l'agente ha davanti; `letti` = [{ valore, regola, fonte }] estratti da
  // ciò che ha letto prima; `parole` = ciò che l'utente ha scritto (un codice suo passa). `memoria` e
  // `daPagina` servono all'OK in più di #587. Torna { blocca, frase } oppure { exfil, reason }.
  function valutaUscita(action, {
    segreti = [], azioni = [], pagina = null, letti = [], parole = '', memoria = '', daPagina = false,
  } = {}) {
    const tipo = String((action && action.type) || '').toUpperCase();
    const verbo = USCITE[tipo];
    const niente = { blocca: false, exfil: false, frase: '', reason: '' };
    if (!verbo) return niente;
    const G = global.SN_GUARDIANO_STATICO;
    const uscente = testoUscente(action);
    const u = formeDi(uscente);
    const min = (G && G.SEGRETO_MIN) || 12;
    for (const s of Array.isArray(segreti) ? segreti : []) {
      const v = String((s && s.valore) || '').trim();
      if (v.length < min) continue;
      const norm = v.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (u.forme.some((f) => f.includes(v)) || (norm.length >= min && u.alnum.includes(norm))) {
        return { ...niente, blocca: true, regola: 'custodito', frase: `${verbo}: conteneva ${CUSTODITI[s.tipo] || CUSTODITI.chiave}` };
      }
    }
    if (!G || !uscente.trim()) return valutaAvvisi(tipo, action, { memoria, azioni, daPagina }, niente);
    const fonti = contestoDaAzioni(azioni).esterni.slice();
    if (pagina && typeof pagina.testo === 'string' && pagina.testo.trim()) {
      fonti.push({ testo: pagina.testo, fonte: pagina.host ? `dalla pagina ${pagina.host}` : 'dalla pagina' });
    }
    const candidati = [];
    const saturi = [];
    for (const f of fonti) {
      const trovati = G.segretiNelTesto(f.testo);
      for (const x of trovati) candidati.push({ ...x, fonte: f.fonte });
      if (trovati.saturo) saturi.push(f);
    }
    for (const x of Array.isArray(letti) ? letti : []) if (x && x.valore) candidati.push(x);
    const scritte = parole ? formeDi(parole) : null;
    const ferma = (regola, fonte) => ({ ...niente, blocca: true, regola, frase: `${verbo}: conteneva ${LETTI[regola] || LETTI.codice} ${fonte || 'da fuori'}` });
    for (const x of candidati) {
      if (!esce(x.valore, x.regola, u, true)) continue;
      if (scritte && esce(x.valore, x.regola, scritte)) continue;
      return ferma(x.regola, x.fonte);
    }
    for (const f of saturi) if (pezzoPresente(u, f.testo, parole)) return ferma('codice', f.fonte);
    return valutaAvvisi(tipo, action, { memoria, azioni, daPagina }, niente);
  }

  // Un testo con più segreti di quanti se ne tengano è costruito apposta per nascondere quello vero (#810): lì ferma
  // ogni pezzo dell'uscita con una cifra che nel testo c'è, salvo quelli scritti dall'utente.
  function pezzoPresente(u, testoLetto, parole) {
    const pezzi = new Set(u.cifre.filter((c) => c.length >= 4));
    for (const f of u.forme) for (const t of f.split(/[^A-Za-z0-9]+/)) if (t.length >= 4 && /\d/.test(t)) pezzi.add(t.toLowerCase());
    if (!pezzi.size) return false;
    const letto = String(testoLetto || '').toLowerCase();
    const proprie = String(parole || '').toLowerCase();
    for (const p of pezzi) if (letto.includes(p) && !proprie.includes(p)) return true;
    return false;
  }

  // I segreti letti da fuori che una frase di Filo ripete: viaggiano con la frase nell'archivio, così la chat
  // riaperta sa ancora cosa veniva da fuori. Una password che Filo propone da sé non c'è, e resta usabile.
  const MAX_LETTI_FRASE = 200;
  function lettiNelTesto(testo, letti) {
    const t = String(testo || '');
    const out = [];
    if (!t.trim()) return out;
    const u = formeDi(t);
    for (const x of Array.isArray(letti) ? letti : []) {
      if (out.length >= MAX_LETTI_FRASE) break;
      if (!x || typeof x.valore !== 'string' || !x.valore || !esce(x.valore, x.regola, u)) continue;
      out.push({ valore: x.valore, regola: String(x.regola || 'codice'), fonte: String(x.fonte || 'da fuori') });
    }
    return out;
  }

  // Il resto del verdetto è l'anti-esfiltrazione di #587: un OK in più, non un blocco.
  function valutaAvvisi(tipo, action, { memoria, azioni, daPagina }, niente) {
    if (tipo === 'NAVIGA') {
      const url = String(action.url ?? action.href ?? action.link ?? '').trim();
      const v = url ? valutaNaviga(url, { memoria, azioni, daPagina }) : null;
      if (v && v.exfil) return { ...niente, exfil: true, reason: v.reason };
    }
    if (tipo === 'CERCA_WEB') {
      const v = valutaRicerca(String(action.query ?? action.q ?? action.testo ?? action.text ?? ''), { memoria, azioni });
      if (v.exfil) return { ...niente, exfil: true, reason: v.reason };
    }
    return niente;
  }

  global.SN_URL_EXFIL = {
    assess, valutaNaviga, valutaRicerca, contestoDaAzioni, valutaUscita, testoUscente, lettiNelTesto, USCITE,
    taint, taintLetto, taintTestoLetto, structural, exposedAlnum, corpusTokens,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
