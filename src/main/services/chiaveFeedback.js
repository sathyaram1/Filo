// La chiave privata dei feedback dell'owner: da dove si prende, e come si carica da un file per custodirla cifrata
// col portachiavi del sistema nella cartella dati. Mai in chiaro su disco, mai al renderer: fuori escono solo stato
// ed esiti. Prove: tests/gestione-chiave-feedback.spec.mjs.

const fs = require('node:fs');
const path = require('node:path');
const Disco = require('./scritturaAtomica');
const { consiglioPortachiavi } = require('../portachiavi');

const VARIABILE = 'FILO_FEEDBACK_PRIVKEY';
const NOME_FILE = 'chiave-feedback.bin';
// Una chiave pesa poche centinaia di byte e un .env pochi KB: un file più grosso è stato scelto per sbaglio, e
// provarne ogni stringa costerebbe secondi.
const TETTO_FILE = 256 * 1024;

let memoria; // undefined: da leggere; null: nessuna chiave custodita

function fileCustodito() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), NOME_FILE);
}

// Il .env degli strumenti di sviluppo: sta nel checkout, mai nel pacchetto. Le prove lo spostano da qui.
function fileDiSviluppo() {
  return path.join(__dirname, '..', '..', '..', 'tests', 'agent', '.env');
}

function backendDiRipiego(safeStorage) {
  if (process.platform !== 'linux') return false;
  // Senza portachiavi Chromium cifra con una chiave scritta nel suo codice: vale quanto il chiaro.
  try { return safeStorage.getSelectedStorageBackend?.() === 'basic_text'; } catch (_) { return false; }
}

function portachiavi() {
  try {
    const { safeStorage } = require('electron');
    if (!safeStorage.isEncryptionAvailable() || backendDiRipiego(safeStorage)) return null;
    return safeStorage;
  } catch (_) { return null; }
}

function motivoSenzaPortachiavi() {
  let backend = '';
  try { backend = require('electron').safeStorage.getSelectedStorageBackend?.() || ''; } catch (_) {}
  const consiglio = consiglioPortachiavi({ platform: process.platform, backend, perChe: 'Per caricarla' });
  const base = 'Questo computer non ha un portachiavi di sistema dove custodire la chiave dei feedback, e in chiaro Filo non la salva.';
  return consiglio ? `${base} ${consiglio}` : base;
}

