// Bacheca utente: voto funziona/non-funziona (DC2). Il voto va su Firestore con l'ID token del votante (mai esposto al renderer) e premia +10 crediti UNA SOLA VOLTA per feedback per utente (rewardedVotes in creditStore.js, namespace separato dal premio di risoluzione C5).
// Niente penalità: il premio resta accreditato anche se l'utente ritira o cambia voto.
// Il renderer non parla mai direttamente con FB.castVote: passa da qui perché il voto richiede l'uid Firebase REALE (claim dell'ID token, request.auth.uid nelle regole), non l'email, che è quanto il renderer vede di sé.

const auth = require('../../auth/google-auth');
// #583 — queste porte non sono del proprietario: valgono per chiunque abbia fatto l'accesso, e su una macchina con una sessione aperta «hai una sessione?» è sempre sì. Senza guardare da dove arriva la richiesta, la pagina di un sito visitato votava al posto dell'utente, gli cancellava il voto, gli spendeva i crediti e apriva segnalazioni a suo nome.
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

      // Una sola volta per feedback per utente: cambiare idea works↔broken o rivotare lo stesso valore NON ripaga.
      const amount = SN_CONST.CREDIT.BOARD_VOTE;
      const reward = await Credits.awardVoteOnce(id, amount);

      // Rilegge il documento per tornare il tally REALE (altri voti compresi), così la UI non si fida solo dell'aggiornamento ottimistico locale.
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

  // Riapertura a pagamento (DC4): l'utente segnala che un fix "Risolti" è ancora rotto. Si verifica l'idoneità, si scala CREDIT.BOARD_REOPEN (rifiutando senza scrivere nulla se il saldo non basta), si marca il guard anti-doppia-riapertura e si crea il feedback collegato.
  // ORDINE DELIBERATO, guard PRIMA del feedback: le due scritture Firestore non sono atomiche, e creando prima il feedback una caduta di rete lascerebbe un figlio orfano col guard mai marcato — l'utente potrebbe ripetere all'infinito creando duplicati gratis, bypassando l'anti-spam.
  // Marcando il guard per primo: se fallisce non è stato creato nulla (retry pulito), se riesce ma la creazione fallisce il guard blocca comunque i tentativi successivi. In entrambi i fallimenti dopo lo scalo, i crediti si restituiscono (best-effort).
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

      // Anti-spam: scala i crediti SOLO se il saldo basta — nessun saldo negativo, nessun tentativo "gratis".
      const amount = SN_CONST.CREDIT.BOARD_REOPEN;
      const spend = await Credits.spendIfAffordable(amount, { kind: 'board_reopen', ref: id });
      if (!spend.ok) {
        return { ok: false, error: `Servono ${amount} crediti per riaprire un fix (saldo: ${spend.balance}).` };
      }

      let created;
      try {
        // Guard PRIMA (vedi la nota d'ordine sopra): chiude la porta ai duplicati anche se la creazione del feedback qui sotto fallisce a metà.
        await FB.castReopenRequest(id, uid, { idToken });
        created = await FB.submit({
          text: `[Riapertura #${original.seq || id}] ${text}`,
          // #583: URL e titolo del feedback originale non arrivano più fin qui, sono di chi l'aveva mandato. Il collegamento resta `parentId` più il numero nel testo, che è ciò che serve al triage.
          url: '',
          title: '',
          userAgent: '',
          clientId: `uid:${uid}`,
          parentId: id,
          name: '',
        });
      } catch (e) {
        // Compensazione best-effort: crediti restituiti invece di lasciare l'utente scalato senza nulla in cambio.
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
      // Nessuna revoca del premio: non è una penalità, è solo ritiro del voto. rewardedVotes resta marcato, un voto successivo non ripaga.
      const votes = await fetchVotes(id);
      return { ok: true, uid, votes };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Legge la SCHEDA PUBBLICA del fix (#583) per verificare l'idoneità con i dati freschi dal server, non con quanto il renderer ha in cache. È la scheda e non il documento perché da quando la collezione non è più pubblica questa macchina non lo può aprire — e non deve: testo e URL sono di chi l'ha mandato. null se non trovato o su errore di rete.
  async function fetchFeedback(id) {
    if (!FB?.getPublic) return null;
    try {
      return await FB.getPublic(id);
    } catch (_) {
      return null;
    }
  }

  // Solo il campo `votes` (GET con proiezione): più leggero di una lista intera per un documento solo. {} se non ci sono ancora voti o in caso d'errore — il chiamante ha comunque appena scritto il proprio voto.
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
