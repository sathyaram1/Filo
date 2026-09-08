// Handler di dominio: crediti sul server e chiave OpenRouter personale
// (feedback #598).
//
// COSA FA
//   - parla con le funzioni `wallet*` di filo-security con l'identità
//     dell'INSTALLAZIONE (anon-auth.js), non con l'account Google: i crediti
//     seguono la copia di Filo, e Filo funziona senza login;
//   - al riscatto di un invito riceve la chiave personale e la mette al sicuro
//     (wallet-store.js, cifrata); da lì in poi withDefaults la usa per tutte
//     le chiamate ai modelli quando l'utente non ha una chiave sua;
//   - scrive il REGISTRO D'USO: una riga per chiamata fatta con la chiave
//     personale (pseudonimo, azione, modello, chi ha servito, token, costo).
//     Il server confronta ogni ora la somma delle righe col consumo che
//     OpenRouter dichiara per la chiave: chi non le scrive si vede;
//   - avvisa quando OpenRouter rifiuta per crediti finiti (402), una volta,
//     senza ritentare.
//
// Il saldo NON lo calcola nessuno qui: lo dice il server, che lo legge da
// OpenRouter (tetto della chiave meno consumo).

const auth = require('../../auth/google-auth');
const identity = require('../../auth/anon-auth');
const walletStore = require('../../auth/wallet-store');

const FUNCTIONS_BASE = process.env.FILO_FUNCTIONS_BASE
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

