// Persistenza cifrata dei token di sessione (vedi Filo/SECURITY.md §2).
//
// I token NON vanno mai in chiaro su disco né in localStorage. Usiamo
// `safeStorage` di Electron, che cifra con le API del sistema operativo
// (DPAPI su Windows, Keychain su macOS, libsecret su Linux). Il blob cifrato
// vive in userData/auth.bin. Se la cifratura OS non è disponibile, NON
// scriviamo in chiaro: rinunciamo alla persistenza fra un avvio e l'altro.

// electron si richiede dentro le funzioni: gli unit test girano fuori da Electron.
const fs = require('node:fs');
const path = require('node:path');
const guasti = require('./guastiAccesso');
const Disco = require('../services/scritturaAtomica');

// La sessione dell'avvio in corso. Senza cifratura del sistema il disco resta
// vuoto, ma salvare e poi rileggere `null` nello stesso processo farebbe
// credere a chi legge che il login non sia mai avvenuto (#708): la rinuncia è
// alla PERSISTENZA fra un avvio e l'altro, non alla sessione.
let inMemoria = null;

function filePath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'auth.bin');
}

function canEncrypt() {
  try {
    const { safeStorage } = require('electron');
    return safeStorage.isEncryptionAvailable();
  } catch (_) {
    return false;
  }
}

// Salva l'oggetto sessione (token + profilo) cifrato. Ritorna true se persistito.
function save(session) {
  if (!session) return false;
  inMemoria = session;
  if (!canEncrypt()) {
    console.warn('[auth] safeStorage non disponibile: sessione non persistita su disco');
    return false;
  }
  try {
    const { safeStorage } = require('electron');
    const enc = safeStorage.encryptString(JSON.stringify(session));
    Disco.scriviSync(filePath(), enc, { mode: 0o600 });
    return true;
  } catch (e) {
    console.error('[auth] salvataggio sessione fallito:', e?.message || e);
    return false;
  }
}

function decifraDati(raw) {
  try {
    const { safeStorage } = require('electron');
    const j = JSON.parse(safeStorage.decryptString(raw));
    return j && j.refreshToken ? j : null;
  } catch (_) { return null; }
}

function decifra(file) {
  try { return decifraDati(fs.readFileSync(file)); } catch (_) { return null; }
}

// Carica la sessione cifrata, o null se assente/illeggibile.
function load() {
  if (!canEncrypt()) return inMemoria;
  const file = filePath();
  Disco.togliTemporaneiUnaVolta(file);
  let raw;
  try {
    raw = Disco.leggiSync(file);
  } catch (e) {
    // Il disco che non risponde non dice niente sul file: niente da mettere da parte.
    console.warn('[auth] sessione non letta dal disco:', e?.message || e);
    return inMemoria;
  }
  if (raw) {
    const dati = decifraDati(raw);
    if (dati) return dati;
    // Blob corrotto o cifrato con un'altra chiave OS (portachiavi diverso, profilo ricreato): il file
    // resta da parte, perché quella chiave può tornare (#1085).
    console.warn('[auth] sessione illeggibile, la metto da parte');
    inMemoria = null;
    guasti.metteDaParte(file, 'illeggibile-' + guasti.timbro());
  }
  // Salvata solo per questo avvio, o una copia messa da parte che con la chiave di adesso si legge.
  return inMemoria || guasti.riprendiDaParte(file, 'illeggibile-', decifra);
}

function clear() {
  inMemoria = null;
  try {
    fs.rmSync(filePath(), { force: true });
    guasti.togliDaParte(filePath(), 'illeggibile-');
  } catch (_) {}
}

module.exports = { save, load, clear, canEncrypt };
