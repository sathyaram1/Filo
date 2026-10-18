// La chiave OpenRouter personale dell'installazione (#598), cifrata con safeStorage in un file suo e mai in chiaro:
// non sta in settings.apiKeys perché non si scrive né si legge nelle Opzioni. Senza cifratura del sistema resta solo
// in memoria. Scritture atomiche (#1087); l'ultimo stato letto dal server sta in un file a parte.

const fs = require('node:fs');
const path = require('node:path');
const guasti = require('./guastiAccesso');
const Disco = require('../services/scritturaAtomica');

let cache = undefined; // undefined = non ancora letto; null = assente
// L'ultimo stato letto dal server sta in un file suo: si riscrive a ogni lettura del saldo, la chiave no (#1087).
let stato = undefined;
// Le versioni prima di #1087 lo tenevano dentro wallet.bin: vale finché non arriva una lettura nuova.
let statoNellaChiave = null;

function filePath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'wallet.bin');
}

function fileStato() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'wallet-stato.bin');
}

function canEncrypt() {
  try { return require('electron').safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
}

// undefined se il disco non ha risposto (si riprova alla prossima domanda: non è «non c'è»), null se manca o non si decifra.
function leggiCifrato(file) {
  Disco.togliTemporaneiUnaVolta(file);
  let raw;
  try { raw = Disco.leggiSync(file); } catch (e) {
    console.warn('[wallet] file non letto:', path.basename(file), e?.message || e);
    return undefined;
  }
  if (!raw) return null;
  try { return JSON.parse(require('electron').safeStorage.decryptString(raw)); } catch (_) { return null; }
}

// { key, pseudonym, redeemedAt }
function load() {
  if (cache !== undefined) return cache;
  if (!canEncrypt()) { cache = null; return null; }
  const j = leggiCifrato(filePath());
  if (j === undefined) return null;
  cache = j && typeof j.key === 'string' && j.key ? { key: j.key, pseudonym: j.pseudonym || '', redeemedAt: j.redeemedAt || '' } : null;
  if (cache && j.lastServer) statoNellaChiave = j.lastServer;
  return cache;
}

// Questa chiave è l'unica di chi entra con un invito, e non passa dalle
// impostazioni: senza questo avviso chi tiene il conto di «Filo può rispondere»
// resta fermo su com'era prima del riscatto, e le home aperte con lui (#663).
function avvisaProntezza() {
  try { globalThis.SN_PRONTEZZA_CAMBIATA?.(); } catch (_) {}
}

function save(wallet) {
  if (!wallet || !wallet.key) return false;
  cache = { key: wallet.key, pseudonym: wallet.pseudonym || '', redeemedAt: wallet.redeemedAt || new Date().toISOString() };
  // Da qui Filo ha di che rispondere, anche se la scrittura su disco fallisce:
  // la chiave in memoria basta per tutta la sessione.
  avvisaProntezza();
  if (!canEncrypt()) {
    console.warn('[wallet] safeStorage non disponibile: chiave personale tenuta solo in memoria');
    return false;
  }
  try {
    const { safeStorage } = require('electron');
    Disco.scriviSync(filePath(), safeStorage.encryptString(JSON.stringify(cache)), { mode: 0o600 });
    return true;
  } catch (e) {
    console.error('[wallet] salvataggio chiave personale fallito:', e?.message || e);
    return false;
  }
}

// Ricominciare con un'identità nuova (scelta confermata dall'utente) toglie il portafoglio da questa
// copia di Filo, ma il file resta accanto: chiave e crediti di prima non si buttano mai (#1085).
function metteDaParte() {
  cache = null;
  stato = null;
  statoNellaChiave = null;
  try { guasti.metteDaParte(filePath(), 'prev'); } catch (_) {}
  try { fs.rmSync(fileStato(), { force: true }); } catch (_) {}
  avvisaProntezza();
}

// C'è un portafoglio su disco, anche se adesso non si decifra: allora l'identità che lo regge non si
// sostituisce in silenzio.
function suDisco() {
  try { return fs.existsSync(filePath()); } catch (_) { return false; }
}

// La sola chiave, o '' se non c'è. È quello che withDefaults chiede.
function personalKey() {
  const w = load();
  return w ? w.key : '';
}

function pseudonym() {
  const w = load();
  return w ? (w.pseudonym || '') : '';
}

// L'ultimo stato letto dal server (saldo, codici, quota): serve quando il server non risponde, per non mostrare
// a chi ha già i crediti il campo dell'invito e un saldo locale che non compra niente.
function saveLastServer(server) {
  if (!load()) return false;
  stato = server || null;
  if (!canEncrypt()) return false;
  try {
    const { safeStorage } = require('electron');
    Disco.scriviSync(fileStato(), safeStorage.encryptString(JSON.stringify(stato)), { mode: 0o600 });
    return true;
  } catch (e) {
    console.error('[wallet] ultimo stato non salvato:', e?.message || e);
    return false;
  }
}

function lastServer() {
  if (!load()) return null;
  if (stato === undefined) stato = canEncrypt() ? leggiCifrato(fileStato()) : null;
  return stato || statoNellaChiave || null;
}

module.exports = { load, save, metteDaParte, suDisco, personalKey, pseudonym, saveLastServer, lastServer };