module.exports = function register(on, ctx) {
  const { MSG, broadcastToTabs, broadcastToFiloPages } = ctx;
  const W = globalThis.SN_WALLET;
  const FB = globalThis.SN_FEEDBACK;

  // Ultimi parametri del server (euro per credito, cambio, quota): servono a
  // scalare i crediti nelle righe del registro e a comporre i messaggi.
  let lastServer = null;

  // ── Callable ──────────────────────────────────────────────────────────────
  // `asOwner`: le funzioni riservate all'owner vogliono il token dell'account
  // Google (è lì che sta l'email nella allowlist admin); tutto il resto usa
  // l'identità dell'installazione.
  async function callable(name, data = {}, { asOwner = false } = {}) {
    const idToken = asOwner ? await auth.getIdToken() : await identity.getIdToken();
    if (!idToken) throw new Error(asOwner ? 'not_signed_in' : 'no_identity');
    const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error?.message || ''; } catch (_) {}
      const err = new Error(`callable ${name} ${res.status}${detail ? ': ' + detail : ''}`);
      err.status = res.status;
      throw err;
    }
    const body = await res.json();
    return body && body.result;
  }

  async function ownKeySet() {
    try {
      const s = await globalThis.SN_STORAGE.getSettings();
      return Boolean(s && s.apiKeys && String(s.apiKeys.openrouter || '').trim());
    } catch (_) { return false; }
  }

  // ── Stato per la pagina Crediti ───────────────────────────────────────────
  // { ok, identity:{ ok, error? }, hasPersonalKey, pseudonym, usingOwnKey,
  //   server: <walletState> | null, error? }
  async function readState() {
    const out = { ok: true, identity: { ok: false }, hasPersonalKey: Boolean(walletStore.personalKey()), pseudonym: walletStore.pseudonym(), usingOwnKey: await ownKeySet(), server: null };
    try {
      await identity.getIdToken();
      out.identity.ok = true;
    } catch (e) {
      out.identity.error = String(e?.message || e);
      return out;
    }
    try {
      out.server = await callable('walletState');
      if (out.server && out.server.hasWallet) {
        lastServer = out.server;
        if (!out.pseudonym && out.server.pseudonym && out.hasPersonalKey) {
          walletStore.save({ ...walletStore.load(), pseudonym: out.server.pseudonym });
          out.pseudonym = out.server.pseudonym;
        }
      }
    } catch (e) {
      out.error = /callable \w+ 5\d\d|fetch failed|ENOTFOUND|ECONN/i.test(String(e?.message || e)) ? 'not_reachable' : String(e?.message || e);
    }
    return out;
  }

  on(MSG.WALLET_STATE, async () => readState());

  // Riscatto: { code } → { ok, status, message, state? }.
  on(MSG.WALLET_REDEEM, async (msg) => {
    const code = String((msg && msg.code) || '').trim();
    if (!code) return { ok: false, status: 'invalid_code', message: W.redeemMessage('invalid_code') };
    let r;
    try {
      r = await callable('walletRedeem', { code });
    } catch (e) {
      const status = /no_identity/.test(String(e?.message)) ? 'internal' : 'not_reachable';
      return { ok: false, status, message: W.redeemMessage(status) };
    }
    const status = (r && r.status) || 'internal';
    if (status !== 'ok') return { ok: false, status, message: W.redeemMessage(status) };
    walletStore.save({ key: r.key, pseudonym: r.pseudonym, redeemedAt: new Date().toISOString() });
    // La config dei modelli effettivi legge la chiave a ogni chiamata: non c'è
    // niente da ricaricare. Si avvisano le pagine che il saldo è cambiato.
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
    const state = await readState();
    return { ok: true, status, message: W.redeemMessage('ok'), credits: r.credits, inviteCodes: r.inviteCodes, state };
  });

  // ── Owner ─────────────────────────────────────────────────────────────────
  const ownerOnly = (fn) => async (msg) => {
    if (!ctx.isAdmin()) return { ok: false, error: 'not_admin' };
    try { return { ok: true, ...(await fn(msg)) }; } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  };
  on(MSG.WALLET_OWNER_OVERVIEW, ownerOnly(async () => ({ overview: await callable('walletOverview', {}, { asOwner: true }) })));
  on(MSG.WALLET_OWNER_GRANT, ownerOnly(async (msg) => ({
    result: await callable('walletGrant', { pseudonym: msg.pseudonym, credits: msg.credits, why: msg.why || 'owner' }, { asOwner: true }),
  })));
  on(MSG.WALLET_OWNER_INVITES, ownerOnly(async (msg) => ({
    codes: (await callable('walletCreateInvites', { count: msg.count || 1 }, { asOwner: true }))?.codes || [],
  })));

  // ── Registro d'uso ────────────────────────────────────────────────────────
  // Le righe si accodano e si scrivono a gruppi (una commit Firestore ogni
  // pochi secondi): una chat con strumenti fa più chiamate al turno, e una
  // scrittura per chiamata sarebbe rumore. Se la scrittura fallisce si
  // ritenta al giro dopo; la coda non cresce oltre un tetto largo, e oltre si
  // perde il più vecchio dicendolo nel log (una riga persa la trova la
  // riconciliazione, non è un segreto).
  const queue = [];
  const QUEUE_CAP = 2000;
  let flushTimer = null;
  let flushing = false;

  async function flush() {
    flushTimer = null;
    if (flushing || !queue.length || !FB?.rest) return;
    flushing = true;
    const batch = queue.splice(0, 200);
    try {
      const idToken = await identity.getIdToken();
      const writes = batch.map((row) => ({
        update: {
          name: `${FB.rest.FIRESTORE_BASE.replace(/^https:\/\/firestore\.googleapis\.com\/v1\//, '')}/wallet-usage/${newId()}`,
          fields: Object.fromEntries(Object.entries(row).map(([k, v]) => [k, FB.toFsValue(v)])),
        },
        currentDocument: { exists: false },
      }));
      const res = await fetch(`${FB.rest.FIRESTORE_BASE}:commit?key=${FB.rest.API_KEY}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes }),
      });
      if (!res.ok) throw new Error(`wallet-usage commit ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    } catch (e) {
      console.warn('[wallet] registro d\'uso non scritto, ritento:', e?.message || e);
      queue.unshift(...batch);
      if (queue.length > QUEUE_CAP) {
        console.warn(`[wallet] registro d'uso: coda oltre ${QUEUE_CAP} righe, scarto le più vecchie`);
        queue.splice(0, queue.length - QUEUE_CAP);
      }
      scheduleFlush(30000);
    } finally {
      flushing = false;
      if (queue.length && !flushTimer) scheduleFlush(5000);
    }
  }

  function scheduleFlush(ms) {
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flush().catch(() => {}); }, ms);
  }

  function newId() {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 20; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }

  // Chiamato da costTracker.record per OGNI chiamata AI. Scrive la riga solo
  // se la chiamata è partita con la chiave personale: con una chiave
  // dell'utente il consumo è affar suo e OpenRouter non lo conta sulla nostra.
  async function recordUsage({ action, model, servedBy, usage }) {
    const pseudonym = walletStore.pseudonym();
    if (!pseudonym || !walletStore.personalKey()) return;
    if (await ownKeySet()) return;
    const costUsd = Number(usage && usage.costUsd) || 0;
    const fx = lastServer && lastServer.balance ? lastServer.balance : {};
    const row = W.usageRow({
      pseudonym, action, model, servedBy, usage, costUsd,
      credits: W.creditsForUsd(costUsd, { eurPerCredit: fx.eurPerCredit, eurUsd: fx.eurUsd }),
    });
    if (!row) return;
    queue.push(row);
    if (queue.length > QUEUE_CAP) queue.splice(0, queue.length - QUEUE_CAP);
    scheduleFlush(3000);
  }

  // ── Crediti finiti ────────────────────────────────────────────────────────
  // Un avviso ogni 10 minuti al massimo: il 402 arriva a ogni chiamata finché
  // il tetto non sale, e un toast per chiamata sarebbe un martello.
  let lastNoticeAt = 0;
  async function outOfCreditsNotice() {
    const now = Date.now();
    if (now - lastNoticeAt < 10 * 60 * 1000) return;
    lastNoticeAt = now;
    const usingOwnKey = await ownKeySet();
    const text = W.outOfCreditsMessage({ usingOwnKey, dailyCredits: lastServer && lastServer.dailyCredits });
    try { broadcastToTabs({ type: MSG.SHOW_TOAST, text: text.charAt(0).toUpperCase() + text.slice(1), duration: 8000 }); } catch (_) {}
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
  }

  globalThis.SN_WALLET_MAIN = { recordUsage, outOfCreditsNotice, flush, readState };

  // All'avvio: identità pronta e stato del server letto una volta, così la
  // prima riga del registro ha già i parametri di conversione. In background.
  setTimeout(() => { readState().catch(() => {}); }, 4000);
};
