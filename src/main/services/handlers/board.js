// Bacheca utente: voto funziona/non-funziona e riapertura a pagamento.
// Il voto premia una sola volta per feedback per utente; ritirarlo non toglie il premio.
// Passa dal main perché il voto vuole l'uid Firebase reale, che il renderer non conosce.

const auth = require('../../auth/google-auth');
// Votare e spendere hanno potere: confine d'origine, vedi origine.js (#583).
const { soloFilo } = require('./origine');

module.exports = function register(on, ctx) {
  const { MSG } = ctx;
  const Credits = globalThis.SN_CREDITS;
  const FB = globalThis.SN_FEEDBACK;
  const { SN_CONST } = globalThis;

  on(MSG.BOARD_CAST_VOTE, soloFilo(async (msg) => {
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

      // Una sola volta per feedback per utente: cambiare voto o rivotare lo stesso NON ripaga.
      const amount = SN_CONST.CREDIT.BOARD_VOTE;
      const reward = await Credits.awardVoteOnce(id, amount);

      // Rilegge il documento per il conteggio vero, non solo l'aggiornamento ottimistico.
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
  }));

  // ORDINE DELIBERATO, guard PRIMA del feedback: le due scritture non sono atomiche, e col
  // feedback per primo una caduta di rete lasciava duplicati gratis. Crediti resi se fallisce.
  on(MSG.BOARD_REOPEN, soloFilo(async (msg) => {
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

      // Idoneità riletta dal documento originale, non dallo stato che il renderer aveva in cache.
      const original = await fetchFeedback(id);
      if (!original) return { ok: false, error: 'Feedback non trovato.' };
      let releasedVersion = '';
      try { releasedVersion = require('electron').app.getVersion(); } catch (_) { /* test env */ }
      if (!MR.canReopen(original, { releasedVersion })) {
        return MR.hasReopenRequest(original)
          ? { ok: false, error: 'Questo fix è già stato segnalato come ancora rotto.' }
          : { ok: false, error: 'Questo fix non è (più) riapribile dalla bacheca.' };
      }

      // Anti-spam: si scala solo se il saldo basta, niente saldo negativo né tentativi gratis.
      const amount = SN_CONST.CREDIT.BOARD_REOPEN;
      const spend = await Credits.spendIfAffordable(amount, { kind: 'board_reopen', ref: id });
      if (!spend.ok) {
        return { ok: false, error: `Servono ${amount} crediti per riaprire un fix (saldo: ${spend.balance}).` };
      }

      let created;
      try {
        // Guard prima (vedi sopra): chiude ai duplicati anche se la creazione qui sotto fallisce.
        await FB.castReopenRequest(id, uid, { idToken });
        created = await FB.submit({
          text: `[Riapertura #${original.seq || id}] ${text}`,
          // URL e titolo dell'originale sono di chi l'ha mandato e non arrivano qui (#583):
          // al triage bastano `parentId` e il numero nel testo.
          url: '',
          title: '',
          userAgent: '',
          clientId: `uid:${uid}`,
          parentId: id,
          name: '',
        });
      } catch (e) {
        // Best-effort: i crediti tornano invece di lasciare l'utente scalato senza nulla in cambio.
        try { await Credits.award({ kind: 'board_reopen_refund', credits: amount, ref: id }); } catch (_) {}
        throw e;
      }

      return { ok: true, feedbackId: created.id, balance: spend.balance };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  on(MSG.BOARD_CLEAR_VOTE, soloFilo(async (msg) => {
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
      // Il ritiro del voto non è una penalità: il premio resta, e un voto successivo non ripaga.
      const votes = await fetchVotes(id);
      return { ok: true, uid, votes };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Idoneità dai dati freschi del server, non dalla cache del renderer. È la SCHEDA e non il
  // documento: la collezione non è pubblica e questa macchina non lo può aprire (#583).
  async function fetchFeedback(id) {
    if (!FB?.getPublic) return null;
    try {
      return await FB.getPublic(id);
    } catch (_) {
      return null;
    }
  }

  // Solo il campo `votes`: più leggero di una lista intera per un documento solo. {} se non ci
  // sono voti o su errore — il chiamante ha comunque appena scritto il proprio.
  async function fetchVotes(id) {
    if (!FB?.rest) return {};
    try {
      const url = `${FB.rest.FIRESTORE_BASE}/${FB.rest.VIEW_COLLECTION}/${encodeURIComponent(id)}` +
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
