// Crediti (gamification): saldo e consumo per tipo d'uso per la pagina Crediti, ricompense feedback, sincronizzazione sul doc Firestore `credits/<uid>` per-account.
// La LOGICA (saldo, refill, aggregazione) vive nel motore puro SN_CREDITS (creditStore.js, testabile headless); qui c'è solo il trasporto: IPC verso la UI e REST Firestore con l'ID token utente.

const auth = require('../../auth/google-auth');
const { soloFilo } = require('./origine');
// Di SN_FEEDBACK_THREAD serve splitNotes(), per estrarre la spiegazione non tecnica dalle note del feedback risolto (C5).
require('../../../shared/feedbackThread.js');

module.exports = function register(on, ctx) {
  const { MSG, broadcastToTabs } = ctx;
  const Credits = globalThis.SN_CREDITS;
  const FB = globalThis.SN_FEEDBACK;

  // uid Firebase (claim dell'ID token), centralizzato in google-auth: lo riusa board.js, perché votes.<uid> vuole l'uid e non l'email.
  const currentUid = auth.getUid;

  // Si sincronizza tutto lo stato del motore. Il costo € resta nel doc privato dell'utente ma non lascia mai il main verso la UI: la vista pubblica lo elimina.
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
    // Registro utenti (#210.1): email e nome dell'account vanno sul proprio doc, così l'owner può risolvere email→uid (/gift) ed elencare gli iscritti (/users). Solo se il profilo c'è, e con la stessa updateMask, così non si azzera nulla quando manca.
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

  // Comandi riservati all'owner: il gate applicativo è negli handler IPC, la garanzia forte è nelle Firestore rules. Le scritture cross-account usano l'ID token dell'owner.

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

  // Corrispondenza esatta sull'email; ritorna l'oggetto completo (uid in _id, eventuale giftNotice) o null.
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

  // Somma al saldo remoto e lascia un avviso `giftNotice` sul doc, cumulativo finché l'utente non lo vede.
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

  // Avviso "crediti regalati" (#210.4): se il doc porta un `giftNotice`, il popup si mostra una volta sola e il campo si azzera.
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

  // Default ON quando il setting non è mai stato scritto (=== undefined): è la politica di F4. False solo in caso di errore di lettura.
  async function getAutoFeedbackEnabled() {
    try {
      const Storage = globalThis.SN_STORAGE;
      if (!Storage || typeof Storage.getSettings !== 'function') return false;
      const s = await Storage.getSettings();
      const v = s && s.security && s.security.autoFeedback;
      return v === undefined ? true : !!v;
    } catch (_) { return false; }
  }

  // Adotta lo stato remoto al primo accesso o al cambio account; se il doc non esiste ancora, ci pusha lo stato locale. Idempotente per uid.
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
          // Primo accesso di questo account: lo stato locale (magari già coi 1000 di benvenuto) diventa il suo e si materializza su Firestore.
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

  // #583 — «sei il proprietario?» da solo non basta: sul suo computer la risposta è sempre sì, ed è l'unico dove c'è qualcosa da prendere. Questi due comandi si scrivono nella chat della dashboard: un sito visitato non deve poter chiedere l'elenco di chi usa Filo né regalare crediti a un indirizzo che sceglie lui.
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

  // +5 crediti subito all'invio di un feedback (C3): ogni invio è un evento distinto, quindi si premia ogni volta.
  on(MSG.CREDITS_AWARD_FEEDBACK, async (msg) => {
    const { SN_CONST } = globalThis;
    const amount = (msg && Number(msg.credits)) || SN_CONST.CREDIT.FEEDBACK_SEND;
    const r = await Credits.award({ kind: 'feedback_sent', credits: amount, ref: msg?.ref || null });
    return { ok: true, ...r };
  });

  // Cosa legge chi ha mandato il feedback quando gli viene detto che è risolto. La scelta — la frase in chiaro sì, il report cifrato mai — sta nella logica pura, accanto al parsing della conversazione, dove si può provare.
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
      // Allinea la cache al doc dell'account prima di premiare, così rewardedFeedback è quello vero anche dopo un cambio dispositivo.
      await ensureAccountSync().catch(() => {});
      const id = await globalThis.SN_STORAGE?.getRaw?.('sn_feedback_client_id', null);
      if (!id || !(FB?.listAllPublic || FB?.listPublic)) return empty;

      // #583: si leggono le SCHEDE pubbliche, non i feedback — la collezione vera non si apre senza credenziali (e questa macchina non ne ha). Nella scheda c'è tutto quello che serve qui e niente dei feedback altrui.
      // TUTTE le schede, non una pagina: la pagina era dei più recenti PER DATA D'INVIO, quindi una segnalazione vecchia chiusa oggi nasceva già fuori, e chi l'aveva mandata non riceveva né annuncio né crediti mentre il suo fix compariva in bacheca sotto i suoi occhi.
      let lette;
      try {
        lette = FB.listAllPublic
          ? await FB.listAllPublic({ timeoutMs: 15000 })
          : await FB.listPublic({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 15000 });
      }
      catch (e) { console.warn('[credits] schede dei feedback non disponibili:', e?.message || e); return empty; }

      // Dal più recente: la lettura completa arriva nell'ordine interno del database, cioè quello degli identificativi, casuale — senza questo, chi si vede risolvere due segnalazioni insieme le trova annunciate a caso. Si ordina una COPIA: sono le stesse righe che legge chi gestisce i feedback.
      const all = (Array.isArray(lette) ? lette.slice() : []).sort((a, b) => {
        const ta = Date.parse(a?.createdAt || '');
        const tb = Date.parse(b?.createdAt || '');
        const va = Number.isFinite(ta);
        const vb = Number.isFinite(tb);
        if (va && vb && ta !== tb) return tb - ta;
        if (va !== vb) return va ? -1 : 1;
        return String(b?._id || '').localeCompare(String(a?._id || ''));
      });

      // Hash del clientId locale calcolato UNA volta per tutti i confronti (SHA-256 troncato a 32 hex, come feedbackClientIdHash.js).
      let localIdHash = '';
      try {
        const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
        if (H && H.hashClientId) localIdHash = await H.hashClientId(id);
      } catch (_) {}

      const state = await Credits.load();
      const rewarded = state.rewardedFeedback || {};
      const rewards = [];
      for (const f of all) {
        // La macchina UTENTE non ha la chiave privata: non può leggere `status` cifrato e guarda solo l'enum grossolano in chiaro. La regola sta in SN_FB_STATUS accanto alla mappa che la determina (#476) — separarle è ciò che aveva fatto premiare gli attacchi confermati.
        const FBS = globalThis.SN_FB_STATUS;
        const isResolved = FBS && FBS.isResolvedForUser
          ? FBS.isResolvedForUser(f)
          : f.statusPublic === 'closed';
        if (!f || !isResolved) continue;
        // #583: l'impronta sulla scheda è di QUELLA scheda, non dell'installazione, così chi legge la bacheca non può raggruppare i fix per segnalatore. Qui si ricalcola scheda per scheda; i feedback anteriori a giugno 2026 non ce l'hanno e non producono più ricompensa.
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
        // #583 — quanto vale la segnalazione lo dice la SCHEDA (`reward`), non il feedback: la priorità è un giudizio interno e sulla scheda non c'è, quindi letta dal feedback ogni ricompensa scenderebbe in silenzio alla fascia più bassa. Le schede pubblicate prima del campo restano alla fascia minima, che è quanto davano comunque.
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
