// Lettura dei DOCUMENTI dell'utente dal disco (azione LEGGI_DOCUMENTO).
//
// PERCHÉ ESISTE
//   I documenti che contano — bollette, estratti conto, contratti, visure —
//   stanno sul disco e sono quasi tutti PDF. Filo poteva già esplorare il disco
//   col terminale, ma un PDF è binario: `type estratto.pdf` restituisce
//   spazzatura. "Quant'è la giacenza media?" con l'estratto conto nei Download
//   era una domanda senza risposta possibile. Qui il PDF diventa testo e rientra
//   nel contesto dell'agente, che finalmente può leggerlo.
//
// PERCHÉ unpdf E NON pdfjs-dist
//   Il motore è lo stesso: unpdf È pdf.js di Mozilla, ripacchettizzato per Node
//   con fuori il visualizzatore web, il canvas, i font di serie e i decodificatori
//   di immagini — roba che serve a DISEGNARE un PDF, non a estrarne il testo.
//   Risultato: 2,4 MB invece di 34 MB nell'installatore, zero dipendenze
//   transitive (quindi una sola cosa da verificare al cancello di sicurezza) e un
//   ingresso CommonJS che il processo main richiede senza acrobazie ESM. La
//   qualità dell'estrazione è quella di pdf.js, cioè la migliore disponibile in
//   puro JavaScript: encoding strani, font CID e ToUnicode — esattamente i casi
//   in cui un estrattore fatto in casa restituisce lettere a caso proprio sugli
//   estratti conto.
//
// SOLA LETTURA
//   Questo modulo apre file e basta: non scrive, non sposta, non esegue nulla.
//
// CONFINAMENTO DEI PERCORSI: nessuno, di proposito.
//   Il terminale di Filo oggi non confina i percorsi (un `type` legge qualunque
//   file leggibile dall'utente), e i documenti veri stanno spesso fuori dal
//   profilo: un disco esterno, una chiavetta, la cartella condivisa del NAS.
//   Un confine sul profilo utente qui bloccherebbe casi legittimi senza togliere
//   nulla a un attaccante, che il terminale ce l'ha comunque: sarebbe una
//   sicurezza finta, e una sicurezza finta è peggio di nessuna perché si smette
//   di cercare quella vera. Il confine reale è un altro: il testo estratto entra
//   SOLO nel contesto del modello, e il testo di un documento è trattato come
//   DATO non fidato (vedi il formattatore in handlers.js), mai come istruzioni.

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Tetto sul TESTO restituito. Allineato al documento di trasparenza (16k):
// abbastanza per un estratto conto o un contratto intero, poco abbastanza da non
// far esplodere il prompt. Oltre il tetto si tronca e lo si DICHIARA.
const MAX_TEXT_CHARS = 16000;

// Tetto sul FILE, prima ancora di aprirlo: un PDF da mezzo giga bloccherebbe il
// processo main per minuti. 25 MB coprono qualunque bolletta o contratto reale.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Estensioni di testo semplice: si leggono così come sono. Ci sono anche i
// formati "di dati" (csv, json, xml…) perché è esattamente ciò che l'utente si
// scarica dalla banca quando non prende il PDF.
const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.log', '.json', '.xml',
  '.yml', '.yaml', '.ini', '.cfg', '.conf', '.env', '.srt', '.vtt', '.tex',
]);

