// Estrae un pacchetto .zip o .tar.gz in una cartella, senza programmi esterni (tar e unzip non ci sono ovunque).
// Non esce mai dalla cartella di destinazione e non crea collegamenti; un archivio fuori dai tetti si rifiuta col numero.
// Il contenuto è già stato verificato con l'impronta: qui si difende solo il disco da un archivio malformato.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const inflateRaw = promisify(zlib.inflateRaw);
const gunzip = promisify(zlib.gunzip);

// Il pacchetto vero pesa 100-150 MB estratto, con una decina di file: i tetti stanno larghi di un ordine di grandezza.
const TETTO_BYTE = 2 * 1024 * 1024 * 1024;
const TETTO_VOCI = 10000;

class ErroreArchivio extends Error {
  constructor(messaggio) { super(messaggio); this.codice = 'archivio'; }
}

/** Il percorso dentro `dest` per il nome di una voce, o null se la voce vorrebbe uscirne. */
function dentro(dest, nome) {
  const pulito = String(nome).replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!pulito || pulito.includes('\u0000')) return null;
  if (pulito.startsWith('/') || /^[a-zA-Z]:/.test(pulito)) return null;
  const pezzi = pulito.split('/').filter((x) => x && x !== '.');
  if (!pezzi.length || pezzi.some((x) => x === '..')) return null;
  const pieno = path.resolve(dest, ...pezzi);
  const radice = path.resolve(dest);
  if (pieno !== radice && !pieno.startsWith(radice + path.sep)) return null;
  return pieno;
}

function conta(stato, byte) {
  stato.voci += 1;
  stato.byte += byte;
  if (stato.voci > TETTO_VOCI) throw new ErroreArchivio(`l'archivio ha più di ${TETTO_VOCI} voci`);
  if (stato.byte > TETTO_BYTE) throw new ErroreArchivio(`l'archivio estratto supera ${Math.round(TETTO_BYTE / 1048576)} MB`);
}

async function scriviVoce(dest, nome, dati, modo, stato) {
  const p = dentro(dest, nome);
  if (!p) throw new ErroreArchivio(`voce con un percorso non ammesso: ${String(nome).slice(0, 120)}`);
  conta(stato, dati.length);
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, dati);
  // Su Windows i permessi Unix non esistono (chmod lì tocca solo la sola lettura); altrove l'eseguibile resta eseguibile.
  if (process.platform !== 'win32') await fs.promises.chmod(p, (modo & 0o111) ? 0o755 : 0o644);
}

async function creaCartella(dest, nome, stato) {
  const p = dentro(dest, nome);
  if (!p) throw new ErroreArchivio(`cartella con un percorso non ammesso: ${String(nome).slice(0, 120)}`);
  conta(stato, 0);
  await fs.promises.mkdir(p, { recursive: true });
}

async function estraiZip(buf, dest, stato) {
  let fine = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fine = i; break; }
  }
  if (fine < 0) throw new ErroreArchivio('non è un archivio zip');
  const voci = buf.readUInt16LE(fine + 10);
  let p = buf.readUInt32LE(fine + 16);
  if (voci === 0xffff || p === 0xffffffff) throw new ErroreArchivio('archivio zip64, non previsto');
  for (let n = 0; n < voci; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ErroreArchivio('indice dello zip rovinato');
    const flag = buf.readUInt16LE(p + 8);
    const metodo = buf.readUInt16LE(p + 10);
    const compressi = buf.readUInt32LE(p + 20);
    const interi = buf.readUInt32LE(p + 24);
    const lNome = buf.readUInt16LE(p + 28);
    const lExtra = buf.readUInt16LE(p + 30);
    const lCommento = buf.readUInt16LE(p + 32);
    const fattoDa = buf.readUInt16LE(p + 4) >> 8;
    const attributi = buf.readUInt32LE(p + 38);
    const locale = buf.readUInt32LE(p + 42);
    const nome = buf.slice(p + 46, p + 46 + lNome).toString((flag & 0x800) ? 'utf8' : 'latin1');
    p += 46 + lNome + lExtra + lCommento;
    if (compressi === 0xffffffff || interi === 0xffffffff) throw new ErroreArchivio('archivio zip64, non previsto');
    if (flag & 0x1) throw new ErroreArchivio('archivio zip cifrato');
    // Su Unix (fattoDa 3) i bit alti degli attributi sono il modo: un collegamento non si crea.
    const modo = fattoDa === 3 ? (attributi >>> 16) : 0;
    if (fattoDa === 3 && (modo & 0o170000) === 0o120000) throw new ErroreArchivio(`collegamento non ammesso: ${nome.slice(0, 120)}`);
    if (nome.endsWith('/') || nome.endsWith('\\')) { await creaCartella(dest, nome, stato); continue; }
    if (locale + 30 > buf.length || buf.readUInt32LE(locale) !== 0x04034b50) throw new ErroreArchivio('voce dello zip rovinata');
    const inizio = locale + 30 + buf.readUInt16LE(locale + 26) + buf.readUInt16LE(locale + 28);
    if (inizio + compressi > buf.length) throw new ErroreArchivio('voce dello zip tagliata');
    const grezzi = buf.slice(inizio, inizio + compressi);
    let dati;
    if (metodo === 0) dati = grezzi;
    else if (metodo === 8) dati = await inflateRaw(grezzi, { maxOutputLength: Math.max(1, interi) });
    else throw new ErroreArchivio(`compressione ${metodo} non prevista`);
    if (dati.length !== interi) throw new ErroreArchivio(`voce dello zip di lunghezza sbagliata: ${nome.slice(0, 120)}`);
    await scriviVoce(dest, nome, dati, modo || 0o644, stato);
  }
}

