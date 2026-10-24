// Crediti: saldo, consumi e sincronizzazione sul doc `credits/<uid>` per-account.
// La logica (saldo, refill, aggregazione) sta nel motore puro SN_CREDITS; qui solo il
// trasporto: IPC verso la UI e REST Firestore con l'ID token utente.

const auth = require('../../auth/google-auth');
// SN_FEEDBACK_THREAD: ci serve splitNotes() per estrarre la spiegazione non
// tecnica dalle note del feedback risolto (C5). Idempotente se già caricato.
require('../../../shared/feedbackThread.js');

// Campi sincronizzati: tutto lo stato del motore (saldo, refill, aggregati,
// ricompense). Il costo € resta nel doc privato dell'utente ma non lascia mai
// il main verso la UI (la vista pubblica lo elimina).
const SYNC_FIELDS = ['balance', 'lastRefillDate', 'byUsage', 'byAction',
  'totalSpentCredits', 'totalCostEur', 'rewards', 'rewardedFeedback'];

module.exports = function register(on, ctx) {
  const { MSG, broadcastToTabs } = ctx;
  const Credits = globalThis.SN_CREDITS;
  const FB = globalThis.SN_FEEDBACK;

  // L'uid Firebase, non l'email: è quello che le regole vedono, e lo riusa anche board.js.
  const currentUid = auth.getUid;

  // ── REST Firestore sul doc credits/<uid> ────────────────────────────────────

  async function loadRemote(uid) {
    if (!FB?.rest) return null;
    const idToken = await auth.getIdToken();
    if (!idToken) return null;
    const url = `${FB.rest.FIRESTORE_BASE}/credits/${encodeURIComponent(uid)}?key=${FB.rest.API_KEY}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`credits load ${res.status}`);
    const doc = await res.json();
    return FB.fsDocToObject(doc);
  }

  async function pushRemote(uid, state) {
    if (!FB?.rest) return;
    const idToken = await auth.getIdToken();
    if (!idToken) return;
    const fields = {};
    for (const k of SYNC_FIELDS) fields[k] = FB.toFsValue(state[k]);
    // Email e nome vanno sul proprio doc perché l'owner possa risolvere email→uid ed elencare
    // gli iscritti. Solo se il profilo c'è e con la stessa updateMask, così non si azzera nulla.
    const maskPaths = [...SYNC_FIELDS];
    const profile = auth.getProfile?.();
    if (profile?.email) { fields.email = FB.toFsValue(String(profile.email).toLowerCase()); maskPaths.push('email'); }
    if (profile?.name) { fields.name = FB.toFsValue(String(profile.name)); maskPaths.push('name'); }
    const mask = maskPaths.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const url = `${FB.rest.FIRESTORE_BASE}/credits/${encodeURIComponent(uid)}?${mask}&key=${FB.rest.API_KEY}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`credits push ${res.status}`);
  }

  // Avviso "crediti regalati" (#210.4): se il doc dell'utente corrente porta un
  // `giftNotice`, mostra il popup una volta sola e azzera il campo così non si
  // ripresenta. `remote` è il doc appena letto in ensureAccountSync.
  // La spinta arriva a ogni home aperta: il regalo lo racconta la prima che lo prende (#664), come il benvenuto dell'invito.
  let regaloDaDire = 0;
  function annunciaRegalo(amount) {
    regaloDaDire = amount;
    broadcastToTabs({ type: MSG.GIFT_NOTICE, amount });
  }
  globalThis.SN_CREDITS_MAIN = { annunciaRegalo };
  async function maybeNotifyGift(uid, remote) {
    const amount = remote?.giftNotice && Math.round(Number(remote.giftNotice.amount) || 0);
    if (!amount || amount <= 0) return;
    annunciaRegalo(amount);
    const idToken = await auth.getIdToken();
    if (!idToken) return;
    const url = `${FB.rest.FIRESTORE_BASE}/credits/${encodeURIComponent(uid)}?updateMask.fieldPaths=giftNotice&key=${FB.rest.API_KEY}`;
    await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { giftNotice: { nullValue: null } } }),
    }).catch(() => {});
  }

  // Default ON quando il setting non è mai stato scritto; false solo su errore di lettura.
  async function getAutoFeedbackEnabled() {
    try {
      const Storage = globalThis.SN_STORAGE;
      if (!Storage || typeof Storage.getSettings !== 'function') return false;
      const s = await Storage.getSettings();
      const v = s && s.security && s.security.autoFeedback;
      return v === undefined ? true : !!v;
    } catch (_) { return false; }
  }

  // Al primo accesso o al cambio account vince lo stato remoto; se il doc non c'è si pusha il
  // locale. Idempotente per uid.
  let lastSyncedOwner; // undefined = mai sincronizzato in questa sessione
  let syncing = null;
  async function ensureAccountSync() {
    const uid = await currentUid();
    const autoFeedbackEnabled = await getAutoFeedbackEnabled().catch(() => false);
    const state = await Credits.load({ autoFeedbackEnabled });
    // Non loggato: la cache locale resta com'è (modalità offline/anonima).
    if (!uid) { lastSyncedOwner = null; return state; }
    if (uid === lastSyncedOwner && state.owner === uid) return state;
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        const remote = await loadRemote(uid);
        if (remote) {
          await Credits.adopt(remote, uid);
          // Email e nome si aggiornano subito, senza aspettare una mutazione del saldo:
          // l'owner deve trovare l'account in /users e /gift.
          const profile = auth.getProfile?.();
          const wantEmail = profile?.email ? String(profile.email).toLowerCase() : null;
          if (wantEmail && (remote.email !== wantEmail || (profile?.name && remote.name !== profile.name))) {
            await pushRemote(uid, await Credits.readState()).catch(() => {});
          }
          await maybeNotifyGift(uid, remote).catch(() => {});
        } else {
          // Primo accesso: lo stato locale, benvenuto compreso, diventa suo e si materializza su
          // Firestore.
          await Credits.setOwner(uid);
          await pushRemote(uid, await Credits.readState());
        }
        lastSyncedOwner = uid;
      } catch (e) {
        console.warn('[credits] sync account fallita:', e?.message || e);
      } finally { syncing = null; }
      return Credits.load();
    })();
    return syncing;
  }

  // Push debounced a ogni mutazione del saldo: non blocca mai il flusso chiamante.
  let pushTimer = null;
  Credits.onChange(() => {
    broadcastToTabs({ type: MSG.CREDITS_CHANGED });
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      pushTimer = null;
      try {
        const uid = await currentUid();
        if (uid) await pushRemote(uid, await Credits.readState());
      } catch (e) { console.warn('[credits] push fallito:', e?.message || e); }
    }, 4000);
  });

  // ── IPC ─────────────────────────────────────────────────────────────────────
  on(MSG.GIFT_NOTICE_CLAIM, async (_msg, _sender, origin) => {
    if (!String(origin || '').startsWith('filo://')) return { ok: false, error: 'forbidden' };
    const amount = regaloDaDire;
    regaloDaDire = 0;
    return { ok: true, amount };
  });

  on(MSG.GET_CREDITS, async () => {
    await ensureAccountSync().catch(() => {});
    return { ok: true, credits: await Credits.getPublic(), signedIn: auth.isSignedIn() };
  });

  // +5 crediti subito all'invio di un feedback (C3). Idempotenza per-invio è del
  // chiamante: ogni invio è un evento distinto, quindi premiamo ogni volta.
  // Con un portafoglio il premio lo dà il server dopo i controlli (#816): il
  // conteggio locale non si muove. `inArrivo`: la segnalazione porta lo
  // pseudonimo, senza il quale il server non sa a chi darlo. `senzaPremio`:
  // oltre il tetto del giorno il server non paga (#1077), e lo si dice.
  on(MSG.CREDITS_AWARD_FEEDBACK, async (msg) => {
    const WM = globalThis.SN_WALLET_MAIN;
    if (WM && WM.haPortafoglio && WM.haPortafoglio()) {
      const conPseudonimo = Boolean(WM.pseudonym && WM.pseudonym());
      const senzaPremio = conPseudonimo && WM.notaInvio ? WM.notaInvio(msg && msg.ref) : '';
      return { ok: true, wallet: true, credits: 0, inArrivo: conPseudonimo && !senzaPremio, senzaPremio };
    }
    const { SN_CONST } = globalThis;
    const amount = (msg && Number(msg.credits)) || SN_CONST.CREDIT.FEEDBACK_SEND;
    const r = await Credits.award({ kind: 'feedback_sent', credits: amount, ref: msg?.ref || null });
    return { ok: true, ...r };
  });

  // Cosa legge chi ha segnalato quando gli si dice che è risolto. La scelta — la frase in
  // chiaro sì, il report cifrato mai — sta nella logica pura, dove si può provare.
  function resolutionExplanation(f) {
    const FBT = globalThis.SN_FEEDBACK_THREAD;
    if (FBT?.explanationForReporter) return FBT.explanationForReporter(f);
    // Senza il modulo condiviso: la frase se c'è, altrimenti niente. Mai il ciphertext.
    const frase = String((f && f.userNote) || '').trim();
    if (frase) return frase;
    const raw = String((f && f.notes) || '').trim();
    return raw.startsWith('FENC') ? '' : raw;
  }

  on(MSG.GET_FEEDBACK_REWARDS, async () => {
    const empty = { ok: true, rewards: [], totalCredits: 0 };
    try {
      // Allinea la cache al doc dell'account prima di premiare: dopo un cambio dispositivo i premi
      // già dati sono quelli veri.
      await ensureAccountSync().catch(() => {});
      const id = await globalThis.SN_STORAGE?.getRaw?.('sn_feedback_client_id', null);
      if (!id || !FB) return empty;

      // #583: si leggono le SCHEDE pubbliche, non i feedback. La collezione
      // vera non si apre senza credenziali (e questa macchina non ne ha: il
      // popup gira da chiunque abbia Filo). Nella scheda c'è tutto quello che
      // serve qui — l'impronta per riconoscere i propri, il titolo, il numero,
      // la frase per chi ha segnalato e la cifra che gli spetta — e niente dei
      // feedback altrui.
      //
      // #678: si chiedono le PROPRIE schede, per id, e non più tutte. La
      // domanda «mi spetta una ricompensa?» riguarda le poche segnalazioni di
      // questa installazione, e gli id li sa questa installazione: leggere
      // l'intera bacheca per cercarsi dentro costava una lettura per scheda
      // esistente, a ogni apertura di scheda nuova e per ogni utente. Adesso
      // costa una lettura per propria segnalazione non ancora premiata — di
      // solito zero — e non più di una volta ogni quattro ore, salvo che
      // l'utente abbia appena mandato o riaperto qualcosa.
      const MINE = globalThis.SN_FEEDBACK_MINE;
      if (!MINE) return empty;
      const adesso = Date.now();
      const state = await Credits.load();
      const rewarded = state.rewardedFeedback || {};

      // Ha mandato segnalazioni PRIMA che il registro esistesse? Il registro
      // nasce al primo invio, quindi se non c'è ancora l'unica traccia di una
      // storia precedente sta nel portafoglio.
      const avevaSegnalato = Object.keys(rewarded).length > 0
        || (Array.isArray(state.rewards) && state.rewards.some((r) => r && r.kind === 'feedback_sent'));
      await MINE.inauguraSeServe(adesso, avevaSegnalato);
      const registro = await MINE.leggi();

      // L'eredità: un'installazione che segnalava già prima del registro si
      // cerca le schede leggendole tutte, una volta al giorno e per un mese.
      // Le installazioni nuove non passano mai di qui.
      const scansione = MINE.toccaScansione(registro, adesso);
      if (!scansione && !MINE.scaduto(registro, adesso)) return empty;
      const guardati = registro.ids.slice();
      const daChiedere = guardati.filter((fid) => !rewarded[fid]);
      if (!scansione && daChiedere.length === 0) {
        await MINE.segnaControllo(adesso, { visti: guardati });
        return empty;
      }

      let lette;
      try {
        if (!scansione) lette = await FB.getManyPublic(daChiedere, { timeoutMs: 15000 });
        else if (FB.listAllPublic) lette = await FB.listAllPublic({ timeoutMs: 15000 });
        else lette = await FB.listPublic({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 15000 });
      }
      catch (e) {
        // Il registro NON si segna come controllato: una rete caduta non è una
        // risposta, e chiedere di nuovo fra poco è giusto.
        console.warn('[credits] schede dei feedback non disponibili:', e?.message || e);
        return empty;
      }
      const imparati = [];

      // Dal più recente: la lettura completa arriva in ordine di identificativo, cioè a caso.
      // Si ordina una COPIA: sono le stesse righe che legge chi gestisce i feedback.
      const all = (Array.isArray(lette) ? lette.slice() : []).sort((a, b) => {
        const ta = Date.parse(a?.createdAt || '');
        const tb = Date.parse(b?.createdAt || '');
        const va = Number.isFinite(ta);
        const vb = Number.isFinite(tb);
        if (va && vb && ta !== tb) return tb - ta;
        if (va !== vb) return va ? -1 : 1;
        return String(b?._id || '').localeCompare(String(a?._id || ''));
      });

      // Hash del clientId locale, calcolato una volta per tutti i confronti.
      let localIdHash = '';
      try {
        const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
        if (H && H.hashClientId) localIdHash = await H.hashClientId(id);
      } catch (_) {}

      // #816 — con un portafoglio la cifra è quella che il server ha
      // accreditato per QUELLA segnalazione; i movimenti si chiedono una volta
      // sola, e solo se c'è davvero qualcosa da annunciare.
      const WM = globalThis.SN_WALLET_MAIN;
      const W = globalThis.SN_WALLET;
      const conPortafoglio = Boolean(WM && WM.haPortafoglio && WM.haPortafoglio() && W && W.resolutionReward);
      let movimenti;
      async function movimentiDelServer() {
        if (movimenti) return movimenti;
        movimenti = { grants: null, fresh: false };
        try {
          const srv = (await WM.readState())?.server;
          if (srv && srv.hasWallet && Array.isArray(srv.grants)) movimenti = { grants: srv.grants, fresh: !srv.cached };
        } catch (_) {}
        return movimenti;
      }

      const rewards = [];
      for (const f of all) {
        // Questa macchina non ha la chiave privata: dello stato vede solo l'enum in chiaro.
        // La regola sta in SN_FB_STATUS, accanto alla mappa che lo determina (#476).
        const FBS = globalThis.SN_FB_STATUS;
        const isResolved = FBS && FBS.isResolvedForUser
          ? FBS.isResolvedForUser(f)
          : f.statusPublic === 'closed';
        if (!f || !isResolved) continue;
        // L'impronta sulla scheda è di QUELLA scheda, non dell'installazione: chi legge la bacheca
        // non può raggruppare i fix per segnalatore, quindi si ricalcola scheda per scheda (#583).
        const matched = await (async () => {
          if (!f.clientIdTag || !localIdHash) return false;
          try {
            const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
            if (!H || !H.cardTag) return false;
            return f.clientIdTag === await H.cardTag(f._id, localIdHash);
          } catch (_) { return false; }
        })();
        if (!matched) continue; // solo i feedback DI questo install
        const fid = f._id;
        // La scansione dell'eredità è anche il momento in cui il registro
        // impara gli id di prima: dalla volta dopo bastano quelli.
        if (scansione && fid) { imparati.push(fid); guardati.push(fid); }
        if (!fid || rewarded[fid]) continue;            // già premiato: niente doppio premio
        // #583 — quanto vale la segnalazione lo dice la SCHEDA (`reward`), non
        // il feedback: la priorità è un giudizio interno e sulla scheda non
        // c'è. Letta dal feedback, qui sarebbe sempre assente e ogni
        // ricompensa scenderebbe in silenzio alla fascia più bassa. Le schede
        // pubblicate prima che il campo esistesse non ce l'hanno: per quelle
        // resta la fascia minima, che è quello che davano comunque.
        let credits;
        if (conPortafoglio) {
          const { grants, fresh } = await movimentiDelServer();
          const esito = W.resolutionReward({ card: f, grants, grantsFresh: fresh, redeemedAt: WM.redeemedAt(), now: adesso });
          // Movimento non ancora arrivato: si riguarda al controllo dopo.
          if (!esito.announce) continue;
          credits = esito.credits;
          await Credits.markFeedbackAnnounced(fid);
        } else {
          credits = Number.isFinite(Number(f.reward)) && Number(f.reward) > 0
            ? Math.round(Number(f.reward))
            : Credits.rewardForPriority(0);
          // Accredita e marca questo feedback come premiato (state.rewardedFeedback),
          // così alla prossima apertura non ricompare.
          await Credits.award({ kind: 'feedback_resolved', credits, ref: fid });
        }
        const annuncio = {
          id: fid,
          num: FB.formatNum ? FB.formatNum(f.seq, f.subSeq) : '',
          name: String(f.name || '').slice(0, 200),
          explanation: resolutionExplanation(f),
          // Risolta o chiusa senza modifiche: il riquadro non le racconta uguali.
          status: f.status === 'done' || !f.status ? 'done' : 'closed',
          credits,
        };
        rewards.push(annuncio);
        // #986 — l'annuncio è anche il momento in cui la copia locale passa a «risolta»: dopo, non torna.
        try {
          await globalThis.SN_SEGNALAZIONI_MIE?.chiusa?.(fid, {
            stato: annuncio.status === 'closed' ? 'chiusa' : 'risolta',
            creataIl: f.createdAt,
            num: annuncio.num, titolo: annuncio.name, risposta: annuncio.explanation,
          });
        } catch (_) {}
      }
      await MINE.segnaControllo(adesso, { visti: guardati, impara: imparati, scansione });
      const totalCredits = rewards.reduce((s, r) => s + r.credits, 0);
      return { ok: true, rewards, totalCredits };
    } catch (e) {
      console.warn('[credits] GET_FEEDBACK_REWARDS fallito:', e?.message || e);
      return empty;
    }
  });
};

module.exports.SYNC_FIELDS = SYNC_FIELDS;
