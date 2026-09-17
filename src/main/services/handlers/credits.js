// Crediti: saldo, consumi e sincronizzazione sul doc `credits/<uid>` per-account.
// La logica (saldo, refill, aggregazione) sta nel motore puro SN_CREDITS; qui solo il
// trasporto: IPC verso la UI e REST Firestore con l'ID token utente.

const auth = require('../../auth/google-auth');
const { soloFilo } = require('./origine');
// Serve splitNotes(): la spiegazione non tecnica dentro le note del feedback risolto.
require('../../../shared/feedbackThread.js');

module.exports = function register(on, ctx) {
  const { MSG, broadcastToTabs } = ctx;
  const Credits = globalThis.SN_CREDITS;
  const FB = globalThis.SN_FEEDBACK;

  // L'uid Firebase, non l'email: è quello che le regole vedono, e lo riusa anche board.js.
  const currentUid = auth.getUid;

  // Il costo in € resta nel doc privato dell'utente e non arriva mai alla UI: la vista
  // pubblica lo elimina.
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

  // Comandi dell'owner: gate negli handler IPC, garanzia forte nelle Firestore rules; le
  // scritture cross-account usano il suo ID token.

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

  // Corrispondenza esatta sull'email; l'uid torna in `_id`, o null se non c'è.
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

  // L'avviso `giftNotice` resta sul doc e si accumula finché l'utente non lo vede.
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

  // Il popup dei crediti regalati si mostra una volta sola: letto il `giftNotice`, si azzera.
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
          // Registro utenti: email e nome si aggiornano subito, senza aspettare la prossima mutazione del saldo, così l'owner trova l'account in /users e /gift.
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

  on(MSG.GET_CREDITS, async () => {
    await ensureAccountSync().catch(() => {});
    return { ok: true, credits: await Credits.getPublic(), signedIn: auth.isSignedIn() };
  });

  // «Sei il proprietario?» non basta: sul suo computer è sempre sì. Elenco degli utenti e
  // regali si chiedono dalla chat della dashboard, non da un sito visitato (#583).
  on(MSG.OWNER_LIST_USERS, soloFilo(async () => {
    if (!auth.isAdmin()) return { ok: false, error: 'Comando riservato al proprietario.' };
    try { return { ok: true, users: await adminListUsers() }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  }));

  on(MSG.OWNER_GIFT_CREDITS, soloFilo(async (msg) => {
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
  }));

  // Ogni invio è un evento distinto: si premia ogni volta.
  on(MSG.CREDITS_AWARD_FEEDBACK, async (msg) => {
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
      if (!id || !(FB?.listAllPublic || FB?.listPublic)) return empty;

      // Si leggono le SCHEDE pubbliche, non i feedback: la collezione vera non si apre senza
      // credenziali. E tutte, non una pagina: una segnalazione vecchia chiusa oggi nasce fuori.
      let lette;
      try {
        lette = FB.listAllPublic
          ? await FB.listAllPublic({ timeoutMs: 15000 })
          : await FB.listPublic({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 15000 });
      }
      catch (e) { console.warn('[credits] schede dei feedback non disponibili:', e?.message || e); return empty; }

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

      const state = await Credits.load();
      const rewarded = state.rewardedFeedback || {};
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
        if (!fid || rewarded[fid]) continue;            // già premiato: niente doppio premio
        // Quanto vale la segnalazione lo dice la SCHEDA (`reward`): la priorità è un giudizio
        // interno e sulla scheda non c'è, quindi dal feedback ogni premio scenderebbe al minimo.
        const credits = Number.isFinite(Number(f.reward)) && Number(f.reward) > 0
          ? Math.round(Number(f.reward))
          : Credits.rewardForPriority(0);
        // Marcare il feedback come premiato evita che ricompaia alla prossima apertura.
        await Credits.award({ kind: 'feedback_resolved', credits, ref: fid });
        rewards.push({
          id: fid,
          num: FB.formatNum ? FB.formatNum(f.seq, f.subSeq) : '',
          name: String(f.name || '').slice(0, 200),
          explanation: resolutionExplanation(f),
          credits,
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
