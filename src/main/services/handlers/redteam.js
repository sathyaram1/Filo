// Handler di dominio: canale RED-TEAM (filo-redteam-ux-spec).
//
// Ponte tra la pagina `filo://redteam/` (e il menu tasto destro) e le Cloud
// Function del backend di sicurezza (repo privato filo-security). Le funzioni
// vivono server-side perché il "cervello" (giudici, scoring, verifica) non deve
// stare nel client pubblico. Qui c'è SOLO il trasporto: invoca le callable
// `redteam*` col Firebase ID token dell'utente loggato (l'`uid` lo ricava il
// backend da quel token: il client non può impersonare né auto-verificarsi).
//
// In pausa (#896) le richieste di chi non vede il Red Team non partono: chi lo
// vede lo decide services/redteamGate.js. Nessun credito viene toccato lato client.

const auth = require('../../auth/google-auth');
const Gate = require('../redteamGate');
const { daFilo, soloFilo } = require('./origine');

// Endpoint delle callable gen2. Region/progetto = quelli del deploy di
// filo-security (europe-west1, filo-8b9cb). Override per i test via env.
const FUNCTIONS_BASE = process.env.FILO_FUNCTIONS_BASE
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

module.exports = function register(on, ctx) {
  const { MSG } = ctx;
  const PAUSA = Gate.FRASE_PAUSA;

  // Riaperto o rimesso in pausa: le pagine di Filo aperte (la home) lo sanno subito.
  Gate.suCambio((s) => {
    try { ctx.broadcastToFiloPages({ type: MSG.REDTEAM_VISIBILITY_CHANGED, visible: s.visible }); } catch (_) {}
  });

  async function inPausa() {
    const s = await Gate.assicura();
    return !s.visible;
  }

  // Il server ha detto «in pausa» a chi qui risultava aperto: la copia locale era vecchia.
  function pausaDalServer(r) {
    if (r && r.paused) Gate.aggiorna({ forza: true });
    return r;
  }

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
      let err = null;
      try { err = (await res.json())?.error || null; } catch (_) {}
      const detail = (err && err.message) || '';
      // La pausa detta dal server è una frase per l'utente, non un errore di trasporto.
      if (err && err.details && err.details.paused === true) {
        Gate.aggiorna({ forza: true });
        const e = new Error(detail || PAUSA);
        e.paused = true;
        throw e;
      }
      throw new Error(`callable ${name} ${res.status}${detail ? ': ' + detail : ''}`);
    }
    const body = await res.json();
    return body && body.result;
  }

  // Invio tentativo. { attackText, description } → vedi MSG.REDTEAM_SUBMIT.
  on(MSG.REDTEAM_SUBMIT, async (msg) => {
    if (await inPausa()) return { status: 'paused', paused: true, error: PAUSA };
    if (!auth.isSignedIn()) return { status: 'not_signed_in' };
    try {
      return await callable('redteamSubmit', {
        attackText: String(msg?.attackText || ''),
        description: String(msg?.description || ''),
      });
    } catch (e) {
      if (e && e.paused) return { status: 'paused', paused: true, error: e.message };
      return { status: 'error', error: e?.message || String(e) };
    }
  });

  // Stato gamification dell'utente per la tab Statistiche. Include `isOwner`
  // così la pagina può mostrare il pannello owner di generazione codici.
  on(MSG.REDTEAM_STATE, async () => {
    if (await inPausa()) return { paused: true, error: PAUSA, verified: false, signedIn: auth.isSignedIn(), isOwner: false };
    if (!auth.isSignedIn()) return { verified: false, signedIn: false, isOwner: false };
    try {
      const r = pausaDalServer(await callable('redteamState', {}));
      return Object.assign({ signedIn: true, isOwner: auth.isAdmin() }, r);
    } catch (e) {
      if (e && e.paused) return { paused: true, error: e.message, verified: false, signedIn: true, isOwner: false };
      return { verified: false, signedIn: true, isOwner: auth.isAdmin(), error: e?.message || String(e) };
    }
  });

  // Un tentativo (polling della rivelazione live). { attemptId }.
  on(MSG.REDTEAM_ATTEMPT, async (msg) => {
    if (await inPausa()) return { paused: true, error: PAUSA, hidden: true };
    if (!auth.isSignedIn()) return { notFound: true };
    try {
      return pausaDalServer(await callable('redteamAttempt', { attemptId: String(msg?.attemptId || '') }));
    } catch (e) {
      if (e && e.paused) return { paused: true, error: e.message, hidden: true };
      return { error: e?.message || String(e) };
    }
  });

  // Leaderboard (tutti i loggati).
  on(MSG.REDTEAM_LEADERBOARD, async () => {
    if (await inPausa()) return { paused: true, error: PAUSA, entries: [] };
    if (!auth.isSignedIn()) return { entries: [], signedIn: false };
    try {
      const r = pausaDalServer(await callable('redteamLeaderboard', {}));
      return Object.assign({ signedIn: true }, r);
    } catch (e) {
      if (e && e.paused) return { paused: true, error: e.message, entries: [] };
      return { entries: [], signedIn: true, error: e?.message || String(e) };
    }
  });

  // Riscatto codice monouso → verifica + handle. { code, handle }.
  on(MSG.REDTEAM_REDEEM, async (msg) => {
    if (await inPausa()) return { status: 'paused', paused: true, error: PAUSA };
    if (!auth.isSignedIn()) return { status: 'not_signed_in' };
    try {
      return await callable('redteamRedeem', {
        code: String(msg?.code || ''),
        handle: String(msg?.handle || ''),
      });
    } catch (e) {
      if (e && e.paused) return { status: 'paused', paused: true, error: e.message };
      return { status: 'error', error: e?.message || String(e) };
    }
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

  // Elenco codici esistenti (SOLO owner) per il pannello di gestione. { } →
  // { ok, codes:[{ code, used, usedAt?, createdAt?, handle? }] }.
  on(MSG.REDTEAM_LIST_CODES, async () => {
    if (!auth.isAdmin()) return { ok: false, error: 'Comando riservato al proprietario.' };
    try {
      const r = await callable('redteamListCodes', {});
      return { ok: true, codes: (r && r.codes) || [] };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  // Revoca di un codice ancora libero (SOLO owner). { code } → { ok } |
  // { ok:false, status } se non esiste o è già stato usato (non revocabile).
  on(MSG.REDTEAM_REVOKE_CODE, async (msg) => {
    if (!auth.isAdmin()) return { ok: false, error: 'Comando riservato al proprietario.' };
    try {
      const r = await callable('redteamRevokeCode', { code: String(msg?.code || '') });
      return Object.assign({ ok: true }, r);
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  // Il Red Team si mostra? A un sito visitato solo il sì/no: chi è owner lo chiede una superficie di Filo.
  // Una copia scaduta si rilegge in sottofondo; `attendi` aspetta la prima lettura.
  on(MSG.REDTEAM_VISIBILITY, async (msg, sender, origin) => {
    const s = msg && msg.attendi ? await Gate.assicura() : Gate.aggiorna();
    if (!daFilo(origin, sender)) return { ok: true, visible: s.visible };
    return { ok: true, visible: s.visible, owner: s.owner, openToAll: s.openToAll, letto: s.letto };
  });

  // L'interruttore di Gestione: lettura fresca e scrittura, solo all'owner e solo da Filo.
  on(MSG.REDTEAM_OPEN_GET, soloFilo(async () => {
    if (!auth.isAdmin()) return { ok: false, error: 'Comando riservato al proprietario.' };
    const s = await Gate.rileggiOra();
    return { ok: true, openToAll: s.openToAll, letto: s.letto };
  }));

  on(MSG.REDTEAM_OPEN_SET, soloFilo(async (msg) => {
    if (!auth.isAdmin()) return { ok: false, error: 'Comando riservato al proprietario.' };
    if (typeof msg?.openToAll !== 'boolean') return { ok: false, error: 'openToAll deve essere vero o falso.' };
    try {
      const s = await Gate.impostaApertoATutti(msg.openToAll);
      return { ok: true, openToAll: s.openToAll };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  }));
};