// Formati che NON sappiamo leggere, con la spiegazione da dare all'utente:
// meglio dire "è un'immagine" che "formato non supportato".
const KNOWN_BINARY = {
  '.jpg': 'è un\'immagine', '.jpeg': 'è un\'immagine', '.png': 'è un\'immagine',
  '.gif': 'è un\'immagine', '.bmp': 'è un\'immagine', '.webp': 'è un\'immagine',
  '.tif': 'è un\'immagine', '.tiff': 'è un\'immagine', '.heic': 'è un\'immagine',
  '.mp3': 'è un file audio', '.wav': 'è un file audio', '.flac': 'è un file audio',
  '.mp4': 'è un video', '.mkv': 'è un video', '.avi': 'è un video', '.mov': 'è un video',
  '.zip': 'è un archivio compresso', '.rar': 'è un archivio compresso',
  '.7z': 'è un archivio compresso', '.gz': 'è un archivio compresso',
  '.tar': 'è un archivio compresso',
  '.exe': 'è un programma eseguibile', '.dll': 'è una libreria di programma',
  '.msi': 'è un installatore', '.bin': 'è un file binario', '.iso': 'è un\'immagine disco',
  '.doc': 'è un documento Word', '.docx': 'è un documento Word',
  '.xls': 'è un foglio di calcolo Excel', '.xlsx': 'è un foglio di calcolo Excel',
  '.ppt': 'è una presentazione PowerPoint', '.pptx': 'è una presentazione PowerPoint',
  '.odt': 'è un documento OpenDocument', '.ods': 'è un foglio OpenDocument',
  '.epub': 'è un ebook', '.mobi': 'è un ebook',
  '.db': 'è un database', '.sqlite': 'è un database',
};

/**
 * Normalizza il percorso che arriva dall'LLM: toglie virgolette e spazi, espande
 * `~` nella home dell'utente, e restituisce un assoluto. PURA.
 *
 * `base` è la cartella in cui Filo sta guardando col terminale, e serve ai nomi
 * SENZA percorso. Un elenco stampa i nomi, non i percorsi: è in quella forma che
 * il nome arriva al passo dopo. Senza `base` un nome nudo finiva risolto contro
 * la cartella del PROGRAMMA Filo — il file dell'utente non si trovava, e da
 * quando un nome quasi giusto viene perdonato poteva perfino aprirsi un file di
 * Filo e finire nella risposta al posto del documento chiesto (#551, terzo giro
 * di verifica). Senza cartella nota si ripiega sulla home, che è da dove il
 * terminale parte, mai sulla cartella del programma.
 */
function normalizePath(input, base) {
  let p = String(input == null ? '' : input).trim();
  if (!p) return '';
  // Gli LLM incartano volentieri i percorsi tra virgolette o apici.
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith('\'') && p.endsWith('\''))) {
    p = p.slice(1, -1).trim();
  }
  if (p === '~') p = os.homedir();
  else if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(2));
  if (!p) return '';
  if (path.isAbsolute(p)) return path.resolve(p);
  const dove = String(base || '').trim();
  return path.resolve(path.isAbsolute(dove) ? dove : os.homedir(), p);
}

// ── Quando il nome è QUASI giusto ────────────────────────────────────────────
//
// #551. Un percorso può arrivare qui leggermente sbagliato senza che sia colpa
// di nessuno: il terminale di Windows scriveva i nomi nella tabella OEM, e il
// modello ricopiava «SPECIFICHE SEO E METADATI - singolarita.txt» al posto di
// «… — singolarita.txt» (trattino lungo) o «Singolarit<27>.txt» al posto di
// «Singolarità.txt». Quel guasto è chiuso a monte (terminal.js), ma la stessa
// svista la può fare un utente che il nome lo scrive a mano, o un PDF il cui
// nome gli è stato dettato al telefono. La filosofia di Filo è esplicita: «un
// typo ogni tre parole non deve essere un problema». Quindi, prima di
// arrendersi, si guarda se nella cartella c'è UN SOLO file che combacia a meno
// di maiuscole, accenti, tipo di trattino e spazi doppi. Uno solo: se sono due
// non si indovina, si dice che sono due.

