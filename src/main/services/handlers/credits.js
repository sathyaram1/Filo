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
  function decodeJwt(token) {
    try {
      const payload = token.split('.')[1];
      const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      return JSON.parse(json);
    } catch (_) { return {}; }
  }
  async function currentUid() {
    if (!auth.isSignedIn()) return null;
    try {
      const tok = await auth.getIdToken();
      if (!tok) return null;
      const p = decodeJwt(tok);
      return p.user_id || p.sub || null;
    } catch (_) { return null; }
  }

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
    // updateMask così non azzeriamo campi non inviati.
    const mask = SYNC_FIELDS.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const url = `${FB.rest.FIRESTORE_BASE}/credits/${encodeURIComponent(uid)}?${mask}&key=${FB.rest.API_KEY}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`credits push ${res.status}`);
  }

  // Adotta lo stato remoto al (primo) accesso o cambio account; se il doc non
  // esiste ancora, ci pusha lo stato locale corrente. Idempotente per uid.
  let lastSyncedOwner; // undefined = mai sincronizzato in questa sessione
  let syncing = null;
  async function ensureAccountSync() {
    const uid = await currentUid();
    const state = await Credits.load();
    // Non loggato: la cache locale resta com'è (modalità offline/anonima).
    if (!uid) { lastSyncedOwner = null; return state; }
    if (uid === lastSyncedOwner && state.owner === uid) return state;
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        const remote = await loadRemote(uid);
        if (remote) {
          await Credits.adopt(remote, uid);
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

  // +5 crediti subito all'invio di un feedback (C3). Idempotenza per-invio è del
  // chiamante: ogni invio è un evento distinto, quindi premiamo ogni volta.
  on(MSG.CREDITS_AWARD_FEEDBACK, async (msg) => {
    const { SN_CONST } = globalThis;
    const amount = (msg && Number(msg.credits)) || SN_CONST.CREDIT.FEEDBACK_SEND;
    const r = await Credits.award({ kind: 'feedback_sent', credits: amount, ref: msg?.ref || null });
    return { ok: true, ...r };
  });
};
