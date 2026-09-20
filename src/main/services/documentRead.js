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
 * Gli invisibili di formattazione, tolti come li toglie la busta con cui ogni
 * contenuto esterno entra nel prompt. Un nome di file in arabo o in ebraico si
 * porta dietro le marche che dicono da che parte si legge la riga: la busta le
 * toglie (servono anche a nascondere le marcature del prompt dentro una
 * parola), quindi al modello quel nome arriva senza, e riscrivendolo com'è
 * scritto non riapriva più niente (#551, quarto giro). La lista la tiene la
 * busta: qui la si chiede, non la si ricopia.
 */
function senzaInvisibili(s) {
  try {
    if (!globalThis.SN_ESTERNO) require('../../shared/contenutoEsterno.js');
    const E = globalThis.SN_ESTERNO;
    if (E && typeof E.invisibiliTolti === 'function') return E.invisibiliTolti(s);
  } catch (_) {}
  return s;
}

/**
 * Chiave con cui due nomi di file si confrontano «a meno delle sviste». PURA.
 * Minuscole, accenti tolti, trattini e apostrofi normalizzati, spazi collassati,
 * invisibili di formattazione tolti.
 */
function chiaveTollerante(nome) {
  let s = senzaInvisibili(String(nome == null ? '' : nome));
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

/**
 * Il nome con i caratteri persi, sezionato: i pezzi di nome VERO e, fra un
 * pezzo e l'altro, quanti caratteri può aver mangiato il buco. PURA.
 * → { pezzi: [stringhe], buchi: [{ min, max }] } con pezzi.length = buchi.length + 1
 */
function sezionaConJolly(conJolly) {
  const pezzi = [];
  const buchi = [];
  const run = new RegExp(IGNOTI_RUN.source, 'g');
  let da = 0;
  let m;
  while ((m = run.exec(conJolly)) !== null) {
    pezzi.push(conJolly.slice(da, m.index));
    // Ogni carattere perso vale UN carattere vero, non un pezzo di nome lungo a
    // piacere: con «uno o più» bastava perdere la «o» di «Bilancio» per aprire
    // «Bilancio 2019 definitivo riservato». Il carattere in più che si concede
    // copre le tabelle a due byte, dove un carattere solo può averne persi due.
    buchi.push({ min: 1, max: m[0].length + 1 });
    da = m.index + m[0].length;
  }
  pezzi.push(conJolly.slice(da));
  return { pezzi, buchi };
}

/**
 * Il nome sezionato combacia con quello vero? PURA.
 *
 * #551, quinto giro di verifica. Prima questa domanda si faceva costruendo
 * un'espressione regolare con un jolly per ogni buco e provandola sul nome
 * vero. Funzionava, ma il tempo di quella prova RADDOPPIA a ogni buco in più:
 * con ventidue caratteri persi un decimo di secondo, con ventotto otto secondi,
 * con trenta trentaquattro — e sono i secondi per UN file, che la cartella
 * moltiplica. Il conto gira nel processo principale, che è uno solo: mentre
 * gira, Filo non risponde a nient'altro (misurato dentro l'app: una richiesta
 * che non c'entrava niente ha aspettato undici secondi e mezzo). E il nome su
 * cui gira non lo sceglie l'utente — lo ricopia il modello da quello che il
 * terminale gli ha stampato o da un documento, cioè da fuori.
 *
 * Qui si avanza invece per POSIZIONI: dopo ogni pezzo di nome vero si tiene
 * l'insieme dei punti in cui si può essere arrivati, e le posizioni sono al
 * massimo quante sono le lettere del nome. Nessun ritorno sui propri passi,
 * quindi il costo cresce con la LUNGHEZZA del nome e non con i buchi: un nome
 * di duecento caratteri tutto a buchi si risolve in meno di un millisecondo.
 * La regola che decide resta identica a prima, e le prove dei giri passati lo
 * verificano.
 */
function combaciaSezionato({ pezzi, buchi }, altro) {
  if (!altro.startsWith(pezzi[0])) return false;
  let posizioni = [pezzi[0].length];
  for (let i = 0; i < buchi.length; i++) {
    const { min, max } = buchi[i];
    const atteso = pezzi[i + 1];
    const viste = new Set();
    const prossime = [];
    for (const p of posizioni) {
      for (let salto = min; salto <= max; salto++) {
        const q = p + salto;
        if (q + atteso.length > altro.length) break;
        // Mai un separatore di percorso dentro un buco: qui si confronta un
        // singolo nome, non un pezzo di percorso.
        const mangiato = altro.charAt(q - 1);
        if (mangiato === '/' || mangiato === '\\') break;
        if (!altro.startsWith(atteso, q)) continue;
        const fine = q + atteso.length;
        if (!viste.has(fine)) { viste.add(fine); prossime.push(fine); }
      }
    }
    if (!prossime.length) return false;
    posizioni = prossime;
  }
  return posizioni.includes(altro.length);
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
  return combaciaSezionato(sezionaConJolly(conJolly), altro);
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
  // conteggio qui sotto lo scarterebbe come binario. Lo riconosciamo dalla
  // firma in testa o dalla sua forma, e decodeText sa leggerlo.
  if (bomDueByte(buf) || pareDueByte(buf)) return true;
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

// Quanta parte di un testo NON è testo: byte nulli e caratteri di controllo non
// stampabili. PURA. Tabulazione, a capo, ritorno a capo, avanzamento pagina ed
// escape restano fuori dal conto: in un registro o in un testo formattato sono
// contenuto vero. È la stessa domanda che `looksLikeText` fa sui byte, e qui
// serve sul testo già decodificato.
//
// I ROMBI NON SI CONTANO, di proposito. Un documento può contenerne di suoi:
// gli appunti in cui l'utente ha ricopiato i nomi storpiati che il terminale
// gli mostrava ne hanno uno ogni poche parole, e sono il suo contenuto. Contarli
// qui vorrebbe dire rifiutare proprio quel documento, che è il caso chiuso nel
// quinto giro. Quanti byte del file fossero rotti lo dice `bilancioUtf8`, che
// è una domanda diversa e ha già la sua risposta.
const QUOTA_NON_TESTO = 0.02;

function quotaNonTesto(s) {
  const n = Math.min(s.length, 8192);
  if (!n) return 1;
  let rumore = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c >= 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 27) continue;
    rumore++;
  }
  return rumore / n;
}

/** Legge il buffer come testo a due byte nel verso dato. PURA. */
function leggiDueByte(buf, verso, conFirma) {
  let corpo = conFirma ? buf.subarray(2) : buf;
  // Un byte spaiato in fondo (file troncato) non deve far morire la lettura:
  // si scarta, come si scarta mezza coppia in coda.
  if (corpo.length % 2) corpo = corpo.subarray(0, corpo.length - 1);
  if (verso === 'be') {
    // Node sa leggere solo il verso piccolo: si scambiano i byte a coppie.
    const girato = Buffer.from(corpo);
    try { girato.swap16(); } catch (_) { return corpo.toString('utf8'); }
    corpo = girato;
  }
  return corpo.toString('utf16le');
}

/**
 * Lo stesso file, ma SENZA la firma in testa. PURA. → 'le' | 'be' | ''
 *
 * #551, quinto giro. La firma è una cortesia, non un obbligo: chi scrive un
 * file a due byte può ometterla, e allora letto come UTF-8 torna una fila di
 * caratteri nulli fra le lettere — e Filo dichiarava di averlo letto.
 *
 * #551, sesto giro. Prima il riconoscimento contava i byte NULLI e pretendeva
 * che fossero metà: vero finché le lettere sono latine, perché lì il byte alto
 * di ogni coppia è zero. In russo, in greco o in cinese quel byte non è zero,
 * il file non veniva riconosciuto, e Filo dichiarava di averlo letto
 * consegnando al modello una fila di caratteri nulli. La domanda giusta è in
 * due passi, e nessuno dei due ha soglie da tarare sulla lingua:
 *   • un testo a 8 bit non contiene MAI un byte nullo. Se c'è, o il file è a
 *     due byte per carattere o non è testo;
 *   • in un testo a due byte quei nulli stanno TUTTI dalla stessa parte delle
 *     coppie: sono il byte alto degli spazi, degli a capo e della
 *     punteggiatura, che ci sono in qualunque lingua. QUANTI siano dipende
 *     dall'alfabeto — metà in italiano, pochi in russo, pochissimi in cinese —
 *     ma a dire il verso è da che PARTE stanno, e quello non dipende dalla
 *     lingua. Era pretenderne una quota a far cadere gli alfabeti non latini;
 *   • e infine si controlla che quello che ne viene fuori sia davvero testo,
 *     così un file binario pieno di nulli non passa per un documento.
 *
 * #551, settimo giro. «Un testo a 8 bit non contiene MAI un byte nullo» è vero
 * di un testo INTATTO, e di un testo intatto soltanto. Un byte nullo dentro un
 * file di testo capita per davvero: il registro di un programma che si è chiuso
 * male, l'export di un gestionale vecchio, il file recuperato dalla chiavetta
 * staccata del quarto giro. E uno solo bastava: con un nullo soltanto il conto
 * «da che parte stanno» dà il cento per cento, il file veniva riletto due byte
 * alla volta, e quello che ne usciva erano ideogrammi. Ideogrammi che sono
 * caratteri STAMPABILI, quindi nemmeno la rete finale se ne accorgeva: Filo
 * dichiarava letto un estratto conto e rispondeva su una fila di segni cinesi.
 *
 * Il passo che mancava è la stessa domanda che si fa sul testo decodificato,
 * fatta qui sulla lettura a 8 BIT: questo file, letto a 8 bit, è GIÀ testo? Se
 * lo è, i nulli sono il danno e non la struttura, e il testo va letto com'è
 * scritto. In un testo a due byte la risposta è no in qualunque alfabeto: a non
 * essere testo è il byte ALTO di ogni coppia — zero in italiano, un carattere
 * di controllo in russo e in greco — e sono la metà dei byte del file. Nessuna
 * soglia nuova da tarare: è la quota che il modulo usa già per decidere se
 * qualcosa è testo.
 */
function pareDueByte(buf) {
  if (!buf || buf.length < 8) return '';
  const n = Math.min(buf.length - (buf.length % 2), 8192);
  let alti = 0;  // nullo in posizione dispari: byte alto nel verso piccolo
  let bassi = 0; // nullo in posizione pari: byte alto nel verso grande
  for (let i = 0; i < n; i += 2) {
    if (buf[i] === 0x00) bassi++;
    if (buf[i + 1] === 0x00) alti++;
  }
  const totale = alti + bassi;
  if (!totale) return '';
  const verso = alti > bassi ? 'le' : 'be';
  if (Math.max(alti, bassi) / totale < 0.9) return '';
  // Letto a 8 bit è già testo? Allora è un testo a 8 bit con qualche byte
  // guasto, non un file a due byte per carattere.
  if (quotaNonTesto(buf.subarray(0, n).toString('utf8')) < QUOTA_NON_TESTO) return '';
  return quotaNonTesto(leggiDueByte(buf, verso, false)) < QUOTA_NON_TESTO ? verso : '';
}

/**
 * Questi byte sono UTF-8 valido? PURA.
 *
 * #551, quinto giro di verifica. Prima la domanda era «quanti rombi vengono
 * fuori leggendoli come UTF-8?», e si ripiegava sulla tabella di Windows sopra
 * un rombo ogni mille caratteri. Una percentuale sbaglia in tutte e due le
 * direzioni, e sbagliava su casi normalissimi:
 *   • un documento salvato in ANSI con pochi segni speciali rispetto alla sua
 *     lunghezza — la specifica della segnalazione, un estratto conto esportato
 *     dal foglio di calcolo — restava letto come UTF-8, e euro, trattino lungo,
 *     apostrofo tipografico e accenti diventavano rombi;
 *   • un documento scritto BENE in UTF-8 che contiene davvero qualche rombo —
 *     gli appunti in cui l'utente ha ricopiato i nomi storpiati dal terminale,
 *     un registro di errori — veniva riletto tutto con la tabella di Windows, e
 *     allora si storpiavano tutti gli accenti che erano giusti.
 * «Sono UTF-8 valido?» invece è una domanda con una risposta esatta, e non ha
 * soglie da tarare.
 */
function eUtf8Valido(buf) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Quante sequenze a più byte sono scritte BENE e quanti byte sono rotti. PURA.
 *
 * #551, sesto giro di verifica. «I byte sono UTF-8 valido?» è una domanda
 * esatta, ma la risposta è tutto o niente: un byte guasto in mezzo a
 * cinquantamila faceva rileggere l'INTERO documento con la tabella di Windows,
 * e allora tutti gli accenti che erano giusti arrivavano al modello storpiati
 * («città» → «cittÃ », «—» → «â€”», «€» → «â‚¬»). Capita per davvero: un export
 * che mescola righe vecchie e righe nuove, un registro di un programma, un file
 * messo insieme da due fonti.
 *
 * La domanda giusta non è «c'è un errore?» ma «di che tipo è questo file?», e
 * si risponde guardando le sequenze a più byte invece che i byte singoli:
 *   • un documento scritto in UTF-8 ne ha tante scritte bene e, se è
 *     danneggiato, qualche byte rotto;
 *   • un documento scritto nella tabella di Windows non ne ha NESSUNA scritta
 *     bene: lì «à» e «—» sono byte singoli, che in UTF-8 non vogliono dire
 *     niente. Un file italiano in quella tabella ha zero sequenze valide e
 *     tante rotte quante sono le lettere accentate.
 * Niente percentuali da tarare: vince la maggioranza fra due conteggi che
 * misurano la stessa cosa.
 */
function bilancioUtf8(buf) {
  let valide = 0;
  let rotte = 0;
  const n = buf.length;
  let i = 0;
  while (i < n) {
    const b = buf[i];
    if (b < 0x80) { i++; continue; }
    // Quanti byte pretende questo capofila? C0 e C1 sarebbero sempre scritture
    // sovralunghe, F5 e oltre sono fuori dall'intervallo dei caratteri.
    let lung = 0;
    if (b >= 0xC2 && b <= 0xDF) lung = 2;
    else if (b >= 0xE0 && b <= 0xEF) lung = 3;
    else if (b >= 0xF0 && b <= 0xF4) lung = 4;
    let ok = lung > 0 && i + lung <= n;
    for (let k = 1; ok && k < lung; k++) {
      const c = buf[i + k];
      if (c < 0x80 || c > 0xBF) ok = false;
    }
    // Le scritture sovralunghe e i mezzi caratteri di coppia: valgono rotte
    // anche se la forma della sequenza tornerebbe.
    if (ok && lung === 3 && b === 0xE0 && buf[i + 1] < 0xA0) ok = false;
    if (ok && lung === 3 && b === 0xED && buf[i + 1] > 0x9F) ok = false;
    if (ok && lung === 4 && b === 0xF0 && buf[i + 1] < 0x90) ok = false;
    if (ok && lung === 4 && b === 0xF4 && buf[i + 1] > 0x8F) ok = false;
    if (ok) { valide++; i += lung; } else { rotte++; i++; }
  }
  return { valide, rotte };
}

// I 32 caratteri in cui la tabella di Windows si discosta da latin1 (da 0x80 a
// 0x9F). Non è una fascia qualunque: è proprio dove stanno i SEGNI TIPOGRAFICI
// — trattino lungo e medio, virgolette e apostrofi curvi, il simbolo dell'euro,
// i puntini di sospensione. Letta come latin1, quella fascia diventa caratteri
// di controllo invisibili: gli accenti tornavano giusti e il resto spariva
// senza lasciare traccia, nemmeno un rombo. Il modello leggeva «12 » al posto
// di «12 €» e rispondeva su un testo bucato (#551, quarto giro di verifica). È
// lo stesso danno della segnalazione, spostato dal nome del file al contenuto:
// un documento salvato in «ANSI» — il modo normale di salvare un testo su
// Windows fino a ieri, e quello che Excel usa esportando un CSV — perdeva i
// segni di cui la segnalazione parla.
const CP1252_ALTI = [
  '€', '\u0081', '‚', 'ƒ', '„', '…', '†', '‡',
  'ˆ', '‰', 'Š', '‹', 'Œ', '\u008D', 'Ž', '\u008F',
  '\u0090', '‘', '’', '“', '”', '•', '–', '—',
  '˜', '™', 'š', '›', 'œ', '\u009D', 'ž', 'Ÿ',
];

/** Da byte di Windows-1252 a testo. PURA. */
function daCp1252(buf) {
  return buf.toString('latin1')
    .replace(/[\u0080-\u009F]/g, (c) => CP1252_ALTI[c.charCodeAt(0) - 0x80]);
}

/**
 * Decodifica un buffer di testo. PURA.
 *
 * L'ordine è per certezze, dalla più solida alla più debole:
 *   1. il file DICHIARA in testa di essere a due byte per carattere;
 *   2. non lo dichiara ma ne ha la forma (metà byte nulli, tutti dalla stessa
 *      parte delle coppie);
 *   3. le sequenze a più byte sono scritte bene → è UTF-8. Se qualche byte è
 *      rotto, è un documento UTF-8 DANNEGGIATO: si tiene la sua tabella e si
 *      perde il byte guasto, invece di storpiare tutto il resto (#551, sesto
 *      giro di verifica);
 *   4. di sequenze scritte bene non ce n'è nemmeno una → la tabella di Windows,
 *      che è come Windows ha sempre salvato i testi e come il foglio di calcolo
 *      esporta un CSV.
 * Nessuna percentuale da tarare: ogni passo è un confronto fra conteggi o una
 * domanda con una risposta esatta.
 *
 * Torna { text, codifica, bytesPersi }: chi legge deve poter DIRE con quale
 * tabella ha letto e quanti byte non ha saputo ricostruire, invece di
 * consegnare un testo bucato senza dirlo a nessuno.
 */
function decodeTextDettaglio(buf) {
  let b = buf;
  const dichiarato = bomDueByte(b);
  const due = dichiarato || pareDueByte(b);
  if (due) {
    return { text: leggiDueByte(b, due, !!dichiarato), codifica: 'due-byte', bytesPersi: 0 };
  }
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  const { valide, rotte } = bilancioUtf8(b);
  if (!rotte) return { text: b.toString('utf8'), codifica: 'utf8', bytesPersi: 0 };
  if (valide > rotte) {
    // UTF-8 danneggiato: al posto dei byte rotti resta un rombo, e tutto il
    // resto del documento arriva com'è scritto.
    return { text: b.toString('utf8'), codifica: 'utf8-danneggiato', bytesPersi: rotte };
  }
  return { text: daCp1252(b), codifica: 'windows', bytesPersi: 0 };
}

/** Solo il testo, per chi la tabella non gliene importa. PURA. */
function decodeText(buf) {
  return decodeTextDettaglio(buf).text;
}

/** Taglia al tetto dichiarando il troncamento. PURA. */
function capText(text, max = MAX_TEXT_CHARS) {
  const s = String(text == null ? '' : text);
  if (s.length <= max) return { text: s, truncated: false };
  // Il taglio cade dove capita, e un'emoji occupa DUE unità di testo: tagliando
  // per numero di unità si resta con la prima metà, che da sola non è nessun
  // carattere e si mostra come un rombo. Se in fondo resta una metà di coppia
  // la si lascia fuori: un carattere in meno, nessun carattere rotto. È la
  // stessa cura già messa al taglio dell'output dei comandi (#551, secondo
  // giro); qui era rimasta fuori, ed è lo stesso taglio (quarto giro).
  let n = max;
  const ultimo = s.charCodeAt(n - 1);
  if (ultimo >= 0xD800 && ultimo <= 0xDBFF) n -= 1;
  return { text: s.slice(0, n), truncated: true };
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
    // Con quale tabella il testo è stato letto, e quanti byte il file aveva
    // rotti. Servono a DIRLO: un testo letto tirando a indovinare la tabella,
    // o bucato in qualche punto, non deve arrivare al modello come se fosse
    // intero (#551, sesto giro).
    codifica: '',
    bytesPersi: 0,
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
  const letto = decodeTextDettaglio(buf);
  // Ultima rete: se quello che è venuto fuori non è testo — byte nulli,
  // caratteri di controllo a raffica — non lo si dichiara letto. Un file in una
  // codifica che Filo non sa riconoscere arrivava al modello come una fila di
  // caratteri nulli, e Filo diceva di averlo letto: il modello rispondeva sul
  // nulla senza che nessuno potesse accorgersene (#551, sesto giro).
  if (quotaNonTesto(letto.text) >= QUOTA_NON_TESTO) {
    return {
      ...base,
      error: 'unreadable',
      detail: 'è scritto in una codifica che Filo non riconosce: il testo che ne viene fuori '
        + 'non vuol dire niente. Riaprilo e risalvalo in UTF-8',
    };
  }
  const capped = capText(letto.text);
  return {
    ...base,
    ok: true,
    kind: 'text',
    text: capped.text,
    truncated: capped.truncated,
    codifica: letto.codifica,
    bytesPersi: letto.bytesPersi,
  };
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
  decodeTextDettaglio,
  bomDueByte,
  pareDueByte,
  eUtf8Valido,
  bilancioUtf8,
  quotaNonTesto,
  capText,
  MAX_TEXT_CHARS,
  MAX_FILE_BYTES,
};
