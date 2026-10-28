// I contatori del servizio (#1472): politica dei modelli, chiamate mai partite, ripieghi, chiavi e crediti, identità,
// accesso e segnalazioni automatiche, con nomi da elenchi chiusi e numeri: mai una chiave, un codice d'invito o un'email.
// Regole: tests/unit/firestoreRulesContatoriServizio.test.mjs. Misura: src/main/services/contatoriServizio.js.

(function (global) {
  'use strict';

  // Un documento per pseudonimo e ora, con l'id dell'ora (#1461): le regole dell'ora sono già al tetto di espressioni.
  const VERSIONE = 1;
  const COLLEZIONE = 'contatori-servizio';
  const ALTRO = 'altro';
  const NESSUNO = 'nessuno';

  // ── Gli elenchi chiusi: copie di quelli del codice, tests/unit/contatoriServizio.test.mjs li confronta ──────────
  // Perché chi ha servito viola la politica (servedPolicyViolation, src/shared/politicaModelli.js).
  const MOTIVI_VIOLAZIONE = Object.freeze(['excluded', 'not_producer']);
  // Chi paga la chiamata (keySource di src/main/services/providers/openrouter.js); «none» quando non si sa.
  const FONTI = Object.freeze(['own', 'personal', 'factory', 'none']);
  // Il «nessun host ammesso»: i motivi di NO_ALLOWED_HOST (hostVerdict, nessunHostAmmesso, nessunHostZdr,
  // produttoreNonRisponde, erroreCrediti) e i codici del rifiuto del router, in minuscolo.
  const MOTIVI_HOST = Object.freeze(['excluded', 'mixed', 'unknown', 'zdr', 'zdrmixed', 'zdrunknown', 'produttore', 'crediti']);
  const CODICI_HOST = Object.freeze(['data_policy', 'no_provider_allowed', 'model_unavailable', 'no_tool_host']);
  const MOTIVI_NESSUN_HOST = Object.freeze([...MOTIVI_HOST, ...CODICI_HOST, ALTRO]);
  const MOTIVI_ZDR = Object.freeze(['zdr', 'zdrmixed', 'zdrunknown']);
  // «Solo pesi aperti» (applyOpenWeightsPolicy e openWeightsBlockKind, src/shared/constants.js).
  const EVENTI_PESI = Object.freeze(['sostituito', 'tolto', 'blocco_provider', 'blocco_model']);
  const STATI_PESI = Object.freeze(['acceso', 'spento']);
  const ESITI_ZDR = Object.freeze(['partita', 'rifiutata']);
  // Le chiamate che non partono (MAI_PARTITE di src/shared/contatoriGiornalieri.js), in minuscolo.
  const MOTIVI_MAI_PARTITA = Object.freeze(['no_api_key', 'limit_reached', 'no_model_for_action', 'no_open_weights_model',
    'gate_method', 'provider_method_missing', 'no_key_info']);
  // Un tentativo rotto dopo aver scritto, già pagato (brokenAttempts), e la decisione su un errore del classificatore
  // (esitoDecisione di src/main/services/modelGate.js).
  const DECISIONI = Object.freeze(['lento', 'passeggero', 'fatale', 'scarta']);
  const EVENTI_RIPIEGO = Object.freeze(['spezzato', ...DECISIONI]);
  const STATUS_CHIAVE = Object.freeze(['401', '402', '403']);
  const ESITI_RIPIEGO_CHIAVE = Object.freeze(['riuscito', 'fallito', 'non_ammesso']);
  // L'avviso prima che i crediti finiscano (#818, src/shared/creditiAvviso.js): i motivi, i rimedi da un clic, le
  // automatiche che il rimedio «automatiche» spegne (automatiche()), e l'avviso dei crediti finiti.
  const MOTIVI_AVVISO = Object.freeze(['proiezione', 'percento']);
  const RIMEDI = Object.freeze(['modello', 'automatiche', 'chiave']);
  const AUTOMATICHE = Object.freeze(['spiegaAnticipata', 'riassuntoSchede', 'riordinoSchede', 'correttore', 'suggerimenti',
    'categorie', 'nomiFile']);
  // Saldo dei crediti e spesa del mese, in fasce: l'ultima vista nell'ora.
  const FASCE_SALDO = Object.freeze([['c0', 0], ['c1', 1], ['c10', 10], ['c50', 50], ['c100', 100], ['c500', 500], ['oltre', Infinity]]);
  const FASCE_SPESA = Object.freeze([['e0', 0], ['e0_1', 0.1], ['e1', 1], ['e5', 5], ['e20', 20], ['oltre', Infinity]]);
  const LIMITI = Object.freeze(['limite_si', 'limite_no']);
  // Gli esiti del riscatto: le chiavi di REDEEM_MESSAGES (src/shared/wallet.js) più quello che dice solo l'app.
  const ESITI_INVITO = Object.freeze(['ok', 'bad_code', 'invalid_code', 'code_used', 'own_code', 'already_in',
    'invites_exhausted', 'global_cap', 'missing_exchange_rate', 'not_configured', 'provider_error', 'too_many_reissues',
    'internal', 'not_reachable', 'inviter_not_linked', 'network_cap', 'no_identity', ALTRO]);
  // L'identità dell'installazione (src/main/auth/anon-auth.js).
  const EVENTI_IDENTITA = Object.freeze(['identity_lost', 'identity_unreadable', 'illeggibile_da_parte', 'registrazione_fallita',
    'salvataggio_fallito']);
  // L'accesso con Google: l'esito (FRASI di src/main/auth/esitoAccesso.js, più «ok»), il passaggio al browser per
  // motivo (rifiutoGoogle.js, accessoInScheda.js, e nessuna scheda dove aprirlo), il rinnovo della sessione.
  const ESITI_ACCESSO = Object.freeze(['ok', 'rete', 'annullato', 'scaduto', 'browser', 'non_configurato', 'servizio']);
  const MOTIVI_BROWSER = Object.freeze(['rete', 'disallowed_useragent', 'rifiutato', 'errore', 'senza_scheda']);
  const ESITI_RINNOVO = Object.freeze(['rifiutato', 'irraggiungibile']);
  // Le segnalazioni automatiche (F4, src/shared/autoFeedback.js) e la proposta di segnalazione in chat (#360).
  const TIPI_F4 = Object.freeze(['capability-gap', 'complaint', 'capability-uncommandable']);
  const ESITI_F4 = Object.freeze(['inviata', 'in_coda', 'fallita', 'annullata', 'sostituita', 'spenta']);
  const ESITI_PROPOSTA = Object.freeze(['mostrata', 'confermata']);
  // La coda dei feedback (src/main/services/feedbackOutbox.js): voci e età della più vecchia, in fasce; le rinunce.
  const FASCE_VOCI_CODA = Object.freeze([['n0', 0], ['n1', 1], ['n5', 5], ['n20', 20], ['oltre', Infinity]]);
  const FASCE_ETA_CODA = Object.freeze([['h1', 1], ['h6', 6], ['h24', 24], ['oltre', Infinity]]);
  const MOTIVI_RINUNCIA = Object.freeze(['cifratura', 'scaduta', 'troppe']);
  const ATTESE_ACCESSO = Object.freeze(['assente', 'rifiutato']);

  // Il nome di una funzione contata (#969) come lo tengono le regole: l'elenco lo tiene l'app, e cresce. Così l'id di
  // una capacità del manifesto. Modello e host hanno la forma di MODELLO_RE e HOST_RE di src/shared/contatoriGiornalieri.js.
  const FORMA_FUNZIONE = '[a-z][a-z0-9-]{0,39}';
  const FORMA_CAPACITA = '[a-z][a-z0-9-]{0,39}';
  const FORMA_MODELLO = '[a-z0-9][a-z0-9._-]{0,59}([/][a-z0-9][a-z0-9._-]{0,79})?([:][a-z0-9._-]{1,30})?';
  const FORMA_HOST = '[A-Za-z0-9][A-Za-z0-9 ._-]{0,47}';
  const MAX_CONTO = 999999999;
  // Le voci specifiche (con un modello, un host o una capacità) di un'ora, per misura: oltre, le parti aperte
  // diventano «altro» e la somma non perde niente.
  const TETTO_VOCI = 40;

  const intero = (n) => Number.isInteger(n) && n >= 0;
  const oggetto = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const conto = (n) => (intero(n) ? Math.min(n, MAX_CONTO) : 0);
  const alternative = (l) => `(${l.join('|')})`;
  const dalElenco = (v, l) => (l.includes(v) ? v : ALTRO);
  const nomi = (fasce) => Object.freeze(fasce.map(([k]) => k));
  function fasciaIn(fasce, v) {
    const n = typeof v === 'number' ? v : NaN;
    if (!Number.isFinite(n)) return '';
    return fasce.find(([, fino]) => Math.max(0, n) <= fino)[0];
  }

  // ── Le parti di una chiave ─────────────────────────────────────────────
  // Una parte è un elenco chiuso o uno di questi segni. Le funzioni crescono con l'app; modello, host e capacità
  // fanno «aperta» la misura che li porta, che si controlla per forma e ha il tetto delle voci.
  const FUNZ = Object.freeze({ parte: 'funzione', forma: FORMA_FUNZIONE, lunga: 40 });
  const CAP = Object.freeze({ parte: 'capacita', forma: FORMA_CAPACITA, lunga: 40, aperta: true });
  const MOD = Object.freeze({ parte: 'modello', forma: FORMA_MODELLO, lunga: 120, aperta: true });
  const HOST = Object.freeze({ parte: 'host', forma: FORMA_HOST, lunga: 48, aperta: true });
  const segno = (p) => p === FUNZ || p === CAP || p === MOD || p === HOST;

  function funzioni() {
    const C = global.SN_CONTATORI;
    const l = C && typeof C.funzioni === 'function' ? C.funzioni() : [];
    return [...new Set([...l, ALTRO])].filter((f) => new RegExp(`^${FORMA_FUNZIONE}$`).test(f));
  }
  function capacita() {
    const K = global.SN_CAPABILITIES;
    const l = K && Array.isArray(K.CAPABILITIES) ? K.CAPABILITIES.map((c) => c && c.id) : [];
    return [...new Set([...l, NESSUNO, ALTRO])].filter((c) => typeof c === 'string' && new RegExp(`^${FORMA_CAPACITA}$`).test(c));
  }
  const funzioneDa = (f) => dalElenco(String(f || ''), funzioni());
  function capacitaDa(id) {
    const s = String(id || '');
    return s ? dalElenco(s, capacita()) : NESSUNO;
  }
  // Un modello o un host scritti a mano possono essere una chiave o un codice d'invito incollati nel posto sbagliato:
  // un pezzo lungo di lettere e cifre, «sk-», la forma di un codice (ABCD-EFGH) o un modello senza fornitore escono «altro».
  const sembraSegreto = (s) => /^sk[-_]/i.test(s) || /^[a-z0-9]{4}-[a-z0-9]{4}$/i.test(s)
    || s.split(/[^A-Za-z0-9]+/).some((p) => p.length >= 20 && /[0-9]/.test(p) && /[a-z]/i.test(p));
  function modelloDa(m) {
    const C = global.SN_CONTATORI;
    const s = C && typeof C.modelloPulito === 'function' ? C.modelloPulito(m) : ALTRO;
    return s !== ALTRO && s.includes('/') && !sembraSegreto(s) ? s : ALTRO;
  }
  function hostDa(h) {
    const C = global.SN_CONTATORI;
    const s = C && typeof C.hostPulito === 'function' ? C.hostPulito(h) : '';
    return s && s.split(' ').length <= 4 && !sembraSegreto(s) ? s : ALTRO;
  }
  function fonteDa(keySource) {
    const s = String(keySource || '');
    return FONTI.includes(s) ? s : 'none';
  }

  // ── Le misure: per ognuna le voci che ammette, ciascuna fatta di parti ─────────────────────────────────────
  const MISURE = Object.freeze({
    politica_violata: [[FUNZ, MOD, HOST, MOTIVI_VIOLAZIONE, FONTI]],
    servita_ignota: [[FUNZ, MOD]],
    nessun_host: [[FUNZ, MOD, MOTIVI_NESSUN_HOST]],
    pesi_aperti: [[FUNZ, EVENTI_PESI], [['stato'], STATI_PESI]],
    zdr: [[FUNZ, ESITI_ZDR]],
    mai_partita: [[FUNZ, MOTIVI_MAI_PARTITA]],
    ripiego: [[FUNZ, EVENTI_RIPIEGO]],
    chiave_fonte: [[FUNZ, FONTI]],
    chiave_ripiego: [[STATUS_CHIAVE, ESITI_RIPIEGO_CHIAVE]],
    avviso_crediti: [[['scattato'], MOTIVI_AVVISO], [['rimedio'], RIMEDI], [['spenta'], AUTOMATICHE], [['finiti'], ['mostrato']]],
    saldo_spesa: [[['saldo'], nomi(FASCE_SALDO)], [['spesa'], nomi(FASCE_SPESA), LIMITI]],
    invito: [[ESITI_INVITO]],
    identita: [[EVENTI_IDENTITA]],
    accesso: [[['esito'], ESITI_ACCESSO], [['browser'], MOTIVI_BROWSER], [['rinnovo'], ESITI_RINNOVO]],
    f4: [[TIPI_F4, CAP, ESITI_F4]],
    f4_proposta: [[ESITI_PROPOSTA]],
    coda_feedback: [[['voci'], nomi(FASCE_VOCI_CODA)], [['eta'], nomi(FASCE_ETA_CODA)], [['rinuncia'], MOTIVI_RINUNCIA],
      [['attesa_accesso'], ATTESE_ACCESSO]],
  });
  const MAPPE = Object.freeze(Object.keys(MISURE));
  const CAMPI = Object.freeze(['v', 'pseudonimo', 'giorno', 'mese', 'ora', 'app', 'os', ...MAPPE]);
  // Una misura aperta ha una voce sola.
  const aperta = (campo) => has(MISURE, campo) && MISURE[campo].some((voce) => voce.some((p) => p.aperta));

  const elencoDi = (p) => (p === FUNZ ? funzioni() : p === CAP ? capacita() : Array.isArray(p) ? p : []);
  const prodotto = (liste) => liste.reduce((acc, l) => acc.flatMap((a) => l.map((b) => (a === null ? b : `${a}|${b}`))), [null]);
  // L'elenco chiuso intero delle chiavi; null per le misure aperte, che si controllano per forma.
  function chiaviDi(campo) {
    if (!has(MISURE, campo) || aperta(campo)) return null;
    return MISURE[campo].flatMap((voce) => prodotto(voce.map(elencoDi)));
  }
  const formaParte = (p) => (Array.isArray(p) ? alternative(p) : p.forma);
  const formaVoce = (voce) => voce.map(formaParte).join('[|]');
  const CHIAVI_FORMA = Object.freeze(Object.fromEntries(MAPPE.map((c) => [c, alternative(MISURE[c].map(formaVoce))])));
  const unite = (voce) => `^(${voce}(#${voce})*)?$`;
  const FORME = Object.freeze({
    CHIAVI: Object.freeze(Object.fromEntries(MAPPE.map((c) => [c, unite(CHIAVI_FORMA[c])]))),
    CONTI: unite('[0-9]{1,9}'),
  });

  // I tetti di caratteri delle chiavi unite e dei conti uniti, per misura. Le funzioni contate per quattro volte quelle
  // di oggi: una funzione nuova non aspetta regole nuove. Le misure aperte: il tetto delle voci più le righe «altro».
  const FUNZIONI_PREVISTE = 160;
  const lungaParte = (p) => (Array.isArray(p) ? Math.max(...p.map((x) => x.length)) : p.lunga);
  const quanteChiuse = (voce) => voce.reduce((n, p) => n * (segno(p) ? (p === FUNZ ? FUNZIONI_PREVISTE : 1) : p.length), 1);
  function tettiDi(campo) {
    const lunga = (voce) => voce.reduce((n, p) => n + lungaParte(p) + 1, 0);
    let voci = 0;
    let caratteri = 0;
    if (aperta(campo)) {
      const voce = MISURE[campo][0];
      voci = TETTO_VOCI + voce.reduce((n, p) => n * (segno(p) ? 1 : p.length), 1);
      caratteri = voci * lunga(voce);
    } else {
      for (const voce of MISURE[campo]) {
        const n = quanteChiuse(voce);
        voci += n;
        caratteri += n * lunga(voce);
      }
    }
    const tondo = (x) => Math.ceil(x / 100) * 100;
    return [tondo(caratteri), tondo(voci * 10)];
  }
  const TETTI = Object.freeze(Object.fromEntries(MAPPE.map((c) => [c, Object.freeze(tettiDi(c))])));

  // ── L'ora, in memoria ─────────────────────────────────────────────────
  // Sta nell'ora dei contatori sotto `servizio`: i suoi conti hanno già la chiave che esce.
  function vuota() {
    return Object.fromEntries(MAPPE.map((c) => [c, {}]));
  }
  function dati(ora) {
    if (!oggetto(ora)) return vuota();
    if (!oggetto(ora.servizio)) ora.servizio = vuota();
    const d = ora.servizio;
    for (const c of MAPPE) if (!oggetto(d[c])) d[c] = {};
    return d;
  }
  function piu(ora, campo, chiave, n = 1) {
    if (!Number.isFinite(n) || n < 1) return false;
    const m = dati(ora)[campo];
    m[chiave] = Math.min(MAX_CONTO, conto(m[chiave]) + Math.round(n));
    return true;
  }
  // Un'istantanea: le voci che cominciano con `prima` lasciano il posto a quella nuova, che vale 1.
  function fotografa(ora, campo, prima, chiave) {
    const m = dati(ora)[campo];
    for (const k of Object.keys(m)) if (k.startsWith(`${prima}|`)) delete m[k];
    m[chiave] = 1;
    return true;
  }
  // Una combinazione finita in «altro» per il tetto: i contatori della sicurezza la contano fra i tetti toccati (#1474).
  function tettoCombinazioni(ora) {
    const S = global.SN_CONTATORI_SICUREZZA;
    if (S && typeof S.registraTetto === 'function') S.registraTetto(ora, 'contatori_combinazioni');
  }
  // Le misure aperte, con le `parti` già ripulite: oltre il tetto delle voci, funzione e parti aperte diventano «altro».
  function piuAperta(ora, campo, parti) {
    const m = dati(ora)[campo];
    const voce = MISURE[campo][0];
    const generica = (k) => k.split('|').every((x, i) => !segno(voce[i]) || x === ALTRO);
    let chiave = parti.join('|');
    if (!has(m, chiave) && !generica(chiave) && Object.keys(m).filter((k) => !generica(k)).length >= TETTO_VOCI) {
      chiave = parti.map((x, i) => (segno(voce[i]) ? ALTRO : x)).join('|');
      tettoCombinazioni(ora);
    }
    return piu(ora, campo, chiave);
  }

  // 1. Chi ha servito viola la politica: `motivo` come lo dà servedViolationOf ('excluded' | 'not-producer').
  function registraViolazione(ora, { funzione, modello, host, motivo, fonte } = {}) {
    const mv = String(motivo || '').replace(/-/g, '_');
    if (!MOTIVI_VIOLAZIONE.includes(mv)) return false;
    return piuAperta(ora, 'politica_violata', [funzioneDa(funzione), modelloDa(modello), hostDa(host), mv, fonteDa(fonte)]);
  }
  // 2. Una risposta servita di cui non si è saputo chi l'ha servita, nemmeno chiedendolo dopo.
  function registraServitaIgnota(ora, funzione, modello) {
    return piuAperta(ora, 'servita_ignota', [funzioneDa(funzione), modelloDa(modello)]);
  }
  // 3. Il motivo di un «nessun host ammesso», da un errore; '' se non lo è.
  function motivoNessunHost(err) {
    if (!err) return '';
    const code = String(err.code || '');
    if (code === 'NO_ALLOWED_HOST') return dalElenco(String(err.reason || ''), MOTIVI_NESSUN_HOST);
    const c = code.toLowerCase();
    return CODICI_HOST.includes(c) ? c : '';
  }
  function registraNessunHost(ora, funzione, modello, motivo) {
    if (!MOTIVI_NESSUN_HOST.includes(motivo)) return false;
    return piuAperta(ora, 'nessun_host', [funzioneDa(funzione), modelloDa(modello), motivo]);
  }
  // 4. «Solo pesi aperti»: modelli sostituiti e tolti da una catena, prove bloccate; lo stato, visto nell'ora.
  function registraPesi(ora, funzione, evento, n = 1) {
    return EVENTI_PESI.includes(evento) ? piu(ora, 'pesi_aperti', `${funzioneDa(funzione)}|${evento}`, n) : false;
  }
  function registraStatoPesi(ora, acceso) {
    dati(ora).pesi_aperti[`stato|${acceso ? 'acceso' : 'spento'}`] = 1;
    return true;
  }
  // 5. Una richiesta partita con la ritenzione zero, o rifiutata per lei.
  function registraZdr(ora, funzione, esito) {
    return ESITI_ZDR.includes(esito) ? piu(ora, 'zdr', `${funzioneDa(funzione)}|${esito}`) : false;
  }
  // 6. Una chiamata che non è partita: il codice dell'errore, se è uno di quelli.
  function motivoMaiPartita(err) {
    const c = String((err && err.code) || '').toLowerCase();
    return MOTIVI_MAI_PARTITA.includes(c) ? c : '';
  }
  function registraMaiPartita(ora, funzione, motivo) {
    return MOTIVI_MAI_PARTITA.includes(motivo) ? piu(ora, 'mai_partita', `${funzioneDa(funzione)}|${motivo}`) : false;
  }
  // 7. Un tentativo rotto e già pagato, o la decisione del classificatore su un errore.
  function registraRipiego(ora, funzione, evento, n = 1) {
    return EVENTI_RIPIEGO.includes(evento) ? piu(ora, 'ripiego', `${funzioneDa(funzione)}|${evento}`, n) : false;
  }
  // 10. La chiave che ha servito una risposta.
  function registraFonte(ora, funzione, keySource) {
    return piu(ora, 'chiave_fonte', `${funzioneDa(funzione)}|${fonteDa(keySource)}`);
  }
  // 11. Il ripiego dalla chiave propria ai crediti, per lo status del rifiuto.
  function registraRipiegoChiave(ora, status, esito) {
    const s = String(Number(status) || '');
    if (!STATUS_CHIAVE.includes(s) || !ESITI_RIPIEGO_CHIAVE.includes(esito)) return false;
    return piu(ora, 'chiave_ripiego', `${s}|${esito}`);
  }
  // 12. L'avviso dei crediti: `cosa` è scattato | rimedio | spenta | finiti, `voce` il nome dal suo elenco.
  const AVVISO = Object.freeze({ scattato: MOTIVI_AVVISO, rimedio: RIMEDI, spenta: AUTOMATICHE, finiti: ['mostrato'] });
  function registraAvviso(ora, cosa, voce) {
    if (!has(AVVISO, cosa) || !AVVISO[cosa].includes(voce)) return false;
    return piu(ora, 'avviso_crediti', `${cosa}|${voce}`);
  }
  // 13. Saldo dei crediti (null se non c'è un portafoglio letto) e spesa del mese in euro, col limite mensile.
  function registraSaldo(ora, { saldo = null, spesaEur = null, limiteEur = null } = {}) {
    const fs = typeof saldo === 'number' ? fasciaIn(FASCE_SALDO, saldo) : '';
    const fe = typeof spesaEur === 'number' ? fasciaIn(FASCE_SPESA, spesaEur) : '';
    if (fs) fotografa(ora, 'saldo_spesa', 'saldo', `saldo|${fs}`);
    if (fe) fotografa(ora, 'saldo_spesa', 'spesa', `spesa|${fe}|${Number(limiteEur) > 0 ? 'limite_si' : 'limite_no'}`);
    return Boolean(fs || fe);
  }
  // 14. L'esito di un riscatto d'invito: lo status, mai il codice.
  function registraInvito(ora, status) {
    return piu(ora, 'invito', dalElenco(String(status || ''), ESITI_INVITO));
  }
  // 15. Un guasto dell'identità dell'installazione.
  function registraIdentita(ora, evento) {
    return EVENTI_IDENTITA.includes(evento) ? piu(ora, 'identita', evento) : false;
  }
  // 16. L'accesso con Google: `cosa` è esito | browser | rinnovo.
  const ACCESSO = Object.freeze({ esito: ESITI_ACCESSO, browser: MOTIVI_BROWSER, rinnovo: ESITI_RINNOVO });
  function registraAccesso(ora, cosa, voce) {
    const v = String(voce || '').replace(/-/g, '_');
    if (!has(ACCESSO, cosa) || !ACCESSO[cosa].includes(v)) return false;
    return piu(ora, 'accesso', `${cosa}|${v}`);
  }
  // 17. Una segnalazione automatica: il suo tipo, la capacità del manifesto che nomina (o nessuna) e com'è finita.
  function registraF4(ora, tipo, capabilityId, esito) {
    if (!TIPI_F4.includes(tipo) || !ESITI_F4.includes(esito)) return false;
    return piuAperta(ora, 'f4', [tipo, capacitaDa(capabilityId), esito]);
  }
  function registraProposta(ora, esito) {
    return ESITI_PROPOSTA.includes(esito) ? piu(ora, 'f4_proposta', esito) : false;
  }
  // 18. La coda dei feedback: l'istantanea di quante voci aspettano e da quanto la più vecchia; rinunce e attese.
  function registraCoda(ora, { voci, etaMs = null } = {}) {
    const fv = typeof voci === 'number' ? fasciaIn(FASCE_VOCI_CODA, voci) : '';
    if (!fv) return false;
    fotografa(ora, 'coda_feedback', 'voci', `voci|${fv}`);
    const fe = voci > 0 && typeof etaMs === 'number' ? fasciaIn(FASCE_ETA_CODA, etaMs / 3600000) : '';
    const m = dati(ora).coda_feedback;
    for (const k of Object.keys(m)) if (k.startsWith('eta|')) delete m[k];
    if (fe) m[`eta|${fe}`] = 1;
    return true;
  }
  function registraRinuncia(ora, motivo, n = 1) {
    return MOTIVI_RINUNCIA.includes(motivo) ? piu(ora, 'coda_feedback', `rinuncia|${motivo}`, n) : false;
  }
  function registraAttesaAccesso(ora, perche) {
    return ATTESE_ACCESSO.includes(perche) ? piu(ora, 'coda_feedback', `attesa_accesso|${perche}`) : false;
  }

  // ── Il documento che esce: ricostruito dagli elenchi chiusi e dalle forme, mai copiato ──────────────────────
  function contiPuliti(campo, mappa) {
    const out = {};
    const ammesse = chiaviDi(campo);
    const forma = ammesse ? null : new RegExp(`^${CHIAVI_FORMA[campo]}$`);
    const chiavi = ammesse || (oggetto(mappa) ? Object.keys(mappa).filter((k) => forma.test(k)).sort() : []);
    for (const k of chiavi) {
      const n = oggetto(mappa) && has(mappa, k) ? mappa[k] : 0;
      if (intero(n) && n > 0) out[k] = String(conto(n));
    }
    return out;
  }

  // `dati`: l'ora dei contatori com'è sul disco.
  function documento({ pseudonimo, chiave, app, os, dati: ora }) {
    const C = global.SN_CONTATORI;
    const grezzo = oggetto(ora) && oggetto(ora.servizio) ? JSON.parse(JSON.stringify(ora.servizio)) : {};
    const d = dati({ servizio: grezzo });
    const [giorno, h] = String(chiave || '').split('T');
    const doc = {
      v: VERSIONE,
      pseudonimo: String(pseudonimo || ''),
      giorno: String(giorno || ''),
      mese: String(giorno || '').slice(0, 7),
      ora: String(h || ''),
      app: C ? C.versioneApp(app) : String(app || ''),
      os: C && C.OS.includes(os) ? os : ALTRO,
    };
    for (const c of MAPPE) doc[c] = contiPuliti(c, d[c]);
    return doc;
  }
  // Un'ora senza niente del servizio non ha il suo documento.
  function senzaDati(doc) {
    return !doc || MAPPE.every((c) => !oggetto(doc[c]) || !Object.keys(doc[c]).length);
  }

  // La forma che chiedono le regole, e in più le chiavi dell'elenco chiuso intero.
  function valida(doc) {
    const no = (motivo) => ({ ok: false, motivo });
    const C = global.SN_CONTATORI;
    if (!oggetto(doc)) return no('non è un documento');
    const chiavi = Object.keys(doc);
    if (chiavi.length !== CAMPI.length || !CAMPI.every((k) => has(doc, k))) return no(`campi: ${chiavi.join(',')}`);
    if (doc.v !== VERSIONE) return no('versione');
    if (!C) return no('contatori non caricati');
    if (!C.PSEUDONIMO_RE.test(String(doc.pseudonimo))) return no('pseudonimo');
    if (!C.GIORNO_RE.test(String(doc.giorno)) || doc.mese !== String(doc.giorno).slice(0, 7)) return no('giorno');
    if (!C.ORA_RE.test(String(doc.ora))) return no('ora');
    if (!C.APP_RE.test(String(doc.app))) return no('versione dell\'app');
    if (!C.OS.includes(doc.os)) return no('sistema');
    const conti = new RegExp(FORME.CONTI);
    for (const c of MAPPE) {
      const m = doc[c];
      if (!oggetto(m)) return no(c);
      const ks = Object.keys(m);
      const ammesse = chiaviDi(c);
      if (ammesse) {
        const s = new Set(ammesse);
        if (ks.some((k) => !s.has(k))) return no(`${c}: chiave fuori elenco`);
      }
      const vs = Object.values(m);
      if (!vs.every((v) => typeof v === 'string')) return no(`${c}: valori`);
      const [tk, tv] = TETTI[c];
      if (ks.join('#').length > tk || vs.join('#').length > tv) return no(`${c}: oltre il tetto`);
      if (!new RegExp(FORME.CHIAVI[c]).test(ks.join('#')) || !conti.test(vs.join('#'))) return no(`${c}: forma`);
    }
    return { ok: true, motivo: '' };
  }

  global.SN_CONTATORI_SERVIZIO = {
    VERSIONE, COLLEZIONE, CAMPI, MAPPE, MISURE, FORME, TETTI, CHIAVI_FORMA, ALTRO, NESSUNO, TETTO_VOCI, FUNZIONI_PREVISTE,
    FORMA_FUNZIONE, FORMA_CAPACITA, FORMA_MODELLO, FORMA_HOST,
    MOTIVI_VIOLAZIONE, FONTI, MOTIVI_HOST, CODICI_HOST, MOTIVI_NESSUN_HOST, MOTIVI_ZDR, EVENTI_PESI, STATI_PESI, ESITI_ZDR,
    MOTIVI_MAI_PARTITA, DECISIONI, EVENTI_RIPIEGO, STATUS_CHIAVE, ESITI_RIPIEGO_CHIAVE, MOTIVI_AVVISO, RIMEDI, AUTOMATICHE,
    FASCE_SALDO, FASCE_SPESA, LIMITI, ESITI_INVITO, EVENTI_IDENTITA, ESITI_ACCESSO, MOTIVI_BROWSER, ESITI_RINNOVO,
    TIPI_F4, ESITI_F4, ESITI_PROPOSTA, FASCE_VOCI_CODA, FASCE_ETA_CODA, MOTIVI_RINUNCIA, ATTESE_ACCESSO,
    funzioni, capacita, chiaviDi, aperta, fonteDa, motivoNessunHost, motivoMaiPartita, fasciaIn,
    vuota, dati, registraViolazione, registraServitaIgnota, registraNessunHost, registraPesi, registraStatoPesi, registraZdr,
    registraMaiPartita, registraRipiego, registraFonte, registraRipiegoChiave, registraAvviso, registraSaldo, registraInvito,
    registraIdentita, registraAccesso, registraF4, registraProposta, registraCoda, registraRinuncia, registraAttesaAccesso,
    documento, senzaDati, valida,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