function rigaVariabile(testo) {
  for (const riga of String(testo || '').split(/\r?\n/)) {
    const m = riga.match(/^\s*(?:export\s+)?FILO_FEEDBACK_PRIVKEY\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim() || null;
  }
  return null;
}

function custodita() {
  if (memoria !== undefined) return memoria;
  const ss = portachiavi();
  if (!ss) return null;
  const file = fileCustodito();
  Disco.togliTemporaneiUnaVolta(file);
  let raw;
  try { raw = Disco.leggiSync(file); } catch (e) {
    // Un disco che non risponde non vuol dire «non c'è»: si riprova alla prossima domanda.
    console.warn('[chiave feedback] file non letto:', e?.message || e);
    return null;
  }
  if (!raw) { memoria = null; return null; }
  try { memoria = String(ss.decryptString(raw) || '').trim() || null; } catch (e) {
    console.warn('[chiave feedback] la chiave custodita non si decifra:', e?.message || e);
    memoria = null;
  }
  return memoria;
}

function daSviluppo() {
  try {
    const f = module.exports.fileDiSviluppo();
    if (!f || !fs.existsSync(f)) return null;
    return rigaVariabile(fs.readFileSync(f, 'utf8'));
  } catch (_) { return null; }
}

// L'ambiente vince: è la scelta esplicita di chi lancia Filo. Poi quella custodita, che l'owner ha scelto ed è
// stata provata contro la chiave pubblica; il .env di sviluppo per ultimo.
function leggiConFonte() {
  const env = String(process.env[VARIABILE] || '').trim();
  if (env) return { chiave: env, fonte: 'ambiente' };
  const c = custodita();
  if (c) return { chiave: c, fonte: 'custodita' };
  const d = daSviluppo();
  if (d) return { chiave: d, fonte: 'sviluppo' };
  return { chiave: null, fonte: '' };
}

function leggi() {
  return leggiConFonte().chiave;
}

function stato() {
  const { fonte } = leggiConFonte();
  const custodibile = !!portachiavi();
  return {
    configurata: !!fonte, fonte, custodibile,
    // Una copia custodita c'è anche quando la variabile d'ambiente la scavalca: si deve poter togliere.
    custodita: !!custodita(),
    ...(custodibile ? {} : { motivo: motivoSenzaPortachiavi() }),
  };
}

// Le forme in cui l'owner può avere la chiave: la riga del .env, un blocco PEM, la stringa da sola o dentro
// l'uscita di gen-feedback-keys. Decide la prova contro la chiave pubblica, non la forma.
function candidate(testo) {
  const s = String(testo || '');
  const out = [];
  const riga = rigaVariabile(s);
  if (riga) out.push(riga);
  for (const m of s.matchAll(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/g)) out.push(m[1].replace(/\s+/g, ''));
  for (const m of s.matchAll(/[A-Za-z0-9+/_-]{100,}={0,2}/g)) out.push(m[0]);
  return [...new Set(out)];
}

// Su Windows `>` di PowerShell 5.1 e il Blocco note in «Unicode» scrivono UTF-16: letto come UTF-8, la chiave
// sparirebbe fra i NUL.
function comeTesto(buf) {
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xFE && buf[1] === 0xFF) return Buffer.from(buf.subarray(2, buf.length - (buf.length % 2))).swap16().toString('utf16le');
  return buf.toString('utf8').replace(/^﻿/, '');
}

async function apreIFeedback(chiave) {
  const C = globalThis.SN_FEEDBACK_CRYPTO;
  if (!C || !C.hasPublicKey()) return false;
  try {
    const prova = await C.encryptForOwner('filo');
    return (await C.decrypt(prova, chiave)) === 'filo';
  } catch (_) { return false; }
}

async function caricaDaFile(percorso) {
  const ss = portachiavi();
  if (!ss) return { ok: false, error: motivoSenzaPortachiavi() };
  let testo;
  try {
    const st = fs.statSync(percorso);
    if (!st.isFile()) return { ok: false, error: 'Quello scelto non è un file. Scegli il file con la chiave.' };
    if (st.size > TETTO_FILE) {
      return { ok: false, error: `Il file scelto pesa ${Math.round(st.size / 1024)} KB, quello di una chiave meno di uno. Scegli il file con la chiave.` };
    }
    testo = comeTesto(fs.readFileSync(percorso));
  } catch (e) {
    return { ok: false, error: `Il file scelto non si apre (${e?.code || e?.message || e}).` };
  }
  const lista = candidate(testo);
  if (!lista.length) return { ok: false, error: 'In questo file non c\'è una chiave privata dei feedback.' };
  let buona = null;
  for (const c of lista) {
    // eslint-disable-next-line no-await-in-loop
    if (await apreIFeedback(c)) { buona = c; break; }
  }
  if (!buona) {
    return { ok: false, error: 'La chiave di questo file non apre i feedback di Filo. Forse è di un\'altra coppia, o è una vecchia.' };
  }
  try {
    Disco.scriviSync(fileCustodito(), ss.encryptString(buona), { mode: 0o600 });
  } catch (e) {
    console.error('[chiave feedback] salvataggio fallito:', e?.message || e);
    return { ok: false, error: 'Non riesco a scrivere la chiave nella cartella dati di Filo. Riprova.' };
  }
  memoria = buona;
  return { ok: true };
}

function dimentica() {
  try { fs.rmSync(fileCustodito(), { force: true }); } catch (e) {
    return { ok: false, error: `Non riesco a togliere la chiave da questo computer (${e?.code || e?.message || e}).` };
  }
  memoria = null;
  return { ok: true };
}

module.exports = { leggi, stato, caricaDaFile, dimentica, fileDiSviluppo };
