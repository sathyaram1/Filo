// Handler di dominio: account "Accedi con Google", triage admin dei feedback
// e config condivisa "modelli predefiniti".

const path = require('node:path');
const auth = require('../../auth/google-auth');
const Defaults = require('../defaultsStore');
const { permissionDeniedHelp } = require('../feedbackError');

// ---- Slot chiave privata feedback (S1.3) ----------------------------------------
// La chiave privata non deve MAI uscire dal main process né essere passata al
// renderer. Il main la legge da env FILO_FEEDBACK_PRIVKEY oppure da
// storage.json (campo `feedbackPrivateKey`), in quest'ordine.
//
// DOVE L'OWNER LA METTE
//   - Locale: `FILO_FEEDBACK_PRIVKEY=<base64>` nel file `tests/agent/.env`
//     (gitignorato) oppure come variabile d'ambiente prima di lanciare Filo.
//   - Cloud/routine: passata come env `FILO_FEEDBACK_PRIVKEY` nella config
//     del runner (secrets della routine — NON in chiaro nel prompt).
//   - Alternativa: impostare il campo `feedbackPrivateKey` in storage.json
//     (il file di storage locale, mai nel repo) con il valore base64 della chiave.
//     Lo storage si trova in %APPDATA%/Filo/storage.json (produzione) o nel
//     percorso in $FILO_USER_DATA/storage.json (test).
//
// La chiave viene letta a ogni chiamata (non cachata) per restare aggiornata
// se l'utente la cambia a runtime.
async function getPrivateKey() {
  // 1. Variabile d'ambiente (priorità massima: setting esplicito del runner).
  if (process.env.FILO_FEEDBACK_PRIVKEY) return process.env.FILO_FEEDBACK_PRIVKEY.trim();

  // 2. File .env locale (per comodità in sviluppo; gitignorato).
  try {
    const fs = require('node:fs');
    const envFile = path.join(path.dirname(path.dirname(path.dirname(path.dirname(path.dirname(__dirname))))), 'tests', 'agent', '.env');
    if (fs.existsSync(envFile)) {
      const lines = fs.readFileSync(envFile, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/^FILO_FEEDBACK_PRIVKEY\s*=\s*(.+)$/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (_) {}

  // 3. Storage.json locale (campo feedbackPrivateKey).
  try {
    if (globalThis.SN_STORAGE) {
      const v = await globalThis.SN_STORAGE.getRaw('feedbackPrivateKey', null);
      if (v && typeof v === 'string') return v.trim();
    }
  } catch (_) {}

  return null;
}

// Decifra i campi FENC1: di un oggetto con la chiave privata del main.
// Retrocompatibile: i valori non cifrati passano invariati.
// Senza chiave privata i campi cifrati diventano il placeholder leggibile.
const TEXT_FIELDS_TO_DECRYPT = ['text', 'url', 'name', 'title', 'notes', 'reviewComment'];
const PLACEHOLDER_NO_KEY = '[cifrato — chiave privata non configurata]';

async function decryptFeedbackObject(fields) {
  const C = globalThis.SN_FEEDBACK_CRYPTO;
  if (!C) return fields; // modulo non caricato: passthrough

  const priv = await getPrivateKey();
  const out = { ...fields };
  for (const f of TEXT_FIELDS_TO_DECRYPT) {
    const v = out[f];
    if (!C.isEncrypted(v)) continue; // in chiaro o null: invariato
    if (!priv) { out[f] = PLACEHOLDER_NO_KEY; continue; }
    try {
      out[f] = await C.decrypt(v, priv);
    } catch (e) {
      console.warn(`[auth] decifratura campo "${f}" fallita:`, e?.message || e);
      out[f] = PLACEHOLDER_NO_KEY;
    }
  }
  return out;
}

module.exports = function register(on, ctx) {
  const { MSG, broadcastToTabs } = ctx;

  // I token restano nel main process: qui torniamo solo il profilo pubblico
  // + se l'utente è admin (può triagiare i feedback).
  on(MSG.AUTH_STATUS, async () => (
    { ok: true, signedIn: auth.isSignedIn(), isAdmin: auth.isAdmin(), profile: auth.getProfile() }
  ));

  on(MSG.AUTH_SIGNIN, async () => {
    try {
      const profile = await auth.signIn();
      broadcastToTabs({ type: MSG.AUTH_CHANGED, signedIn: auth.isSignedIn(), isAdmin: auth.isAdmin(), profile });
      // Da loggati possiamo leggere eventuali chiavi default ruotate
      // dall'admin (doc Firestore config/secrets): rinfresca in background.
      Defaults.refresh().catch(() => {});
      return { ok: true, profile, isAdmin: auth.isAdmin() };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  on(MSG.AUTH_SIGNOUT, async () => {
    try {
      auth.signOut();
      broadcastToTabs({ type: MSG.AUTH_CHANGED, signedIn: false, isAdmin: false, profile: null });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Triage admin di un feedback: solo admin loggati, con Firebase ID token
  // come Bearer (il token non lascia mai il main). La garanzia forte è nelle
  // Firestore rules; questo è il gate applicativo + il trasporto autenticato.
  on(MSG.FEEDBACK_UPDATE, async (msg) => {
    try {
      if (!auth.isAdmin()) {
        return { ok: false, error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.' };
      }
      if (!globalThis.SN_FEEDBACK?.updateStatus) {
        throw new Error('SN_FEEDBACK non caricato nel main process');
      }
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const { id, status, notes, priority, reviewDecision, reviewComment, reviewedAt, starred } = msg;
      await globalThis.SN_FEEDBACK.updateStatus(
        id,
        { status, notes, priority, reviewDecision, reviewComment, reviewedAt, starred },
        { idToken },
      );
      return { ok: true };
    } catch (e) {
      const raw = e?.message || String(e);
      let claims = null;
      try { claims = auth.getTokenClaims(); } catch (_) {}
      return { ok: false, error: permissionDeniedHelp(raw, claims) };
    }
  });

  // Config "modelli predefiniti" condivisa. La lettura (per l'editor admin)
  // NON espone le chiavi vere, solo se sono configurate. La scrittura è
  // riservata agli admin (Firebase ID token come Bearer): le regole Firestore
  // rifiutano i non-admin. La modifica si propaga a tutti gli utenti.
  on(MSG.DEFAULTS_GET, async () => {
    try {
      if (!auth.isAdmin()) {
        return { ok: false, error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.' };
      }
      await Defaults.refresh().catch(() => {});
      return { ok: true, config: Defaults.getPublicForAdmin() };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  on(MSG.DEFAULTS_UPDATE, async (msg) => {
    try {
      if (!auth.isAdmin()) {
        return { ok: false, error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.' };
      }
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const config = await Defaults.update(msg.config || {}, idToken);
      return { ok: true, config };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Interruttore master dell'auto-miglioramento (config/automation). Owner-only.
  // Default OFF (autonomia spenta): mentre è OFF anche i feedback "sicuri"
  // richiedono verifica umana. Vedi filo-security DESIGN §2. La scrittura passa
  // dal main con l'ID token admin; le regole Firestore sono la garanzia forte.
  on(MSG.AUTOMATION_GET, async () => {
    try {
      if (!auth.isAdmin()) {
        return { ok: false, error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.' };
      }
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const enabled = await Defaults.getAutomationGate(idToken);
      return { ok: true, enabled };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  on(MSG.AUTOMATION_SET, async (msg) => {
    try {
      if (!auth.isAdmin()) {
        return { ok: false, error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.' };
      }
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const enabled = await Defaults.setAutomationGate(Boolean(msg.enabled), idToken);
      return { ok: true, enabled };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
};
