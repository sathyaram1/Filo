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

const { AsyncLocalStorage } = require('node:async_hooks');
const auth = require('../../auth/google-auth');
const identity = require('../../auth/anon-auth');
const walletStore = require('../../auth/wallet-store');
const Defaults = require('../defaultsStore');
const Disco = require('../../shim/storage');

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
  // Senza chiave la frase si ricostruisce sul posto e non costa niente; con la
  // chiave la home la toglie da sé (FILO_READY_CHANGED) e il modello non parte (#869).
  async function rinfrescaHome() {
    try {
      const r = await ctx.handleFiloGenerateDashboard({ openTabsCount: 0 });
      if (!r || !r.message || r.cached) return;
      broadcastToTabs({ type: MSG.FILO_DASHBOARD_UPDATED, message: r.message, suggestions: r.suggestions, ts: r.ts });
    } catch (_) { /* la home resta com'è: non è un motivo per fallire un riscatto */ }
  }

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

  // La prova di una chiave (il «Prova» delle Impostazioni) misura QUELLA
  // chiave: dentro `senzaRipiego` un rifiuto risale com'è, senza riserva.
  const provaDiChiave = new AsyncLocalStorage();
  function senzaRipiego(fn) { return provaDiChiave.run(true, fn); }

  // Ogni risposta pagata col ripiego lo dice: la riga sotto la risposta, o un avviso, uno per
  // rifiuto e al massimo ogni 10 minuti (#662). Vale come detta solo la riga arrivata a schermo
  // (KEY_FALLBACK_SHOWN), non la richiesta di chi potrebbe mostrarla: una spiegazione anticipata
  // mai aperta, o un riquadro chiuso prima, lascia partire l'avviso. Le richieste con la riga in
  // volo (`conRipiegoDetto`) tengono fermo l'avviso finché la loro riga ha il tempo di comparire.
  const FINESTRA_RIPIEGO_MS = 10 * 60 * 1000;
  const ATTESA_AVVISO_RIPIEGO_MS = 4000;
  let inVoloConRiga = 0;
  let ultimoAvvisoRipiego = 0;
  let avvisoSospeso = null; // { status, timer }
  function conRipiegoDetto(fn) {
    inVoloConRiga++;
    let p;
    try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
    return p.finally(() => {
      inVoloConRiga--;
      if (!inVoloConRiga && avvisoSospeso && !avvisoSospeso.timer) {
        avvisoSospeso.timer = setTimeout(mandaAvvisoSospeso, ATTESA_AVVISO_RIPIEGO_MS);
      }
    });
  }
  function annullaAvvisoSospeso() {
    if (avvisoSospeso && avvisoSospeso.timer) clearTimeout(avvisoSospeso.timer);
    avvisoSospeso = null;
  }
  function mandaAvvisoSospeso() {
    if (!avvisoSospeso) return;
    avvisoSospeso.timer = null;
    if (inVoloConRiga > 0) return;
    const { status } = avvisoSospeso;
    avvisoSospeso = null;
    const now = Date.now();
    if (now - ultimoAvvisoRipiego < FINESTRA_RIPIEGO_MS) return;
    ultimoAvvisoRipiego = now;
    try { broadcastToTabs({ type: MSG.SHOW_TOAST, text: W.ownKeyFallbackLine(status), duration: 8000 }); } catch (_) {}
  }
  function ripiegoMostrato() {
    ultimoAvvisoRipiego = Date.now();
    annullaAvvisoSospeso();
  }
  function avvisaRipiegoMuto(status) {
    const now = Date.now();
    if (now - ultimoAvvisoRipiego < FINESTRA_RIPIEGO_MS || avvisoSospeso) return;
    avvisoSospeso = { status, timer: setTimeout(mandaAvvisoSospeso, ATTESA_AVVISO_RIPIEGO_MS) };
  }

  // La riserva per la chiave con cui una chiamata è partita: la personale del
  // portafoglio, solo se si era partiti con la chiave PROPRIA. Con la
  // personale già in uso non c'è riserva (un 402 lì sono i crediti finiti), e
  // con la chiave di fabbrica nemmeno.
  async function alternativeKeyFor(apiKey) {
    if (provaDiChiave.getStore()) return null;
    const k = String(apiKey || '').trim();
    const personal = walletStore.personalKey();
    if (!k || !personal || k === personal) return null;
    if (k !== (await ownKey())) return null;
    return { key: personal, source: 'personal' };
  }

  // L'ultimo rifiuto della chiave propria: { at, status, detail, usedCredits }.
  // Lo legge la pagina Crediti (readState); si cancella quando la chiave
  // cambia. `usedCredits`: da quando la chiave è rifiutata, un ripiego ha
  // risposto almeno una volta (un ripiego caduto non ha speso niente).
  const REFUSAL_KEY = 'walletOwnKeyRefusal';
  async function noteOwnKeyRefusal({ status, detail, served = true } = {}) {
    const prev = await lastOwnKeyRefusal();
    const usedCredits = Boolean(served) || Boolean(prev && prev.usedCredits !== false);
    const rec = { at: new Date().toISOString(), status: Number(status) || 0, detail: String(detail || '').slice(0, 300), usedCredits };
    try { await globalThis.SN_STORAGE.setRaw(REFUSAL_KEY, rec); } catch (_) {}
    if (served) avvisaRipiegoMuto(rec.status);
    console.warn(`[wallet] chiave propria rifiutata (${rec.status}): ${served ? 'ha risposto la chiave personale' : 'anche il ripiego sulla personale è caduto'}`);
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
    ultimoAvvisoRipiego = 0;
    annullaAvvisoSospeso();
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
      ultimoAvvisoRipiego = 0;
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
  // L'ultima lettura resta a chi deve DIRE il saldo fuori da quella pagina
  // (la chat, #816): lo stesso numero, senza un giro dal server a ogni turno.
  let ultimaLettura = null; // { at, state }
  // Vale la lettura partita per ultima: una partita prima e finita dopo (un server lento) non prende il posto della
  // nuova, né in memoria né su disco, e non passa per fresca (#1353).
  let letturePartite = 0;
  let letturaValida = 0;
  async function readState() {
    const mia = ++letturePartite;
    const state = await leggiStato(() => mia > letturaValida);
    if (mia <= letturaValida) return state;
    letturaValida = mia;
    ultimaLettura = { at: Date.now(), state };
    try { globalThis.SN_AVVISO_CREDITI_MAIN?.dopoLettura(state); } catch (_) {}
    return state;
  }
  async function leggiStato(piuNuova = () => true) {
    const own = await ownKey();
    await loadQueue().catch(() => {});
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
      out.identity.unreadable = e && e.code === 'identity_unreadable';
      out.identity.unreachable = e && e.code === 'servizio_non_raggiungibile';
      out.identity.offline = e && e.code === 'offline';
      // Offline con la chiave personale qui: vale l'ultimo stato letto — il campo dell'invito e un
      // saldo locale a chi ha già il portafoglio sarebbero due bugie.
      const cached = out.hasPersonalKey && !out.identity.lost ? walletStore.lastServer() : null;
      if (cached && cached.hasWallet) out.server = { ...cached, stale: true, cached: true };
      return out;
    }
    try {
      out.server = await callable('walletState');
      if (out.server && out.server.hasWallet && piuNuova()) {
        lastServer = out.server;
        if (!out.pseudonym && out.server.pseudonym && out.hasPersonalKey) {
          walletStore.save({ ...walletStore.load(), pseudonym: out.server.pseudonym });
          out.pseudonym = out.server.pseudonym;
        }
        if (out.hasPersonalKey) walletStore.saveLastServer({ ...out.server, readAt: new Date().toISOString() });
      }
      out.chiaveStaccata = chiaveStaccata(out);
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

  // La chiave personale qui non è del portafoglio che il server lega a questa identità (#1601): ogni riga
  // del registro firmata con lo pseudonimo locale la regola la rifiuta, e la pagina Crediti lo dice.
  function chiaveStaccata({ hasPersonalKey, pseudonym, server }) {
    if (!hasPersonalKey || !server) return '';
    if (!server.hasWallet) return server.configured === false ? '' : 'senza_portafoglio';
    return server.pseudonym && pseudonym && server.pseudonym !== pseudonym ? 'altro_pseudonimo' : '';
  }

  // Questa installazione ha un portafoglio (#816): i crediti veri li tiene il
  // server, e il conteggio locale non riceve premi né si racconta in chat.
  function haPortafoglio() {
    try {
      return Boolean(walletStore.personalKey() || walletStore.pseudonym() || (lastServer && lastServer.hasWallet));
    } catch (_) { return false; }
  }

  // Gli invii col portafoglio di questa sessione (#1077): il premio d'invio ha
  // un tetto al giorno e arriva dopo i giudici, quindi l'ultimo stato letto
  // non li conta ancora tutti. Ritorna la frase da dire se il tetto è pieno.
  let inviiSessione = [];
  function notaInvio(id) {
    const now = Date.now();
    let stato = lastServer;
    if (!stato) { try { stato = walletStore.lastServer(); } catch (_) { stato = null; } }
    const oggi = new Date(now).toISOString().slice(0, 10);
    inviiSessione = inviiSessione.filter((x) => new Date(x.at).toISOString().slice(0, 10) === oggi);
    const esito = W.premioInvio({ grants: stato && stato.grants, perDay: stato && stato.sentRewardsPerDay, invii: inviiSessione, now });
    // Oltre mille invii in un giorno il tetto è pieno comunque: la lista non cresce senza fine.
    inviiSessione = [...inviiSessione, { id: String(id || '').slice(0, 200), at: now }].slice(-1000);
    return esito.esaurito ? W.premioInvioEsauritoTesto(esito.perDay) : '';
  }

  // Il saldo che la chat dice (#816): quello della pagina Crediti, mai aspettato (#1353; regola in SN_WALLET.saldoPerChat).
  // `fresco`: la domanda viene da un turno di chat, e una lettura più vecchia di un minuto si rifà in sottofondo.
  const rilettore = W.rilettoreSaldo({ leggi: () => readState(), ultima: () => ultimaLettura });
  function rileggiSaldo() {
    if (haPortafoglio()) rilettore.rileggi();
  }
  async function saldoPerChat({ fresco = false } = {}) {
    if (!haPortafoglio()) return null;
    if (fresco) rilettore.rileggi();
    let disco = null;
    try { disco = walletStore.lastServer() || lastServer; } catch (_) { disco = lastServer; }
    return W.saldoPerChat({ lettura: ultimaLettura, disco });
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

  // Chi scrive nella chat manderà presto un turno: il saldo si rilegge adesso, così all'invio è pronto (#1353).
  on(MSG.WALLET_SALDO_PREPARA, filoOnly(async () => { rileggiSaldo(); return { ok: true }; }));

  // Anche dai siti: la riga sta nei riquadri sulle pagine web. Il peggio che un mittente può fare è
  // zittire per dieci minuti un avviso che ripete una frase.
  on(MSG.KEY_FALLBACK_SHOWN, async () => { ripiegoMostrato(); return { ok: true }; });

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

  // Il cancello sta qui e non nella pagina: senza un'identità persa o illeggibile ricominciare
  // staccherebbe un portafoglio vivo, e senza il sì esplicito non si tocca niente.
  on(MSG.WALLET_RESET_IDENTITY, filoOnly(async (msg) => {
    let motivo = '';
    try { await identity.getIdToken(); } catch (e) { motivo = (e && e.code) || ''; }
    if (motivo !== 'identity_lost' && motivo !== 'identity_unreadable') {
      return { ok: false, status: motivo ? 'not_reachable' : 'identity_ok', state: await readState() };
    }
    if (!msg || msg.confermato !== true) return { ok: false, status: 'needs_confirm' };
    identity.resetIdentity();
    walletStore.metteDaParte();
    const righeTolte = await svuotaCodaPerRicominciare();
    lastServer = null;
    ultimaLettura = null;
    letturaValida = letturePartite;
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
    rinfrescaHome();
    return { ok: true, righeTolte, state: await readState() };
  }));

  // L'identità dell'installazione che non si crea è un problema diverso da «il server non
  // risponde»: il messaggio deve dirlo, invece di mandare a guardare la rete.
  async function identityProblem() {
    try { await identity.getIdToken(); return null; } catch (e) {
      return `Non riesco a preparare l'identità di questa installazione: ${String(e?.message || e)}.`;
    }
  }

  // Riscatto: { code } → { ok, status, message, state? }.
  // `code` è quello che l'utente ha incollato: il codice nudo, la riga intera
  // del messaggio in cui è arrivato, o il link di filo.red. Niente tetto di
  // caratteri sul campo, niente taglio: o dentro c'è un codice, o si dice.
  // La lettura è lineare (#664): qui gira nel main, e un conto lento ferma
  // tutte le schede.
  async function doRedeem(rawCode) {
    const codes = W.codesFromInput(rawCode || '');
    if (!codes.length) return { ok: false, status: 'bad_code', message: W.redeemMessage('bad_code') };
    const idErr = await identityProblem();
    if (idErr) return { ok: false, status: 'no_identity', message: idErr };
    // Al riscatto si entra coi soli crediti d'ingresso (#1138): il conteggio locale non si dichiara, e il server
    // ignora un `localCredits` scritto da chi chiama la callable da sé (#1519).
    // Chi lo vedeva come saldo deve sentire dove va (#1353): si guarda prima che la chiave personale arrivi.
    const conteggioLocale = W.conteggioLocaleInVista({ hasWallet: Boolean(lastServer && lastServer.hasWallet), keySource: await keySource() });
    // Un saluto di otto lettere buone («Cara Sara») può stare davanti al
    // codice vero (#664): a «non esiste» si prova il blocco dopo. Ogni altra
    // risposta è del codice giusto (pieno, tuo, già dentro) e ferma la fila.
    const daProvare = codes.slice(0, W.CODE_TRIES);
    let r = null;
    for (const code of daProvare) {
      try {
        r = await callable('walletRedeem', { code, localCredits });
      } catch (e) {
        return { ok: false, status: 'not_reachable', message: W.redeemMessage('not_reachable') };
      }
      if (!r || r.status !== 'invalid_code') break;
    }
    const status = (r && r.status) || 'internal';
    if (status === 'invalid_code' && codes.length > daProvare.length) {
      return { ok: false, status, message: W.tooManyCodesMessage(codes.length, daProvare.length) };
    }
    if (status !== 'ok') return { ok: false, status, message: W.redeemMessage(status, r) };
    walletStore.save({ key: r.key, pseudonym: r.pseudonym, redeemedAt: new Date().toISOString() });
    try { await globalThis.SN_AVVISO_CREDITI_MAIN?.ricordaIngresso(r.entryCredits != null ? r.entryCredits : r.credits); } catch (_) {}
    // La config dei modelli effettivi legge la chiave a ogni chiamata: non c'è
    // niente da ricaricare. Si avvisano le pagine che il saldo è cambiato, e
    // la home si rifà: da adesso Filo risponde.
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
    rinfrescaHome();
    const state = await readState();
    return {
      ok: true, status, message: W.redeemOkMessage({ ...r, conteggioLocale }), conteggioLocale,
      credits: r.credits, inviteCodes: r.inviteCodes, invitesLocked: r.invitesLocked || null, state,
    };
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

  // Ogni lettura e scrittura dell'avviso passa da qui, una alla volta: la
  // spinta arriva a tutte le home insieme, e il benvenuto lo deve prendere una
  // sola (#664).
  let filaAvviso = Promise.resolve();
  function inFilaAvviso(fn) {
    const turno = filaAvviso.then(fn);
    filaAvviso = turno.catch(() => {});
    return turno;
  }

  // L'avviso si SPINGE appena il riscatto è andato. Non basta: al PRIMO
  // avvio il riscatto si chiude in pochi secondi, mentre la home si sta
  // ancora aprendo, e la spinta non trova nessuno in ascolto — l'invitato si
  // ritrova i crediti senza che niente glielo dica, che è indistinguibile da
  // un invito perso (quarto giro di verifica del #651: col server rallentato
  // apposta l'avviso arrivava, con un server svelto mai). Quindi chi apre lo
  // CHIEDE anche, con WALLET_NOTICE_PENDING: l'avviso è scritto in locale e
  // chiederlo non costa un giro dal server, a differenza dello stato del
  // portafoglio.
  // `invitesLocked`: entrato senza Google collegato, quindi senza inviti da dare (#1120): la home non li promette.
  async function setNotice(kind, text, { invitesLocked = null } = {}) {
    const rec = { kind, text: String(text || ''), invitesLocked: invitesLocked || null, at: new Date().toISOString(), seenHome: false, seenCredits: false };
    await inFilaAvviso(async () => { try { await globalThis.SN_STORAGE.setRaw(NOTICE_KEY, rec); } catch (_) {} });
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED, walletNotice: { kind: rec.kind, text: rec.text, invitesLocked: rec.invitesLocked } }); } catch (_) {}
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

  async function segnaVisto(where) {
    let r = null;
    try { r = await globalThis.SN_STORAGE.getRaw(NOTICE_KEY, null); } catch (_) {}
    if (!r) return;
    if (where === 'home') r.seenHome = true;
    else r.seenCredits = true;
    try {
      await globalThis.SN_STORAGE.setRaw(NOTICE_KEY, r.seenHome && r.seenCredits ? null : r);
    } catch (_) {}
  }

  // Quale superficie non l'ha ancora visto. `where` è la stessa parola di
  // WALLET_NOTICE_SEEN: chi l'ha già mostrato non se lo ritrova addosso alla
  // prossima apertura. Con `claim` chi chiede lo prende: alla prossima
  // domanda, anche da un'altra home, non c'è più.
  on(MSG.WALLET_NOTICE_PENDING, filoOnly(async (msg) => {
    const where = String((msg && msg.where) || '');
    if (where !== 'home' && where !== 'credits') return { ok: false, error: 'bad_where' };
    const notice = await inFilaAvviso(async () => {
      const r = await readNotice();
      const visto = where === 'home' ? r && r.seenHome : r && r.seenCredits;
      if (!r || visto) return null;
      if (msg && msg.claim) await segnaVisto(where);
      return { kind: r.kind, text: r.text, invitesLocked: r.invitesLocked || null };
    });
    return { ok: true, notice };
  }));

  on(MSG.WALLET_NOTICE_SEEN, filoOnly(async (msg) => {
    const where = String((msg && msg.where) || '');
    if (where !== 'home' && where !== 'credits') return { ok: false, error: 'bad_where' };
    await inFilaAvviso(() => segnaVisto(where));
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
      await setNotice('entry', W.entryNoticeText({ credits: out.credits, conteggioLocale: out.conteggioLocale }), { invitesLocked: out.invitesLocked });
    } else if (out && out.status === 'network_cap') {
      // L'invito resta in attesa e si riprova al prossimo avvio, ma chi l'ha scaricato apposta deve sapere perché non è entrato.
      await setNotice('failed', out.message);
    }
    return out;
  }

  // Il codice arrivato da `filo://invito/<codice>`. Chi ha già un portafoglio
  // non ha niente da riscattare, e sentirselo dire è meglio di un silenzio.
  // Un doppio clic sul pulsante dell'invito porta qui due volte (#664): il
  // secondo riscatto direbbe «hai già i crediti» sopra il benvenuto, quindi
  // finché il primo è in corso chi arriva aspetta quello.
  let invitoInCorso = null;
  function redeemFromInvite(code) {
    if (!invitoInCorso) invitoInCorso = riscattaInvito(code).finally(() => { invitoInCorso = null; });
    return invitoInCorso;
  }
  async function riscattaInvito(code) {
    if (walletStore.personalKey()) {
      const rec = await setNotice('already_in', 'Hai già i crediti di Filo su questo computer. Questo invito puoi darlo a qualcun altro.');
      return { ok: false, status: 'already_in', message: rec.text };
    }
    const out = await doRedeem(code);
    if (out && out.ok) {
      await markPending({ done: true });
      await setNotice('entry', W.entryNoticeText({ credits: out.credits, conteggioLocale: out.conteggioLocale }), { invitesLocked: out.invitesLocked });
    } else {
      await setNotice('failed', (out && out.message) || W.redeemMessage('internal'));
    }
    return out;
  }

  // L'invito portato dentro Filo: si riscatta e si apre la pagina Crediti, dove
  // l'esito si legge. Stessa strada per il collegamento arrivato da fuori
  // (main.js) e per quello cliccato dentro Filo (#664).
  function portaDentroInvito(code, win) {
    // Il portafoglio è dell'installazione: da una finestra incognito si scrive sul disco lo stesso.
    Disco.runNormale(() => redeemFromInvite(code)).catch(() => {});
    try { win?._filoTabs?.openTab('filo://credits/credits.html', { activate: true }); } catch (_) {}
  }

  // Un collegamento d'invito cliccato davvero in una pagina, o «Riscatta
  // l'invito» dal tasto destro. Arriva anche dalle pagine web: lo manda il
  // mondo isolato del preload, e solo su un gesto vero dell'utente.
  on(MSG.WALLET_INVITE_OPEN, async (msg, sender) => {
    const link = String((msg && msg.link) || '');
    const code = W.inviteCodeFromLink(link);
    if (!code && !W.isInviteDeepLink(link)) return { ok: false, error: 'not_invite' };
    portaDentroInvito(code, ctx.winOf(sender));
    return { ok: true };
  });

  // ── Owner ─────────────────────────────────────────────────────────────────
  const ownerOnly = (fn) => filoOnly(async (msg) => {
    if (!ctx.isAdmin()) return { ok: false, error: 'not_admin' };
    try { return { ok: true, ...(await fn(msg)) }; } catch (e) {
      // Il codice di rete dice se la richiesta è partita: la pagina lo usa per sapere se un regalo può essere arrivato.
      const rete = e && e.cause && e.cause.code ? ` (${e.cause.code})` : '';
      return { ok: false, error: String(e?.message || e) + rete };
    }
  });
  // La vista fa leggere al server tutti i portafogli: chi non la vuole fresca (home, controllo da solo) si accontenta di
  // una lettura di meno di un quarto d'ora o di quella in volo; la pagina dell'owner rilegge sempre. Ogni lettura
  // riuscita rifà gli avvisi della home (#855), che così non costano letture loro; una partita prima e arrivata dopo
  // un'altra non la scavalca.
  const VISTA_VALE_MS = 15 * 60 * 1000;
  let vistaLetta = null;
  let vistaInVolo = null;
  let voli = 0;
  let ultimoVolo = 0;
  function vistaOwner({ fresca = false } = {}) {
    if (!fresca && vistaLetta && Date.now() - vistaLetta.at < VISTA_VALE_MS) return Promise.resolve(vistaLetta.overview);
    if (!fresca && vistaInVolo) return vistaInVolo;
    const n = ++voli;
    const volo = callable('walletOverview', {}, { asOwner: true }).then((overview) => {
      if (overview && typeof overview === 'object' && n > ultimoVolo) {
        ultimoVolo = n;
        vistaLetta = { at: Date.now(), overview };
        rifaiAvvisiOwner(overview);
      }
      return overview;
    });
    vistaInVolo = volo;
    volo.finally(() => { if (vistaInVolo === volo) vistaInVolo = null; }).catch(() => {});
    return volo;
  }
  on(MSG.WALLET_OWNER_OVERVIEW, ownerOnly(async () => ({ overview: await vistaOwner({ fresca: true }) })));

  // Gli avvisi all'owner fra le notifiche della home (#855). Una carta per caso; quali marcatori sono già stati detti
  // sta su disco, così una situazione che resta quella non si ridice a ogni avvio. Il portafoglio è dell'installazione:
  // anche una lettura partita da una finestra incognito scrive sul disco.
  const AVVISI_DETTI_KEY = 'walletOwnerAvvisiDetti';
  const CONTROLLO_OGNI_MS = 6 * 60 * 60 * 1000;
  let filaAvvisi = Promise.resolve();
  function rifaiAvvisiOwner(overview) {
    filaAvvisi = filaAvvisi.then(() => Disco.runNormale(() => scriviAvvisiOwner(overview))).catch((e) => {
      console.warn('[wallet] avvisi dell’owner non scritti', String(e?.message || e));
    });
    return filaAvvisi;
  }
  async function scriviAvvisiOwner(overview) {
    const FiloMem = globalThis.SN_FILO_MEMORY;
    if (!FiloMem?.addNotification) return;
    let detti = [];
    try { detti = await globalThis.SN_STORAGE.getRaw(AVVISI_DETTI_KEY, []); } catch (_) {}
    const esito = await W.applicaAvvisiOwner(FiloMem, detti, overview);
    await globalThis.SN_STORAGE.setRaw(AVVISI_DETTI_KEY, esito.detti);
    if (esito.cambiato) ctx.broadcastLiveUpdate();
  }
  // Il controllo da solo: all'avvio e ogni sei ore, solo sulla copia dell'owner. Un server muto non scrive niente.
  async function controllaAvvisiOwner() {
    if (!ctx.isAdmin()) return 'non_owner';
    try { await vistaOwner(); } catch (e) {
      console.warn('[wallet] avvisi dell’owner: vista non arrivata', String(e?.message || e));
      return 'non_letta';
    }
    await filaAvvisi;
    return 'fatto';
  }
  setTimeout(() => { controllaAvvisiOwner().catch(() => {}); }, 6000).unref?.();
  setInterval(() => { controllaAvvisiOwner().catch(() => {}); }, CONTROLLO_OGNI_MS).unref?.();

  // L'allarme del conto all'avvio (#820). Ogni home che si apre lo chiede, e gli allarmi già detti stanno su disco,
  // così una situazione che resta quella non si ridice a ogni avvio.
  const ALLARMI_DETTI_KEY = 'walletOwnerAllarmiDetti';
  let filaAllarmi = Promise.resolve();
  async function leggiContoOwner() {
    return W.contoOwner(await vistaOwner());
  }
  on(MSG.WALLET_OWNER_ALARM_PENDING, filoOnly(async () => {
    if (!ctx.isAdmin()) return { ok: true, alarm: null };
    const turno = filaAllarmi.then(async () => {
      let conto = null;
      try { conto = await leggiContoOwner(); } catch (e) {
        console.warn('[wallet] allarme del conto: vista non arrivata', String(e?.message || e));
        return null;
      }
      let detti = [];
      try { detti = await globalThis.SN_STORAGE.getRaw(ALLARMI_DETTI_KEY, []); } catch (_) {}
      const esito = W.allarmiDaDire(detti, conto);
      try { await globalThis.SN_STORAGE.setRaw(ALLARMI_DETTI_KEY, esito.detti); } catch (_) {}
      if (!esito.dire.length) return null;
      const title = esito.dire.some((a) => a.kind === 'vivi_oltre_conto')
        ? 'Il conto OpenRouter non regge'
        : 'Il tetto dei regali supera il conto OpenRouter';
      return { title, text: esito.dire.map((a) => a.testo).join('\n\n') };
    });
    filaAllarmi = turno.catch(() => {});
    const alarm = await turno;
    // Gli avvisi nati dalla stessa lettura sono già fra le notifiche quando la home ha la risposta.
    await filaAvvisi;
    return { ok: true, alarm };
  }));
  on(MSG.WALLET_OWNER_GRANT, ownerOnly(async (msg) => {
    const result = await callable('walletGrant', { pseudonym: msg.pseudonym, credits: msg.credits, why: msg.why || 'owner' }, { asOwner: true });
    // Se il regalo è alla propria installazione, la pagina Crediti aperta
    // accanto deve muoversi: si avvisano le pagine, come a ogni cambio di saldo.
    if (result && result.ok) {
      ultimaLettura = null;
      vistaLetta = null;
      try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
    }
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
  on(MSG.WALLET_OWNER_OFF_POLICY_SEEN, ownerOnly(async (msg) => {
    const shown = Array.isArray(msg && msg.shown) ? msg.shown : [];
    const result = await callable('walletAckOffPolicy', { pseudonym: String((msg && msg.pseudonym) || ''), shown }, { asOwner: true });
    vistaLetta = null;
    return { result };
  }));

  // Le manopole dei crediti (#652). Non passano da una callable: `config/credits`
  // è un documento che l'account admin scrive direttamente, come già fa per i
  // modelli predefiniti e per i bilanci delle routine. Il token è quello
  // dell'account Google, non quello dell'installazione.
  on(MSG.WALLET_OWNER_KNOBS_SET, ownerOnly(async (msg) => {
    const idToken = await auth.getIdToken();
    if (!idToken) throw new Error('Sessione scaduta: rifai l’accesso.');
    const knobs = await Defaults.setCreditsKnobs((msg && msg.patch) || {}, idToken);
    // Le manopole cambiano quota e premi: chi guarda i crediti in un'altra
    // pagina deve rileggere, e la chat anche.
    ultimaLettura = null;
    vistaLetta = null;
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
    return { knobs };
  }));

  // ── Registro d'uso ────────────────────────────────────────────────────────
  // Le righe si accodano e si scrivono a gruppi (una commit Firestore ogni
  // pochi secondi): una chat con strumenti fa più chiamate al turno, e una
  // scrittura per chiamata sarebbe rumore. Un guasto passeggero si ritenta al
  // giro dopo; una riga che il server rifiuta esce dalla coda (#1601). Ogni
  // riga che esce senza arrivare, anche oltre il tetto largo della coda, si
  // conta per motivo (`scarta`).
  //
  // La coda sta anche su disco (#629): le righe ancora da scrivere alla
  // chiusura di Filo ripartono all'avvio dopo, invece di sparire con il
  // processo. E l'esito dell'ultima scrittura resta leggibile (usageLogStatus,
  // nella pagina Crediti): una riga rifiutata dal server che si ritenta in
  // silenzio per settimane è indistinguibile da un registro che funziona.
  const queue = [];
  const QUEUE_CAP = 2000;
  const QUEUE_KEY = 'walletUsageQueue';
  // Il conto delle righe scartate sta su disco: lo scarto avviene di solito appena dopo l'avvio, e chi apre Crediti
  // dopo un riavvio deve trovarlo ancora (#1601).
  const SCARTI_KEY = 'walletUsageLog';
  let flushTimer = null;
  let flushing = false;
  let caricamentoCoda = null;
  let scartiLetti = false;
  // Cresce a ogni «Ricomincia»: un invio partito prima non rimette in coda le righe dell'identità di prima.
  let generazioneCoda = 0;
  const log = { written: 0, lastWriteAt: null, lastError: '', lastErrorAt: null, discardedBy: {}, lastDiscardReason: '', lastDiscardAt: null };

  function usageLogStatus() {
    const discarded = Object.values(log.discardedBy).reduce((s, n) => s + n, 0);
    return {
      pending: queue.length, written: log.written, lastWriteAt: log.lastWriteAt, lastError: log.lastError, lastErrorAt: log.lastErrorAt,
      discarded, discardedBy: { ...log.discardedBy }, lastDiscardReason: log.lastDiscardReason, lastDiscardAt: log.lastDiscardAt,
    };
  }

  // Nessuna riga esce dalla coda senza dirlo: conta per motivo, la pagina Crediti lo mostra.
  function scarta(n, motivo, dettaglio = '') {
    if (!n) return;
    log.discardedBy[motivo] = (log.discardedBy[motivo] || 0) + n;
    log.lastDiscardReason = dettaglio || motivo;
    log.lastDiscardAt = new Date().toISOString();
    console.warn(`[wallet] registro d'uso: ${n} righe tolte dalla coda (${motivo})${dettaglio ? `: ${dettaglio}` : ''}`);
    if (scartiLetti) salvaScarti();
  }

  function salvaScarti() {
    const { discardedBy, lastDiscardReason, lastDiscardAt } = log;
    const dato = Object.keys(discardedBy).length ? { discardedBy: { ...discardedBy }, lastDiscardReason, lastDiscardAt } : null;
    try { Promise.resolve(globalThis.SN_STORAGE.setRaw(SCARTI_KEY, dato)).catch(() => {}); } catch (_) {}
  }

  // Si sommano a quelli scartati prima della lettura, che altrimenti la lettura cancellerebbe.
  async function leggiScarti() {
    let dato = null;
    try { dato = await globalThis.SN_STORAGE.getRaw(SCARTI_KEY, null); } catch (_) {}
    const prima = Object.keys(log.discardedBy).length > 0;
    if (dato && dato.discardedBy && typeof dato.discardedBy === 'object') {
      for (const [m, v] of Object.entries(dato.discardedBy)) {
        const n = Math.max(0, Math.floor(Number(v) || 0));
        if (n) log.discardedBy[m] = (log.discardedBy[m] || 0) + n;
      }
      if (!log.lastDiscardAt) {
        log.lastDiscardReason = String(dato.lastDiscardReason || '');
        log.lastDiscardAt = dato.lastDiscardAt || null;
      }
    }
    scartiLetti = true;
    if (prima) salvaScarti();
  }

  function tagliaCoda() {
    if (queue.length <= QUEUE_CAP) return;
    scarta(queue.length - QUEUE_CAP, 'coda_piena', `oltre ${QUEUE_CAP} righe, le più vecchie`);
    queue.splice(0, queue.length - QUEUE_CAP);
  }

  // Le righe firmate con lo pseudonimo di un'altra identità la regola non le prende mai. Senza pseudonimo
  // attuale (portafoglio che non si legge adesso) non si giudica: decide il server.
  function togliAltreIdentita() {
    const mio = walletStore.pseudonym();
    if (!mio) return;
    const prima = queue.length;
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].pseudonym !== mio) queue.splice(i, 1);
    scarta(prima - queue.length, 'altra_identita');
  }

  // Chi arriva mentre la lettura è in corso la aspetta: la pagina Crediti non deve vedere coda e conto ancora vuoti.
  function loadQueue() {
    if (!caricamentoCoda) caricamentoCoda = caricaCoda();
    return caricamentoCoda;
  }

  async function caricaCoda() {
    await leggiScarti();
    try {
      const saved = await globalThis.SN_STORAGE.getRaw(QUEUE_KEY, null);
      if (Array.isArray(saved) && saved.length) {
        queue.unshift(...saved.filter((r) => r && r.pseudonym));
        togliAltreIdentita();
        tagliaCoda();
        if (queue.length !== saved.length) await saveQueue();
        if (queue.length) scheduleFlush(5000);
      }
    } catch (_) {}
  }

  async function saveQueue() {
    try { await globalThis.SN_STORAGE.setRaw(QUEUE_KEY, queue.length ? queue.slice() : null); } catch (_) {}
  }

  async function commitRighe(righe) {
    const idToken = await identity.getIdToken();
    const writes = righe.map((row) => ({
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
    if (res.ok) return { ok: true };
    const testo = await res.text().catch(() => '');
    const motivo = `wallet-usage commit ${res.status}: ${testo.slice(0, 200)}`;
    if (W.rifiutoDellaRigaUso(res.status, testo)) return { ok: false, motivo };
    throw new Error(motivo);
  }

  async function flush() {
    flushTimer = null;
    if (flushing || !queue.length || !FB?.rest) return;
    flushing = true;
    const generazione = generazioneCoda;
    togliAltreIdentita();
    const batch = queue.splice(0, 200);
    try {
      if (!batch.length) return;
      const esito = await W.scriviIsolando(batch, commitRighe);
      if (esito.scritte.length) {
        log.written += esito.scritte.length;
        log.lastWriteAt = new Date().toISOString();
      }
      if (esito.rifiutate.length) scarta(esito.rifiutate.length, 'rifiutata', esito.rifiutate[esito.rifiutate.length - 1].motivo);
      if (!esito.errore) {
        log.lastError = '';
        log.lastErrorAt = null;
        return;
      }
      ritenta(esito.errore, esito.rimaste, generazione);
    } catch (e) {
      // Prima di ogni invio (scriviIsolando non lancia): il lotto torna intero.
      ritenta(e, batch, generazione);
    } finally {
      flushing = false;
      await saveQueue();
      if (queue.length && !flushTimer) scheduleFlush(5000);
    }
  }

  function ritenta(errore, rimaste, generazione) {
    log.lastError = String(errore?.message || errore);
    log.lastErrorAt = new Date().toISOString();
    if (generazione !== generazioneCoda) {
      scarta(rimaste.length, 'ricomincia');
      return;
    }
    console.warn('[wallet] registro d\'uso non scritto, ritento:', log.lastError);
    queue.unshift(...rimaste);
    tagliaCoda();
    scheduleFlush(30000);
  }

  // «Ricomincia con un nuovo invito»: le righe in coda sono del portafoglio che si lascia, e nessuna passerebbe più.
  async function svuotaCodaPerRicominciare() {
    await loadQueue();
    generazioneCoda += 1;
    const n = queue.length;
    queue.length = 0;
    scarta(n, 'ricomincia');
    await saveQueue();
    return n;
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
    try { globalThis.SN_AVVISO_CREDITI_MAIN?.registraConsumo({ action, credits: row.credits, usage }); } catch (_) {}
    queue.push(row);
    tagliaCoda();
    await saveQueue();
    scheduleFlush(3000);
  }

  // ── Chiave propria dalla pagina Crediti (#629) ────────────────────────────
  // Spesa e residuo che OpenRouter dichiara per la chiave scritta dall'utente.
  // La chiave non esce dal main: alla pagina tornano i numeri e la frase.
  on(MSG.WALLET_OWN_KEY_INFO, filoOnly(async () => {
    const key = await ownKey();
    if (!key) return { ok: false, status: 'no_own_key' };
    const Gate = globalThis.SN_MODEL_GATE;
    if (!Gate || !Gate.supports('openrouter', 'keyInfo')) return { ok: false, status: 'internal' };
    try {
      const info = await Gate.keyInfo({ provider: 'openrouter', apiKey: key });
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
    // L'avviso nomina la pagina Crediti: porta il tasto per andarci, come ogni frase sui crediti (#663).
    try { broadcastToTabs({ type: MSG.SHOW_TOAST, text: text.charAt(0).toUpperCase() + text.slice(1), duration: 8000, rimedio: { keyRefused: true } }); } catch (_) {}
    try { globalThis.SN_CONTATORI_MAIN?.erroreVisto('avviso:crediti_finiti'); } catch (_) {}
    try { broadcastToFiloPages({ type: MSG.CREDITS_CHANGED }); } catch (_) {}
  }

  // La tariffa dei crediti dell'ultimo stato letto (euro per credito, cambio): le stime di costo (#819) scalano con
  // la stessa del registro d'uso. Mai letta: valgono i valori di ripiego di SN_WALLET.creditsPerUsd.
  function tariffaCrediti() {
    let b = lastServer && lastServer.balance;
    if (!b) { try { const disco = walletStore.lastServer(); b = disco && disco.balance; } catch (_) { b = null; } }
    return { eurPerCredit: b && b.eurPerCredit, eurUsd: b && b.eurUsd };
  }

  globalThis.SN_WALLET_MAIN = {
    recordUsage, outOfCreditsNotice, flush, readState, keySource, tariffaCrediti,
    // Le cifre dette fuori dalla pagina Crediti (#816): chat, premi delle
    // segnalazioni. `redeemedAt`: da quando le segnalazioni portano lo pseudonimo.
    haPortafoglio, saldoPerChat, notaInvio,
    // L'avviso prima che i crediti finiscano (#818) legge l'ultimo stato senza chiederne uno nuovo.
    ultimaLettura: () => ultimaLettura,
    redeemedAt: () => { try { return (walletStore.load() || {}).redeemedAt || null; } catch (_) { return null; } },
    // Lo pseudonimo di questa installazione, letto dal deposito locale (niente
    // rete): lo scrive chi manda un feedback, così il server sa a chi
    // accreditare il premio (#652). Vuoto se non c'è un portafoglio.
    pseudonym: () => { try { return walletStore.pseudonym() || ''; } catch (_) { return ''; } },
    // L'invito che arriva da fuori (#651): main.js porta dentro il
    // collegamento filo://invito/<codice>, l'avvio l'invito in attesa.
    redeemFromInvite, tryPendingInvite, portaDentroInvito,
    // Il controllo che all'avvio e ogni sei ore scrive gli avvisi all'owner (#855): lo chiamano anche gli spec.
    controllaAvvisiOwner,
    // Ripiego dalla chiave propria (#629): li chiama il provider OpenRouter.
    keySourceOf, alternativeKeyFor, noteOwnKeyRefusal, noteOwnKeySuccess, lastOwnKeyRefusal, ownKeyChanged, usageLogStatus,
    // La prova di una chiave dalle Impostazioni (handlers/ai.js): niente riserva.
    senzaRipiego, conRipiegoDetto,
    // Solo per i test (NODE_ENV=test): simula il riavvio senza rete.
    expireIdentityForTest: () => { if (process.env.NODE_ENV === 'test') identity._expireToken(); },
    // …e il riavvio per la coda del registro: la si rilegge dal disco come all'avvio.
    rileggiCodaPerTest: async () => {
      if (process.env.NODE_ENV !== 'test') return;
      queue.length = 0;
      Object.assign(log, { discardedBy: {}, lastDiscardReason: '', lastDiscardAt: null });
      scartiLetti = false;
      caricamentoCoda = null;
      await loadQueue();
    },
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
