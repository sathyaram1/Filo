// Estrae un pacchetto .zip o .tar.gz in una cartella, rifiutando tutto ciò che uscirebbe da lì (percorsi assoluti,
// «..», collegamenti) e ogni voce rotta: un pacchetto a metà non si installa. Regole: tests/unit/archivioAltreApp.test.mjs.

const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const inflateRaw = promisify(zlib.inflateRaw);
const gunzip = promisify(zlib.gunzip);

class ErroreArchivio extends Error {
  constructor(messaggio) { super(messaggio); this.codice = 'archivio'; }
}

// Il nome di una voce, ripulito: null se non sta dentro la cartella di destinazione.
function percorsoSicuro(nome) {
  const n = String(nome || '').replace(/\\/g, '/');
  if (!n || n.includes('\u0000')) return null;
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return null;
  const parti = n.split('/').filter((p) => p && p !== '.');
  if (!parti.length || parti.some((p) => p === '..')) return null;
  return parti.join('/');
}

function dentro(radice, relativo) {
  const assoluto = path.resolve(radice, ...relativo.split('/'));
  const r = path.resolve(radice);
  return assoluto === r || assoluto.startsWith(r + path.sep) ? assoluto : null;
}

async function scriviVoce(radice, nome, dati, modo) {
  const rel = percorsoSicuro(nome);
  if (!rel) throw new ErroreArchivio(`Il pacchetto contiene un percorso non ammesso: ${String(nome).slice(0, 120)}`);
  const dest = dentro(radice, rel);
  if (!dest) throw new ErroreArchivio(`Il pacchetto contiene un percorso non ammesso: ${rel}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, dati, { mode: modo });
}

async function creaCartella(radice, nome) {
  const rel = percorsoSicuro(nome);
  if (!rel) return;
  const dest = dentro(radice, rel);
  if (dest) await fs.mkdir(dest, { recursive: true });
}

async function estraiZip(buf, radice) {
  if (buf.length < 22) throw new ErroreArchivio('Il pacchetto non è un archivio zip.');
  let eocd = -1;
  for (let i = buf.length - 22, min = Math.max(0, buf.length - 22 - 0xFFFF); i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ErroreArchivio('Il pacchetto non è un archivio zip.');
  const voci = buf.readUInt16LE(eocd + 10);
  const inizio = buf.readUInt32LE(eocd + 16);
  if (inizio === 0xFFFFFFFF) throw new ErroreArchivio('Il pacchetto usa un formato zip che Filo non legge (zip64).');
  let p = inizio;
  let scritte = 0;
  for (let n = 0; n < voci; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ErroreArchivio('Il pacchetto zip è rovinato (indice).');
    const flag = buf.readUInt16LE(p + 8);
    const metodo = buf.readUInt16LE(p + 10);
    const compresso = buf.readUInt32LE(p + 20);
    const intero = buf.readUInt32LE(p + 24);
    const lNome = buf.readUInt16LE(p + 28);
    const lExtra = buf.readUInt16LE(p + 30);
    const lCommento = buf.readUInt16LE(p + 32);
    const attributi = buf.readUInt32LE(p + 38);
    const offset = buf.readUInt32LE(p + 42);
    const nome = buf.slice(p + 46, p + 46 + lNome).toString('utf8');
    p += 46 + lNome + lExtra + lCommento;
    if (flag & 0x1) throw new ErroreArchivio('Il pacchetto zip è cifrato.');
    const tipoUnix = (attributi >>> 16) & 0o170000;
    if (tipoUnix === 0o120000) throw new ErroreArchivio(`Il pacchetto contiene un collegamento: ${nome.slice(0, 120)}`);
    if (nome.endsWith('/')) { await creaCartella(radice, nome); continue; }
    if (offset + 30 > buf.length || buf.readUInt32LE(offset) !== 0x04034b50) throw new ErroreArchivio('Il pacchetto zip è rovinato (voce).');
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const grezzo = buf.slice(start, start + compresso);
    if (grezzo.length !== compresso) throw new ErroreArchivio('Il pacchetto zip è troncato.');
    let dati;
    if (metodo === 0) dati = grezzo;
    else if (metodo === 8) {
      try { dati = await inflateRaw(grezzo); } catch (_) { throw new ErroreArchivio(`Il pacchetto zip è rovinato: ${nome.slice(0, 120)}`); }
    } else throw new ErroreArchivio(`Il pacchetto zip usa una compressione che Filo non legge (${metodo}).`);
    if (dati.length !== intero) throw new ErroreArchivio(`Il pacchetto zip è rovinato: ${nome.slice(0, 120)}`);
    const permessi = (attributi >>> 16) & 0o777;
    await scriviVoce(radice, nome, dati, permessi ? permessi | 0o600 : 0o644);
    scritte++;
  }
  return scritte;
}

function ottale(buf, da, lung) {
  const s = buf.slice(da, da + lung).toString('latin1').replace(/\u0000.*$/s, '').trim();
  return s ? parseInt(s, 8) : 0;
}
function stringaTar(buf, da, lung) {
  return buf.slice(da, da + lung).toString('utf8').replace(/\u0000.*$/s, '');
}
function paxPercorso(dati) {
  let i = 0;
  const testo = dati.toString('utf8');
  let percorso = null;
  while (i < testo.length) {
    const sp = testo.indexOf(' ', i);
    if (sp < 0) break;
    const lung = parseInt(testo.slice(i, sp), 10);
    if (!(lung > 0)) break;
    const riga = testo.slice(sp + 1, i + lung - 1);
    const eq = riga.indexOf('=');
    if (eq > 0 && riga.slice(0, eq) === 'path') percorso = riga.slice(eq + 1);
    i += lung;
  }
  return percorso;
}

async function estraiTarGz(buf, radice) {
  let tar;
  try { tar = await gunzip(buf); } catch (_) { throw new ErroreArchivio('Il pacchetto non è un archivio .tar.gz leggibile.'); }
  let p = 0;
  let scritte = 0;
  let nomeLungo = null;
  while (p + 512 <= tar.length) {
    const testa = tar.slice(p, p + 512);
    if (testa.every((b) => b === 0)) break;
    const dimensione = ottale(testa, 124, 12);
    const tipo = String.fromCharCode(testa[156] || 48);
    let nome = stringaTar(testa, 0, 100);
    const prefisso = stringaTar(testa, 345, 155);
    if (prefisso && testa.slice(257, 262).toString('latin1') === 'ustar') nome = `${prefisso}/${nome}`;
    const modo = ottale(testa, 100, 8) & 0o777;
    const inizio = p + 512;
    const dati = tar.slice(inizio, inizio + dimensione);
    if (dati.length !== dimensione) throw new ErroreArchivio('Il pacchetto .tar.gz è troncato.');
    p = inizio + Math.ceil(dimensione / 512) * 512;
    if (tipo === 'L') { nomeLungo = dati.toString('utf8').replace(/\u0000.*$/s, ''); continue; }
    if (tipo === 'x') { nomeLungo = paxPercorso(dati) || nomeLungo; continue; }
    if (tipo === 'g') continue;
    if (nomeLungo) { nome = nomeLungo; nomeLungo = null; }
    if (tipo === '5') { await creaCartella(radice, nome); continue; }
    if (tipo === '0' || tipo === '\u0000' || tipo === '7') {
      await scriviVoce(radice, nome, dati, modo ? modo | 0o600 : 0o644);
      scritte++;
      continue;
    }
    throw new ErroreArchivio(`Il pacchetto contiene una voce non ammessa (${tipo === '2' || tipo === '1' ? 'collegamento' : `tipo ${tipo}`}): ${nome.slice(0, 120)}`);
  }
  return scritte;
}

// `nomeFile` decide il formato dall'estensione: è quella dichiarata nel file dei pacchetti, non quella che manda il server.
async function estrai(file, radice, nomeFile = file) {
  const buf = await fs.readFile(file);
  await fs.mkdir(radice, { recursive: true });
  const n = String(nomeFile).toLowerCase();
  const scritte = n.endsWith('.zip') ? await estraiZip(buf, radice)
    : (n.endsWith('.tar.gz') || n.endsWith('.tgz')) ? await estraiTarGz(buf, radice)
      : (() => { throw new ErroreArchivio('Formato del pacchetto sconosciuto.'); })();
  if (!scritte) throw new ErroreArchivio('Il pacchetto è vuoto.');
  return scritte;
}

module.exports = { estrai, percorsoSicuro, ErroreArchivio };
