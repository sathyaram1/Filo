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
//     senza ritentare;
//   - dà al provider la chiave di RISERVA (#629): se una chiamata partita con
//     la chiave scritta dall'utente viene rifiutata (401/402/403), si rifà
//     con la personale, e il rifiuto resta registrato per la pagina Crediti.
//
// Il saldo NON lo calcola nessuno qui: lo dice il server, che lo legge da
// OpenRouter (tetto della chiave meno consumo).

const auth = require('../../auth/google-auth');
const identity = require('../../auth/anon-auth');
const walletStore = require('../../auth/wallet-store');
const Defaults = require('../defaultsStore');

const FUNCTIONS_BASE = process.env.FILO_FUNCTIONS_BASE
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

module.exports = function register(on, ctx) {
  const { MSG, broadcastToTabs, broadcastToFiloPages } = ctx;
  const W = globalThis.SN_WALLET;
  const FB = globalThis.SN_FEEDBACK;

  // Con cosa Filo paga le risposte è appena cambiato: portafoglio riscattato,
  // identità azzerata, chiave propria messa o tolta. La home già aperta non se
  // ne accorgeva e restava ferma sull'ultimo messaggio: a un invito riscattato
  // da solo al primo avvio continuava a dire «Per attivare Filo serve un
  // codice d'invito», col primo suggerimento che portava a riscattare un
  // invito già riscattato. Qui la home si rifà e si spinge alle pagine aperte.
  // Senza chiave il messaggio si ricostruisce sul posto e non costa niente;
  // con la chiave il ricalcolo passa dal solito giro in background, che si
  // annuncia da sé quando è pronto, e qui non si spinge una cache vecchia.
  async function rinfrescaHome() {
    try {
      const r = await ctx.handleFiloGenerateDashboard({ openTabsCount: 0 });
      if (!r || !r.message || r.cached) return;
      broadcastToTabs({ type: MSG.FILO_DASHBOARD_UPDATED, message: r.message, suggestions: r.suggestions, ts: r.ts });
    } catch (_) { /* la home resta com'è: non è un motivo per fallire un riscatto */ }
  }

  // Il conteggio locale già dichiarato al server a un riscatto (per non
  // portarlo due volte). Sopravvive al riscatto e all'annullamento dell'identità.
  const DECLARED_KEY = 'walletLocalDeclared';

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

  // Da dove viene la chiave OpenRouter che parte davvero: 'own' (scritta
  // dall'utente), 'personal' (creata dal server), 'factory' (incastonata,
  // solo installazioni vecchie), 'none'. Lo legge la pagina Crediti e lo
  // usano i test.
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

  // La chiave scritta dall'utente (Impostazioni o pagina Crediti: è lo
  // stesso campo), o ''.
  async function ownKey() {
    try {
      const s = await globalThis.SN_STORAGE.getSettings();
      return String((s && s.apiKeys && s.apiKeys.openrouter) || '').trim();
    } catch (_) { return ''; }
  }

  async function ownKeySet() {
    return Boolean(await ownKey());
  }

  // ── Ripiego dalla chiave propria ai crediti (#629) ────────────────────────
  // Il provider chiama queste due a ogni chiamata: sono confronti di stringhe.
  // Da dove viene UNA chiave data (quella che ha servito davvero).
  async function keySourceOf(apiKey) {
    const k = String(apiKey || '').trim();
    if (!k) return '';
    if (k === (await ownKey())) return 'own';
    if (k === walletStore.personalKey()) return 'personal';
    return 'factory';
  }

  // La riserva per la chiave con cui una chiamata è partita: la personale del
  // portafoglio, solo se si era partiti con la chiave PROPRIA. Con la
  // personale già in uso non c'è riserva (un 402 lì sono i crediti finiti), e
  // con la chiave di fabbrica nemmeno.
  async function alternativeKeyFor(apiKey) {
    const k = String(apiKey || '').trim();
    const personal = walletStore.personalKey();
    if (!k || !personal || k === personal) return null;
    if (k !== (await ownKey())) return null;
    return { key: personal, source: 'personal' };
  }

  // L'ultimo rifiuto della chiave propria: { at, status, detail }. Lo legge
  // la pagina Crediti (readState); si cancella quando la chiave cambia.
  const REFUSAL_KEY = 'walletOwnKeyRefusal';
  async function noteOwnKeyRefusal({ status, detail } = {}) {
    const rec = { at: new Date().toISOString(), status: Number(status) || 0, detail: String(detail || '').slice(0, 300) };
    try { await globalThis.SN_STORAGE.setRaw(REFUSAL_KEY, rec); } catch (_) {}
    console.warn(`[wallet] chiave propria rifiutata (${rec.status}): ripiego sulla chiave personale`);
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
  }
  async function lastOwnKeyRefusal() {
    try {
      const r = await globalThis.SN_STORAGE.getRaw(REFUSAL_KEY, null);
      return r && r.at ? r : null;
    } catch (_) { return null; }
  }
  // La chiave propria è cambiata (messa, tolta, sostituita): il rifiuto di
  // quella di prima non dice niente su questa.
  async function ownKeyChanged() {
    try { await globalThis.SN_STORAGE.setRaw(REFUSAL_KEY, null); } catch (_) {}
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
    rinfrescaHome();
  }
  // La chiave propria ha servito una chiamata (lo dice il provider a ogni
  // risposta buona): il rifiuto ricordato, se c'era, è superato — il conto è
  // stato ricaricato — e la pagina Crediti, se è aperta, richiede spesa e
  // residuo. L'avviso parte a ogni chiamata solo se c'è qualcosa da
  // aggiornare: senza rifiuto ricordato, al massimo uno ogni pochi secondi.
  let lastOwnKeyUsedAt = 0;
  async function noteOwnKeySuccess() {
    const had = await lastOwnKeyRefusal();
    if (had) {
      try { await globalThis.SN_STORAGE.setRaw(REFUSAL_KEY, null); } catch (_) {}
      console.info('[wallet] la chiave propria risponde di nuovo: rifiuto dimenticato');
    }
    const now = Date.now();
    if (!had && now - lastOwnKeyUsedAt < 3000) return;
    lastOwnKeyUsedAt = now;
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED, ownKeyUsed: true }); } catch (_) {}
  }

  // ── Stato per la pagina Crediti ───────────────────────────────────────────
  // { ok, identity:{ ok, error? }, hasPersonalKey, pseudonym, usingOwnKey,
  //   server: <walletState> | null, error? }
  async function readState() {
    const own = await ownKey();
    const out = {
      ok: true, identity: { ok: false }, hasPersonalKey: Boolean(walletStore.personalKey()), pseudonym: walletStore.pseudonym(),
      usingOwnKey: Boolean(own), keySource: await keySource(), isOwner: Boolean(ctx.isAdmin()), server: null,
      // La chiave propria, per riconoscerla senza mostrarla; l'ultimo rifiuto
      // (#629); lo stato del registro d'uso (righe in attesa e l'ultimo
      // errore di scrittura: un registro che non si scrive non è un segreto).
      ownKeyTail: W.keyTail(own), ownKeyRefusal: own ? await lastOwnKeyRefusal() : null,
      usageLog: usageLogStatus(),
      // L'avviso di un invito arrivato da fuori (#651), finché le superfici
      // che lo raccontano non l'hanno mostrato.
      notice: await readNotice(),
    };
    try {
      await identity.getIdToken();
      out.identity.ok = true;
    } catch (e) {
      out.identity.error = String(e?.message || e);
      out.identity.lost = e && e.code === 'identity_lost';
      out.identity.offline = e && e.code === 'offline';
      // Offline (o identità che non si rinnova) con la chiave personale qui:
      // l'ultimo stato letto vale anche adesso. Il campo dell'invito e il
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
      // Server muto ma chiave personale qui: si mostra l'ultimo stato letto,
      // dichiarato vecchio. Il campo dell'invito e il saldo locale a chi ha
      // già il portafoglio sarebbero due bugie.
      const cached = out.hasPersonalKey ? walletStore.lastServer() : null;
      if (cached && cached.hasWallet) {
        out.server = { ...cached, stale: true, cached: true };
        lastServer = lastServer || out.server;
      }
    }
    return out;
  }

  // Cancello sull'origine (pattern «nuovo tipo di messaggio»): saldo, codici
  // d'invito, riscatto e nuova chiave leggono e muovono dati dell'utente.
  // Solo le pagine filo:// e la shell; una pagina web riceve `forbidden`.
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
    rinfrescaHome();
    return { ok: true, status, message: 'Nuova chiave pronta: i tuoi crediti si usano di nuovo da qui.', state: await readState() };
  }));

  on(MSG.WALLET_RESET_IDENTITY, filoOnly(async () => {
    identity.resetIdentity();
    walletStore.clear();
    lastServer = null;
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
    rinfrescaHome();
    return { ok: true, state: await readState() };
  }));

  // L'identità dell'installazione non si crea (provider anonimo spento su
  // Firebase, rete assente): è un problema diverso da «il server dei crediti
  // non risponde», e il messaggio deve dirlo, non mandare a guardare la rete.
  async function identityProblem() {
    try { await identity.getIdToken(); return null; } catch (e) {
      return `Non riesco a preparare l'identità di questa installazione: ${String(e?.message || e)}.`;
    }
  }

  // Riscatto: { code } → { ok, status, message, state? }.
  // `code` è quello che l'utente ha incollato: il codice nudo, la riga intera
  // del messaggio in cui è arrivato, o il link di filo.red. Niente tetto di
  // caratteri sul campo, niente taglio: o dentro c'è un codice, o si dice.
  async function doRedeem(rawCode) {
    const code = W.codeFromInput(rawCode || '');
    if (!code) return { ok: false, status: 'bad_code', message: W.redeemMessage('bad_code') };
    const idErr = await identityProblem();
    if (idErr) return { ok: false, status: 'no_identity', message: idErr };
    // I crediti del vecchio conteggio locale si portano sul server: chi li
    // aveva guadagnati non deve perderli passando al portafoglio (entro un
    // tetto che sta in configurazione lato server).
    // Si dichiarano una volta sola: quanto è già stato dichiarato a un riscatto
    // precedente (identità annullata e nuovo invito) non si ripresenta, il
    // conteggio locale resta com'è e paga solo la parte guadagnata dopo.
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
    // La config dei modelli effettivi legge la chiave a ogni chiamata: non c'è
    // niente da ricaricare. Si avvisano le pagine che il saldo è cambiato, e
    // la home si rifà: da adesso Filo risponde.
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
    rinfrescaHome();
    const state = await readState();
    return { ok: true, status, message: W.redeemOkMessage(r), credits: r.credits, inviteCodes: r.inviteCodes, state };
  }

  on(MSG.WALLET_REDEEM, filoOnly(async (msg) => doRedeem((msg && msg.code) || '')));

  // ── L'invito che arriva da fuori (#651) ───────────────────────────────────
  // Due strade portano un invito dentro Filo senza far ricopiare niente a
  // nessuno:
  //   - il PRIMO AVVIO dopo aver scaricato Filo dalla pagina del link: il
  //     server ha segnato l'apertura (l'impronta dell'indirizzo, un'ora di
  //     tempo) e `walletPendingInvite` la ridà a chi arriva da lì;
  //   - il collegamento `filo://invito/<codice>`, per chi Filo ce l'ha già:
  //     apre Filo, o lo porta davanti, e riscatta.
  // In tutti e due i casi l'utente non ha chiesto niente e non sta guardando
  // la pagina Crediti: l'esito si scrive qui e lo raccontano la home e la
  // pagina Crediti. Un riscatto silenzioso è indistinguibile da un invito
  // perso.
  const NOTICE_KEY = 'walletNotice';
  const NOTICE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  // L'avviso si SPINGE appena il riscatto è andato. Non basta: al PRIMO
  // avvio il riscatto si chiude in pochi secondi, mentre la home si sta
  // ancora aprendo, e la spinta non trova nessuno in ascolto — l'invitato si
  // ritrova i crediti senza che niente glielo dica, che è indistinguibile da
  // un invito perso (quarto giro di verifica del #651: col server rallentato
  // apposta l'avviso arrivava, con un server svelto mai). Quindi chi apre lo
  // CHIEDE anche, con WALLET_NOTICE_PENDING: l'avviso è scritto in locale e
  // chiederlo non costa un giro dal server, a differenza dello stato del
  // portafoglio.
  async function setNotice(kind, text) {
    const rec = { kind, text: String(text || ''), at: new Date().toISOString(), seenHome: false, seenCredits: false };
    try { await globalThis.SN_STORAGE.setRaw(NOTICE_KEY, rec); } catch (_) {}
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED, walletNotice: { kind: rec.kind, text: rec.text } }); } catch (_) {}
    return rec;
  }

  // L'avviso ancora da mostrare, o null. Sparisce quando l'hanno visto tutte
  // e due le superfici, e comunque dopo una settimana: un benvenuto che
  // ricompare a ogni avvio per sempre diventa rumore.
  async function readNotice() {
    let r = null;
    try { r = await globalThis.SN_STORAGE.getRaw(NOTICE_KEY, null); } catch (_) { return null; }
    if (!r || !r.text) return null;
    const at = Date.parse(String(r.at || ''));
    const scaduto = !Number.isFinite(at) || Date.now() - at > NOTICE_TTL_MS;
    if (scaduto || (r.seenHome && r.seenCredits)) {
      try { await globalThis.SN_STORAGE.setRaw(NOTICE_KEY, null); } catch (_) {}
      return null;
    }
    return r;
  }

  // Quale superficie non l'ha ancora visto. `where` è la stessa parola di
  // WALLET_NOTICE_SEEN: chi l'ha già mostrato non se lo ritrova addosso alla
  // prossima apertura.
  on(MSG.WALLET_NOTICE_PENDING, filoOnly(async (msg) => {
    const where = String((msg && msg.where) || '');
    if (where !== 'home' && where !== 'credits') return { ok: false, error: 'bad_where' };
    const r = await readNotice();
    const visto = where === 'home' ? r && r.seenHome : r && r.seenCredits;
    return { ok: true, notice: r && !visto ? { kind: r.kind, text: r.text } : null };
  }));

  on(MSG.WALLET_NOTICE_SEEN, filoOnly(async (msg) => {
    const where = String((msg && msg.where) || '');
    let r = null;
    try { r = await globalThis.SN_STORAGE.getRaw(NOTICE_KEY, null); } catch (_) {}
    if (!r) return { ok: true };
    if (where === 'home') r.seenHome = true;
    else if (where === 'credits') r.seenCredits = true;
    else return { ok: false, error: 'bad_where' };
    try {
      await globalThis.SN_STORAGE.setRaw(NOTICE_KEY, r.seenHome && r.seenCredits ? null : r);
    } catch (_) {}
    return { ok: true };
  }));

  // Il segno del «ci ho già provato»: { since, done }. Senza `done`, l'invito
  // in attesa si richiede a ogni avvio per un giorno — un server muto al
  // primo avvio non deve costare l'invito.
  const PENDING_KEY = 'walletPendingInvite';
  const PENDING_WINDOW_MS = 24 * 60 * 60 * 1000;

  async function markPending(patch) {
    let cur = null;
    try { cur = await globalThis.SN_STORAGE.getRaw(PENDING_KEY, null); } catch (_) {}
    const rec = { since: (cur && cur.since) || new Date().toISOString(), done: false, ...(cur || {}), ...patch };
    try { await globalThis.SN_STORAGE.setRaw(PENDING_KEY, rec); } catch (_) {}
    return rec;
  }

  // Primo avvio: c'è un invito che aspetta questa installazione? Non blocca
  // niente e non dice niente se non c'è.
  async function tryPendingInvite() {
    if (walletStore.personalKey()) return null;
    let mark = null;
    try { mark = await globalThis.SN_STORAGE.getRaw(PENDING_KEY, null); } catch (_) {}
    if (mark && mark.done) return null;
    const since = mark && mark.since ? Date.parse(String(mark.since)) : NaN;
    if (Number.isFinite(since) && Date.now() - since > PENDING_WINDOW_MS) {
      await markPending({ done: true });
      return null;
    }
    await markPending({});
    let r = null;
    try {
      r = await callable('walletPendingInvite');
    } catch (e) {
      // Server muto, o identità non ancora pronta: non è un errore
      // dell'utente, non ferma l'avvio, e si riprova domani.
      console.info('[wallet] invito in attesa: il server non risponde, riprovo al prossimo avvio');
      return null;
    }
    if (!r || r.status !== 'ok' || !r.code) return null;
    const out = await doRedeem(r.code);
    if (out && out.ok) {
      await markPending({ done: true });
      await setNotice('entry', W.entryNoticeText({ credits: out.credits }));
    }
    return out;
  }

  // Il codice arrivato da `filo://invito/<codice>`. Chi ha già un portafoglio
  // non ha niente da riscattare, e sentirselo dire è meglio di un silenzio.
  async function redeemFromInvite(code) {
    if (walletStore.personalKey()) {
      const rec = await setNotice('already_in', 'Hai già i crediti di Filo su questo computer. Questo invito puoi darlo a qualcun altro.');
      return { ok: false, status: 'already_in', message: rec.text };
    }
    const out = await doRedeem(code);
    if (out && out.ok) {
      await markPending({ done: true });
      await setNotice('entry', W.entryNoticeText({ credits: out.credits }));
    } else {
      await setNotice('failed', (out && out.message) || W.redeemMessage('internal'));
    }
    return out;
  }

  // ── Owner ─────────────────────────────────────────────────────────────────
  const ownerOnly = (fn) => filoOnly(async (msg) => {
    if (!ctx.isAdmin()) return { ok: false, error: 'not_admin' };
    try { return { ok: true, ...(await fn(msg)) }; } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  on(MSG.WALLET_OWNER_OVERVIEW, ownerOnly(async () => ({ overview: await callable('walletOverview', {}, { asOwner: true }) })));
  on(MSG.WALLET_OWNER_GRANT, ownerOnly(async (msg) => {
    const result = await callable('walletGrant', { pseudonym: msg.pseudonym, credits: msg.credits, why: msg.why || 'owner' }, { asOwner: true });
    // Se il regalo è alla propria installazione, la pagina Crediti aperta
    // accanto deve muoversi: si avvisano le pagine, come a ogni cambio di saldo.
    if (result && result.ok) { try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {} }
    return { result };
  }));
  on(MSG.WALLET_OWNER_INVITES, ownerOnly(async (msg) => ({
    codes: (await callable('walletCreateInvites', { count: msg.count || 1 }, { asOwner: true }))?.codes || [],
  })));

  // La scheda di una persona (#652). Il server la dà già pronta: qui si passa
  // solo lo pseudonimo, che è l'unico nome con cui una persona esiste da questa
  // parte (gli uid non escono mai dal server).
  on(MSG.WALLET_OWNER_USER_DETAIL, ownerOnly(async (msg) => ({
    detail: await callable('walletUserDetail', { pseudonym: String((msg && msg.pseudonym) || '') }, { asOwner: true }),
  })));

  // Le manopole dei crediti (#652). Non passano da una callable: `config/credits`
  // è un documento che l'account admin scrive direttamente, come già fa per i
  // modelli predefiniti e per i bilanci delle routine. Il token è quello
  // dell'account Google, non quello dell'installazione.
  on(MSG.WALLET_OWNER_KNOBS_SET, ownerOnly(async (msg) => {
    const idToken = await auth.getIdToken();
    if (!idToken) throw new Error('Sessione scaduta: rifai l’accesso.');
    const knobs = await Defaults.setCreditsKnobs((msg && msg.patch) || {}, idToken);
    // Le manopole cambiano quota e premi: chi guarda i crediti in un'altra
    // pagina deve rileggere.
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
    return { knobs };
  }));

  // ── Registro d'uso ────────────────────────────────────────────────────────
  // Le righe si accodano e si scrivono a gruppi (una commit Firestore ogni
  // pochi secondi): una chat con strumenti fa più chiamate al turno, e una
  // scrittura per chiamata sarebbe rumore. Se la scrittura fallisce si
  // ritenta al giro dopo; la coda non cresce oltre un tetto largo, e oltre si
  // perde il più vecchio dicendolo nel log (una riga persa la trova la
  // riconciliazione, non è un segreto).
  //
  // La coda sta anche su disco (#629): le righe ancora da scrivere alla
  // chiusura di Filo ripartono all'avvio dopo, invece di sparire con il
  // processo. E l'esito dell'ultima scrittura resta leggibile (usageLogStatus,
  // nella pagina Crediti): una riga rifiutata dal server che si ritenta in
  // silenzio per settimane è indistinguibile da un registro che funziona.
  const queue = [];
  const QUEUE_CAP = 2000;
  const QUEUE_KEY = 'walletUsageQueue';
  let flushTimer = null;
  let flushing = false;
  let queueLoaded = false;
  const log = { written: 0, lastWriteAt: null, lastError: '', lastErrorAt: null };

  function usageLogStatus() {
    return { pending: queue.length, written: log.written, lastWriteAt: log.lastWriteAt, lastError: log.lastError, lastErrorAt: log.lastErrorAt };
  }

  async function loadQueue() {
    if (queueLoaded) return;
    queueLoaded = true;
    try {
      const saved = await globalThis.SN_STORAGE.getRaw(QUEUE_KEY, null);
      if (Array.isArray(saved) && saved.length) {
        queue.unshift(...saved.filter((r) => r && r.pseudonym));
        if (queue.length > QUEUE_CAP) queue.splice(0, queue.length - QUEUE_CAP);
        if (queue.length) scheduleFlush(5000);
      }
    } catch (_) {}
  }

  async function saveQueue() {
    try { await globalThis.SN_STORAGE.setRaw(QUEUE_KEY, queue.length ? queue.slice() : null); } catch (_) {}
  }

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
      log.written += batch.length;
      log.lastWriteAt = new Date().toISOString();
      log.lastError = '';
      log.lastErrorAt = null;
    } catch (e) {
      log.lastError = String(e?.message || e);
      log.lastErrorAt = new Date().toISOString();
      console.warn('[wallet] registro d\'uso non scritto, ritento:', log.lastError);
      queue.unshift(...batch);
      if (queue.length > QUEUE_CAP) {
        console.warn(`[wallet] registro d'uso: coda oltre ${QUEUE_CAP} righe, scarto le più vecchie`);
        queue.splice(0, queue.length - QUEUE_CAP);
      }
      scheduleFlush(30000);
    } finally {
      flushing = false;
      await saveQueue();
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
  // se la chiamata è stata SERVITA dalla chiave personale: con una chiave
  // dell'utente il consumo è affar suo e OpenRouter non lo conta sulla nostra.
  // Chi l'ha servita lo dice il provider (`usage.keySource`), così una
  // chiamata partita con la chiave propria e ripiegata sulla personale (#629)
  // si registra come ogni altra chiamata con la personale. Senza quel campo
  // (una chiamata che non passa dal provider) vale la precedenza delle chiavi.
  async function recordUsage({ action, model, servedBy, usage }) {
    const pseudonym = walletStore.pseudonym();
    if (!pseudonym || !walletStore.personalKey()) return;
    const src = usage && usage.keySource;
    if (src ? src !== 'personal' : await ownKeySet()) return;
    await loadQueue();
    const costUsd = Number(usage && usage.costUsd) || 0;
    const fx = lastServer && lastServer.balance ? lastServer.balance : {};
    const row = W.usageRow({
      pseudonym, action, model, servedBy, usage, costUsd,
      credits: W.creditsForUsd(costUsd, { eurPerCredit: fx.eurPerCredit, eurUsd: fx.eurUsd }),
    });
    if (!row) return;
    queue.push(row);
    if (queue.length > QUEUE_CAP) queue.splice(0, queue.length - QUEUE_CAP);
    await saveQueue();
    scheduleFlush(3000);
  }

  // ── Chiave propria dalla pagina Crediti (#629) ────────────────────────────
  // Spesa e residuo che OpenRouter dichiara per la chiave scritta dall'utente.
  // La chiave non esce dal main: alla pagina tornano i numeri e la frase.
  on(MSG.WALLET_OWN_KEY_INFO, filoOnly(async () => {
    const key = await ownKey();
    if (!key) return { ok: false, status: 'no_own_key' };
    // Dal cancello unico (#591): al fornitore non si arriva da nessun'altra
    // parte, nemmeno per una domanda che non costa niente.
    const Gate = globalThis.SN_MODEL_GATE;
    if (!Gate) return { ok: false, status: 'internal' };
    try {
      const info = await Gate.keyInfo({ provider: 'openrouter', apiKey: key });
      if (!info) return { ok: false, status: 'internal' };
      return { ok: true, ...info, line: W.ownKeyBalanceLine(info) };
    } catch (e) {
      const st = Number(e && e.status) || 0;
      const refused = W.isKeyRefusalStatus(st);
      return {
        ok: false, status: refused ? 'refused' : 'not_reachable', httpStatus: st,
        message: refused
          ? `OpenRouter non accetta questa chiave (${W.keyRefusalReason(st)}).`
          : 'Non riesco a chiedere a OpenRouter cosa resta su questa chiave: riprova fra poco.',
      };
    }
  }));

  // ── Crediti finiti ────────────────────────────────────────────────────────
  // Un avviso ogni 10 minuti al massimo: il 402 arriva a ogni chiamata finché
  // il tetto non sale, e un toast per chiamata sarebbe un martello.
  // La frase si scrive qui, dove si sa tutto: quale chiave OpenRouter ha
  // rifiutato (l'errore lo porta, #629), se il ripiego sulla personale c'è
  // stato e ha fallito, se c'è un portafoglio, quanti crediti arrivano domani.
  // Resta sull'errore (userMessage) per la chat, che altrimenti dovrebbe
  // tirare a indovinare.
  let lastNoticeAt = 0;
  async function outOfCreditsNotice(err) {
    const src = err && err.keySource;
    const usingOwnKey = src ? src === 'own' : await ownKeySet();
    const fallbackFailed = Boolean(err && err.keyFallback && err.keyFallback.failed);
    const text = W.outOfCreditsMessage({
      usingOwnKey, fallbackFailed, hasWallet: Boolean(walletStore.personalKey()),
      dailyCredits: lastServer && lastServer.dailyCredits,
    });
    if (err && typeof err === 'object') { try { err.userMessage = text; } catch (_) {} }
    const now = Date.now();
    if (now - lastNoticeAt < 10 * 60 * 1000) return;
    lastNoticeAt = now;
    try { broadcastToTabs({ type: MSG.SHOW_TOAST, text: text.charAt(0).toUpperCase() + text.slice(1), duration: 8000 }); } catch (_) {}
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
  }

  globalThis.SN_WALLET_MAIN = {
    recordUsage, outOfCreditsNotice, flush, readState, keySource,
    // Lo pseudonimo di questa installazione, letto dal deposito locale (niente
    // rete): lo scrive chi manda un feedback, così il server sa a chi
    // accreditare il premio (#652). Vuoto se non c'è un portafoglio.
    pseudonym: () => { try { return walletStore.pseudonym() || ''; } catch (_) { return ''; } },
    // L'invito che arriva da fuori (#651): lo chiama main.js per il
    // collegamento filo://invito/<codice>, e l'avvio per l'invito in attesa.
    redeemFromInvite, tryPendingInvite,
    // Ripiego dalla chiave propria (#629): li chiama il provider OpenRouter.
    keySourceOf, alternativeKeyFor, noteOwnKeyRefusal, noteOwnKeySuccess, lastOwnKeyRefusal, ownKeyChanged, usageLogStatus,
    // Solo per i test (NODE_ENV=test): simula il riavvio senza rete.
    expireIdentityForTest: () => { if (process.env.NODE_ENV === 'test') identity._expireToken(); },
  };

  // All'avvio: identità pronta e stato del server letto una volta, così la
  // prima riga del registro ha già i parametri di conversione; e le righe
  // rimaste da scrivere alla chiusura precedente ripartono. In background.
  // Poi, senza portafoglio, si chiede se c'è un invito che aspetta questa
  // installazione (#651): dopo la lettura dello stato, così l'identità è già
  // pronta, e comunque senza bloccare niente.
  setTimeout(() => {
    readState()
      .catch(() => {})
      .then(() => tryPendingInvite())
      .catch(() => {});
    loadQueue().catch(() => {});
  }, 4000);
};
