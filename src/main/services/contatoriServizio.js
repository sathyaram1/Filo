// Le misure del servizio (#1472): politica dei modelli, chiamate mai partite, ripieghi, chiavi, crediti, identità,
// accesso e segnalazioni automatiche. Passa nomi da elenchi chiusi e numeri al servizio dei contatori, che tiene
// interruttore e incognito; mai una chiave, un codice d'invito, un'email o un testo. Forma: src/shared/contatoriServizio.js.

// Un errore contato fra le chiamate mai partite: più porte lo vedono passare (il cancello, chi l'ha chiamato), una conta.
const CONTATA = Symbol('mai partita contata');
const SPESA_VALE_MS = 5 * 60 * 1000;

function crea(dip = {}) {
  const contatori = dip.contatori;
  const R = dip.R || globalThis.SN_CONTATORI_SERVIZIO;
  const C = () => dip.C || globalThis.SN_CONTATORI;
  const adesso = dip.adesso || (() => Date.now());
  const portafoglio = dip.portafoglio || (() => {
    const W = globalThis.SN_WALLET_MAIN;
    return W && typeof W.ultimaLettura === 'function' ? W.ultimaLettura() : null;
  });
  const spesaDelMese = dip.spesaDelMese || (async () => {
    const K = globalThis.SN_COSTS;
    const m = K && typeof K.getMonthly === 'function' ? await K.getMonthly() : null;
    return m && Number.isFinite(Number(m.totalEur)) ? Number(m.totalEur) : null;
  });
  const coda = dip.coda || (() => {
    const O = globalThis.SN_FEEDBACK_OUTBOX;
    return O && typeof O.stato === 'function' ? O.stato() : null;
  });
  const impostazioni = dip.impostazioni || (() => (typeof contatori.impostazioniViste === 'function' ? contatori.impostazioniViste() : null));

  // `incognito` vero salta, falso conta; senza, decide il contesto della chiamata, come per ogni altro conto.
  const scrivi = (fn, incognito = null) => contatori.servizio((ora) => fn(ora), { incognito: typeof incognito === 'boolean' ? incognito : null });
  const funzioneDi = (action) => {
    if (!action) return '';
    try { return C().funzioneDi(action) || ''; } catch (_) { return ''; }
  };

  // ── L'istantanea dell'ora: lo stato dei pesi aperti, saldo e spesa, la coda dei feedback ───────────────────
  // La spesa del mese si legge solo in modo asincrono: l'istantanea usa l'ultima letta, e ne chiede una nuova.
  let spesa = { eur: null, at: 0, inVolo: false };
  function rinfrescaSpesa() {
    if (spesa.inVolo || adesso() - spesa.at < SPESA_VALE_MS) return;
    spesa.inVolo = true;
    Promise.resolve().then(spesaDelMese).then((eur) => {
      spesa = { eur: typeof eur === 'number' ? eur : spesa.eur, at: adesso(), inVolo: false };
    }, () => { spesa = { ...spesa, at: adesso(), inVolo: false }; });
  }
  function fotografaOra(ora) {
    const s = impostazioni();
    if (s && typeof s === 'object') R.registraStatoPesi(ora, s.openWeightsOnly === true);
    let saldo = null;
    try {
      const w = portafoglio();
      const crediti = w && w.state && w.state.server && w.state.server.balance && w.state.server.balance.credits;
      if (typeof crediti === 'number' && Number.isFinite(crediti)) saldo = crediti;
    } catch (_) { saldo = null; }
    const limiteEur = s && typeof s === 'object' ? Number(s.monthlyLimitEur) || 0 : null;
    R.registraSaldo(ora, { saldo, spesaEur: s ? spesa.eur : null, limiteEur });
    try {
      const q = coda();
      if (q && typeof q.voci === 'number') R.registraCoda(ora, { voci: q.voci, etaMs: q.piuVecchiaMs });
    } catch (_) {}
    rinfrescaSpesa();
  }
  contatori.primaDiOgniScrittura(fotografaOra);
  rinfrescaSpesa();

  // ── Il cancello dei modelli ─────────────────────────────────────────────
  // La ritenzione zero vale per ogni richiesta al router pagata coi crediti, tranne i modelli del solo produttore
  // (zdrApplies di src/main/services/providers/openrouter.js). `keySource` vuota: nessuna richiesta è partita.
  function conZdr(provider, modello, keySource) {
    if (provider !== 'openrouter' || !keySource || keySource === 'own') return false;
    const K = globalThis.SN_CONST;
    return !(K && typeof K.producerOnlyRule === 'function' && K.producerOnlyRule(String(modello || '')));
  }

  // Una risposta servita: la chiave che l'ha pagata, la ritenzione zero, e chi l'ha servita se non lo si saprà più.
  function servita(action, { modello = '', provider = '', keySource = '', ignota = false } = {}) {
    const f = funzioneDi(action);
    const src = String(keySource || '');
    scrivi((ora) => {
      R.registraFonte(ora, f, src);
      if (conZdr(provider, modello, src)) R.registraZdr(ora, f, 'partita');
      if (ignota) R.registraServitaIgnota(ora, f, modello);
    });
    return true;
  }
  function servitaIgnota(action, modello) {
    const f = funzioneDi(action);
    scrivi((ora) => R.registraServitaIgnota(ora, f, modello));
    return true;
  }

  // Un tentativo fallito: il «nessun host ammesso» col suo motivo, e la ritenzione zero se la richiesta era partita.
  function tentativoFallito(action, err, { modello = '', provider = '' } = {}) {
    if (!err || typeof err !== 'object') return false;
    const motivo = R.motivoNessunHost(err);
    const m = modello || err.model || '';
    const partita = conZdr(provider || err.provider || '', m, err.keySource);
    if (!motivo && !partita) return false;
    const f = funzioneDi(action);
    scrivi((ora) => {
      if (motivo) R.registraNessunHost(ora, f, m, motivo);
      if (R.MOTIVI_ZDR.includes(motivo)) R.registraZdr(ora, f, 'rifiutata');
      if (partita) R.registraZdr(ora, f, 'partita');
    });
    return true;
  }

  // `motivo` come lo dà servedViolationOf; `fonte` la keySource di chi ha pagato.
  function violazione({ action, modello, host, motivo, fonte } = {}) {
    const f = funzioneDi(action);
    const dati = { funzione: f, modello: String(modello || ''), host: String(host || ''), motivo: String(motivo || ''), fonte: String(fonte || '') };
    scrivi((ora) => R.registraViolazione(ora, dati));
    return true;
  }

  function maiPartita(action, err) {
    if (!err || typeof err !== 'object' || err[CONTATA]) return false;
    const motivo = R.motivoMaiPartita(err);
    if (!motivo) return false;
    try { Object.defineProperty(err, CONTATA, { value: true, enumerable: false }); } catch (_) { return false; }
    const f = funzioneDi(action || err.action);
    const tolti = motivo === 'no_open_weights_model' && Array.isArray(err.droppedRefs) ? err.droppedRefs.length : 0;
    scrivi((ora) => {
      R.registraMaiPartita(ora, f, motivo);
      if (tolti) R.registraPesi(ora, f, 'tolto', tolti);
    });
    return true;
  }

  // Una catena costruita per una chiamata vera, coi modelli che «solo pesi aperti» ha sostituito o tolto (buildAttemptChain
  // li lascia su `pesiAperti`). La stessa catena passa da più porte: conta una volta.
  const catene = new WeakSet();
  function catena(action, attempts) {
    if (!attempts || typeof attempts !== 'object' || catene.has(attempts)) return false;
    catene.add(attempts);
    const p = attempts.pesiAperti;
    if (!p || !(p.sostituiti > 0 || p.tolti > 0)) return false;
    const f = funzioneDi(action);
    scrivi((ora) => {
      if (p.sostituiti > 0) R.registraPesi(ora, f, 'sostituito', p.sostituiti);
      if (p.tolti > 0) R.registraPesi(ora, f, 'tolto', p.tolti);
    });
    return true;
  }
  // La prova di un fornitore o di un modello fermata dall'interruttore: `tipo` è quello di openWeightsBlockKind.
  function bloccoPesi(tipo) {
    if (tipo !== 'provider' && tipo !== 'model') return false;
    const K = globalThis.SN_CONST;
    const f = funzioneDi(K && K.ACTIONS && K.ACTIONS.PROVIDER_TEST);
    scrivi((ora) => R.registraPesi(ora, f, `blocco_${tipo}`));
    return true;
  }

  function ripiego(action, evento, n = 1) {
    if (!R.EVENTI_RIPIEGO.includes(evento) || !(n >= 1)) return false;
    const f = funzioneDi(action);
    scrivi((ora) => R.registraRipiego(ora, f, evento, n));
    return true;
  }

  // ── Chiavi, crediti, identità, accesso, segnalazioni ──────────────────────────
  const semplice = (registra, ...a) => { scrivi((ora) => registra(ora, ...a)); return true; };
  const ripiegoChiave = (status, esito) => semplice(R.registraRipiegoChiave, Number(status) || 0, String(esito || ''));
  const avviso = (cosa, voce) => semplice(R.registraAvviso, String(cosa || ''), String(voce || ''));
  const invito = (status) => semplice(R.registraInvito, String(status || ''));
  const identita = (evento) => semplice(R.registraIdentita, String(evento || ''));
  const accesso = (cosa, voce) => semplice(R.registraAccesso, String(cosa || ''), String(voce || ''));
  const proposta = (esito) => semplice(R.registraProposta, String(esito || ''));
  const rinuncia = (motivo, n = 1) => semplice(R.registraRinuncia, String(motivo || ''), Number(n) || 0);
  const attesaAccesso = (perche) => semplice(R.registraAttesaAccesso, String(perche || ''));
  // `incognito`: quello della chat da cui è nata, che il suo esito arriva dopo, da un'altra strada.
  function f4(tipo, capabilityId, esito, { incognito = null } = {}) {
    scrivi((ora) => R.registraF4(ora, String(tipo || ''), String(capabilityId || ''), String(esito || '')), incognito);
    return true;
  }

  return {
    fotografaOra, servita, servitaIgnota, tentativoFallito, violazione, maiPartita, catena, bloccoPesi, ripiego,
    ripiegoChiave, avviso, invito, identita, accesso, f4, proposta, rinuncia, attesaAccesso,
  };
}

// Per gli agganci: una misura che non c'è o che si rompe non ferma mai chi la chiama. Quelle che arrivano prima che
// il servizio esista (l'identità all'avvio) aspettano, con un tetto.
const IN_ATTESA = [];
const TETTO_ATTESA = 100;
function misura(nome, ...args) {
  try {
    const m = globalThis.SN_CONTATORI_SERVIZIO_MAIN;
    if (!m) {
      if (IN_ATTESA.length < TETTO_ATTESA) IN_ATTESA.push([nome, args]);
      return undefined;
    }
    return typeof m[nome] === 'function' ? m[nome](...args) : undefined;
  } catch (_) { return undefined; }
}
function avvia(m) {
  globalThis.SN_CONTATORI_SERVIZIO_MAIN = m;
  for (const [nome, args] of IN_ATTESA.splice(0)) misura(nome, ...args);
  return m;
}

module.exports = { crea, misura, avvia, CONTATA };