// Trattini di ogni foggia (breve, unicode, cifre, medio, lungo, barra, meno
// matematico, le forme larghe/compatte del giapponese) → tutti «-».
const TRATTINI = /[‐‑‒–—―−⁃﹘﹣－]/g;
// I due modi in cui un carattere arriva qui PERSO. Nel confronto valgono come
// jolly, perché sotto ci stava un carattere vero che nessuno può ricostruire:
//   • il rombo di sostituzione, al posto di un byte che in UTF-8 non vuol dire
//     niente (la «à» scritta nella tabella OEM);
//   • il punto interrogativo, che è quello che Windows mette da sé quando nella
//     tabella di codici un carattere non ha proprio dove andare (il simbolo
//     dell'euro, un alfabeto non latino). Su Windows un nome di file non può
//     contenerlo, quindi un «?» arrivato fin qui è sempre un carattere perso.
//     Altrove il file col «?» nel nome esiste per davvero, e allora il percorso
//     c'è e a questa strada non ci si arriva nemmeno.
const IGNOTI = /[�?]/;
const IGNOTI_RUN = /[�?]+/g;

/**
 * Il nome VERO che resta sotto i caratteri persi, senza l'estensione. PURA.
 * L'estensione va tolta prima di contare: «.txt» da sola sono già quattro
 * caratteri, e basterebbe a far passare per nome un nome che non c'è più.
 */
function parteRiconosciuta(chiave) {
  const punto = chiave.lastIndexOf('.');
  const gambo = punto > 0 ? chiave.slice(0, punto) : chiave;
  return gambo.replace(IGNOTI_RUN, '').trim();
}

/**
 * Chiave con cui due nomi di file si confrontano «a meno delle sviste». PURA.
 * Minuscole, accenti tolti, trattini e apostrofi normalizzati, spazi collassati.
 */
function chiaveTollerante(nome) {
  let s = String(nome == null ? '' : nome);
  s = s.replace(TRATTINI, '-');
  // Apici e virgolette tipografiche → forma dritta (l'altra metà dei segni che
  // un programma di scrittura sostituisce da solo mentre si dà il nome).
  s = s.replace(/[‘’ʼ′´]/g, '\'').replace(/[“”″]/g, '"');
  // Accenti: si scompone e si buttano i segni diacritici. «à» → «a».
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Spazi di ogni tipo (compreso quello unificatore), collassati.
  s = s.replace(/[\s ]+/g, ' ').trim();
  return s.toLowerCase();
}

