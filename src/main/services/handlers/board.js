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
      // #366.2: importo dalla config owner (ripiego sulla costante BOARD_VOTE).
      const amount = Credits.config().boardVote;
      const reward = await Credits.awardVoteOnce(id, amount);

      // Rilegge il documento per tornare il tally REALE (altri voti compresi),
      // così la UI non deve fidarsi solo dell'aggiornamento ottimistico locale.
      // FB.list non filtra per id: leggiamo il singolo documento via REST diretto
      // (fetchVotes sotto, stesso plumbing esposto da SN_FEEDBACK).
      const votes = await fetchVotes(id);

      return {
        ok: true,
        uid,
        votes,
        awarded: reward.awarded,
        credits: reward.credits,
        balance: reward.balance,
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Riapertura a pagamento (DC4): l'utente loggato segnala che un fix
  // "Risolti" è ancora rotto. Passi atomici-quanto-possibile:
  //   1. verifica idoneità (è davvero in Risolti, nessuno l'ha già riaperto);
  //   2. scala CREDIT.BOARD_REOPEN (anti-spam — rifiuta senza scrivere nulla
  //      se il saldo non basta, applyConsumptionIfAffordable in creditStore.js);
  //   3. marca `reopenRequests.<uid>` sull'originale (il GUARD anti-doppia-
  //      riapertura — segnale per il triage: un utente normale non può scrivere
  //      `status`, quindi il flip fuori da "Risolti" resta al percorso fidato —
  //      vedi nota in messages.js);
  //   4. crea il feedback collegato (parentId).
  //
  // ORDINE DELIBERATO (guard PRIMA del feedback): i passi 3 e 4 sono due
  // scritture REST Firestore separate e NON atomiche. Se creassimo il feedback
  // (4) prima di marcare il guard (3) e la rete cadesse fra le due, resteremmo
  // con un feedback figlio orfano E il guard MAI marcato: canReopen()
  // continuerebbe a dire "riapribile" e l'utente potrebbe ripetere all'infinito,
  // creando ogni volta un nuovo feedback duplicato (crediti sempre rimborsati) —
  // la coda si riempirebbe di segnalazioni gratis, bypassando l'anti-spam.
  // Marcando il guard PER PRIMO: se (3) fallisce, non abbiamo ancora creato
  // nulla (retry pulito, nessun orfano); se (3) riesce ma (4) fallisce, il guard
  // blocca comunque ogni tentativo successivo → al più UN feedback figlio per
  // utente, mai duplicati. In entrambi i rami di fallimento dopo aver scalato,
  // restituiamo i crediti (compensazione best-effort).
  on(MSG.BOARD_REOPEN, async (msg) => {
    try {
      if (!auth.isSignedIn()) {
        return { ok: false, error: 'Accedi per segnalare che un fix è ancora rotto.' };
      }
      const id = String(msg?.id || '').trim();
      const text = String(msg?.text || '').trim();
      if (!id) return { ok: false, error: 'Feedback non valido.' };
      if (!text) return { ok: false, error: 'Descrivi cosa non funziona ancora.' };
      if (text.length > 10000) return { ok: false, error: 'Testo troppo lungo.' };

      const uid = await auth.getUid();
      if (!uid) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      if (!FB?.castReopenRequest || !FB?.submit) throw new Error('SN_FEEDBACK non caricato nel main process');

      const MR = globalThis.SN_MANAGE_REVIEW;
      if (!MR?.canReopen) throw new Error('SN_MANAGE_REVIEW non caricato nel main process');

      // Idoneità: rilegge il documento originale (non fidarsi dello stato che
      // il renderer aveva in cache) e applica lo stesso gate "Risolti, niente
      // red-team" della board + il guard anti-doppia-riapertura.
      const original = await fetchFeedback(id);
      if (!original) return { ok: false, error: 'Feedback non trovato.' };
      let releasedVersion = '';
      try { releasedVersion = require('electron').app.getVersion(); } catch (_) { /* test env */ }
      if (!MR.canReopen(original, { releasedVersion })) {
        return MR.hasReopenRequest(original)
          ? { ok: false, error: 'Questo fix è già stato segnalato come ancora rotto.' }
          : { ok: false, error: 'Questo fix non è (più) riapribile dalla bacheca.' };
      }

      // Anti-spam: scala i crediti SOLO se il saldo basta (nessun saldo
      // negativo, nessun tentativo "gratis" se insufficiente).
      const amount = SN_CONST.CREDIT.BOARD_REOPEN;
      const spend = await Credits.spendIfAffordable(amount, { kind: 'board_reopen', ref: id });
      if (!spend.ok) {
        return { ok: false, error: `Servono ${amount} crediti per riaprire un fix (saldo: ${spend.balance}).` };
      }

      let created;
      try {
        // Guard PRIMA (vedi nota d'ordine sopra): marcare reopenRequests.<uid>
        // chiude la porta a duplicati anche se la creazione del feedback qui
        // sotto fallisce a metà.
        await FB.castReopenRequest(id, uid, { idToken });
        created = await FB.submit({
          text: `[Riapertura #${original.seq || id}] ${text}`,
          url: original.url || '',
          title: original.title || '',
          userAgent: '',
          clientId: `uid:${uid}`,
          parentId: id,
          name: '',
        });
      } catch (e) {
        // Compensazione best-effort: il segnale/feedback non è andato a buon
        // fine dopo aver già scalato — restituiamo i crediti invece di
        // lasciare l'utente scalato senza nulla in cambio.
        try { await Credits.award({ kind: 'board_reopen_refund', credits: amount, ref: id }); } catch (_) {}
        throw e;
      }

      return { ok: true, feedbackId: created.id, balance: spend.balance };
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
      return { ok: true, uid, votes };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Legge il documento feedback intero via REST (GET singolo, no proiezione):
  // serve a BOARD_REOPEN per verificare idoneità con i dati FRESCHI dal server
  // (status/resolvedInVersion/reopenRequests), non con quanto il renderer ha in
  // cache. Ritorna null se non trovato o in caso d'errore di rete.
  async function fetchFeedback(id) {
    if (!FB?.rest) return null;
    try {
      const url = `${FB.rest.FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}?key=${FB.rest.API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const doc = await res.json();
      return FB.fsDocToObject(doc);
    } catch (_) {
      return null;
    }
  }

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
