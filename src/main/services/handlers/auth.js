// Handler di dominio: account "Accedi con Google", triage admin dei feedback
// e config condivisa "modelli predefiniti".

const auth = require('../../auth/google-auth');
const Defaults = require('../defaultsStore');
const { permissionDeniedHelp } = require('../feedbackError');

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
      const { id, status, notes, priority } = msg;
      await globalThis.SN_FEEDBACK.updateStatus(id, { status, notes, priority }, { idToken });
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
