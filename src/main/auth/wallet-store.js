// La chiave OpenRouter PERSONALE dell'installazione, cifrata a riposo
// (feedback #598).
//
// È la chiave che il server crea al riscatto di un invito: il suo tetto di
// spesa sono i crediti dell'utente. Vive qui e non in settings.apiKeys: le
// chiavi in settings sono quelle che l'utente scrive e legge nelle Opzioni,
// questa non deve comparire lì (non si modifica a mano, e mostrarla
// inviterebbe a copiarla altrove). Stesso schema di token-store.js:
// safeStorage, file suo, mai in chiaro su disco. Senza cifratura OS non si
// persiste: al prossimo avvio la pagina Crediti dirà che manca e si potrà
// chiedere di nuovo al server (il portafoglio non si perde, la chiave sì:
// vedi walletRecover... no — la chiave compare una volta sola: in quel caso
// l'utente vede il messaggio e il server può emetterne un'altra su richiesta
// dell'owner). In pratica su Windows e Mac la cifratura c'è sempre.

const fs = require('node:fs');
const path = require('node:path');

let cache = undefined; // undefined = non ancora letto; null = assente

function filePath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'wallet.bin');
}

function canEncrypt() {
  try { return require('electron').safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
}

// { key, pseudonym, redeemedAt }
function load() {
  if (cache !== undefined) return cache;
  cache = null;
  if (!canEncrypt()) return null;
  try {
    const { safeStorage } = require('electron');
    const raw = fs.readFileSync(filePath());
    const j = JSON.parse(safeStorage.decryptString(raw));
    if (j && typeof j.key === 'string' && j.key) cache = j;
  } catch (_) { cache = null; }
  return cache;
}

function save(wallet) {
  if (!wallet || !wallet.key) return false;
  cache = {
    key: wallet.key, pseudonym: wallet.pseudonym || '', redeemedAt: wallet.redeemedAt || new Date().toISOString(),
    // L'ultimo stato letto dal server (saldo, codici, quota): serve quando il
    // server non risponde, per non mostrare a chi ha già i crediti il campo
    // dell'invito e un saldo locale che non compra niente.
    lastServer: wallet.lastServer || (cache && cache.lastServer) || null,
  };
  if (!canEncrypt()) {
    console.warn('[wallet] safeStorage non disponibile: chiave personale tenuta solo in memoria');
    return false;
  }
  try {
    const { safeStorage } = require('electron');
    fs.writeFileSync(filePath(), safeStorage.encryptString(JSON.stringify(cache)), { mode: 0o600 });
    return true;
  } catch (e) {
    console.error('[wallet] salvataggio chiave personale fallito:', e?.message || e);
    return false;
  }
}

function clear() {
  cache = null;
  try { fs.rmSync(filePath(), { force: true }); } catch (_) {}
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

function saveLastServer(server) {
  const w = load();
  if (!w) return false;
  return save({ ...w, lastServer: server });
}

function lastServer() {
  const w = load();
  return w && w.lastServer ? w.lastServer : null;
}

module.exports = { load, save, clear, personalKey, pseudonym, saveLastServer, lastServer };
