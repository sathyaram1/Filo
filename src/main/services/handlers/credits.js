// Handler di dominio: crediti (gamification). Espone il saldo + il consumo per
// tipo d'uso alla pagina Crediti, accredita le ricompense feedback, e sincronizza
// lo stato sul doc Firestore `credits/<uid>` per-account.
//
// Separazione: la LOGICA (saldo, refill, aggregazione) vive nel motore puro
// SN_CREDITS (creditStore.js, testabile headless). Qui sopra c'è solo il
// trasporto: IPC verso la UI + REST Firestore autenticato con l'ID token utente.

const auth = require('../../auth/google-auth');
// SN_FEEDBACK_THREAD: ci serve splitNotes() per estrarre la spiegazione non
// tecnica dalle note del feedback risolto (C5). Idempotente se già caricato.
require('../../../shared/feedbackThread.js');

module.exports = function register(on, ctx) {
  const { MSG, broadcastToTabs } = ctx;
  const Credits = globalThis.SN_CREDITS;
  const FB = globalThis.SN_FEEDBACK;

  // ── uid dell'utente loggato (claim dell'ID token Firebase) ──────────────────
  // Centralizzato in google-auth.js (getUid): lo riusa anche l'handler board.js
  // (DC2) per lo stesso scopo (votes.<uid> richiede l'uid Firebase, non l'email).
  const currentUid = auth.getUid;

  // ── REST Firestore sul doc credits/<uid> ────────────────────────────────────
  // Campi sincronizzati: tutto lo stato del motore (saldo, refill, aggregati,
  // ricompense). Il costo € resta nel doc privato dell'utente ma non lascia mai
  // il main verso la UI (la vista pubblica lo elimina).
  const SYNC_FIELDS = ['balance', 'lastRefillDate', 'byUsage', 'byAction',
    'totalSpentCredits', 'totalCostEur', 'rewards', 'rewardedFeedback'];

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
    // Registro utenti (#210.1): scriviamo anche email/name dell'account loggato
    // sul proprio doc, così l'owner può risolvere email→uid (/gift) ed elencare
    // gli iscritti (/users). Solo se il profilo è disponibile, e con la stessa
    // updateMask così non azzeriamo nulla quando il profilo manca.
    const maskPaths = [...SYNC_FIELDS];
    const profile = auth.getProfile?.();
    if (profile?.email) { fields.email = FB.toFsValue(String(profile.email).toLowerCase()); maskPaths.push('email'); }
    if (profile?.name) { fields.name = FB.toFsValue(String(profile.name)); maskPaths.push('name'); }
    // updateMask così non azzeriamo campi non inviati.
    const mask = maskPaths.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const url = `${FB.rest.FIRESTORE_BASE}/credits/${encodeURIComponent(uid)}?${mask}&key=${FB.rest.API_KEY}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`credits push ${res.status}`);
  }

  // ── Comandi proprietario (#210): registro utenti + regalo crediti ───────────
  // Tutte le operazioni qui sotto sono riservate all'owner (auth.isAdmin()): il
  // gate applicativo è negli handler IPC, la garanzia forte è nelle Firestore
  // rules (match /credits/{uid} … allow read,write: if isAdmin()). Le scritture
  // cross-account usano l'ID token dell'owner come Bearer.

  // Elenco di tutti gli utenti registrati (doc credits con campo `email`).
  async function adminListUsers() {
    if (!FB?.rest) return [];
    const idToken = await auth.getIdToken();
    if (!idToken) throw new Error('Sessione scaduta: rifai l\'accesso.');
    const endpoint = `${FB.rest.FIRESTORE_BASE}:runQuery?key=${FB.rest.API_KEY}`;
    const body = { structuredQuery: { from: [{ collectionId: 'credits' }], limit: 1000 } };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`users ${res.status}`);
    const rows = await res.json();
    const users = [];
    for (const r of rows) {
      if (!r.document) continue;
      const o = FB.fsDocToObject(r.document);
      if (o.email) users.push({ email: o.email, name: o.name || '', balance: Math.round(Number(o.balance) || 0) });
    }
    users.sort((a, b) => a.email.localeCompare(b.email));
    return users;
  }

  // Trova il doc credits il cui campo `email` corrisponde (esatto). Ritorna
  // l'oggetto completo (incluso uid in _id e l'eventuale giftNotice) o null.
  async function adminFindByEmail(email) {
    if (!FB?.rest) return null;
    const idToken = await auth.getIdToken();
    if (!idToken) throw new Error('Sessione scaduta: rifai l\'accesso.');
    const endpoint = `${FB.rest.FIRESTORE_BASE}:runQuery?key=${FB.rest.API_KEY}`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'credits' }],
        where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } },
        limit: 1,
      },
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`lookup ${res.status}`);
    const rows = await res.json();
    for (const r of rows) { if (r.document) return FB.fsDocToObject(r.document); }
    return null;
  }

  // Regala `amount` crediti all'utente con `email`: somma al suo saldo remoto e
  // lascia un avviso `giftNotice` (cumulativo finché non lo vede) sul suo doc.
  async function adminGift(email, amount) {
    const target = await adminFindByEmail(email);
    if (!target || !target._id) throw new Error('Nessun utente registrato con questa email.');
    const uid = target._id;
    const newBalance = Math.round((Number(target.balance) || 0) + amount);
    const prevNotice = target.giftNotice && Math.round(Number(target.giftNotice.amount) || 0);
    const noticeAmount = (prevNotice > 0 ? prevNotice : 0) + amount;
    const idToken = await auth.getIdToken();
    const fields = {
      balance: FB.toFsValue(newBalance),
      giftNotice: FB.toFsValue({ amount: noticeAmount, ts: Date.now() }),
    };
    const mask = ['balance', 'giftNotice'].map((k) => `updateMask.fieldPaths=${k}`).join('&');
    const url = `${FB.rest.FIRESTORE_BASE}/credits/${encodeURIComponent(uid)}?${mask}&key=${FB.rest.API_KEY}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`gift ${res.status}`);
    return { balance: newBalance };
  }

  // Avviso "crediti regalati" (#210.4): se il doc dell'utente corrente porta un
  // `giftNotice`, mostra il popup una volta sola e azzera il campo così non si
  // ripresenta. `remote` è il doc appena letto in ensureAccountSync.
  async function maybeNotifyGift(uid, remote) {
    const amount = remote?.giftNotice && Math.round(Number(remote.giftNotice.amount) || 0);
    if (!amount || amount <= 0) return;
    broadcastToTabs({ type: MSG.GIFT_NOTICE, amount });
    const idToken = await auth.getIdToken();
    if (!idToken) return;
    const url = `${FB.rest.FIRESTORE_BASE}/credits/${encodeURIComponent(uid)}?updateMask.fieldPaths=giftNotice&key=${FB.rest.API_KEY}`;
    await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { giftNotice: { nullValue: null } } }),
    }).catch(() => {});
  }

  // Legge il flag "feedback autonomo attivo" dalle impostazioni correnti.
  // Default ON (true) quando il setting non è ancora stato scritto dall'utente
  // (=== undefined): corrisponde alla politica "ON di default" di F4.
  // Fallback false (safe) solo in caso di errore di lettura.
  async function getAutoFeedbackEnabled() {
    try {
      const Storage = globalThis.SN_STORAGE;
      if (!Storage || typeof Storage.getSettings !== 'function') return false;
      const s = await Storage.getSettings();
      const v = s && s.security && s.security.autoFeedback;
      // undefined → mai impostato → default ON
      return v === undefined ? true : !!v;
    } catch (_) { return false; }
  }

  // Adotta lo stato remoto al (primo) accesso o cambio account; se il doc non
  // esiste ancora, ci pusha lo stato locale corrente. Idempotente per uid.
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
          // Registro utenti (#210.1): se il doc remoto non ha ancora email/name
          // (o sono cambiati), aggiorniamoli subito senza aspettare la prossima
          // mutazione del saldo, così l'owner trova l'account in /users e /gift.
          const profile = auth.getProfile?.();
          const wantEmail = profile?.email ? String(profile.email).toLowerCase() : null;
          if (wantEmail && (remote.email !== wantEmail || (profile?.name && remote.name !== profile.name))) {
            await pushRemote(uid, await Credits.readState()).catch(() => {});
          }
          // Avviso crediti regalati (#210.4): se l'owner ha lasciato un avviso
          // sul doc, mostralo una volta sola e azzeralo.
          await maybeNotifyGift(uid, remote).catch(() => {});
        } else {
          // Primo accesso di questo account: lo stato locale (eventualmente già
          // 1000 di benvenuto) diventa il suo, e lo materializziamo su Firestore.
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

  // Push debounced su ogni mutazione del saldo (consumo in background, refill,
  // ricompensa). Non blocca mai il flusso chiamante.
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
  on(MSG.GET_CREDITS, async () => {
    await ensureAccountSync().catch(() => {});
    return { ok: true, credits: await Credits.getPublic(), signedIn: auth.isSignedIn() };
  });

  // ── Comandi proprietario (#210): /users e /gift ─────────────────────────────
  on(MSG.OWNER_LIST_USERS, async () => {
    if (!auth.isAdmin()) return { ok: false, error: 'Comando riservato al proprietario.' };
    try { return { ok: true, users: await adminListUsers() }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  on(MSG.OWNER_GIFT_CREDITS, async (msg) => {
    if (!auth.isAdmin()) return { ok: false, error: 'Comando riservato al proprietario.' };
    const amount = Math.round(Number(msg?.amount));
    const email = String(msg?.email || '').trim().toLowerCase();
    if (!Number.isInteger(amount) || amount <= 0) {
      return { ok: false, error: 'Numero di crediti non valido: usa un intero positivo.' };
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { ok: false, error: 'Email non valida.' };
    }
    try {
      const r = await adminGift(email, amount);
      return { ok: true, email, amount, balance: r.balance };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  // +5 crediti subito all'invio di un feedback (C3). Idempotenza per-invio è del
  // chiamante: ogni invio è un evento distinto, quindi premiamo ogni volta.
  on(MSG.CREDITS_AWARD_FEEDBACK, async (msg) => {
    const { SN_CONST } = globalThis;
    const amount = (msg && Number(msg.credits)) || SN_CONST.CREDIT.FEEDBACK_SEND;
    const r = await Credits.award({ kind: 'feedback_sent', credits: amount, ref: msg?.ref || null });
    return { ok: true, ...r };
  });

  // ── Ricompensa alla risoluzione di un feedback (C5) ─────────────────────────
  // base(clientId): toglie il prefisso "owner:" applicato agli invii dell'admin,
  // così l'install riconosce come "suoi" sia i feedback inviati da sloggato sia
  // quelli marcati owner quando era loggato (stesso clientId di base).
  function baseClientId(c) {
    const s = String(c || '');
    return s.startsWith('owner:') ? s.slice(6) : s;
  }

  // Cosa legge chi ha mandato il feedback, quando gli viene detto che è risolto.
  //
  // I DUE TESTI (spec ROUTINE-AUTH-SPEC.md §8). `userNote` è la frase scritta
  // per lui: breve, in chiaro, e leggibile sulla SUA macchina, che non ha —
  // giustamente — nessuna chiave. `notes` è un'altra cosa: è il report per
  // l'owner, con le scelte della lavorazione, e da qui in avanti viaggia
  // cifrato. Mostrargli quello era il motivo per cui il report non poteva
  // essere protetto.
  //
  // RETROCOMPATIBILITÀ: i feedback già chiusi hanno un testo solo, in chiaro,
  // dentro `notes`. Per quelli si continua a estrarre i turni del modello, come
  // prima — altrimenti chi torna su un feedback vecchio non leggerebbe più
  // niente. Se invece `notes` è cifrato e non c'è la frase, non si mostra il
  // ciphertext: si tace, che è meglio di un blob.
  function resolutionExplanation(f) {
    const frase = String((f && f.userNote) || '').trim();
    if (frase) return frase;

    const raw = String((f && f.notes) || '').trim();
    if (!raw || raw.startsWith('FENC')) return '';
    const FBT = globalThis.SN_FEEDBACK_THREAD;
    if (!FBT?.splitNotes) return raw;
    return FBT.splitNotes(raw)
      .filter((s) => s.role === 'model' && s.body)
      .map((s) => s.body)
      .join('\n\n')
      .trim();
  }

  on(MSG.GET_FEEDBACK_REWARDS, async () => {
    const empty = { ok: true, rewards: [], totalCredits: 0 };
    try {
      // Allinea la cache crediti al doc dell'account (così rewardedFeedback è
      // quello vero anche dopo un cambio dispositivo) prima di premiare.
      await ensureAccountSync().catch(() => {});
      const id = await globalThis.SN_STORAGE?.getRaw?.('sn_feedback_client_id', null);
      if (!id || !FB?.list) return empty;

      let all;
      try { all = await FB.list({ pageSize: 200 }); }
      catch (e) { console.warn('[credits] lista feedback non disponibile:', e?.message || e); return empty; }

      // S1.F2.2: pre-calcola l'hash del clientId locale UNA VOLTA per tutti i confronti.
      // Stesso algoritmo di feedbackClientIdHash.js (SHA-256 troncato 32 hex).
      let localIdHash = '';
      try {
        const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
        if (H && H.hashClientId) localIdHash = await H.hashClientId(id);
      } catch (_) {}

      const state = await Credits.load();
      const rewarded = state.rewardedFeedback || {};
      const rewards = [];
      for (const f of all) {
        // S1.F2.1: la macchina UTENTE non ha la chiave privata → non può leggere
        // `status` cifrato e guarda solo l'enum grossolano in chiaro. La regola
        // sta in SN_FB_STATUS accanto alla mappa che la determina (#476): è la
        // stessa decisione, e separarle è ciò che aveva fatto premiare gli
        // attacchi confermati.
        const FBS = globalThis.SN_FB_STATUS;
        const isResolved = FBS && FBS.isResolvedForUser
          ? FBS.isResolvedForUser(f)
          : f.statusPublic === 'closed';
        if (!f || !isResolved) continue;
        // S1.F2.2: match via clientIdHash (in chiaro, disponibile anche se clientId è cifrato).
        // RETROCOMPAT: se il feedback non ha clientIdHash (storico), ricadi sul confronto raw.
        const matched = (() => {
          if (f.clientIdHash && localIdHash) {
            return f.clientIdHash === localIdHash;
          }
          // Fallback per feedback storici senza clientIdHash: confronto raw clientId.
          return baseClientId(f.clientId) === id;
        })();
        if (!matched) continue; // solo i feedback DI questo install
        const fid = f._id;
        if (!fid || rewarded[fid]) continue;            // già premiato: niente doppio premio
        const priority = Math.max(0, Math.min(3, Math.round(Number(f.priority) || 0)));
        const credits = Credits.rewardForPriority(priority);
        // Accredita e marca questo feedback come premiato (state.rewardedFeedback),
        // così alla prossima apertura non ricompare.
        await Credits.award({ kind: 'feedback_resolved', credits, ref: fid });
        rewards.push({
          id: fid,
          num: FB.formatNum ? FB.formatNum(f.seq, f.subSeq) : '',
          name: String(f.name || '').slice(0, 200),
          explanation: resolutionExplanation(f.notes),
          credits,
          priority,
        });
      }
      const totalCredits = rewards.reduce((s, r) => s + r.credits, 0);
      return { ok: true, rewards, totalCredits };
    } catch (e) {
      console.warn('[credits] GET_FEEDBACK_REWARDS fallito:', e?.message || e);
      return empty;
    }
  });
};
