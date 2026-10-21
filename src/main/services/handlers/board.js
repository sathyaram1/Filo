// Handler di dominio: bacheca utente — voto funziona/non-funziona (DC2) e «Ancora rotto?» (DC4).
// Vota e riapre chi ha un portafoglio, con l'identità dell'installazione; la riapertura la fa il server (#1076).
// Il token non arriva mai al renderer. Regole della scheda: firestore.rules (feedback-public).

const auth = require('../../auth/google-auth');
const identita = require('../../auth/anon-auth');
const Mittente = require('../feedbackMittente');
// #583 — queste porte non sono del proprietario: valgono per chiunque
// abbia fatto l'accesso, e su una macchina con una sessione aperta «hai una
// sessione?» è sempre sì. Senza guardare da dove arriva la richiesta, una
// pagina di un sito visitato votava al posto dell'utente, gli cancellava il
// voto e gli spendeva i crediti per riaprire un fix, aprendo a suo nome una
// segnalazione col testo che voleva. Il voto e la riapertura sono gesti che si
// fanno in bacheca, che è una pagina di Filo.
const { soloFilo } = require('./origine');

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
  const GIA_SEGNALATO = {
    ok: false, code: 'gone',
    error: 'Qualcuno ha già segnalato che questo miglioramento non funziona ancora: è tornato in lavorazione.',
  };
  // #1076 — un account anonimo non costa niente: voto e riapertura chiedono i crediti di Filo.
  const SENZA_PORTAFOGLIO = {
    voto: { ok: false, code: 'portafoglio', error: 'Per votare servono i crediti di Filo: riscatta un invito nella pagina Crediti.' },
    riapertura: { ok: false, code: 'portafoglio', error: 'Per segnalare che un fix è ancora rotto servono i crediti di Filo: riscatta un invito nella pagina Crediti.' },
  };
  const SENZA_PORTAFOGLIO_BACHECA = 'Per votare e per segnalare un fix ancora rotto servono i crediti di Filo: riscatta un invito nella pagina Crediti.';
  const PORTAFOGLIO_NON_ATTIVO = {
    ok: false, code: 'portafoglio',
    error: 'Il portafoglio di questa installazione non risulta attivo: per ora non si può votare né segnalare.',
  };

  function statoHttp(e) {
    const s = Number(e && e.status);
    if (s > 0) return s;
    const m = /\((\d{3})\)/.exec(String((e && e.message) || ''));
    return m ? Number(m[1]) : 0;
  }

  const WM = () => globalThis.SN_WALLET_MAIN;
  function haPortafoglio() {
    try { return Boolean(WM()?.haPortafoglio?.()); } catch (_) { return false; }
  }

  // Chi fa il gesto. L'owner con la sua credenziale: le regole lo lasciano scrivere da admin e la riapertura parte
  // col suo nome (#953). Gli altri con l'identità dell'installazione, dove sta il portafoglio che regole e server
  // pretendono (#1076): l'account Google collegato prima che il portafoglio esistesse è un altro uid.
  // Il token si chiede fuori da getUid(), che inghiotte ogni errore: senza rete il rinnovo fallisce e «sessione
  // scaduta» manderebbe a rifare un accesso che non serve.
  async function credenziali(gesto) {
    if (Mittente.dallOwner()) {
      let idToken = null;
      try { idToken = await auth.getIdToken(); } catch (e) { return { fallito: e }; }
      if (!idToken) return { esito: SESSIONE_SCADUTA };
      const uid = await auth.getUid();
      if (!uid) return { esito: SESSIONE_SCADUTA };
      return { uid, idToken, owner: true };
    }
    if (!haPortafoglio()) return { esito: SENZA_PORTAFOGLIO[gesto] };
    let idToken = null;
    try { idToken = await identita.getIdToken(); } catch (e) { return { fallito: e, installazione: true }; }
    const uid = await identita.getUid().catch(() => null);
    if (!idToken || !uid) return { fallito: new Error('identità dell\'installazione non disponibile'), installazione: true };
    return { uid, idToken, owner: false, installazione: true };
  }

  // `installazione`: il token rifiutato non è l'accesso Google, e «rifai l'accesso» non servirebbe.
  async function esitoFallito(e, id, generico, { installazione = false } = {}) {
    console.warn('[board] gesto non riuscito:', e?.message || e);
    const CE = globalThis.SN_CHAT_ERRORS;
    if (CE?.isTransientNetwork?.(e)) {
      return { ok: false, code: 'offline', error: 'Non riesco a raggiungere il server: controlla la connessione e riprova.' };
    }
    // Un rinnovo rifiutato chiude la sessione (signOut in google-auth).
    const st = statoHttp(e);
    if (!auth.isSignedIn() || (!installazione && st === 401)) return SESSIONE_SCADUTA;
    // Una scheda che non c'è più non si può scrivere: le regole rifiutano la
    // creazione, e la risposta è un 403 che da solo non dice perché.
    if (id && (st === 403 || st === 404)) {
      try {
        const card = await FB.getPublic(id);
        if (!inBacheca(card)) return TORNATO_IN_LAVORAZIONE;
        // La scheda c'è: le regole hanno rifiutato chi vota, cioè il portafoglio (sospeso, o non più sul server).
        if (installazione && st === 403) return PORTAFOGLIO_NON_ATTIVO;
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

  // Con quale identità vota questa installazione (la bacheca ci riconosce il proprio voto) e se può farlo. Senza
  // portafoglio non si crea un'identità per chiederlo; senza accesso non si decide niente (il gesto chiede l'accesso).
  on(MSG.BOARD_IDENTITA, soloFilo(async () => {
    if (!auth.isSignedIn()) return { ok: true, uid: null };
    if (Mittente.dallOwner()) return { ok: true, uid: await auth.getUid(), portafoglio: true };
    if (!haPortafoglio()) return { ok: true, uid: null, portafoglio: false, motivo: SENZA_PORTAFOGLIO_BACHECA };
    return { ok: true, uid: await identita.getUid().catch(() => null), portafoglio: true };
  }));

  on(MSG.BOARD_CAST_VOTE, soloFilo(async (msg) => {
    const id = String(msg?.id || '').trim();
    let installazione = false;
    try {
      if (!auth.isSignedIn()) {
        return { ok: false, code: 'auth', error: 'Accedi per votare i miglioramenti.' };
      }
      const vote = msg?.vote;
      if (!id) return { ok: false, error: 'Feedback non valido.' };
      if (vote !== 'works' && vote !== 'broken') {
        return { ok: false, error: "Voto non valido: usa 'works' o 'broken'." };
      }
      const cr = await credenziali('voto');
      if (cr.esito) return cr.esito;
      installazione = Boolean(cr.installazione);
      if (cr.fallito) return esitoFallito(cr.fallito, id, VOTO_NON_REGISTRATO, { installazione });
      const { uid, idToken } = cr;
      if (!FB?.castVote) throw new Error('SN_FEEDBACK non caricato nel main process');

      await FB.castVote(id, { uid, vote, credibilitySnapshot: 1 }, { idToken });

      // Il premio locale (+10 una volta per feedback, idempotente in creditStore.awardVoteOnce) vale solo senza
      // portafoglio, come gli altri premi (#816): col portafoglio i crediti veri li dà il server, che per un voto
      // non ne dà.
      const reward = haPortafoglio()
        ? { awarded: false, credits: 0 }
        : await Credits.awardVoteOnce(id, SN_CONST.CREDIT.BOARD_VOTE);

      // Rilegge il documento per tornare il tally REALE (altri voti compresi),
      // così la UI non deve fidarsi solo dell'aggiornamento ottimistico locale.
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
      return esitoFallito(e, id, VOTO_NON_REGISTRATO, { installazione });
    }
  }));

  // «Ancora rotto?» (DC4): chi è in bacheca segnala che un fix "Risolti" è ancora rotto. Il gesto lo fa il server
  // (callable `bachecaRiapri`, #1076): scala i crediti del portafoglio, crea il feedback collegato e segna la scheda
  // in una transazione sola, quindi qui niente compensazioni. Il controllo d'idoneità qui sotto serve solo a
  // rispondere subito: decide il server.
  on(MSG.BOARD_REOPEN, soloFilo(async (msg) => {
    const id = String(msg?.id || '').trim();
    let installazione = false;
    try {
      if (!auth.isSignedIn()) {
        return { ok: false, code: 'auth', error: 'Accedi per segnalare che un fix è ancora rotto.' };
      }
      const text = String(msg?.text || '').trim();
      if (!id) return { ok: false, error: 'Feedback non valido.' };
      const owner = Mittente.dallOwner();
      if (!owner && !haPortafoglio()) return SENZA_PORTAFOGLIO.riapertura;
      if (!text) return { ok: false, error: 'Descrivi cosa non funziona ancora.' };
      if (text.length > 10000) return { ok: false, error: 'Testo troppo lungo.' };
      if (!FB?.getPublic) throw new Error('SN_FEEDBACK non caricato nel main process');
      const MR = globalThis.SN_MANAGE_REVIEW;
      if (!MR?.canReopen) throw new Error('SN_MANAGE_REVIEW non caricato nel main process');

      // Un guasto di rete qui non è «fix non trovato»: sale a esitoFallito.
      const original = await FB.getPublic(id);
      if (!original) return TORNATO_IN_LAVORAZIONE;
      if (!MR.canReopen(original, { releasedVersion: versioneRilasciata() })) {
        return MR.hasReopenRequest(original) ? GIA_SEGNALATO : TORNATO_IN_LAVORAZIONE;
      }
      if (owner) return await riapriDaOwner(id, text, original);

      installazione = true;
      const chiama = WM()?.chiama;
      if (typeof chiama !== 'function') throw new Error('SN_WALLET_MAIN non caricato nel main process');
      const r = await chiama('bachecaRiapri', { id, text });
      if (!r || r.ok !== true) return rifiutoRiapertura(r);
      await ricordaSegnalazione(r.feedbackId, String(r.num || '').replace(/^#/, ''), text, original);
      // La spesa è un movimento del portafoglio: la pagina Crediti aperta lo mostra subito.
      try { ctx.broadcastToFiloPages?.({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
      return { ok: true, feedbackId: r.feedbackId, cost: r.already ? 0 : r.cost, balance: r.balance };
    } catch (e) {
      return esitoFallito(e, id, RIAPERTURA_NON_PARTITA, { installazione });
    }
  }));

  // Il server ha detto no: la frase giusta per la scheda, coi numeri quando ci sono.
  function rifiutoRiapertura(r) {
    const motivo = r && r.reason;
    if (motivo === 'no_wallet') return SENZA_PORTAFOGLIO.riapertura;
    if (motivo === 'disabled') return PORTAFOGLIO_NON_ATTIVO;
    if (motivo === 'already_reopened') return GIA_SEGNALATO;
    if (motivo === 'not_on_board') return TORNATO_IN_LAVORAZIONE;
    if (motivo === 'insufficient') {
      const W = globalThis.SN_WALLET;
      const saldo = W?.formatCredits ? W.formatCredits(r.balance) : String(r.balance ?? 0);
      return { ok: false, error: `Servono ${r.cost} crediti per riaprire un fix (saldo: ${saldo}).` };
    }
    if (motivo === 'empty_text') return { ok: false, error: 'Descrivi cosa non funziona ancora.' };
    if (motivo === 'text_too_long') return { ok: false, error: `Testo troppo lungo (al massimo ${r.max} caratteri).` };
    if (motivo === 'rate_limited') return { ok: false, error: 'Troppi tentativi di fila: riprova fra un minuto.' };
    return { ok: false, error: RIAPERTURA_NON_PARTITA };
  }

  // L'owner riapre con la sua credenziale (admin nelle regole) e senza spesa: è il gesto di chi i fix li chiude.
  // Il segnale per primo, così un figlio orfano non lascia la porta aperta ai doppioni (#269); se la creazione non
  // va il segnale torna indietro, e l'id d'invio stabile tiene chiusa la porta a un secondo figlio (#602).
  async function riapriDaOwner(id, text, original) {
    const cr = await credenziali('riapertura');
    if (cr.esito) return cr.esito;
    if (cr.fallito) return esitoFallito(cr.fallito, id, RIAPERTURA_NON_PARTITA);
    const { uid, idToken } = cr;
    if (!FB?.castReopenRequest || !FB?.submit) throw new Error('SN_FEEDBACK non caricato nel main process');
    let created;
    try {
      await FB.castReopenRequest(id, uid, { idToken });
      // Dall'owner parte con la sua prova come dal riquadro (#953), mai col ripiego anonimo.
      const firmato = Mittente.firma(`uid:${uid}`);
      created = await FB.submit({
        submissionId: `reopen-${id}-${uid}`,
        text: `[Riapertura #${original.seq || id}] ${text}`,
        // #583: URL e titolo della pagina originale non arrivano fin qui: il collegamento è `parentId`.
        url: '',
        title: '',
        userAgent: '',
        clientId: firmato.clientId,
        parentId: id,
        name: '',
      }, firmato.dallOwner ? { idToken, soloAdmin: true } : undefined);
    } catch (e) {
      try { await FB.clearReopenRequest(id, uid, { idToken }); } catch (_) {}
      throw e;
    }
    await ricordaSegnalazione(created?.id, FB.formatNum ? FB.formatNum(created?.seq, 0) : '', text, original);
    return { ok: true, feedbackId: created.id, cost: 0 };
  }

  // #678 — la riapertura è una segnalazione di questa installazione: entra nel
  // registro, e la prossima apertura della home va a vedere subito se c'è una
  // ricompensa da dare (l'attesa si azzera).
  async function ricordaSegnalazione(feedbackId, num, text, original) {
    try { await globalThis.SN_FEEDBACK_MINE?.ricordaId?.(feedbackId); } catch (_) {}
    try {
      await globalThis.SN_SEGNALAZIONI_MIE?.registra?.({
        id: feedbackId, feedbackId, testo: text, stato: 'inviata', num,
        titolo: original.name ? `Ancora rotto: ${original.name}` : 'Ancora rotto',
      });
    } catch (_) {}
  }

  // #986 — le segnalazioni mandate da qui: le legge e le toglie solo una pagina di Filo.
  const Mie = () => globalThis.SN_SEGNALAZIONI_MIE;
  on(MSG.SEGNALAZIONI_MIE_LIST, soloFilo(async () => {
    const voci = await Mie().elenco();
    return voci ? { ok: true, voci, precedenti: await Mie().haPrecedenti() } : { ok: true, voci: [], incognito: true };
  }));
  on(MSG.SEGNALAZIONI_MIE_TOGLI, soloFilo(async (msg) => ({ ok: true, voci: await Mie().togli(msg?.id) })));

  on(MSG.BOARD_CLEAR_VOTE, soloFilo(async (msg) => {
    const id = String(msg?.id || '').trim();
    let installazione = false;
    try {
      if (!auth.isSignedIn()) {
        return { ok: false, code: 'auth', error: 'Accedi per votare i miglioramenti.' };
      }
      if (!id) return { ok: false, error: 'Feedback non valido.' };
      const cr = await credenziali('voto');
      if (cr.esito) return cr.esito;
      installazione = Boolean(cr.installazione);
      if (cr.fallito) return esitoFallito(cr.fallito, id, VOTO_NON_REGISTRATO, { installazione });
      const { uid, idToken } = cr;
      if (!FB?.clearVote) throw new Error('SN_FEEDBACK non caricato nel main process');

      await FB.clearVote(id, uid, { idToken });
      // NB: nessuna revoca del premio (non è una penalità, è solo ritiro del
      // voto) — rewardedVotes resta marcato: un voto successivo non ripaga.
      const votes = await fetchVotes(id);
      return { ok: true, uid, votes };
    } catch (e) {
      return esitoFallito(e, id, VOTO_NON_REGISTRATO, { installazione });
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
