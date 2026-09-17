// Lettura dei documenti dal disco (LEGGI_DOCUMENTO): un PDF binario diventa testo.
// SOLA LETTURA: non scrive, non sposta, non esegue nulla.
// Nessun confine sui percorsi: il testo estratto è sempre DATO non fidato (handlers.js).

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Tetto sul testo restituito: un contratto intero ci sta, il prompt non esplode.
// Oltre il tetto si tronca, e il troncamento si DICHIARA.
const MAX_TEXT_CHARS = 16000;

// Tetto sul FILE prima di aprirlo: un PDF da mezzo giga bloccherebbe il main per minuti.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Anche i formati di dati (csv, json, xml): è ciò che si scarica dalla banca senza il PDF.
const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.log', '.json', '.xml',
  '.yml', '.yaml', '.ini', '.cfg', '.conf', '.env', '.srt', '.vtt', '.tex',
]);

// Con la spiegazione per l'utente: meglio «è un'immagine» che «formato non supportato».
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

// Il percorso arriva dall'LLM: va normalizzato ad assoluto prima di toccarlo. PURA.
function normalizePath(input) {
  let p = String(input == null ? '' : input).trim();
  if (!p) return '';
  // Gli LLM incartano volentieri i percorsi tra virgolette o apici.
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith('\'') && p.endsWith('\''))) {
    p = p.slice(1, -1).trim();
  }
  if (p === '~') p = os.homedir();
  else if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(2));
  if (!p) return '';
  return path.resolve(p);
}

// Dalla sola estensione: 'pdf' | 'text' | { binary: 'spiegazione' } | 'unknown'. PURA.
function kindFromExtension(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (TEXT_EXT.has(ext)) return 'text';
  if (KNOWN_BINARY[ext]) return { binary: KNOWN_BINARY[ext] };
  return 'unknown';
}

// Per i file senza estensione nota (.eml, .bak) si guarda dentro invece di rifiutarli. PURA.
// Criterio: nessun byte NUL e pochissimi byte di controllo nel primo tratto.
function looksLikeText(buf) {
  if (!buf || !buf.length) return true; // un file vuoto è testo vuoto, non binario
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

// UTF-8 col BOM tolto; se esce pieno di caratteri di sostituzione si ripiega su latin1:
// gli export CSV italiani sono windows-1252 e perderebbero tutti gli accenti. PURA.
function decodeText(buf) {
  let b = buf;
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

// unpdf è pdf.js senza visualizzatore, canvas e font: stessa qualità su encoding strani e
// font CID, a 2,4 MB invece di 34 e senza dipendenze transitive.
async function extractPdf(buf) {
  const { getDocumentProxy, extractText } = require('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const r = await extractText(pdf, { mergePages: true });
  const text = Array.isArray(r?.text) ? r.text.join('\n') : String(r?.text || '');
  return { text, pages: Number(r?.totalPages) || 0 };
}

// Esito sempre nella stessa forma, anche in caso di rifiuto: chi formatta l'osservazione
// per il modello non deve indovinare niente.
async function readDocument(input) {
  const base = {
    ok: false, path: '', name: '', kind: '', text: '', truncated: false,
    pages: 0, empty: false, bytes: 0, error: null, detail: '',
  };
  const full = normalizePath(input);
  if (!full) return { ...base, error: 'no_path', detail: 'nessun percorso indicato' };
  base.path = full;
  base.name = path.basename(full);

  let st;
  try {
    st = await fsp.stat(full);
  } catch (_) {
    return { ...base, error: 'not_found', detail: 'a quel percorso non c\'è nessun file' };
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
    // Un PDF di sole immagini restituisce spazi e a capo: dopo il trim non resta niente.
    if (!text) {
      // PDF scansionato: risposta onesta, niente OCR e soprattutto niente contenuto inventato.
      return { ...base, ok: true, kind: 'pdf', empty: true, text: '' };
    }
    const capped = capText(text);
    return { ...base, ok: true, kind: 'pdf', text: capped.text, truncated: capped.truncated };
  }

  // Estensione non nota: decide il contenuto, non il rifiuto in blocco (vedi looksLikeText).
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
  kindFromExtension,
  looksLikeText,
  decodeText,
  capText,
  MAX_TEXT_CHARS,
  MAX_FILE_BYTES,
};
