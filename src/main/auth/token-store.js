// Persistenza cifrata dei token di sessione (vedi Filo/SECURITY.md §2).
//
// I token NON vanno mai in chiaro su disco né in localStorage. Usiamo
// `safeStorage` di Electron, che cifra con le API del sistema operativo
// (DPAPI su Windows, Keychain su macOS, libsecret su Linux). Il blob cifrato
// vive in userData/auth.bin. Se la cifratura OS non è disponibile, NON
// scriviamo in chiaro: rinunciamo alla persistenza (l'utente rifarà il login).

// Niente require('electron') a livello di modulo: questo file viene richiesto
// (transitivamente, via google-auth → defaultsStore/supportModelsStore) anche
// dagli unit test node:test che girano fuori da Electron. `app`/`safeStorage`
// servono solo dentro le funzioni, quindi si richiedono lazy lì.
const fs = require('node:fs');
const path = require('node:path');

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
  if (!canEncrypt()) {
    console.warn('[auth] safeStorage non disponibile: sessione non persistita su disco');
    return false;
  }
  try {
    const { safeStorage } = require('electron');
    const enc = safeStorage.encryptString(JSON.stringify(session));
    fs.writeFileSync(filePath(), enc, { mode: 0o600 });
    return true;
  } catch (e) {
    console.error('[auth] salvataggio sessione fallito:', e?.message || e);
    return false;
  }
}

// Carica la sessione cifrata, o null se assente/illeggibile.
function load() {
  if (!canEncrypt()) return null;
  let raw;
  try {
    raw = fs.readFileSync(filePath());
  } catch (_) {
    return null; // file assente = non loggato
  }
  try {
    const json = safeStorage.decryptString(raw);
    return JSON.parse(json);
  } catch (e) {
    // Blob corrotto o cifrato con un'altra chiave OS (es. altro utente):
    // trattalo come "non loggato" e ripulisci.
    console.warn('[auth] sessione illeggibile, la elimino:', e?.message || e);
    clear();
    return null;
  }
}

function clear() {
  try {
    fs.rmSync(filePath(), { force: true });
  } catch (_) {}
}

module.exports = { save, load, clear, canEncrypt };
