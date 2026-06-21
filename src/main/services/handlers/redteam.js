// Handler di dominio: canale RED-TEAM (filo-redteam-ux-spec).
//
// Ponte tra la pagina `filo://redteam/` (e il menu tasto destro) e le Cloud
// Function del backend di sicurezza (repo privato filo-security). Le funzioni
// vivono server-side perché il "cervello" (giudici, scoring, verifica) non deve
// stare nel client pubblico. Qui c'è SOLO il trasporto: invoca le callable
// `redteam*` col Firebase ID token dell'utente loggato (l'`uid` lo ricava il
// backend da quel token: il client non può impersonare né auto-verificarsi).
//
// NB: finché il backend non è deployato (gate owner) queste chiamate falliscono
// con un errore di rete: gli handler ritornano una forma d'errore pulita e la UI
// mostra lo stato adeguato. Nessun credito viene toccato lato client.

const auth = require('../../auth/google-auth');

// Endpoint delle callable gen2. Region/progetto = quelli del deploy di
// filo-security (europe-west1, filo-8b9cb). Override per i test via env.
const FUNCTIONS_BASE = process.env.FILO_FUNCTIONS_BASE
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

module.exports = function register(on, ctx) {
  const { MSG } = ctx;

  // Invoca una Cloud Function callable (protocollo onCall): POST {data} con
  // Bearer ID token; risposta {result}. Lancia su errore (auth/rete/HTTP).
  async function callable(name, data = {}) {
    const idToken = await auth.getIdToken();
    if (!idToken) throw new Error('not_signed_in');
    const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error?.message || ''; } catch (_) {}
      throw new Error(`callable ${name} ${res.status}${detail ? ': ' + detail : ''}`);
    }
    const body = await res.json();
    return body && body.result;
  }

  // Invio tentativo. { attackText, description } → vedi MSG.REDTEAM_SUBMIT.
  on(MSG.REDTEAM_SUBMIT, async (msg) => {
    if (!auth.isSignedIn()) return { status: 'not_signed_in' };
    try {
      return await callable('redteamSubmit', {
        attackText: String(msg?.attackText || ''),
        description: String(msg?.description || ''),
      });
    } catch (e) { return { status: 'error', error: e?.message || String(e) }; }
  });

  // Stato gamification dell'utente per la tab Statistiche.
  on(MSG.REDTEAM_STATE, async () => {
    if (!auth.isSignedIn()) return { verified: false, signedIn: false };
    try {
      const r = await callable('redteamState', {});
      return Object.assign({ signedIn: true }, r);
    } catch (e) { return { verified: false, signedIn: true, error: e?.message || String(e) }; }
  });

  // Un tentativo (polling della rivelazione live). { attemptId }.
  on(MSG.REDTEAM_ATTEMPT, async (msg) => {
    if (!auth.isSignedIn()) return { notFound: true };
    try {
      return await callable('redteamAttempt', { attemptId: String(msg?.attemptId || '') });
    } catch (e) { return { error: e?.message || String(e) }; }
  });

  // Leaderboard (tutti i loggati).
  on(MSG.REDTEAM_LEADERBOARD, async () => {
    if (!auth.isSignedIn()) return { entries: [], signedIn: false };
    try {
      const r = await callable('redteamLeaderboard', {});
      return Object.assign({ signedIn: true }, r);
    } catch (e) { return { entries: [], signedIn: true, error: e?.message || String(e) }; }
  });

  // Riscatto codice monouso → verifica + handle. { code, handle }.
  on(MSG.REDTEAM_REDEEM, async (msg) => {
    if (!auth.isSignedIn()) return { status: 'not_signed_in' };
    try {
      return await callable('redteamRedeem', {
        code: String(msg?.code || ''),
        handle: String(msg?.handle || ''),
      });
    } catch (e) { return { status: 'error', error: e?.message || String(e) }; }
  });

  // Generazione codici (SOLO owner). { count } → { ok, codes }.
  on(MSG.REDTEAM_GEN_CODES, async (msg) => {
    if (!auth.isAdmin()) return { ok: false, error: 'Comando riservato al proprietario.' };
    const count = Math.max(1, Math.min(200, Math.floor(Number(msg?.count) || 1)));
    try {
      const r = await callable('redteamGenerateCodes', { count });
      return { ok: true, codes: (r && r.codes) || [] };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });
};