function ottale(buf, da, lungo) {
  // Base 256 (bit alto acceso) per le dimensioni oltre gli 8 GB: qui non servono, quindi si rifiutano.
  if (buf[da] & 0x80) throw new ErroreArchivio('voce del tar troppo grande');
  const s = buf.slice(da, da + lungo).toString('latin1').replace(/\u0000.*$/, '').trim();
  if (!s) return 0;
  if (!/^[0-7]+$/.test(s)) throw new ErroreArchivio('intestazione del tar rovinata');
  return parseInt(s, 8);
}

function testo(buf, da, lungo) {
  return buf.slice(da, da + lungo).toString('utf8').replace(/\u0000.*$/s, '');
}

function campiPax(buf) {
  const out = {};
  let i = 0;
  const s = buf.toString('utf8');
  while (i < s.length) {
    const spazio = s.indexOf(' ', i);
    if (spazio < 0) break;
    const lungo = parseInt(s.slice(i, spazio), 10);
    if (!(lungo > 0)) break;
    const riga = s.slice(spazio + 1, i + lungo - 1);
    const uguale = riga.indexOf('=');
    if (uguale > 0) out[riga.slice(0, uguale)] = riga.slice(uguale + 1);
    i += lungo;
  }
  return out;
}

async function estraiTar(buf, dest, stato) {
  let p = 0;
  let nomeLungo = null;
  let pax = {};
  while (p + 512 <= buf.length) {
    const h = buf.slice(p, p + 512);
    if (h.every((b) => b === 0)) break;
    let somma = 0;
    for (let i = 0; i < 512; i++) somma += (i >= 148 && i < 156) ? 32 : h[i];
    if (somma !== ottale(h, 148, 8)) throw new ErroreArchivio('intestazione del tar rovinata');
    const tipo = String.fromCharCode(h[156] || 48);
    const misura = ottale(h, 124, 12);
    const modo = ottale(h, 100, 8);
    // Solo il formato POSIX ha il prefisso del nome a 345: nel GNU lì ci sono le date.
    const prefisso = h.slice(257, 263).toString('latin1') === 'ustar\u0000' ? testo(h, 345, 155) : '';
    let nome = (prefisso ? `${prefisso}/` : '') + testo(h, 0, 100);
    const dati = buf.slice(p + 512, p + 512 + misura);
    if (dati.length !== misura) throw new ErroreArchivio('voce del tar tagliata');
    p += 512 + Math.ceil(misura / 512) * 512;
    if (tipo === 'L') { nomeLungo = dati.toString('utf8').replace(/\u0000.*$/s, ''); continue; }
    if (tipo === 'x') { pax = campiPax(dati); continue; }
    if (tipo === 'g') continue;
    if (pax.path) nome = pax.path;
    else if (nomeLungo) nome = nomeLungo;
    nomeLungo = null;
    pax = {};
    if (tipo === '0' || tipo === '\u0000' || tipo === '7') await scriviVoce(dest, nome, dati, modo, stato);
    else if (tipo === '5') await creaCartella(dest, nome, stato);
    else if (tipo === '1' || tipo === '2') throw new ErroreArchivio(`collegamento non ammesso: ${nome.slice(0, 120)}`);
    else throw new ErroreArchivio(`voce del tar di tipo ${JSON.stringify(tipo)} non prevista`);
  }
}

/** Estrae `file` (formato 'zip' o 'tar.gz') dentro `dest`, che deve esistere. → { voci, byte } */
async function estrai(file, formato, dest) {
  const stato = { voci: 0, byte: 0 };
  const buf = await fs.promises.readFile(file);
  if (formato === 'zip') await estraiZip(buf, dest, stato);
  else if (formato === 'tar.gz') {
    let tar;
    try { tar = await gunzip(buf, { maxOutputLength: TETTO_BYTE }); } catch (e) { throw new ErroreArchivio(`gzip illeggibile (${e.code || e.message})`); }
    await estraiTar(tar, dest, stato);
  } else throw new ErroreArchivio(`formato ${formato} non previsto`);
  return stato;
}

module.exports = { estrai, dentro, ErroreArchivio, TETTO_BYTE, TETTO_VOCI };
