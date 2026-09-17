// Crediti sul server e chiave OpenRouter personale: si parla con filo-security con
// l'identità dell'INSTALLAZIONE, non con l'account Google — Filo funziona senza login.
// Qui si scrive anche il registro d'uso: il server lo confronta col consumo dichiarato.

const auth = require('../../auth/google-auth');
const identity = require('../../auth/anon-auth');
const walletStore = require('../../auth/wallet-store');

const FUNCTIONS_BASE = process.env.FILO_FUNCTIONS_BASE
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

module.exports = function register(on, ctx) {
  const { MSG, broadcastToTabs, broadcastToFiloPages } = ctx;
  const W = globalThis.SN_WALLET;
  const FB = globalThis.SN_FEEDBACK;

  // Quanto del conteggio locale è già stato dichiarato al server: non si porta due volte, e
  // sopravvive al riscatto e all'annullamento dell'identità.
  const DECLARED_KEY = 'walletLocalDeclared';

  // Ultimi parametri del server: servono a scalare i crediti nelle righe del registro e a
  // comporre i messaggi.
  let lastServer = null;

  // `asOwner`: le funzioni riservate vogliono il token Google, dov'è l'email in allowlist;
  // tutto il resto usa l'identità dell'installazione.
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

  // Da dove viene la chiave che parte davvero: 'own' dell'utente, 'personal' dal server,
  // 'factory' incastonata, 'none'.
  async function keySource() {
    try {
      const s = await ctx.getEffectiveSettings();
      const k = String((s && s.apiKeys && s.apiKeys.openrouter) || '');
      if (!k) return 'none';
      if (await ownKeySet()) return 'own';
      if (k === walletStore.personalKey()) return 'personal';
      return 'factory';
    } catch (_) { return 'none'; }
  }

  async function ownKeySet() {
    try {
      const s = await globalThis.SN_STORAGE.getSettings();
      return Boolean(s && s.apiKeys && String(s.apiKeys.openrouter || '').trim());
    } catch (_) { return false; }
  }

  async function readState() {
    const out = {
      ok: true, identity: { ok: false }, hasPersonalKey: Boolean(walletStore.personalKey()), pseudonym: walletStore.pseudonym(),
      usingOwnKey: await ownKeySet(), keySource: await keySource(), isOwner: Boolean(ctx.isAdmin()), server: null,
    };
    try {
      await identity.getIdToken();
      out.identity.ok = true;
    } catch (e) {
      out.identity.error = String(e?.message || e);
      out.identity.lost = e && e.code === 'identity_lost';
      out.identity.offline = e && e.code === 'offline';
      // Offline con la chiave personale qui: vale l'ultimo stato letto — il campo dell'invito e un
      // saldo locale a chi ha già il portafoglio sarebbero due bugie.
      const cached = out.hasPersonalKey && !out.identity.lost ? walletStore.lastServer() : null;
      if (cached && cached.hasWallet) out.server = { ...cached, stale: true, cached: true };
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
        if (out.hasPersonalKey) walletStore.saveLastServer({ ...out.server, readAt: new Date().toISOString() });
      }
    } catch (e) {
      out.error = /callable \w+ 5\d\d|fetch failed|ENOTFOUND|ECONN/i.test(String(e?.message || e)) ? 'not_reachable' : String(e?.message || e);
      // Server muto ma chiave personale qui: si mostra l'ultimo stato letto, dichiarato vecchio.
      const cached = out.hasPersonalKey ? walletStore.lastServer() : null;
      if (cached && cached.hasWallet) {
        out.server = { ...cached, stale: true, cached: true };
        lastServer = lastServer || out.server;
      }
    }
    return out;
  }

  // Saldo, inviti e riscatto muovono dati dell'utente: solo pagine filo:// e shell, a una
  // pagina web `forbidden`.
  const isFilo = (origin) => String(origin || '').startsWith('filo://');
  const filoOnly = (fn) => async (msg, sender, origin) => {
    if (!isFilo(origin) && !sender?.isShell) return { ok: false, error: 'forbidden' };
    return fn(msg, sender, origin);
  };

  on(MSG.WALLET_STATE, filoOnly(async () => readState()));

  // Nuova chiave: il portafoglio esiste sul server, la chiave non è qui.
  on(MSG.WALLET_REISSUE, filoOnly(async () => {
    const idErr = await identityProblem();
    if (idErr) return { ok: false, status: 'no_identity', message: idErr };
    let r;
    try {
      r = await callable('walletReissue', {});
    } catch (e) {
      return { ok: false, status: 'not_reachable', message: W.redeemMessage('not_reachable') };
    }
    const status = (r && r.status) || 'internal';
    if (status !== 'ok') return { ok: false, status, message: W.redeemMessage(status === 'no_wallet' ? 'internal' : status) };
    walletStore.save({ key: r.key, pseudonym: r.pseudonym, redeemedAt: new Date().toISOString() });
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
    return { ok: true, status, message: 'Nuova chiave pronta: i tuoi crediti si usano di nuovo da qui.', state: await readState() };
  }));

  on(MSG.WALLET_RESET_IDENTITY, filoOnly(async () => {
    identity.resetIdentity();
    walletStore.clear();
    lastServer = null;
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
    return { ok: true, state: await readState() };
  }));

  // L'identità dell'installazione che non si crea è un problema diverso da «il server non
  // risponde»: il messaggio deve dirlo, invece di mandare a guardare la rete.
  async function identityProblem() {
    try { await identity.getIdToken(); return null; } catch (e) {
      return `Non riesco a preparare l'identità di questa installazione: ${String(e?.message || e)}.`;
    }
  }

  on(MSG.WALLET_REDEEM, filoOnly(async (msg) => {
    // Il codice si estrae da quello che è stato incollato, riga intera compresa: nessun tetto
    // sul campo, nessun taglio.
    const code = W.extractCode((msg && msg.code) || '');
    if (!code) return { ok: false, status: 'invalid_code', message: W.redeemMessage('invalid_code') };
    const idErr = await identityProblem();
    if (idErr) return { ok: false, status: 'no_identity', message: idErr };
    // I crediti del conteggio locale si portano sul server: chi li ha guadagnati non li perde
    // passando al portafoglio. Si dichiarano una volta sola, paga solo la parte nuova.
    let localCredits = 0;
    let balanceNow = 0;
    try {
      const pub = await globalThis.SN_CREDITS?.getPublic?.();
      balanceNow = Number(pub && (pub.balanceExact != null ? pub.balanceExact : pub.balance)) || 0;
      const declared = Number(await globalThis.SN_STORAGE.getRaw(DECLARED_KEY, 0)) || 0;
      localCredits = Math.max(0, Math.floor(balanceNow - declared));
    } catch (_) { localCredits = 0; }
    let r;
    try {
      r = await callable('walletRedeem', { code, localCredits });
    } catch (e) {
      return { ok: false, status: 'not_reachable', message: W.redeemMessage('not_reachable') };
    }
    const status = (r && r.status) || 'internal';
    if (status !== 'ok') return { ok: false, status, message: W.redeemMessage(status) };
    walletStore.save({ key: r.key, pseudonym: r.pseudonym, redeemedAt: new Date().toISOString() });
    if (localCredits > 0) { try { await globalThis.SN_STORAGE.setRaw(DECLARED_KEY, Math.floor(balanceNow)); } catch (_) {} }
    // La chiave si rilegge a ogni chiamata: non c'è niente da ricaricare, basta avvisare le
    // pagine che il saldo è cambiato.
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
    const state = await readState();
    return { ok: true, status, message: W.redeemOkMessage(r), credits: r.credits, inviteCodes: r.inviteCodes, state };
  }));

  const ownerOnly = (fn) => filoOnly(async (msg) => {
    if (!ctx.isAdmin()) return { ok: false, error: 'not_admin' };
    try { return { ok: true, ...(await fn(msg)) }; } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  on(MSG.WALLET_OWNER_OVERVIEW, ownerOnly(async () => ({ overview: await callable('walletOverview', {}, { asOwner: true }) })));
  on(MSG.WALLET_OWNER_GRANT, ownerOnly(async (msg) => {
    const result = await callable('walletGrant', { pseudonym: msg.pseudonym, credits: msg.credits, why: msg.why || 'owner' }, { asOwner: true });
    // Regalo alla propria installazione: la pagina Crediti aperta accanto deve muoversi, come a
    // ogni cambio di saldo.
    if (result && result.ok) { try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {} }
    return { result };
  }));
  on(MSG.WALLET_OWNER_INVITES, ownerOnly(async (msg) => ({
    codes: (await callable('walletCreateInvites', { count: msg.count || 1 }, { asOwner: true }))?.codes || [],
  })));

  // Le righe si accodano e si scrivono a gruppi: una chat con strumenti fa più chiamate al
  // turno. Oltre il tetto si perde la più vecchia dicendolo: la trova la riconciliazione.
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

  // La riga si scrive solo se la chiamata è partita con la chiave personale: con la chiave
  // dell'utente il consumo è affar suo e non conta sulla nostra.
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

  // Un avviso ogni dieci minuti: il 402 torna a ogni chiamata finché il tetto non sale, e un
  // toast per chiamata sarebbe un martello.
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

  globalThis.SN_WALLET_MAIN = {
    recordUsage, outOfCreditsNotice, flush, readState, keySource,
    // Solo per i test (NODE_ENV=test): simula il riavvio senza rete.
    expireIdentityForTest: () => { if (process.env.NODE_ENV === 'test') identity._expireToken(); },
  };

  // All'avvio e in background: identità e stato del server letti una volta, così la prima riga
  // del registro ha già i parametri di conversione.
  setTimeout(() => { readState().catch(() => {}); }, 4000);
};
