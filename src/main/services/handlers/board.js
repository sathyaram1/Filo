// Handler di dominio: bacheca utente — voto funziona/non-funziona (DC2).
//
// Persiste il voto su Firestore (votes.<uid>, DB4) con l'ID token del votante
// (mai esposto al renderer) e premia +10 crediti UNA SOLA VOLTA per feedback
// per utente (anti-doppio-premio in creditStore.js — rewardedVotes, namespace
// separato dal premio di risoluzione C5). Niente timeout, niente penalità: il
// premio resta accreditato anche se l'utente ritira o cambia voto in seguito.
//
// Il renderer (src/pages/board/board.js) NON parla direttamente con FB.castVote:
// passa sempre da qui, perché il voto richiede l'uid Firebase REALE (claim
// dell'ID token: request.auth.uid nelle Firestore rules) — non l'email, che è
// quanto il renderer vede di sé via AUTH_STATUS.

const auth = require('../../auth/google-auth');

module.exports = function register(on, ctx) {
  const { MSG } = ctx;
  const Credits = globalThis.SN_CREDITS;
  const FB = globalThis.SN_FEEDBACK;
  const { SN_CONST } = globalThis;

  on(MSG.BOARD_CAST_VOTE, async (msg) => {
    try {
      if (!auth.isSignedIn()) {
        return { ok: false, error: 'Accedi per votare i miglioramenti.' };
      }
      const id = String(msg?.id || '').trim();
      const vote = msg?.vote;
      if (!id) return { ok: false, error: 'Feedback non valido.' };
      if (vote !== 'works' && vote !== 'broken') {
        return { ok: false, error: "Voto non valido: usa 'works' o 'broken'." };
      }
      const uid = await auth.getUid();
      if (!uid) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      if (!FB?.castVote) throw new Error('SN_FEEDBACK non caricato nel main process');

      await FB.castVote(id, { uid, vote, credibilitySnapshot: 1 }, { idToken });

      // Premio: +10 crediti, una sola volta per feedback per questo utente
      // (idempotente — vedi creditStore.awardVoteOnce). Cambiare idea
      // works↔broken o rivotare lo stesso valore NON ripaga.
      const amount = SN_CONST.CREDIT.BOARD_VOTE;
      const reward = await Credits.awardVoteOnce(id, amount);

      // Rilegge il documento per tornare il tally REALE (altri voti compresi),
      // così la UI non deve fidarsi solo dell'aggiornamento ottimistico locale.
      let votes = null;
      try {
        const list = await FB.list({ pageSize: 1 }); // placeholder: vedi sotto
      } catch (_) { /* ignorato: il fallback è il voto appena scritto */ }
      // FB.list non filtra per id: leggiamo il singolo documento via REST diretto
      // usando lo stesso plumbing esposto da SN_FEEDBACK (rest/fromFsValue).
      votes = await fetchVotes(id);

      return {
        ok: true,
        votes,
        awarded: reward.awarded,
        credits: reward.credits,
        balance: reward.balance,
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  on(MSG.BOARD_CLEAR_VOTE, async (msg) => {
    try {
      if (!auth.isSignedIn()) {
        return { ok: false, error: 'Accedi per votare i miglioramenti.' };
      }
      const id = String(msg?.id || '').trim();
      if (!id) return { ok: false, error: 'Feedback non valido.' };
      const uid = await auth.getUid();
      if (!uid) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      if (!FB?.clearVote) throw new Error('SN_FEEDBACK non caricato nel main process');

      await FB.clearVote(id, uid, { idToken });
      // NB: nessuna revoca del premio (non è una penalità, è solo ritiro del
      // voto) — rewardedVotes resta marcato: un voto successivo non ripaga.
      const votes = await fetchVotes(id);
      return { ok: true, votes };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Legge SOLO il campo `votes` del documento feedback via REST (GET singolo,
  // proiezione mask) — più leggero di un FB.list({pageSize:500}) per un solo
  // documento. Ritorna {} se il documento non ha ancora voti o in caso d'errore
  // (best-effort: il chiamante ha comunque appena scritto il proprio voto).
  async function fetchVotes(id) {
    if (!FB?.rest) return {};
    try {
      const url = `${FB.rest.FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}` +
        `?mask.fieldPaths=votes&key=${FB.rest.API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) return {};
      const doc = await res.json();
      const obj = FB.fsDocToObject(doc);
      return (obj && typeof obj.votes === 'object' && obj.votes) || {};
    } catch (_) {
      return {};
    }
  }
};
