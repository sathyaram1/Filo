// Canale RED-TEAM: ponte fra la pagina `filo://redteam/` (e il menu del tasto destro) e le Cloud Function di filo-security. Il "cervello" — giudici, scoring, verifica — sta server-side e non nel client pubblico; qui c'è SOLO il trasporto, con l'ID token dell'utente: l'uid lo ricava il backend da quel token, quindi il client non può impersonare né auto-verificarsi.
// Finché il backend non è deployato le chiamate falliscono con un errore di rete: gli handler ritornano una forma d'errore pulita e nessun credito viene toccato lato client.

const auth = require('../../auth/google-auth');

// Region e progetto sono quelli del deploy di filo-security; override per i test via env.
const FUNCTIONS_BASE = process.env.FILO_FUNCTIONS_BASE
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

module.exports = function register(on, ctx) {
  const { MSG } = ctx;

  // Protocollo onCall: POST {data} con Bearer ID token, risposta {result}. Lancia su errore di auth, rete o HTTP.
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

  on(MSG.REDTEAM_SUBMIT, async (msg) => {
    if (!auth.isSignedIn()) return { status: 'not_signed_in' };
    try {
      return await callable('redteamSubmit', {
        attackText: String(msg?.attackText || ''),
        description: String(msg?.description || ''),
      });
    } catch (e) { return { status: 'error', error: e?.message || String(e) }; }
  });

  // `isOwner` serve alla pagina per mostrare il pannello owner di generazione codici.
  on(MSG.REDTEAM_STATE, async () => {
    if (!auth.isSignedIn()) return { verified: false, signedIn: false, isOwner: false };
    try {
      const r = await callable('redteamState', {});
      return Object.assign({ signedIn: true, isOwner: auth.isAdmin() }, r);
    } catch (e) { return { verified: false, signedIn: true, isOwner: auth.isAdmin(), error: e?.message || String(e) }; }
  });

  on(MSG.REDTEAM_ATTEMPT, async (msg) => {
    if (!auth.isSignedIn()) return { notFound: true };
    try {
      return await callable('redteamAttempt', { attemptId: String(msg?.attemptId || '') });
    } catch (e) { return { error: e?.message || String(e) }; }
  });

  on(MSG.REDTEAM_LEADERBOARD, async () => {
    if (!auth.isSignedIn()) return { entries: [], signedIn: false };
    try {
      const r = await callable('redteamLeaderboard', {});
      return Object.assign({ signedIn: true }, r);
    } catch (e) { return { entries: [], signedIn: true, error: e?.message || String(e) }; }
  });

  on(MSG.REDTEAM_REDEEM, async (msg) => {
    if (!auth.isSignedIn()) return { status: 'not_signed_in' };
    try {
      return await callable('redteamRedeem', {
        code: String(msg?.code || ''),
        handle: String(msg?.handle || ''),
      });
    } catch (e) { return { status: 'error', error: e?.message || String(e) }; }
  });

  on(MSG.REDTEAM_GEN_CODES, async (msg) => {
    if (!auth.isAdmin()) return { ok: false, error: 'Comando riservato al proprietario.' };
    const count = Math.max(1, Math.min(200, Math.floor(Number(msg?.count) || 1)));
    try {
      const r = await callable('redteamGenerateCodes', { count });
      return { ok: true, codes: (r && r.codes) || [] };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  on(MSG.REDTEAM_LIST_CODES, async () => {
    if (!auth.isAdmin()) return { ok: false, error: 'Comando riservato al proprietario.' };
    try {
      const r = await callable('redteamListCodes', {});
      return { ok: true, codes: (r && r.codes) || [] };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  // Un codice già usato non è revocabile.
  on(MSG.REDTEAM_REVOKE_CODE, async (msg) => {
    if (!auth.isAdmin()) return { ok: false, error: 'Comando riservato al proprietario.' };
    try {
      const r = await callable('redteamRevokeCode', { code: String(msg?.code || '') });
      return Object.assign({ ok: true }, r);
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });
};