/** Scherma i metacaratteri di un'espressione regolare. PURA. */
function scherma(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Due nomi di file sono lo stesso nome, a meno delle sviste? PURA.
 * Un carattere perso vale come jolly su POCHI caratteri veri: è l'unico modo di
 * ritrovare «Singolarità.txt» partendo da «Singolarit<27>.txt».
 */
function nomiCombaciano(a, b) {
  const ka = chiaveTollerante(a);
  const kb = chiaveTollerante(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const conJolly = IGNOTI.test(ka) ? ka : (IGNOTI.test(kb) ? kb : '');
  if (!conJolly) return false;
  const altro = conJolly === ka ? kb : ka;
  // Un nome fatto (quasi) di soli caratteri persi non è un nome: combacerebbe
  // con qualunque cosa, e in una cartella con un file solo aprirebbe quello
  // senza che nessuno abbia riconosciuto niente. Serve del nome VERO sotto, e
  // l'estensione non conta come nome.
  if (parteRiconosciuta(conJolly).length < 3) return false;
  // Ogni carattere perso vale UN carattere vero, non un pezzo di nome lungo a
  // piacere: con «uno o più» bastava perdere la «o» di «Bilancio» per aprire
  // «Bilancio 2019 definitivo riservato». Il carattere in più che si concede
  // copre le tabelle a due byte, dove un carattere solo può averne persi due.
  // Mai un separatore di percorso: qui si confronta un singolo nome.
  let pattern = '';
  let da = 0;
  const run = new RegExp(IGNOTI_RUN.source, 'g');
  let m;
  while ((m = run.exec(conJolly)) !== null) {
    pattern += scherma(conJolly.slice(da, m.index));
    pattern += `[^\\\\/]{1,${m[0].length + 1}}`;
    da = m.index + m[0].length;
  }
  pattern += scherma(conJolly.slice(da));
  let re;
  try { re = new RegExp(`^${pattern}$`); } catch (_) { return false; }
  return re.test(altro);
}

/** Il percorso esiste? (file o cartella, non importa). */
async function esiste(p) {
  try { await fsp.stat(p); return true; } catch (_) { return false; }
}

/** I nomi nella cartella che combaciano col segmento chiesto. */
async function candidatiNellaCartella(dir, nome, soloCartelle) {
  let voci;
  try { voci = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return []; }
  const out = [];
  for (const v of voci) {
    // Un segmento intermedio DEVE essere una cartella: senza questo filtro un
    // file omonimo a metà percorso farebbe fallire la risoluzione più avanti.
    if (soloCartelle && !v.isDirectory()) continue;
    if (nomiCombaciano(v.name, nome)) out.push(v.name);
  }
  return out;
}

/**
 * Risolve un percorso che NON esiste così com'è scritto, segmento per segmento:
 * ogni pezzo che non c'è viene cercato tollerante nella cartella che lo
 * contiene. La storpiatura del terminale colpisce anche i nomi delle CARTELLE,
 * quindi fermarsi all'ultimo pezzo lascerebbe fuori metà dei casi.
 * → { path: '' se non si è capito quale, ambigui: [nomi] se erano più d'uno }
 */
async function risolviTollerante(full) {
  const root = path.parse(String(full || '')).root;
  if (!root) return { path: '', ambigui: [] };
  const segs = String(full).slice(root.length).split(/[\\/]+/).filter(Boolean);
  if (!segs.length) return { path: '', ambigui: [] };
  let cur = root;
  for (let i = 0; i < segs.length; i++) {
    const ultimo = i === segs.length - 1;
    const diretto = path.join(cur, segs[i]);
    if (await esiste(diretto)) { cur = diretto; continue; }
    const cand = await candidatiNellaCartella(cur, segs[i], !ultimo);
    // Zero: non c'è niente di simile. Due o più: non si tira a indovinare su un
    // file dell'utente — si dice che sono più d'uno e li si elenca. Vale anche
    // a METÀ percorso: a storpiarsi può essere il nome di una cartella, e
    // tacere lì lasciava l'utente senza il modo di scegliere, mentre sul nome
    // del file gliene si dava l'elenco (#551, secondo giro di verifica).
    if (cand.length !== 1) return { path: '', ambigui: cand, tipo: ultimo ? 'file' : 'cartella' };
    cur = path.join(cur, cand[0]);
  }
  return { path: cur, ambigui: [], tipo: 'file' };
}

/** Il motivo da dare a chi legge quando il file non si trova. PURA. */
function dettaglioNonTrovato(ambigui, tipo) {
  if (!Array.isArray(ambigui) || ambigui.length < 2) {
    return 'a quel percorso non c\'è nessun file';
  }
  const mostrati = ambigui.slice(0, 5).map((n) => `"${n}"`).join(', ');
  const resto = ambigui.length > 5 ? ` e altri ${ambigui.length - 5}` : '';
  if (tipo === 'cartella') {
    return `a quel percorso non c'è nessun file, e di cartelle col nome quasi uguale a una `
      + `di quelle scritte nel percorso ce ne sono ${ambigui.length} (${mostrati}${resto}): `
      + 'serve sapere quale';
  }
  return `a quel percorso non c'è nessun file, e nella cartella ce ne sono ${ambigui.length} `
    + `con un nome quasi uguale (${mostrati}${resto}): serve sapere quale`;
}

/**
 * Che tipo di file è, dalla sola estensione. PURA.
 * → 'pdf' | 'text' | { binary: 'spiegazione' } | 'unknown'
 */
function kindFromExtension(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (TEXT_EXT.has(ext)) return 'text';
  if (KNOWN_BINARY[ext]) return { binary: KNOWN_BINARY[ext] };
  return 'unknown';
}

/**
 * Un buffer contiene testo o è roba binaria? Serve per i file senza estensione
 * nota (un `.eml`, un `.bak`, un file di configurazione senza estensione): invece
 * di rifiutarli in blocco guardiamo cosa c'è dentro. PURA.
 * Criterio: nessun byte NUL e pochissimi byte di controllo nel primo tratto.
 */
function looksLikeText(buf) {
  if (!buf || !buf.length) return true; // un file vuoto è testo vuoto, non binario
  // Un file a due byte per carattere è pieno di byte nulli per costruzione: il
  // conteggio qui sotto lo scarterebbe come binario. La firma in testa dice che
  // è testo, e decodeText sa leggerlo.
  if (bomDueByte(buf)) return true;
  const n = Math.min(buf.length, 8192);
  let controls = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return false;
    // Controlli non stampabili, esclusi tab (9), LF (10), CR (13), FF (12), ESC (27).
    if (b < 32 && b !== 9 && b !== 10 && b !== 13 && b !== 12 && b !== 27) controls++;
  }
  return controls / n < 0.02;
}

/**
 * La firma in testa a un file scritto A DUE BYTE per carattere, se c'è. PURA.
 * → 'le' | 'be' | ''
 *
 * #551, terzo giro di verifica. È la codifica che su Windows sta dappertutto:
 * Windows PowerShell 5.1 la usa per OGNI file prodotto mandando l'uscita di un
 * comando in un file — cioè per i file che Filo stesso crea col terminale — e
 * il Blocco note la offre come «Unicode». Letto come UTF-8, un file così
 * diventa una fila di byte nulli alternati alle lettere: Filo dichiarava di
 * averlo letto e rispondeva sul nulla. È lo stesso danno della segnalazione un
 * passo più in là — non il nome del file, il suo contenuto.
 */
function bomDueByte(buf) {
  if (!buf || buf.length < 2) return '';
  // FF FE 00 00 è la firma a QUATTRO byte per carattere: non è questa.
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    if (buf.length >= 4 && buf[2] === 0x00 && buf[3] === 0x00) return '';
    return 'le';
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) return 'be';
  return '';
}

