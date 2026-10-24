// Scrivere un file senza poterlo lasciare a metà, e leggerlo senza scambiare un guasto per «non c'è» (#1087).
// Niente electron: lo caricano anche gli unit. Prove: tests/unit/scritturaAtomica.test.mjs.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

// Su Windows un antivirus o un indicizzatore tiene il file aperto per un attimo.
const OCCUPATO = new Set(['EPERM', 'EBUSY', 'EACCES']);
const TENTATIVI_RINOMINA = 5;
const TENTATIVI_LETTURA = 4;
const attesaMs = (i) => 50 * (i + 1);
// Le rinomine riprovate, per codice d'errore: le ritira lo storage per i contatori anonimi (#1466), che le riducono a
// un elenco chiuso. Valgono per ogni file scritto da qui: l'antivirus che tiene un file tiene anche gli altri.
const ritenti = new Map();
function ritento(e) {
  const c = typeof (e && e.code) === 'string' ? e.code : '';
  ritenti.set(c, (ritenti.get(c) || 0) + 1);
}
function ritentiRinomina() {
  const out = Object.fromEntries(ritenti);
  ritenti.clear();
  return out;
}

let progressivo = 0;
// Un temporaneo per scrittura: la scrittura di chiusura (sincrona) e una in volo non si rubano il file.
function nomeTemporaneo(target) {
  progressivo += 1;
  return `${target}.tmp-${process.pid}-${progressivo}`;
}

function dormiSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) {
    const fine = Date.now() + ms;
    while (Date.now() < fine) { /* attesa attiva: Atomics.wait non è permesso qui */ }
  }
}

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

// La rename diventa durevole solo col fsync della cartella; dove la cartella non si apre (Windows) il giornale del disco la tiene già.
function sincronizzaCartellaSync(dir) {
  let fd;
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); } catch (_) {} finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

async function sincronizzaCartella(dir) {
  let fh;
  try { fh = await fsp.open(dir, 'r'); await fh.sync(); } catch (_) {} finally {
    if (fh) { try { await fh.close(); } catch (_) {} }
  }
}

function comeBuffer(dati) {
  return Buffer.isBuffer(dati) ? dati : Buffer.from(String(dati), 'utf8');
}

function rinominaSync(da, a) {
  for (let i = 0; ; i++) {
    try { return fs.renameSync(da, a); } catch (e) {
      if (i >= TENTATIVI_RINOMINA - 1 || !OCCUPATO.has(e.code)) throw e;
      ritento(e);
      dormiSync(attesaMs(i));
    }
  }
}

async function rinomina(da, a) {
  for (let i = 0; ; i++) {
    try { return await fsp.rename(da, a); } catch (e) {
      if (i >= TENTATIVI_RINOMINA - 1 || !OCCUPATO.has(e.code)) throw e;
      ritento(e);
      await dorme(attesaMs(i));
    }
  }
}

// Se qualcosa fallisce lancia, e `target` resta com'era. `mode` vale a ogni scrittura, non solo alla prima.
function scriviSync(target, dati, { mode } = {}) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = nomeTemporaneo(target);
  try {
    const fd = fs.openSync(tmp, 'w', mode);
    try {
      fs.writeFileSync(fd, comeBuffer(dati));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    rinominaSync(tmp, target);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) {}
    throw e;
  }
  sincronizzaCartellaSync(dir);
  return true;
}

// Come scriviSync. `primaDiRinominare()` che torna false scarta la scrittura (ne è già arrivata una più nuova) e dà false.
async function scrivi(target, dati, { mode, primaDiRinominare } = {}) {
  const dir = path.dirname(target);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = nomeTemporaneo(target);
  try {
    const fh = await fsp.open(tmp, 'w', mode);
    try {
      await fh.writeFile(comeBuffer(dati));
      await fh.sync();
    } finally { await fh.close(); }
    if (primaDiRinominare && primaDiRinominare() === false) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      return false;
    }
    await rinomina(tmp, target);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  await sincronizzaCartella(dir);
  return true;
}

// null solo se il file non c'è; un errore che resta dopo i tentativi si lancia: chi legge non deve sovrascrivere.
function leggiSync(target) {
  for (let i = 0; ; i++) {
    try { return fs.readFileSync(target); } catch (e) {
      if (e.code === 'ENOENT') return null;
      if (i >= TENTATIVI_LETTURA - 1) throw e;
      dormiSync(attesaMs(i));
    }
  }
}

async function leggi(target) {
  for (let i = 0; ; i++) {
    try { return await fsp.readFile(target); } catch (e) {
      if (e.code === 'ENOENT') return null;
      if (i >= TENTATIVI_LETTURA - 1) throw e;
      await dorme(attesaMs(i));
    }
  }
}

// Set-Content -Encoding utf8 di PowerShell 5.1 mette un BOM davanti, e JSON.parse lo rifiuta.
function togliBom(testo) {
  const s = String(testo);
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

// Due punti e punto non vanno in un nome di file su Windows.
function nomeRovinato(target, quando = new Date()) {
  return `${target}.rovinato-${quando.toISOString().replace(/[:.]/g, '-')}`;
}

// Un file che non si capisce si sposta accanto, intatto, invece di finire sotto la prossima scrittura. Torna il percorso nuovo.
async function mettiDaParte(target) {
  const dest = nomeRovinato(target);
  await rinomina(target, dest);
  return dest;
}

function mettiDaParteSync(target) {
  const dest = nomeRovinato(target);
  rinominaSync(target, dest);
  return dest;
}

// I temporanei lasciati da un arresto a metà scrittura (il file vero non l'hanno toccato), anche quelli delle sue
// copie accanto (`storage.json.bak`): nessun altro li guarda, e ogni arresto ne lascerebbe uno grande quanto il file.
async function togliTemporanei(target) {
  const dir = path.dirname(target);
  const base = path.basename(target);
  let nomi = [];
  try { nomi = await fsp.readdir(dir); } catch (_) { return 0; }
  let tolti = 0;
  for (const n of nomi) {
    if (!n.startsWith(base)) continue;
    const resto = n.slice(base.length);
    // `.tmp` nudo è il nome delle versioni prima di #1087; quelli di questo processo possono essere scritture in volo.
    const m = /^(?:\.[A-Za-z0-9-]+)?\.tmp-(\d+)-\d+$/.exec(resto);
    if (resto !== '.tmp' && (!m || Number(m[1]) === process.pid)) continue;
    try { await fsp.rm(path.join(dir, n), { force: true }); tolti++; } catch (_) {}
  }
  return tolti;
}

// Per chi legge un file a ogni domanda (le credenziali): la pulizia basta una volta per avvio.
const ripuliti = new Set();
function togliTemporaneiUnaVolta(target) {
  if (ripuliti.has(target)) return;
  ripuliti.add(target);
  togliTemporanei(target).catch(() => {});
}

module.exports = {
  scriviSync, scrivi, leggiSync, leggi, togliBom, mettiDaParte, mettiDaParteSync, togliTemporanei, togliTemporaneiUnaVolta, nomeRovinato,
  OCCUPATO, TENTATIVI_RINOMINA, ritentiRinomina,
};
