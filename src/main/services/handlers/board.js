// Bacheca utente: voto funziona/non-funziona e riapertura a pagamento.
// Il voto premia una sola volta per feedback per utente; ritirarlo non toglie il premio.
// Passa dal main perché il voto vuole l'uid Firebase reale, che il renderer non conosce.

const auth = require('../../auth/google-auth');
const Mittente = require('../feedbackMittente');
// #583 — queste tre porte non sono del proprietario: valgono per chiunque
// abbia fatto l'accesso, e su una macchina con una sessione aperta «hai una
// sessione?» è sempre sì. Senza guardare da dove arriva la richiesta, una
// pagina di un sito visitato votava al posto dell'utente, gli cancellava il
// voto e gli spendeva i crediti per riaprire un fix, aprendo a suo nome una
// segnalazione col testo che voleva. Il voto e la riapertura sono gesti che si
// fanno in bacheca, che è una pagina di Filo.
const { soloFilo } = require('./origine');
const InPausa = require('../inPausa');

module.exports = function register(on, ctx) {
  const { MSG } = ctx;
  const Credits = globalThis.SN_CREDITS;
  const FB = globalThis.SN_FEEDBACK;
  const { SN_CONST } = globalThis;

  // #678.1 — un gesto non riuscito si DICE, con la frase giusta: chi vota o
  // riapre deve sapere se manca la rete, la sessione o il fix stesso. Il
  // messaggio grezzo resta nei log. `code` serve alla pagina per reagire.
  const SESSIONE_SCADUTA = { ok: false, code: 'auth', error: 'Sessione scaduta: rifai l\'accesso.' };
  const VOTO_NON_REGISTRATO = 'Il voto non è stato registrato: riprova.';
  const RIAPERTURA_NON_PARTITA = 'La segnalazione non è partita: riprova.';
  const TORNATO_IN_LAVORAZIONE = {
    ok: false, code: 'gone',
    error: 'Questo miglioramento è tornato in lavorazione: per ora non si può più votare né segnalare.',
  };

  function statoHttp(e) {
    const s = Number(e && e.status);
    if (s > 0) return s;
    const m = /\((\d{3})\)/.exec(String((e && e.message) || ''));
    return m ? Number(m[1]) : 0;
  }

  // Il token si chiede fuori da getUid(), che inghiotte ogni errore: senza
  // rete il rinnovo fallisce e «sessione scaduta» manderebbe a rifare un
  // accesso che non serve.
  async function credenziali() {
    let idToken = null;
    try { idToken = await auth.getIdToken(); } catch (e) { return { fallito: e }; }
    if (!idToken) return { esito: SESSIONE_SCADUTA };
    const uid = await auth.getUid();
    if (!uid) return { esito: SESSIONE_SCADUTA };
    return { uid, idToken };
  }

  async function esitoFallito(e, id, generico) {
    console.warn('[board] gesto non riuscito:', e?.message || e);
    const CE = globalThis.SN_CHAT_ERRORS;
    if (CE?.isTransientNetwork?.(e)) {
      return { ok: false, code: 'offline', error: 'Non riesco a raggiungere il server: controlla la connessione e riprova.' };
    }
    // Un rinnovo rifiutato chiude la sessione (signOut in google-auth).
    const st = statoHttp(e);
    if (!auth.isSignedIn() || st === 401) return SESSIONE_SCADUTA;
    // Una scheda che non c'è più non si può scrivere: le regole rifiutano la
    // creazione, e la risposta è un 403 che da solo non dice perché.
    if (id && (st === 403 || st === 404)) {
      try {
        const card = await FB.getPublic(id);
        if (!inBacheca(card)) return TORNATO_IN_LAVORAZIONE;
      } catch (_) { /* la verifica non è riuscita: resta la frase generica */ }
    }
    return { ok: false, error: generico };
  }

  function versioneRilasciata() {
    try { return require('electron').app.getVersion(); } catch (_) { return ''; }
  }

  function inBacheca(card) {
    if (!card) return false;
    const MR = globalThis.SN_MANAGE_REVIEW;
    if (!MR?.listBoardTab) return true;
    return MR.listBoardTab([card], { releasedVersion: versioneRilasciata() }).length > 0;
  }

  // La Bacheca in pausa (#1592): voti e «Ancora rotto?» non partono per chi non la vede, nemmeno da una pagina vecchia.
  const bachecaChiusa = async () => {
    if ((await InPausa.cancello('bacheca').assicura()).visible) return null;
    return { ok: false, code: 'paused', error: InPausa.FRASI_PAUSA.bacheca };
  };

  on(MSG.BOARD_CAST_VOTE, soloFilo(async (msg) => {
    const chiusa = await bachecaChiusa();
    if (chiusa) return chiusa;
    const id = String(msg?.id || '').trim();
    try {
      if (!auth.isSignedIn()) {
        return { ok: false, code: 'auth', error: 'Accedi per votare i miglioramenti.' };
      }
      const vote = msg?.vote;
      if (!id) return { ok: false, error: 'Feedback non valido.' };
      if (vote !== 'works' && vote !== 'broken') {
        return { ok: false, error: "Voto non valido: usa 'works' o 'broken'." };
      }
      const cr = await credenziali();
      if (cr.esito) return cr.esito;
      if (cr.fallito) return esitoFallito(cr.fallito, id, VOTO_NON_REGISTRATO);
      const { uid, idToken } = cr;
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
      return esitoFallito(e, id, VOTO_NON_REGISTRATO);
    }
  }));

  // ORDINE DELIBERATO, guard PRIMA del feedback: le due scritture non sono atomiche, e col
  // feedback per primo una caduta di rete lasciava duplicati gratis. Crediti resi se fallisce.
  on(MSG.BOARD_REOPEN, soloFilo(async (msg) => {
    const chiusa = await bachecaChiusa();
    if (chiusa) return chiusa;
    const id = String(msg?.id || '').trim();
    try {
      if (!auth.isSignedIn()) {
        return { ok: false, code: 'auth', error: 'Accedi per segnalare che un fix è ancora rotto.' };
      }
      const text = String(msg?.text || '').trim();
      if (!id) return { ok: false, error: 'Feedback non valido.' };
      if (!text) return { ok: false, error: 'Descrivi cosa non funziona ancora.' };
      if (text.length > 10000) return { ok: false, error: 'Testo troppo lungo.' };

      const cr = await credenziali();
      if (cr.esito) return cr.esito;
      if (cr.fallito) return esitoFallito(cr.fallito, id, RIAPERTURA_NON_PARTITA);
      const { uid, idToken } = cr;
      if (!FB?.castReopenRequest || !FB?.submit || !FB?.getPublic) throw new Error('SN_FEEDBACK non caricato nel main process');

      const MR = globalThis.SN_MANAGE_REVIEW;
      if (!MR?.canReopen) throw new Error('SN_MANAGE_REVIEW non caricato nel main process');

      // Idoneità: rilegge il documento originale (non fidarsi dello stato che
      // il renderer aveva in cache) e applica lo stesso gate "Risolti, niente
      // red-team" della board + il guard anti-doppia-riapertura.
      // Un guasto di rete qui non è «fix non trovato»: sale a esitoFallito.
      const original = await FB.getPublic(id);
      if (!original) return TORNATO_IN_LAVORAZIONE;
      if (!MR.canReopen(original, { releasedVersion: versioneRilasciata() })) {
        return MR.hasReopenRequest(original)
          ? { ok: false, code: 'gone', error: 'Qualcuno ha già segnalato che questo miglioramento non funziona ancora: è tornato in lavorazione.' }
          : TORNATO_IN_LAVORAZIONE;
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
        // Dall'owner parte con la sua prova come dal riquadro (#953), mai col ripiego anonimo.
        const firmato = Mittente.firma(`uid:${uid}`);
        created = await FB.submit({
          // Un id d'invio STABILE per questa coppia (fix, persona): se la
          // risposta si perde per strada ma il documento è nato lo stesso, un
          // secondo tentativo non crea un doppione — il server lo riconosce e
          // torna quello di prima. È ciò che rende sicuro rimettere a posto il
          // segnale qui sotto quando la creazione fallisce: la porta si riapre
          // per chi deve riprovare, e resta chiusa ai duplicati.
          submissionId: `reopen-${id}-${uid}`,
          text: `[Riapertura #${original.seq || id}] ${text}`,
          // URL e titolo dell'originale sono di chi l'ha mandato e non arrivano qui (#583):
          // al triage bastano `parentId` e il numero nel testo.
          url: '',
          title: '',
          userAgent: '',
          clientId: firmato.clientId,
          parentId: id,
          name: '',
        }, firmato.dallOwner ? { idToken, soloAdmin: true } : undefined);
        // #678 — la riapertura è una segnalazione di questa installazione:
        // entra nel registro, e la prossima apertura della home va a vedere
        // subito se c'è una ricompensa da dare (l'attesa si azzera).
        try { await globalThis.SN_FEEDBACK_MINE?.ricordaId?.(created?.id); } catch (_) {}
        try {
          await globalThis.SN_SEGNALAZIONI_MIE?.registra?.({
            id: created?.id, feedbackId: created?.id, testo: text, stato: 'inviata',
            num: FB.formatNum ? FB.formatNum(created?.seq, 0) : '',
            titolo: original.name ? `Ancora rotto: ${original.name}` : 'Ancora rotto',
          });
        } catch (_) {}
      } catch (e) {
        // Best-effort: i crediti tornano invece di lasciare l'utente scalato senza nulla in cambio.
        try { await Credits.award({ kind: 'board_reopen_refund', credits: amount, ref: id }); } catch (_) {}
        // E torna indietro anche il SEGNALE di riapertura. Lo scriviamo per
        // primo apposta, perché chiude la porta ai duplicati (#269); ma se la
        // segnalazione collegata non è nata, di duplicati non ce n'è nessuno —
        // c'è solo chi ha scritto cosa non funziona ancora e, con quel segnale
        // rimasto lì, si sentiva rispondere che il fix era «già stato
        // segnalato»: i crediti tornavano, la spiegazione no, e non poteva più
        // mandarla. Adesso può riprovare, e l'id d'invio stabile qui sopra
        // impedisce che da un ritentativo nasca un doppione.
        try { await FB.clearReopenRequest(id, uid, { idToken }); } catch (_) {}
        throw e;
      }

      return { ok: true, feedbackId: created.id, balance: spend.balance };
    } catch (e) {
      return esitoFallito(e, id, RIAPERTURA_NON_PARTITA);
    }
  }));

  // #986 — le segnalazioni mandate da qui: le legge e le toglie solo una pagina di Filo.
  const Mie = () => globalThis.SN_SEGNALAZIONI_MIE;
  on(MSG.SEGNALAZIONI_MIE_LIST, soloFilo(async () => {
    const voci = await Mie().elenco();
    return voci ? { ok: true, voci, precedenti: await Mie().haPrecedenti() } : { ok: true, voci: [], incognito: true };
  }));
  on(MSG.SEGNALAZIONI_MIE_TOGLI, soloFilo(async (msg) => ({ ok: true, voci: await Mie().togli(msg?.id) })));

  on(MSG.BOARD_CLEAR_VOTE, soloFilo(async (msg) => {
    const chiusa = await bachecaChiusa();
    if (chiusa) return chiusa;
    const id = String(msg?.id || '').trim();
    try {
      if (!auth.isSignedIn()) {
        return { ok: false, code: 'auth', error: 'Accedi per votare i miglioramenti.' };
      }
      if (!id) return { ok: false, error: 'Feedback non valido.' };
      const cr = await credenziali();
      if (cr.esito) return cr.esito;
      if (cr.fallito) return esitoFallito(cr.fallito, id, VOTO_NON_REGISTRATO);
      const { uid, idToken } = cr;
      if (!FB?.clearVote) throw new Error('SN_FEEDBACK non caricato nel main process');

      await FB.clearVote(id, uid, { idToken });
      // Il ritiro del voto non è una penalità: il premio resta, e un voto successivo non ripaga.
      const votes = await fetchVotes(id);
      return { ok: true, uid, votes };
    } catch (e) {
      return esitoFallito(e, id, VOTO_NON_REGISTRATO);
    }
  }));

  // Legge SOLO il campo `votes` della scheda pubblica (GET singolo, proiezione
  // mask). {} = la scheda non ha voti; null = rilettura non riuscita, e la
  // pagina tiene il conteggio che ha: un {} lì azzererebbe un voto già scritto.
  async function fetchVotes(id) {
    if (!FB?.rest) return null;
    try {
      const url = `${FB.rest.FIRESTORE_BASE}/${FB.rest.VIEW_COLLECTION}/${encodeURIComponent(id)}` +
        `?mask.fieldPaths=votes&key=${FB.rest.API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const doc = await res.json();
      const obj = FB.fsDocToObject(doc);
      return (obj && typeof obj.votes === 'object' && obj.votes) || {};
    } catch (_) {
      return null;
    }
  }
};