/**
 * Decodifica un buffer di testo. Due byte per carattere se il file lo dichiara
 * in testa; altrimenti UTF-8 (BOM tolto); se il risultato è pieno di
 * caratteri di sostituzione ripiega su latin1 — il caso tipico degli export CSV
 * italiani, scritti in windows-1252, dove altrimenti spariscono tutti gli accenti.
 * PURA.
 */
function decodeText(buf) {
  let b = buf;
  const due = bomDueByte(b);
  if (due) {
    // Via la firma, e un byte spaiato in fondo (file troncato) non deve far
    // morire la lettura: si scarta, come si scarta mezza coppia in coda.
    let corpo = b.subarray(2);
    if (corpo.length % 2) corpo = corpo.subarray(0, corpo.length - 1);
    if (due === 'be') {
      // Node sa leggere solo il verso piccolo: si scambiano i byte a coppie.
      const girato = Buffer.from(corpo);
      try { girato.swap16(); } catch (_) { return corpo.toString('utf8'); }
      corpo = girato;
    }
    return corpo.toString('utf16le');
  }
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  const utf8 = b.toString('utf8');
  const bad = (utf8.match(/�/g) || []).length;
  if (bad > 0 && bad / Math.max(utf8.length, 1) > 0.001) return b.toString('latin1');
  return utf8;
}

/** Taglia al tetto dichiarando il troncamento. PURA. */
function capText(text, max = MAX_TEXT_CHARS) {
  const s = String(text == null ? '' : text);
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max), truncated: true };
}

