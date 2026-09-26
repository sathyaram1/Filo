// Una copia su file di qualcosa che si è già letto dal server, con scadenza.
// NON è una cache di prodotto: serve agli script lanciati più volte di seguito.
// Regole e perché: patterns/una-scansione-chiede-i-campi-che-usa-e-si-paga-una-volta.md

import {
  chmodSync, constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, writeFileSync, unlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Su Mac e Linux la cartella temporanea è di tutti, e il nome di una copia è
// ricavabile: chi la crea per primo decide cosa ci troviamo dentro e dove
// scriviamo. Quindi apriamo senza seguire i collegamenti, e ci fidiamo solo di
// una cartella nostra e chiusa agli altri. Su Windows non serve: `%TEMP%` sta
// già dentro il profilo dell'utente, e queste due bandiere lì non esistono.
const WINDOWS = process.platform === 'win32';
const NO_SYMLINK = WINDOWS ? 0 : (constants.O_NOFOLLOW || 0);
function nostro(st) {
  if (WINDOWS) return true;
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
  return (st.mode & 0o077) === 0;
}

// La cartella temporanea la decide il sistema (`os.tmpdir()`), mai un percorso
// scritto a mano: gli script girano anche su Mac e Linux.
// `FILO_COPIE_DIR` esiste per le prove, che devono poter guardare il file.
// Torna '' se la cartella non è nostra o è aperta agli altri: allora la copia
// non si fa, e chi chiama rilegge dal server.
export function cartellaCopie(dir = null) {
  const scelta = String(dir || process.env.FILO_COPIE_DIR || '').trim();
  const base = scelta || join(tmpdir(), 'filo-copie');
  try { mkdirSync(base, { recursive: true, mode: 0o700 }); } catch (_) { /* c'è già: lo dice il controllo qui sotto */ }
  try {
    let st = lstatSync(base);
    // Un rimando al posto della cartella, o una cartella di qualcun altro: è
    // roba preparata, non nostra, e non ci si mette dentro niente.
    if (!st.isDirectory() || st.isSymbolicLink()) return '';
    if (!WINDOWS && typeof process.getuid === 'function' && st.uid !== process.getuid()) return '';
    // Nostra ma aperta agli altri (l'ha lasciata così una versione di prima):
    // si chiude, invece di smettere di funzionare in silenzio.
    if (!nostro(st)) {
      chmodSync(base, 0o700);
      st = lstatSync(base);
      if (!nostro(st)) return '';
    }
  } catch (_) { return ''; }
  return base;
}

// Il nome del file non contiene la chiave: una chiave può essere un URL intero,
// con caratteri che su Windows non stanno in un nome di file.
export function percorsoCopia(chiave, dir = null) {
  const base = cartellaCopie(dir);
  if (!base) return '';
  const impronta = createHash('sha256').update(String(chiave)).digest('hex').slice(0, 24);
  return join(base, `${impronta}.json`);
}

/**
 * Scrive la copia. `0600`: la copia di una lettura dei feedback non deve essere
 * leggibile dagli altri utenti della macchina.
 * Un guasto di scrittura NON è un errore del chiamante: la copia è un risparmio,
 * non un pezzo del lavoro. Ritorna il percorso scritto, o '' se non ci è riuscita.
 */
export function scriviCopia(chiave, dati, { dir = null, now = Date.now() } = {}) {
  const file = percorsoCopia(chiave, dir);
  if (!file) return '';
  let fd = null;
  try {
    // Senza O_NOFOLLOW un rimando lasciato lì da qualcun altro ci fa riscrivere
    // il file che punta lui.
    fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NO_SYMLINK, 0o600);
    if (!nostro(fstatSync(fd))) return '';
    writeFileSync(fd, JSON.stringify({ at: now, chiave: String(chiave), dati }), { encoding: 'utf8' });
    return file;
  } catch (_) {
    return '';
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch (_) { /* già chiuso */ } }
  }
}

/**
 * Rilegge la copia se è ancora valida. Tre modi di dire «no, rileggi dal
 * server», tutti indistinguibili per chi chiama: assente, scaduta, illeggibile
 * (JSON rotto, troncata, di un'altra chiave). Una copia scaduta di un minuto
 * non deve mai far partire un giro con impostazioni che l'owner ha cambiato.
 * @returns {{dati:any, etaMs:number}|null}
 */
export function leggiCopia(chiave, { dir = null, now = Date.now(), ttlMs = 60_000 } = {}) {
  const file = percorsoCopia(chiave, dir);
  if (!file) return null;
  let json = null;
  let fd = null;
  try {
    // Una copia che non abbiamo scritto noi non è una copia: è quello che ci ha
    // lasciato lì un altro utente della macchina, e per le routine sarebbero i
    // numeri e l'interruttore con cui parte il giro.
    fd = openSync(file, constants.O_RDONLY | NO_SYMLINK);
    if (!nostro(fstatSync(fd))) return null;
    json = JSON.parse(readFileSync(fd, 'utf8'));
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch (_) { /* già chiuso */ } }
  }
  if (!json || typeof json !== 'object') return null;
  if (String(json.chiave || '') !== String(chiave)) return null;
  const at = Number(json.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  const eta = now - at;
  // Una copia con la data nel futuro (orologio spostato) non vale: rileggere
  // costa una lettura, fidarsi di una data impossibile costa una decisione.
  if (eta < 0 || eta > Math.max(0, Number(ttlMs) || 0)) return null;
  if (json.dati === undefined) return null;
  return { dati: json.dati, etaMs: eta };
}

/** Butta la copia: dopo un'applicazione, i dati letti non descrivono più il server. */
export function scordaCopia(chiave, { dir = null } = {}) {
  const file = percorsoCopia(chiave, dir);
  if (!file) return false;
  try { unlinkSync(file); return true; } catch (_) { return false; }
}

/** Come si dice a video che si sta riusando una lettura, invece di rifarla. */
export function rigaCopiaRiusata(etaMs) {
  const s = Math.max(0, Math.round(Number(etaMs) / 1000));
  const quando = s < 1 ? 'appena fatta' : `${s} s fa`;
  return `Riuso la lettura della prova a secco (${quando}): nessuna richiesta al server.`;
}