/** Estrae il testo da un PDF con unpdf (pdf.js). Ritorna { text, pages }. */
async function extractPdf(buf) {
  const { getDocumentProxy, extractText } = require('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const r = await extractText(pdf, { mergePages: true });
  const text = Array.isArray(r?.text) ? r.text.join('\n') : String(r?.text || '');
  return { text, pages: Number(r?.totalPages) || 0 };
}

/**
 * Legge un documento dal disco e ne restituisce il TESTO.
 *
 * Esito sempre nella stessa forma, anche in caso di rifiuto: chi formatta
 * l'osservazione per il modello non deve indovinare niente.
 */
async function readDocument(input, { cwd } = {}) {
  const base = {
    ok: false, path: '', name: '', kind: '', text: '', truncated: false,
    pages: 0, empty: false, bytes: 0, error: null, detail: '',
    // Valorizzato SOLO quando il percorso chiesto non esisteva e si è aperto un
    // file dal nome quasi uguale: chi legge deve sapere che ha in mano un altro
    // file, e l'utente deve vederselo dire (#551).
    requested: '',
  };
  let full = normalizePath(input, cwd);
  if (!full) return { ...base, error: 'no_path', detail: 'nessun percorso indicato' };
  base.path = full;
  base.name = path.basename(full);

  let st;
  try {
    st = await fsp.stat(full);
  } catch (_) {
    // Il percorso non c'è così com'è scritto. Prima di arrendersi: c'è UN SOLO
    // file che combacia a meno di accenti, trattini e maiuscole? (#551)
    const alt = await risolviTollerante(full);
    if (alt.path) {
      try { st = await fsp.stat(alt.path); } catch (_) { st = null; }
    }
    if (!st) return { ...base, error: 'not_found', detail: dettaglioNonTrovato(alt.ambigui, alt.tipo) };
    base.requested = full;
    full = alt.path;
    base.path = full;
    base.name = path.basename(full);
  }
  if (st.isDirectory()) {
    return { ...base, error: 'is_directory', detail: 'quello è il percorso di una cartella, non di un file' };
  }
  base.bytes = st.size;
  if (st.size > MAX_FILE_BYTES) {
    const mb = (st.size / (1024 * 1024)).toFixed(1);
    return {
      ...base,
      error: 'too_big',
      detail: `pesa ${mb} MB e il limite è ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB`,
    };
  }

  const kind = kindFromExtension(full);
  if (kind && typeof kind === 'object' && kind.binary) {
    return { ...base, error: 'unsupported', detail: kind.binary };
  }

  let buf;
  try {
    buf = await fsp.readFile(full);
  } catch (e) {
    return { ...base, error: 'unreadable', detail: 'il file non si riesce ad aprire (permessi o file in uso)' };
  }

  if (kind === 'pdf') {
    base.kind = 'pdf';
    let out;
    try {
      out = await extractPdf(buf);
    } catch (e) {
      return { ...base, kind: 'pdf', error: 'pdf_failed', detail: 'il PDF è danneggiato o protetto da password' };
    }
    base.pages = out.pages;
    const text = String(out.text || '').trim();
    // `trim()` toglie anche gli spazi unificatori: un PDF di sole immagini
    // restituisce spesso spazi e a capo, e se non resta nulla testo estraibile non ce n'è.
    if (!text) {
      // PDF senza testo estraibile: è una scansione o una foto. Risposta onesta,
      // niente OCR (per ora) e soprattutto niente contenuto inventato.
      return { ...base, ok: true, kind: 'pdf', empty: true, text: '' };
    }
    const capped = capText(text);
    return { ...base, ok: true, kind: 'pdf', text: capped.text, truncated: capped.truncated };
  }

  // Testo semplice. Estensione non nota → decidiamo dal contenuto invece di
  // rifiutare in blocco: un `.eml`, un `.bak` o un file senza estensione sono
  // spesso testo perfettamente leggibile.
  if (kind === 'unknown' && !looksLikeText(buf)) {
    return { ...base, error: 'unsupported', detail: 'è un file binario, non testo' };
  }
  base.kind = 'text';
  const capped = capText(decodeText(buf));
  return { ...base, ok: true, kind: 'text', text: capped.text, truncated: capped.truncated };
}

module.exports = {
  readDocument,
  // esportati per gli unit test e per chi formatta l'osservazione
  normalizePath,
  chiaveTollerante,
  nomiCombaciano,
  risolviTollerante,
  dettaglioNonTrovato,
  kindFromExtension,
  looksLikeText,
  decodeText,
  bomDueByte,
  capText,
  MAX_TEXT_CHARS,
  MAX_FILE_BYTES,
};
