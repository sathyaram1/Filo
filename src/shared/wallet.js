// Crediti sul server e chiave personale, logica PURA condivisa fra main e pagine (#598).
// Un 402 del provider è «crediti finiti» e NON si ritenta; la riga del registro d'uso porta
// SOLO i campi che le regole Firestore accettano: uno in più la fa rifiutare.

(function (global) {
  'use strict';

  // Gli stessi campi elencati nelle regole Firestore (wallet-usage): cambiarli qui senza
  // cambiarli lì fa rifiutare ogni riga.
  const USAGE_FIELDS = Object.freeze([
    'pseudonym', 'at', 'action', 'model', 'servedBy',
    'promptTokens', 'completionTokens', 'costUsd', 'credits',
  ]);

  // 402 dal servizio AI = tetto della chiave esaurito; con la chiave personale vuol dire
  // «crediti finiti».
  function isOutOfCredits(err) {
    if (!err) return false;
    const st = Number(err.status);
    if (st === 402) return true;
    const raw = String((err && err.message) || err || '');
    return /^OpenRouter(?:\s+\S+)?\s+402\b/.test(raw) || /insufficient credits|key limit exceeded/i.test(raw);
  }

  // Quanti crediti vale un dollaro, coi parametri del server (euro per
  // credito, cambio): la stessa tariffa scala il saldo e fa le stime (#819).
  function creditsPerUsd({ eurPerCredit, eurUsd } = {}) {
    const e = Number(eurPerCredit) || 0.0007;
    const fx = Number(eurUsd) || 1.1;
    return 1 / (e * fx);
  }

  // Quanti crediti vale una spesa in dollari. Per eccesso al decimo: ciò che
  // si scala al saldo mostrato non deve essere meno di ciò che OpenRouter conta.
  function creditsForUsd(costUsd, params = {}) {
    const usd = Number(costUsd);
    if (!Number.isFinite(usd) || usd <= 0) return 0;
    return Math.ceil(usd * creditsPerUsd(params) * 10 - 1e-6) / 10;
  }

  // I tetti di lunghezza della stessa regola: un nome di modello più lungo farebbe rifiutare la
  // riga intera, accorciato arriva. Sentinella in tests/unit/wallet.test.mjs.
  const USAGE_LIMITS = Object.freeze({ at: 40, action: 80, model: 200, servedBy: 100 });

  // Scarta tutto ciò che non è nel contratto. `at` è ISO UTC: il server confronta per
  // intervallo di tempo.
  function usageRow({ pseudonym, at, action, model, servedBy, usage, costUsd, credits } = {}) {
    if (!pseudonym) return null;
    const u = usage || {};
    const usd = Number(costUsd != null ? costUsd : u.costUsd);
    const L = USAGE_LIMITS;
    return {
      pseudonym: String(pseudonym),
      at: String(at || new Date().toISOString()).slice(0, L.at),
      action: String(action || '').slice(0, L.action),
      model: String(model || '').slice(0, L.model),
      servedBy: String(servedBy || '').slice(0, L.servedBy),
      promptTokens: Math.max(0, Math.floor(Number(u.promptTokens) || 0)),
      completionTokens: Math.max(0, Math.floor(Number(u.completionTokens) || 0)),
      costUsd: Number.isFinite(usd) && usd > 0 ? usd : 0,
      credits: Math.max(0, Number(credits) || 0),
    };
  }

  // La regola o il contenuto rifiutano la riga, e ritentarla non la fa mai passare (#1601). Una chiave API
  // ruotata o bloccata risponde con gli stessi codici ma vale per tutte le righe: è un guasto, si ritenta.
  function rifiutoDellaRigaUso(status, testo) {
    const t = String(testo || '');
    return (status === 403 && /insufficient permissions/i.test(t)) || (status === 400 && !/api.?key/i.test(t));
  }

  // Il commit di Firestore è atomico: una riga che la regola rifiuta respinge tutto il lotto (#1601).
  // Al rifiuto il lotto si divide a metà finché la riga cattiva resta sola, e le buone passano.
  // `commit(righe)` dà { ok: true } o { ok: false, motivo } per un rifiuto, e lancia per un guasto
  // passeggero: allora ci si ferma, e ciò che non è stato né scritto né rifiutato sta in `rimaste`.
  async function scriviIsolando(righe, commit) {
    const esito = { scritte: [], rifiutate: [], rimaste: [], errore: null };
    const daFare = righe && righe.length ? [righe.slice()] : [];
    while (daFare.length) {
      const lotto = daFare.shift();
      let r;
      try { r = await commit(lotto); } catch (e) {
        esito.errore = e;
        esito.rimaste = [lotto, ...daFare].flat();
        return esito;
      }
      if (r && r.ok) esito.scritte.push(...lotto);
      else if (lotto.length === 1) esito.rifiutate.push({ riga: lotto[0], motivo: String((r && r.motivo) || '') });
      else {
        const meta = Math.ceil(lotto.length / 2);
        daFare.unshift(lotto.slice(0, meta), lotto.slice(meta));
      }
    }
    return esito;
  }

  // Le righe del registro uscite dalla coda senza arrivare al server, dette alla pagina Crediti.
  // `perMotivo`: { rifiutata, altra_identita, ricomincia, coda_piena } → quante. '' se nessuna.
  const SCARTATE_MOTIVI = Object.freeze({
    rifiutata: ['rifiutato dal server', 'rifiutati dal server'],
    altra_identita: ['di un portafoglio di prima', 'di un portafoglio di prima'],
    ricomincia: ['tolto ricominciando con un nuovo invito', 'tolti ricominciando con un nuovo invito'],
    coda_piena: ['perso perché ce n\'erano troppi in attesa', 'persi perché ce n\'erano troppi in attesa'],
  });
  function registroScartateTesto(perMotivo) {
    const voci = Object.keys(SCARTATE_MOTIVI)
      .map((m) => [m, Math.max(0, Math.floor(Number(perMotivo && perMotivo[m]) || 0))])
      .filter(([, n]) => n > 0);
    const tot = voci.reduce((s, [, n]) => s + n, 0);
    if (!tot) return '';
    const testa = tot === 1 ? 'Un consumo non è stato registrato' : `${tot} consumi non sono stati registrati`;
    const frase = (m, n) => SCARTATE_MOTIVI[m][n === 1 ? 0 : 1];
    if (voci.length === 1) return `${testa}: ${frase(voci[0][0], tot)}.`;
    return `${testa}: ${voci.map(([m, n]) => `${n} ${frase(m, n)}`).join(', ')}.`;
  }

  // Il messaggio per l'utente quando la chiamata è stata rifiutata per crediti.
  //   usingOwnKey: la chiamata è partita con una chiave dell'utente (non quella
  //                personale di Filo): allora è il SUO conto OpenRouter.
  //   dailyCredits: quota giornaliera, se nota, per dire quanto arriva domani.
  //   fallbackFailed: la chiave propria è stata rifiutata E la personale ha
  //                risposto 402: sono finiti tutti e due (#629).
  //   hasWallet:   c'è un portafoglio (chiave personale su questo computer).
  //                Senza, «togli la chiave per tornare ai crediti di Filo»
  //                è una promessa vuota: la strada è un invito.
  function outOfCreditsMessage({ usingOwnKey = false, dailyCredits = null, fallbackFailed = false, hasWallet = null } = {}) {
    const domani = dailyCredits ? ` (domani ne arrivano ${dailyCredits})` : '';
    if (fallbackFailed) {
      return `OpenRouter ha rifiutato la tua chiave (il suo credito è finito) e anche i crediti di Filo sono finiti${domani}: ricarica il tuo conto OpenRouter, oppure aspetta i crediti di domani.`;
    }
    if (usingOwnKey) {
      if (hasWallet === false) {
        return 'la tua chiave OpenRouter non ha più credito: ricarica il tuo conto OpenRouter, oppure riscatta un invito nella pagina Crediti per usare i crediti di Filo.';
      }
      return 'la tua chiave OpenRouter non ha più credito: ricarica il tuo account OpenRouter, oppure togli la chiave dalla pagina Crediti per tornare ai crediti di Filo.';
    }
    return `i crediti di Filo sono finiti${domani}. Puoi aspettare quelli di domani, oppure mettere una tua chiave OpenRouter nella pagina Crediti.`;
  }

  // ── Ripiego dalla chiave propria ai crediti di Filo (#629) ───────────────
  // OpenRouter documenta i codici così: 401 chiave disattivata o non valida,
  // 402 credito finito, 403 permessi insufficienti, guardia sui contenuti o
  // moderazione. I primi due sono sempre la CHIAVE; il 403 lo è solo se la
  // risposta non parla di moderazione (secondo giro di verifica del ramo: un
  // testo segnalato dalla moderazione lo è con qualunque chiave, e rimandarlo
  // coi crediti di Filo lo fa bloccare di nuovo mentre Crediti segna un
  // rifiuto che non c'è stato). Solo per un rifiuto della chiave, se la
  // chiamata era partita con la chiave scritta dall'utente e c'è la chiave
  // personale del portafoglio, si ritenta la stessa richiesta con la
  // personale. Rete, 429, 5xx, errori di modello: no — non è la chiave.
  function isKeyRefusalStatus(status) {
    const st = Number(status);
    return st === 401 || st === 402 || st === 403;
  }

  // La risposta di OpenRouter dice che è la moderazione (o una guardia sui
  // contenuti) a bloccare il testo: il corpo porta `metadata.reasons` e
  // `flagged_input`, o lo dice a parole.
  function isModerationBlock(body) {
    const text = typeof body === 'string' ? body : (body ? JSON.stringify(body) : '');
    if (!text) return false;
    return /moderat|flagged|guardrail|content policy/i.test(text);
  }

  // Rifiuto della CHIAVE: status più, per il 403, il corpo della risposta.
  function isKeyRefusal(status, body) {
    const st = Number(status);
    if (st === 401 || st === 402) return true;
    if (st === 403) return !isModerationBlock(body);
    return false;
  }

  // Lo status di rifiuto della chiave dentro un errore del provider, o 0. Il
  // messaggio dell'errore porta il corpo della risposta («OpenRouter 403: …»):
  // un 403 di moderazione non è un rifiuto.
  function keyRefusalOf(err) {
    if (!err) return 0;
    const msg = String(err.message || err || '');
    let st = Number(err.status);
    if (!isKeyRefusalStatus(st)) {
      const m = /^OpenRouter(?:\s+\S+)?\s+(40[123])\b/.exec(msg);
      st = m ? Number(m[1]) : 0;
    }
    if (!st) return 0;
    return isKeyRefusal(st, msg) ? st : 0;
  }

  // Il perché, da incastonare dopo «OpenRouter ha rifiutato la chiave».
  function keyRefusalReason(status) {
    const st = Number(status);
    if (st === 401) return 'non la riconosce';
    if (st === 402) return 'il suo credito è finito';
    if (st === 403) return 'ha bloccato la richiesta';
    return 'senza dire perché';
  }

  // La riga discreta in chat, quando il ripiego è appena avvenuto.
  function ownKeyFallbackLine(status) {
    return `OpenRouter ha rifiutato la tua chiave (${keyRefusalReason(status)}): ho usato i crediti di Filo.`;
  }

  // Lo stato nella pagina Crediti: l'ultimo rifiuto, e cosa succede finché la
  // chiave resta lì. `at` è ISO.
  // `usedCredits === false`: il ripiego non ha risposto, niente è stato speso.
  function ownKeyRefusalNote({ at, status, usedCredits } = {}) {
    let quando = '';
    try {
      const d = new Date(at);
      if (!Number.isNaN(d.getTime())) {
        quando = ` l'ultima volta il ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} alle ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
      }
    } catch (_) { quando = ''; }
    if (usedCredits === false) {
      return `OpenRouter ha rifiutato la tua chiave${quando} (${keyRefusalReason(status)}). Finché resta qui, ogni chiamata prova prima lei; se la rifiuta, Filo usa i tuoi crediti.`;
    }
    return `OpenRouter ha rifiutato la tua chiave${quando} (${keyRefusalReason(status)}) e Filo ha usato i tuoi crediti. Finché resta qui, ogni chiamata prova prima lei.`;
  }

  // Gli ultimi sei caratteri della chiave, per riconoscerla senza mostrarla.
  function keyTail(key) {
    const k = String(key || '').trim();
    return k ? k.slice(-6) : '';
  }

  // Spesa e residuo della chiave propria, come li dice `GET /api/v1/auth/key`
  // di OpenRouter: { limit, usage, limit_remaining }. `limit` null = nessun
  // tetto sulla chiave: allora quello che resta è il credito dell'account
  // (`account`: { credits, usage } da `GET /api/v1/credits`), e senza nemmeno
  // quello resta la sola spesa.
  function ownKeyBalanceLine({ limit, usage, limit_remaining, account } = {}) {
    const usd = (n) => `${new Intl.NumberFormat('it-IT', { useGrouping: true, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)} $`;
    const spesa = `Spesi ${usd(usage)}`;
    const conto = account && Number.isFinite(Number(account.credits))
      ? Math.max(0, Number(account.credits) - (Number(account.usage) || 0))
      : null;
    if (limit == null || !Number.isFinite(Number(limit))) {
      if (conto != null) return `${spesa} · restano ${usd(conto)} sul tuo conto OpenRouter`;
      return `${spesa} · nessun tetto`;
    }
    const resta = limit_remaining != null && Number.isFinite(Number(limit_remaining))
      ? Number(limit_remaining)
      : Number(limit) - (Number(usage) || 0);
    // Il tetto di una chiave è un limite, non un saldo: se il conto ha meno
    // del residuo del tetto, OpenRouter rifiuta quando finisce il conto
    // (secondo giro di verifica del ramo).
    if (conto != null && conto < Math.max(0, resta)) {
      return `${spesa} · restano ${usd(conto)} sul tuo conto OpenRouter, meno del tetto della chiave (${usd(limit)})`;
    }
    return `${spesa} · restano ${usd(Math.max(0, resta))} su ${usd(limit)}`;
  }

  // Gli esiti del riscatto, tradotti. `status` è quello del server.
  const REDEEM_MESSAGES = Object.freeze({
    ok: 'Invito riscattato: i tuoi crediti sono pronti.',
    bad_code: 'Questo non è un codice d’invito. Un invito è fatto di otto caratteri, come ABCD-EFGH, e qui va bene anche il link intero.',
    invalid_code: 'Questo codice non esiste. Controlla di averlo copiato tutto.',
    // Un invito vale per più persone (#651): «già usato» faceva credere che
    // chi l'ha mandato se lo fosse speso lui, e si andava a chiedergliene un
    // altro che non esiste. Quello che è finito sono i POSTI.
    code_used: 'Questo invito è pieno: i posti che aveva sono tutti occupati. Fatti mandare un altro link da chi ti ha invitato.',
    own_code: 'È un tuo codice: dallo a qualcun altro.',
    already_in: 'Hai già i tuoi crediti su questa installazione.',
    invites_exhausted: 'Per ora i posti sono finiti: riprova fra qualche giorno.',
    global_cap: 'Per ora non possiamo dare altri crediti: riprova fra qualche giorno.',
    missing_exchange_rate: 'Il server non è ancora pronto (manca il cambio del giorno): riprova fra qualche minuto.',
    not_configured: 'Il server non è ancora configurato per i crediti.',
    provider_error: 'Il servizio dei modelli non ha risposto: riprova fra poco.',
    // Le chiavi spente si rileggono per un mese (#1520): oltre trenta in quel mese il server dice di no.
    too_many_reissues: 'Hai chiesto troppe chiavi nuove nell’ultimo mese: riprova fra qualche giorno.',
    internal: 'Qualcosa è andato storto sul server: riprova.',
    not_reachable: 'Non riesco a raggiungere il server: controlla la connessione.',
    // Dà inviti solo chi ha collegato Google (#1120): il codice resta suo, e torna buono quando si collega.
    inviter_not_linked: 'Chi ti ha mandato questo invito non ha ancora collegato il suo account Google a Filo, e finché non lo fa il suo codice non fa entrare nessuno. Diglielo, o fatti mandare un invito da qualcun altro.',
    network_cap: 'Da questa connessione sono già entrate troppe persone di recente. Il tuo codice resta valido, riprova più tardi.',
  });

  // `info` è la risposta intera del server: il tetto per rete porta l'ora in cui riaprire.
  function redeemMessage(status, info) {
    if (status === 'network_cap' && info && info.reopensAt) return networkCapMessage(info);
    return REDEEM_MESSAGES[status] || REDEEM_MESSAGES.internal;
  }

  // Il tetto dei riscatti dalla stessa rete (#1120), coi numeri del server e l'ora locale in cui si libera un posto.
  // Un'ora che non si legge non diventa «adesso»: resta la frase senza ora.
  function networkCapMessage({ reopensAt, cap, hours } = {}, nowMs = Date.now()) {
    const t = Date.parse(String(reopensAt || ''));
    if (!Number.isFinite(t)) return REDEEM_MESSAGES.network_cap;
    const n = Math.floor(Number(cap) || 0);
    const h = Number(hours) || 0;
    const chi = n === 1 ? 'è già entrata una persona' : (n > 1 ? `sono già entrate ${fmtInt(n)} persone` : 'sono già entrate troppe persone');
    const finestra = h === 1 ? ' nell’ultima ora' : (h > 0 ? ` nelle ultime ${Number.isInteger(h) ? fmtInt(h) : String(h).replace('.', ',')} ore` : ' di recente');
    return `Da questa connessione ${chi}${finestra}. Il tuo codice resta valido, riprova ${quandoRiapre(t, nowMs)}.`;
  }

  function quandoRiapre(t, nowMs) {
    const d = new Date(t);
    const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const giorno = (x) => { const g = new Date(x); g.setHours(0, 0, 0, 0); return g.getTime(); };
    const giorni = Math.round((giorno(t) - giorno(nowMs)) / 86400000);
    if (giorni <= 0) return `dopo le ${ora}`;
    if (giorni === 1) return `domani dopo le ${ora}`;
    return `da ${d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} alle ${ora}`;
  }

  function fmtInt(n) {
    return String(Math.max(0, Math.floor(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  // La frase del riscatto riuscito dice solo i crediti d'ingresso: il conteggio
  // locale non passa (#1138), e «nessuno dei 1.000 che avevi» si leggeva come un furto.
  // `conteggioLocale`: era a schermo come saldo, e la frase dice dove va, senza contarlo (#1353).
  function redeemOkMessage({ entryCredits, conteggioLocale = false } = {}) {
    const entry = Math.max(0, Math.floor(Number(entryCredits) || 0));
    const frase = entry ? `Invito riscattato: hai ${fmtInt(entry)} crediti d’ingresso.` : REDEEM_MESSAGES.ok;
    return conteggioLocale ? `${frase} ${CONTEGGIO_LOCALE_LASCIA}` : frase;
  }

  // Il codice si ricopia con la riga intorno («Codice: ABCD-EFGH»): se il testo ripulito non
  // è un codice si cerca un blocco di otto caratteri staccato; se non c'è, torna com'era.
  function extractCode(raw) {
    const s = String(raw || '').trim();
    const norm = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (norm.length === 8) return s;
    const m = s.toUpperCase().match(/(?<![A-Z0-9])([A-Z0-9]{4})[\s-]*([A-Z0-9]{4})(?![A-Z0-9])/);
    return m ? m[1] + m[2] : s;
  }

  // ── Il codice di un invito (#651) ────────────────────────────────────────
  // L'alfabeto dei codici non ha 0, 1, I, L, O: a leggerli da un messaggio si
  // scambiano. Le tre costanti e `normalizeCode` sono IDENTICHE al server
  // (functions/src/wallet/credits.js di filo-security): se cambiano lì,
  // cambiano anche qui, e gli unit test sono gli stessi dalle due parti.
  const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const CODE_LEN = 8;
  const INVITE_LINK_BASE = 'https://filo.red/i/';

  // Il codice come lo scrive la gente: «ABCD-EFGH», «abcd efgh», o il link
  // intero («filo.red/i/ABCD-EFGH», «https://filo.red/i/abcdefgh/»). Se c'è un
  // percorso si prende l'ultimo pezzo non vuoto; poi restano solo lettere e
  // cifre, maiuscole. Torna il codice o `null`: tutto il resto non è un codice.
  function normalizeCode(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (s.includes('/')) {
      const parts = s.split('/').map((p) => p.trim()).filter(Boolean);
      s = parts.length ? parts[parts.length - 1] : '';
    }
    s = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.length !== CODE_LEN) return null;
    for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
    return s;
  }

  // Il codice come si mostra: ABCD-EFGH. Quello che non è un codice torna
  // com'era (non si inventa un trattino a metà di un testo qualsiasi).
  function formatCode(code) {
    const c = normalizeCode(code);
    return c ? `${c.slice(0, 4)}-${c.slice(4)}` : String(code == null ? '' : code);
  }

  // Il link da dare a qualcuno. Senza un codice valido torna '': un link
  // costruito attorno a un codice storto porterebbe a una pagina che non c'è.
  function inviteLink(code) {
    const c = normalizeCode(code);
    return c ? INVITE_LINK_BASE + c : '';
  }

  // Il link d'invito DENTRO un testo qualunque. Da un telefono un messaggio si
  // copia tenendolo premuto, e negli appunti finisce la frase intera: saluto
  // davanti, congedo dietro, il link in mezzo. In quel caso `normalizeCode` non
  // basta (l'ultimo pezzo del percorso si porta dietro le parole che seguono) e
  // il blocco di otto caratteri può cadere sul posto sbagliato: «Ciao Anna» è
  // quattro più quattro, e vince sul link perché viene prima (terzo giro di
  // verifica del #651). L'indirizzo è il segno più forte che ci sia, quindi si
  // cerca per primo. Senza il prefisso dello schema e dei sottodomini: non
  // cambiava il codice catturato, e su un incollaggio lungo faceva crescere la
  // ricerca col quadrato della lunghezza, nel main (#664).
  const LINK_NEL_TESTO = /filo\.red\/i\/([a-z0-9-]+)/i;
  const INVITO_NEL_TESTO = /filo:\/*invito\/([a-z0-9-]+)/i;
  function codeFromLinkInText(raw) {
    const s = String(raw == null ? '' : raw);
    for (const re of [LINK_NEL_TESTO, INVITO_NEL_TESTO]) {
      const m = re.exec(s);
      const c = m ? normalizeCode(m[1]) : null;
      if (c) return c;
    }
    return null;
  }

  // I blocchi di otto caratteri dentro una riga incollata («Codice:
  // ABCD-EFGH»), TUTTI, dal più simile a un codice: un messaggio comincia con
  // un saluto, e «Cara Sara» è otto lettere che un codice può avere (#664).
  // Pesano il trattino (un codice si mostra ABCD-EFGH), una cifra (le parole
  // non ne hanno) e le sole maiuscole; a pari peso vince chi viene prima.
  const BLOCCO_OTTO = /(?<![A-Za-z0-9])([A-Za-z0-9]{4})([\s-]*)([A-Za-z0-9]{4})(?![A-Za-z0-9])/g;
  function codeBlocksInText(raw) {
    const s = String(raw == null ? '' : raw);
    const re = new RegExp(BLOCCO_OTTO.source, 'g');
    const trovati = [];
    let m;
    while ((m = re.exec(s))) {
      const otto = m[1] + m[3];
      const c = normalizeCode(otto);
      if (c) {
        const lettere = otto.replace(/[^A-Za-z]/g, '');
        const peso = (m[2].includes('-') ? 4 : 0) + (/[0-9]/.test(otto) ? 2 : 0) + (lettere === lettere.toUpperCase() ? 1 : 0);
        trovati.push({ c, peso, ordine: trovati.length });
      }
      // Il blocco appena letto può aver mangiato metà di quello buono: «ecco
      // ABCD EFGH» si legge prima come «ECCO ABCD». Si riparte dal carattere dopo.
      re.lastIndex = m.index + 1;
    }
    return trovati.sort((a, b) => (b.peso - a.peso) || (a.ordine - b.ordine)).map((t) => t.c);
  }

  // Quello che l'utente ha messo nel campo dell'invito → i codici possibili,
  // dal più probabile: il testo com'è (codice o link), un link d'invito dentro
  // il testo, poi i blocchi di otto caratteri. Chi riscatta prova il secondo
  // quando il server dice che il primo non esiste.
  function codesFromInput(raw) {
    const visti = new Set();
    for (const c of [normalizeCode(raw), codeFromLinkInText(raw), ...codeBlocksInText(raw)]) {
      if (c) visti.add(c);
    }
    return [...visti];
  }

  function codeFromInput(raw) {
    return codesFromInput(raw)[0] || null;
  }

  // Quanti codici di una riga incollata si provano col server, al massimo. Un
  // messaggio vero ne ha uno o due (saluto, codice); il tetto ferma un testo
  // lungo incollato per sbaglio, e chi riscatta lo dice col numero.
  const CODE_TRIES = 5;
  function tooManyCodesMessage(found, tried) {
    return `Nel testo ci sono ${fmtInt(found)} blocchi che sembrano codici, e i primi ${fmtInt(tried)} non esistono. Incolla solo il codice, o il link.`;
  }

  // Un collegamento che porta un invito: il link di filo.red o `filo://invito/…`.
  // Torna il codice, o `null` se non è un invito o il codice è storto.
  function inviteCodeFromLink(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (isInviteDeepLink(s)) return inviteCodeFromDeepLink(s);
    let u;
    try { u = new URL(s); } catch (_) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase();
    if (host !== 'filo.red' && host !== 'www.filo.red') return null;
    const m = /^\/i\/([^/]+)\/?$/.exec(u.pathname);
    if (!m) return null;
    let pezzo = m[1];
    try { pezzo = decodeURIComponent(pezzo); } catch (_) { /* resta com'è */ }
    return normalizeCode(pezzo);
  }

  // `filo://invito/<codice>` — il collegamento che porta un invito dentro
  // Filo da fuori (la pagina del link, un messaggio). Registrando `filo://`
  // come protocollo di sistema, il sistema consegna all'app QUALUNQUE
  // `filo://…`: anche un `filo://credits/credits.html` messo in un link da un
  // sito qualsiasi. Si accetta il solo host `invito`; tutto il resto torna
  // `null` e chi chiama non apre niente.
  function deepLinkHost(raw) {
    const m = /^filo:\/*([^/?#]+)(?:\/([^?#]*))?/i.exec(String(raw == null ? '' : raw).trim());
    return m ? { host: m[1].toLowerCase(), rest: m[2] || '' } : null;
  }

  // È un collegamento d'invito? La domanda è separata da «qual è il codice»
  // apposta: un `filo://` che non è un invito si lascia cadere in silenzio
  // (non l'ha chiesto l'utente), ma un invito col codice storto va DETTO —
  // chi ha cliccato aspetta che succeda qualcosa.
  function isInviteDeepLink(raw) {
    const p = deepLinkHost(raw);
    return Boolean(p && p.host === 'invito');
  }

  function inviteCodeFromDeepLink(raw) {
    const p = deepLinkHost(raw);
    if (!p || p.host !== 'invito') return null;
    let rest = p.rest;
    try { rest = decodeURIComponent(rest); } catch (_) { /* resta com'è */ }
    return normalizeCode(rest);
  }

  // L'indirizzo arriva fra gli argomenti del processo (su Windows e Linux:
  // primo avvio e `second-instance`). La posizione NON è fissa — in sviluppo
  // il secondo argomento è `.`, nei test `.` è l'ultimo — quindi si cerca il
  // prefisso, scandendo tutto.
  function filoUrlFromArgv(argv) {
    for (const a of (Array.isArray(argv) ? argv : [])) {
      const s = String(a == null ? '' : a).trim();
      if (/^filo:\/\//i.test(s)) return s;
    }
    return null;
  }

  // Un invito come lo manda il server: { code, link, used, max, uses, revoked }.
  // `used` è QUANTI sono entrati, non «sì o no»: un invito da tre posti con un
  // ingresso è ancora da dare. Un invito scritto prima degli inviti a più usi
  // ha `used` booleano e vale un posto solo.
  function inviteView(inv) {
    const src = inv || {};
    const rawMax = Math.floor(Number(src.max));
    const legacy = !Number.isFinite(rawMax) || rawMax < 1;
    const max = legacy ? 1 : rawMax;
    const uses = (Array.isArray(src.uses) ? src.uses : []).filter(Boolean);
    const counted = src.used === true ? 1 : Math.max(0, Math.floor(Number(src.used) || 0));
    const used = Math.min(max, Math.max(uses.length, counted));
    const code = formatCode(src.code);
    return {
      code,
      link: String(src.link || inviteLink(src.code) || ''),
      used, max, uses,
      left: Math.max(0, max - used),
      exhausted: used >= max,
      revoked: src.revoked === true,
    };
  }

  // Quanti sono entrati con questo invito, in parole.
  function inviteStateLine(v) {
    const view = v && v.max ? v : inviteView(v);
    if (view.revoked) return 'annullato';
    return `entrati ${view.used} su ${view.max}`;
  }

  // ── Le manopole dei crediti (#652) ─────────────────────────────────────────
  // Le impostazioni che l'owner può cambiare in `config/credits`: come si
  // chiamano nella pagina e quanto possono valere. Stanno qui perché le usano
  // in due — la pagina per disegnare i campi, il main per rifiutare un numero
  // storto prima di scriverlo sul server. I tetti sono larghi di proposito: il
  // controllo serve a fermare un errore di battitura, non a decidere al posto
  // dell'owner.
  const OWNER_KNOBS = Object.freeze([
    { chiave: 'entryCredits', etichetta: 'Crediti a chi entra', min: 0, max: 10000000, aiuto: 'Quanti crediti riceve chi riscatta un invito.' },
    { chiave: 'dailyCredits', etichetta: 'Crediti al giorno', min: 0, max: 1000000, aiuto: 'La quota che arriva ogni notte a chi ha un portafoglio.' },
    { chiave: 'invitesPerUser', etichetta: 'Inviti per persona', min: 0, max: 1000, aiuto: 'Quanti codici riceve chi entra, da dare ad altri.' },
    { chiave: 'invitesMaxUses', etichetta: 'Persone per invito', min: 1, max: 1000, aiuto: 'Quante persone possono entrare con lo stesso codice. Vale anche per i link già in giro.' },
    // Il server lo scala di uno a ogni riscatto: è un contatore, ma lo decide l'owner (#854).
    { chiave: 'invitesRemaining', etichetta: 'Ingressi con invito rimasti', min: 0, max: 10000000, aiuto: 'Quante persone possono ancora entrare con un invito, in tutto. A zero nessun invito funziona più.' },
    { chiave: 'maxGrantCredits', etichetta: 'Tetto dei crediti elargibili', min: 0, max: 1000000000, aiuto: 'Il massimo che Filo può regalare, sommando tutte le persone.' },
    { chiave: 'rewardFeedbackSent', etichetta: 'Premio per un feedback inviato', min: 0, max: 1000000, aiuto: 'Arriva quando la segnalazione passa i controlli.' },
    { chiave: 'rewardSentPerDay', etichetta: 'Feedback inviati premiati al giorno', min: 0, max: 100000, aiuto: 'Quanti feedback inviati ricevono il premio, per persona e per giorno. Gli altri arrivano senza premio.' },
    { chiave: 'rewardFeedbackClosed', etichetta: 'Premio per un feedback risolto', min: 0, max: 1000000, aiuto: 'Arriva solo se la segnalazione viene risolta.' },
    // Il tetto per rete (#1120): una famiglia che condivide la connessione entra, una persona sola che apre portafogli a catena no.
    { chiave: 'redeemsPerNetwork', etichetta: 'Ingressi dalla stessa connessione', min: 0, max: 1000, aiuto: 'Quante persone possono entrare con un invito dalla stessa connessione, nelle ore scritte sotto. Vale anche per i tuoi codici. A zero nessun limite.' },
    { chiave: 'redeemsPerNetworkHours', etichetta: 'Ore in cui si contano', min: 1, max: 8760, aiuto: 'La finestra in cui si contano gli ingressi dalla stessa connessione: passata, chi era entrato non conta più.' },
  ]);
  const OWNER_KNOB_KEYS = Object.freeze(OWNER_KNOBS.map((k) => k.chiave));
  function knobOf(chiave) { return OWNER_KNOBS.find((k) => k.chiave === chiave) || null; }

  // ── I movimenti del portafoglio (#652) ─────────────────────────────────────
  // Una voce di `grants[]` porta un `why` che è un codice, a volte con l'id del
  // feedback attaccato (`feedback_closed:abc123`). Qui diventa una riga che una
  // persona legge.
  const GRANT_LABELS = Object.freeze({
    entry: 'Invito riscattato',
    daily: 'Quota del giorno',
    owner: 'Regalo di Filo',
    gift: 'Regalo di Filo',
    feedback_sent: 'Segnalazione inviata',
    feedback_closed: 'Segnalazione risolta',
  });
  function grantLabel(why) {
    const raw = String(why || '').trim();
    if (!raw) return 'Crediti ricevuti';
    const i = raw.indexOf(':');
    const capo = i === -1 ? raw : raw.slice(0, i);
    return GRANT_LABELS[capo] || GRANT_LABELS[raw] || 'Crediti ricevuti';
  }

  // Un saldo come lo scrive la pagina Crediti: al più un decimale, alla
  // italiana. La chat lo scrive uguale, così i due numeri non divergono.
  function formatCredits(n) {
    const v = Math.round((Number(n) || 0) * 10) / 10;
    return new Intl.NumberFormat('it-IT', { useGrouping: true, maximumFractionDigits: 1 }).format(v);
  }

  // ── Il saldo che dice la chat (#816, #1353) ───────────────────────────────
  // Il turno non aspetta mai il server: vale l'ultima lettura finita, e una più vecchia di un minuto si rifà in
  // sottofondo. «Il server non risponde» solo se quella lettura è fallita: un server lento non lo diventa.
  const SALDO_CHAT_VALIDO_MS = 60 * 1000;

  // `lettura`: l'ultima finita, { at, state } (lo stato della pagina Crediti), o null; `disco`: l'ultimo stato del
  // server salvato qui. null = nessun portafoglio, e vale il conteggio locale.
  function saldoPerChat({ lettura = null, disco = null, now = Date.now() } = {}) {
    const st = lettura && lettura.state ? lettura.state : null;
    let lettaIl = st ? Number(lettura.at) || null : null;
    if (st && st.identity && st.identity.lost) return null;
    if (st && st.server && st.server.hasWallet === false) return null;
    let server = st && st.server && st.server.hasWallet ? st.server : null;
    if (!server) {
      // Una lettura finita senza lo stato del server è fallita; senza nessuna lettura il disco è solo vecchio.
      if (!disco || !disco.hasWallet) return { balance: null, nonRisponde: Boolean(st) };
      server = { ...disco, cached: Boolean(st) };
      lettaIl = Date.parse(String(disco.readAt || '')) || null;
    }
    const b = server.balance || {};
    // Perché non è il saldo di adesso: la lettura fallita, il servizio dei modelli che non ha detto il consumo (come
    // la pagina), o una lettura solo vecchia.
    const lastKnown = server.cached ? 'server'
      : server.stale ? 'models'
        : !lettaIl || now - lettaIl > SALDO_CHAT_VALIDO_MS ? 'old' : '';
    const readAt = server.cached ? server.readAt
      : server.stale ? server.usageReadAt
        : lastKnown && lettaIl ? new Date(lettaIl).toISOString() : null;
    const numero = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    return {
      balance: numero(b.credits),
      dailyCredits: numero(server.dailyCredits),
      lastKnown, readAt: readAt || null,
      usingOwnKey: Boolean(st && st.usingOwnKey),
      keyMissing: Boolean(st && st.hasPersonalKey === false),
    };
  }

  // Le riletture per la chat: una alla volta, solo se l'ultima finita (`ultima()`, { at } o null) ha più di un
  // minuto, e chi le chiede non le aspetta. `leggi` è la lettura vera, che aggiorna l'ultima da sé.
  function rilettoreSaldo({ leggi, ultima, now = () => Date.now(), validoMs = SALDO_CHAT_VALIDO_MS } = {}) {
    let inVolo = null;
    function rileggi() {
      const u = ultima();
      if (u && now() - Number(u.at) <= validoMs) return null;
      if (inVolo) return inVolo;
      let p;
      try { p = Promise.resolve(leggi()); } catch (_) { p = Promise.resolve(null); }
      inVolo = p.catch(() => null).finally(() => { inVolo = null; });
      return inVolo;
    }
    return { rileggi };
  }

  // Il conteggio locale sta a schermo come saldo solo senza portafoglio e con una chiave che parte davvero, la
  // propria o quella di fabbrica (#1138). Chi lo vedeva, al riscatto sente dire dove va (#1353).
  function conteggioLocaleInVista({ hasWallet = false, keySource = '', identityLost = false } = {}) {
    return !hasWallet && !identityLost && (keySource === 'own' || keySource === 'factory');
  }
  const CONTEGGIO_LOCALE_LASCIA = 'Prendono il posto dei crediti di prova che Filo teneva su questo computer.';

  // ── Il premio di una segnalazione chiusa, con un portafoglio (#816) ───────
  // Il premio vero lo accredita il server, e solo a una segnalazione RISOLTA
  // (`done`) mandata col portafoglio. Il riquadro annuncia la cifra del
  // movimento `feedback_closed:<id>`; senza movimento non inventa una cifra:
  // aspetta, finché il movimento può ancora arrivare.
  const PREMIO_ATTESA_MS = 24 * 60 * 60 * 1000;

  // { card, grants, grantsFresh, redeemedAt, now } → { announce, credits }.
  // `grantsFresh` falso = movimenti da una lettura vecchia (server muto): ciò
  // che c'è vale, ciò che manca può essere solo non ancora letto.
  function resolutionReward({ card, grants, grantsFresh = false, redeemedAt = null, now = Date.now() } = {}) {
    const c = card || {};
    const why = `feedback_closed:${String(c._id || '')}`;
    const g = (Array.isArray(grants) ? grants : []).find((x) => x && x.why === why && Number(x.credits) > 0);
    if (g) return { announce: true, credits: Number(g.credits) };
    // Archiviata, doppione: il server non la premia.
    if (c.status && c.status !== 'done') return { announce: true, credits: 0 };
    // Mandata prima del riscatto: sul documento non c'è lo pseudonimo, e il
    // server non sa a chi darlo.
    const created = Date.parse(String(c.createdAt || ''));
    const redeemed = Date.parse(String(redeemedAt || ''));
    if (Number.isFinite(created) && Number.isFinite(redeemed) && created < redeemed) return { announce: true, credits: 0 };
    if (!grantsFresh) return { announce: false, credits: 0 };
    // Manopola a zero, tetto dei regali pieno: il movimento non arriverà più.
    const closed = Date.parse(String(c.resolvedAt || c.publishedAt || ''));
    if (!Number.isFinite(closed) || Number(now) - closed > PREMIO_ATTESA_MS) return { announce: true, credits: 0 };
    return { announce: false, credits: 0 };
  }

  // ── Il tetto giornaliero dei premi d'invio (#1077) ────────────────────────
  // Il server paga al più `perDay` invii per portafoglio e giorno UTC. Prima di
  // promettere un premio si contano i premi d'invio già arrivati oggi più gli
  // invii di oggi il cui premio non è ancora arrivato (`feedback_sent:<id>`
  // assente). Senza tetto noto (server vecchio, stato mai letto) non si nega.
  // { grants, perDay, invii: [{ id, at }], now } → { esaurito, perDay }.
  function premioInvio({ grants, perDay, invii = [], now = Date.now() } = {}) {
    const tetto = Number.isInteger(perDay) && perDay >= 0 ? perDay : null;
    if (tetto === null) return { esaurito: false, perDay: null };
    const giorno = new Date(now).toISOString().slice(0, 10);
    const diOggi = (iso) => String(iso || '').slice(0, 10) === giorno;
    const pagati = new Set((Array.isArray(grants) ? grants : [])
      .filter((g) => g && String(g.why || '').startsWith('feedback_sent:') && diOggi(g.at))
      .map((g) => String(g.why)));
    const inAttesa = (Array.isArray(invii) ? invii : []).filter((x) => x && Number.isFinite(x.at)
      && diOggi(new Date(x.at).toISOString()) && !(x.id && pagati.has(`feedback_sent:${x.id}`))).length;
    return { esaurito: pagati.size + inAttesa >= tetto, perDay: tetto };
  }

  // La frase del messaggio d'invio quando il tetto di oggi è pieno.
  function premioInvioEsauritoTesto(perDay) {
    const n = Math.max(0, Math.floor(Number(perDay) || 0));
    if (n === 0) return 'Per ora i feedback inviati non ricevono premi.';
    const primi = n === 1 ? 'solo per il primo feedback' : `per i primi ${n} feedback`;
    return `Il premio vale ${primi} del giorno. Questo non ne riceve.`;
  }

  // Si è appena entrati con un invito: la frase che lo dice, in home e nella
  // pagina Crediti. Chi ha invitato non si può nominare — il server non manda
  // il suo pseudonimo con lo stato del portafoglio.
  function entryNoticeText({ credits, conteggioLocale = false } = {}) {
    const n = Math.max(0, Math.floor(Number(credits) || 0));
    const frase = n > 0
      ? `Sei entrato con un invito: hai ${fmtInt(n)} crediti.`
      : 'Sei entrato con un invito: i tuoi crediti sono pronti.';
    return conteggioLocale ? `${frase} ${CONTEGGIO_LOCALE_LASCIA}` : frase;
  }

  // ── Chi usa Filo e se il conto OpenRouter regge (#820) ───────────────────
  // Per la pagina «Inviti e utenti» e per l'avviso all'owner all'avvio, dalla vista del server. Un cambio che manca
  // dà null, mai un cambio inventato: il numero che ne viene è un trattino, non uno zero.
  const GIORNO_MS = 24 * 60 * 60 * 1000;
  const GIORNO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const giornoUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
  const numeroO = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

  function creditiDaUsd(usd, cfg = {}) {
    const u = numeroO(usd); const e = numeroO(cfg.eurPerCredit); const fx = numeroO(cfg.eurUsd);
    return u == null || !(e > 0) || !(fx > 0) ? null : u / (e * fx);
  }
  function usdDaCrediti(crediti, cfg = {}) {
    const c = numeroO(crediti); const e = numeroO(cfg.eurPerCredit); const fx = numeroO(cfg.eurUsd);
    return c == null || !(e > 0) || !(fx > 0) ? null : c * e * fx;
  }
  function euroDaCrediti(crediti, cfg = {}) {
    const c = numeroO(crediti); const e = numeroO(cfg.eurPerCredit);
    return c == null || !(e > 0) ? null : c * e;
  }
  function euroDaUsd(usd, cfg = {}) {
    const u = numeroO(usd); const fx = numeroO(cfg.eurUsd);
    return u == null || !(fx > 0) ? null : u / fx;
  }

  // Attivo vuol dire almeno una riga nel registro d'uso nella finestra: un giorno presente in `usage.byDay` conta
  // anche se la sua spesa è zero. I giorni sono quelli del server (UTC); oggi compreso, 7 giorni sono oggi e i sei prima.
  function usoPersone(users, now = Date.now()) {
    const da7 = giornoUtc(now - 6 * GIORNO_MS);
    const da30 = giornoUtc(now - 29 * GIORNO_MS);
    const ultimo = Object.create(null);
    const attivi7 = [];
    const attivi30 = [];
    let spesoUsd = 0;
    let spesoIgnoti = 0;
    for (const u of Array.isArray(users) ? users : []) {
      if (!u || typeof u.pseudonym !== 'string') continue;
      const perGiorno = u.usage && u.usage.byDay && typeof u.usage.byDay === 'object' ? u.usage.byDay : {};
      const giorni = Object.keys(perGiorno).filter((k) => GIORNO_RE.test(k)).sort();
      const fine = giorni.length ? giorni[giorni.length - 1] : null;
      ultimo[u.pseudonym] = fine;
      if (fine && fine >= da7) attivi7.push(u.pseudonym);
      if (fine && fine >= da30) attivi30.push(u.pseudonym);
      const s = numeroO(u.balance && u.balance.usageUsd);
      if (s == null) spesoIgnoti += 1;
      else spesoUsd += s;
    }
    const nessuno = spesoIgnoti > 0 && spesoIgnoti === (Array.isArray(users) ? users.length : 0);
    return { attivi7, attivi30, ultimo, spesoUsd: nessuno ? null : spesoUsd, spesoIgnoti };
  }

  function usd2(n) {
    return `${new Intl.NumberFormat('it-IT', { useGrouping: true, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)} $`;
  }
  function crediti0(n) {
    return new Intl.NumberFormat('it-IT', { useGrouping: true, maximumFractionDigits: 0 }).format(Math.floor(Number(n) || 0));
  }

  // Il conto lo legge il server (`overview.account`, contratto in messages.js accanto a WALLET_OWNER_OVERVIEW). Senza
  // il campo, o con un errore, il conto non è letto: nessun numero e nessun allarme, perché non si sa.
  function contoOwner(overview) {
    const o = overview && typeof overview === 'object' ? overview : {};
    const cfg = o.config || {};
    const tot = o.totals || {};
    const a = o.account;
    if (!a || typeof a !== 'object') return { letto: false, motivo: 'assente', allarmi: [] };
    const caricatoUsd = numeroO(a.totalCreditsUsd);
    const spesoUsd = numeroO(a.totalUsageUsd);
    if (a.error || caricatoUsd == null || spesoUsd == null) return { letto: false, motivo: 'errore', allarmi: [] };
    const restaUsd = Math.max(0, caricatoUsd - spesoUsd);
    const restaCrediti = creditiDaUsd(restaUsd, cfg);
    const vivi = numeroO(tot.liveCredits);
    const margine = restaCrediti != null && vivi != null ? restaCrediti - vivi : null;
    const tettoUsd = numeroO(tot.maxGrantUsd) != null ? numeroO(tot.maxGrantUsd) : usdDaCrediti(tot.maxGrantCredits, cfg);
    const allarmi = [];
    if (margine != null && margine < -1e-6) {
      allarmi.push({
        kind: 'vivi_oltre_conto',
        testo: `Sul conto OpenRouter restano ${usd2(restaUsd)}, cioè ${crediti0(restaCrediti)} crediti, e le persone ne hanno ${crediti0(vivi)} da spendere: se li spendessero tutti il conto si svuoterebbe e Filo smetterebbe di rispondere a tutti, anche a chi ha ancora crediti. Ricarica il conto.`,
      });
    }
    if (tettoUsd != null && tettoUsd > caricatoUsd + 1e-9) {
      allarmi.push({
        kind: 'tetto_oltre_caricato',
        testo: `Il tetto dei crediti da regalare vale ${usd2(tettoUsd)}, più dei ${usd2(caricatoUsd)} caricati sul conto OpenRouter: abbassa il tetto o ricarica il conto.`,
      });
    }
    return {
      letto: true, caricatoUsd, spesoUsd, restaUsd, restaCrediti, caricatoCrediti: creditiDaUsd(caricatoUsd, cfg),
      vivi, margine, tettoUsd, readAt: typeof a.readAt === 'string' ? a.readAt : '', allarmi,
    };
  }

  // Quali allarmi dire all'owner all'avvio: gli accesi che l'avviso precedente non aveva già detto. Un conto non
  // letto non cambia niente; uno letto senza allarmi li azzera, così un allarme che torna si ridice.
  function allarmiDaDire(detti, conto) {
    const prima = Array.isArray(detti) ? detti.filter((k) => typeof k === 'string') : [];
    if (!conto || !conto.letto) return { dire: [], detti: prima };
    const accesi = (conto.allarmi || []).map((a) => a.kind);
    return { dire: (conto.allarmi || []).filter((a) => !prima.includes(a.kind)), detti: accesi };
  }

  // ── La riconciliazione segnata (#1520) ─────────────────────────────────────
  // Il server scrive in `reconcile` i motivi (`reasons`) e gli usi fuori politica (`offPolicy`: [{ model, provider,
  // usd, requests, violation }], `violation` di SN_POLITICA_MODELLI.creditsUsageViolation); la scheda della persona
  // porta `router` ({ rows } della stessa forma, o { error }). Un segno senza `reasons` viene da prima: scarto positivo.
  const MOTIVI_SCARTO = Object.freeze({
    unrecorded: 'non registrato', excess_rows: 'righe in eccesso', off_policy: 'fuori politica',
  });
  const FRASI_SCARTO = Object.freeze({
    unrecorded: 'qualcuno consuma senza scrivere il registro d\'uso',
    excess_rows: 'il registro d\'uso conta più di quanto il router ha fatto pagare',
    off_policy: 'la chiave dei crediti ha pagato modelli o fornitori fuori dalla politica sui modelli',
  });
  const VIOLAZIONI_USO = Object.freeze({
    model: 'modello fuori politica', excluded: 'fornitore escluso', 'not-producer': 'non servito dal produttore',
  });
  const testoCorto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const perSpesa = (a, b) => (b.usd || 0) - (a.usd || 0);

  function usoDelRouter(u) {
    if (!u || typeof u !== 'object') return null;
    const model = testoCorto(u.model, 200);
    if (!model) return null;
    const violation = typeof u.violation === 'string' && Object.prototype.hasOwnProperty.call(VIOLAZIONI_USO, u.violation) ? u.violation : '';
    return {
      model, provider: testoCorto(u.provider, 200), usd: numeroO(u.usd), requests: numeroO(u.requests),
      violation, fuori: violation ? VIOLAZIONI_USO[violation] : '',
    };
  }

  function usiFuoriPolitica(rec) {
    const lista = rec && typeof rec === 'object' && Array.isArray(rec.offPolicy) ? rec.offPolicy : [];
    return lista.map(usoDelRouter).filter((u) => u && u.violation).sort(perSpesa);
  }

  // I motivi di un portafoglio segnato, coi dollari che li misurano (null se non si sanno); [] se non è segnato.
  function motiviScarto(rec) {
    if (!rec || typeof rec !== 'object' || !rec.flagged) return [];
    const drift = numeroO(rec.driftUsd);
    const chiavi = Array.isArray(rec.reasons) ? [...new Set(rec.reasons.filter((k) => typeof k === 'string' && k))] : [];
    if (!chiavi.length) chiavi.push(drift != null && drift < 0 ? 'excess_rows' : 'unrecorded');
    const fuori = usiFuoriPolitica(rec);
    return chiavi.map((chiave) => {
      if (chiave === 'off_policy') {
        return { chiave, testo: MOTIVI_SCARTO.off_policy, usd: fuori.some((u) => u.usd != null) ? fuori.reduce((a, u) => a + (u.usd || 0), 0) : null };
      }
      if (chiave === 'unrecorded' || chiave === 'excess_rows') return { chiave, testo: MOTIVI_SCARTO[chiave], usd: drift == null ? null : Math.abs(drift) };
      return { chiave, testo: 'segnato', usd: null };
    });
  }

  // Il consumo della chiave secondo il router, per modello e fornitore, dalla spesa più alta. `letto` è falso se il
  // server non l'ha letto (campo assente) o non ci è riuscito (`errore`): un consumo non letto non è un consumo zero.
  function consumoRouter(router) {
    if (!router || typeof router !== 'object') return { letto: false, errore: '', righe: [] };
    if (router.error) return { letto: false, errore: testoCorto(String(router.error), 300) || 'errore', righe: [] };
    const righe = (Array.isArray(router.rows) ? router.rows : []).map(usoDelRouter).filter(Boolean).sort(perSpesa);
    return { letto: true, errore: '', righe };
  }

  // ── Gli avvisi all'owner fra le notifiche della home (#855) ─────────────────
  // Un caso per ogni cosa che ferma gli utenti, un marcatore per ogni soglia superata. Un caso che la vista non dice
  // (campo assente) non è rientrato: non compare nell'elenco, e la sua carta resta com'era.
  const AVVISO_OWNER = 'crediti-owner';
  const PAGINA_OWNER = 'filo://manage/manage.html#utenti';
  const SOGLIE_TETTO = Object.freeze([80, 95]);
  const INVITI_POCHI = 2;
  const PSEUDONIMI_DETTI = 3;
  const DOVE = 'in Gestione, sezione Utenti';
  const TITOLI_OWNER = Object.freeze({
    tetto: 'Tetto dei regali', giornaliera: 'Quota del giorno', inviti: 'Ingressi con invito', scarto: 'Registro d’uso',
  });

  const alPercento = (p) => (/^(1|8|11|8\d)$/.test(String(p)) ? `all'${p}%` : `al ${p}%`);
  function elencoBreve(nomi) {
    const altri = nomi.length - PSEUDONIMI_DETTI;
    const primi = nomi.slice(0, PSEUDONIMI_DETTI).join(', ');
    return altri > 0 ? `${primi} e ${altri === 1 ? 'un altro' : `altri ${altri}`}` : primi;
  }

  function avvisiOwner(overview) {
    const o = overview && typeof overview === 'object' ? overview : null;
    if (!o) return [];
    const cfg = o.config && typeof o.config === 'object' ? o.config : {};
    const tot = o.totals && typeof o.totals === 'object' ? o.totals : {};
    // In ordine di gravità: scritti insieme, la home li mostra in quest'ordine.
    const casi = [];

    const tetto = numeroO(tot.maxGrantCredits);
    const dati = numeroO(tot.grantedCredits);
    if (tetto != null && dati != null) {
      // Un tetto a zero non lascia regalare niente: è già pieno.
      const cento = (tetto > 0 ? dati / tetto : 1) * 100 + 1e-9;
      const p = Math.floor(cento);
      const quanti = `${crediti0(dati)} su ${crediti0(tetto)}`;
      casi.push({
        caso: 'tetto', numero: p,
        marcatori: SOGLIE_TETTO.filter((s) => cento >= s).map((s) => `tetto:${s}`),
        testo: p >= 100
          ? `I crediti regalati hanno raggiunto il tetto, ${quanti}. Il server rifiuta la quota del giorno e i nuovi ingressi finché non alzi il tetto ${DOVE}.`
          : `I crediti regalati sono ${alPercento(p)} del tetto, ${quanti}. Alza il tetto ${DOVE}, o il server rifiuterà la quota del giorno e i nuovi ingressi.`,
      });
    }

    const giorno = o.daily && typeof o.daily === 'object' && o.daily.summary && typeof o.daily.summary === 'object' ? o.daily.summary : null;
    if (giorno) {
      const r = Math.max(0, Math.floor(numeroO(giorno.refused) || 0));
      casi.push({
        caso: 'giornaliera', numero: r,
        marcatori: r > 0 ? ['giornaliera:rifiuti'] : [],
        testo: `L'ultima quota del giorno non è arrivata a ${r === 1 ? '1 persona' : `${r} persone`} perché il tetto dei crediti elargibili era pieno. Alza il tetto ${DOVE}.`,
      });
    }

    const inviti = numeroO(cfg.invitesRemaining);
    if (inviti != null) {
      const n = Math.max(0, Math.floor(inviti));
      casi.push({
        caso: 'inviti', numero: n,
        marcatori: n <= INVITI_POCHI ? [`inviti:${INVITI_POCHI}`] : [],
        testo: n === 0
          ? `Gli ingressi con invito sono finiti, e chi riceve un invito adesso non riesce a entrare. Aggiungine ${DOVE}.`
          : `${n === 1 ? 'Resta 1 ingresso' : `Restano ${n} ingressi`} con invito, poi chi riceve un invito non riesce più a entrare. Aggiungine ${DOVE}.`,
      });
    }

    // Ogni portafoglio segnato è un marcatore: uno nuovo si ridice anche se un altro era già segnato.
    const utenti = Array.isArray(o.users) ? o.users : null;
    const rs = o.reconcile && typeof o.reconcile === 'object' && o.reconcile.summary && typeof o.reconcile.summary === 'object' ? o.reconcile.summary : null;
    const riassunto = rs ? numeroO(rs.flagged) : null;
    if (utenti || riassunto != null) {
      // Un motivo nuovo su un portafoglio già segnato (#1520) è un marcatore nuovo: un uso fuori politica si dice anche lì.
      const motivi = new Map();
      for (const u of utenti || []) {
        if (!u || typeof u.pseudonym !== 'string' || !u.pseudonym) continue;
        const chiavi = motiviScarto(u.reconcile).map((m) => m.chiave);
        if (chiavi.length) motivi.set(u.pseudonym, [...new Set([...(motivi.get(u.pseudonym) || []), ...chiavi])]);
      }
      const segnati = [...motivi.keys()].sort();
      const n = segnati.length || Math.max(0, Math.floor(riassunto || 0));
      const cause = [...new Set(segnati.flatMap((p) => motivi.get(p)))].filter((k) => FRASI_SCARTO[k]);
      const soloScarto = cause.length === 1 && cause[0] === 'unrecorded';
      const quanti = n === 1 ? '1 portafoglio' : `${n} portafogli`;
      const chi = segnati.length ? ` (${elencoBreve(segnati)})` : '';
      const frase = cause.map((k) => FRASI_SCARTO[k]).join('; ');
      casi.push({
        caso: 'scarto', numero: n,
        marcatori: segnati.length
          ? segnati.flatMap((p) => motivi.get(p).map((k) => (k === 'unrecorded' ? `scarto:${p}` : `scarto:${p}:${k}`)))
          : (n > 0 ? ['scarto:?'] : []),
        testo: soloScarto
          ? `La riconciliazione ha trovato uno scarto su ${quanti}${chi}. Qualcuno consuma senza scrivere il registro d'uso, e trovi le righe segnate ${DOVE}.`
          : `La riconciliazione ha segnato ${quanti}${chi}${frase ? `: ${frase}` : ''}. Trovi le righe segnate ${DOVE}.`,
      });
    }
    return casi;
  }

  // Un marcatore mai detto scrive una carta nuova al posto di quella del suo caso; gli stessi marcatori riscrivono
  // solo il numero; un caso letto senza marcatori toglie la carta e li scorda, così quando torna si ridice.
  function avvisiOwnerPiano(detti, casi) {
    const prima = Array.isArray(detti) ? detti.filter((k) => typeof k === 'string') : [];
    const elenco = Array.isArray(casi) ? casi.filter((c) => c && typeof c.caso === 'string' && Array.isArray(c.marcatori)) : [];
    const letti = new Set(elenco.map((c) => c.caso));
    const piano = { scrivi: [], riscrivi: [], togli: [] };
    for (const c of elenco) {
      if (!c.marcatori.length) piano.togli.push(c.caso);
      else if (c.marcatori.some((k) => !prima.includes(k))) piano.scrivi.push(c);
      else piano.riscrivi.push(c);
    }
    const restano = prima.filter((k) => !letti.has(k.split(':')[0]));
    return { ...piano, detti: [...restano, ...elenco.flatMap((c) => c.marcatori)] };
  }

  // Il piano sulle notifiche: `mem` è SN_FILO_MEMORY nel main, un finto negli unit test. I marcatori da salvare li
  // restituisce: li scrive chi chiama, dopo le notifiche, così una scrittura fallita si rifà alla lettura dopo.
  async function applicaAvvisiOwner(mem, detti, overview) {
    const piano = avvisiOwnerPiano(detti, avvisiOwner(overview));
    const vive = ((await mem.listNotifications()) || []).filter((n) => n && n.action && n.action.tipo === AVVISO_OWNER);
    const delCaso = (caso) => vive.filter((n) => n.action.caso === caso);
    let cambiato = false;
    const togli = async (caso) => {
      for (const n of delCaso(caso)) { await mem.dismissNotification(n.id); cambiato = true; }
    };
    for (const caso of piano.togli) await togli(caso);
    // Le notifiche nuove vanno davanti: dall'ultimo, così il più grave resta in cima.
    for (const c of piano.scrivi.slice().reverse()) {
      await togli(c.caso);
      await mem.addNotification({
        kind: 'alert', text: c.testo,
        action: {
          tipo: AVVISO_OWNER, caso: c.caso, marcatori: c.marcatori, titolo: TITOLI_OWNER[c.caso] || '',
          apri: PAGINA_OWNER, etichetta: 'Apri Inviti e utenti',
        },
      });
      cambiato = true;
    }
    for (const c of piano.riscrivi) {
      for (const n of delCaso(c.caso)) { if (await mem.setNotificationText(n.id, c.testo)) cambiato = true; }
    }
    return { detti: piano.detti, cambiato };
  }

  global.SN_WALLET = {
    USAGE_FIELDS, USAGE_LIMITS, rifiutoDellaRigaUso, scriviIsolando, registroScartateTesto, isOutOfCredits, creditsPerUsd, creditsForUsd, usageRow, outOfCreditsMessage, redeemMessage, redeemOkMessage, networkCapMessage, extractCode, REDEEM_MESSAGES,
    isKeyRefusalStatus, isKeyRefusal, isModerationBlock, keyRefusalOf, keyRefusalReason, ownKeyFallbackLine, ownKeyRefusalNote, keyTail, ownKeyBalanceLine,
    // Inviti e link d'invito (#651)
    CODE_ALPHABET, CODE_LEN, INVITE_LINK_BASE,
    normalizeCode, formatCode, inviteLink, codeFromInput, codesFromInput, CODE_TRIES, tooManyCodesMessage, inviteCodeFromLink,
    isInviteDeepLink, inviteCodeFromDeepLink, filoUrlFromArgv,
    inviteView, inviteStateLine, entryNoticeText,
    // Manopole e movimenti della pagina dell'owner (#652)
    OWNER_KNOBS, OWNER_KNOB_KEYS, knobOf, GRANT_LABELS, grantLabel,
    // Le cifre dette fuori dalla pagina Crediti (#816)
    formatCredits, PREMIO_ATTESA_MS, resolutionReward, premioInvio, premioInvioEsauritoTesto,
    // Il saldo della chat senza attese, e il conteggio locale che il riscatto sostituisce (#1353)
    SALDO_CHAT_VALIDO_MS, saldoPerChat, rilettoreSaldo, conteggioLocaleInVista,
    // Chi usa Filo e se il conto OpenRouter regge (#820)
    creditiDaUsd, usdDaCrediti, euroDaCrediti, euroDaUsd, usoPersone, contoOwner, allarmiDaDire,
    // Gli avvisi all'owner nella home (#855)
    AVVISO_OWNER, PAGINA_OWNER, SOGLIE_TETTO, INVITI_POCHI, avvisiOwner, avvisiOwnerPiano, applicaAvvisiOwner,
    // La riconciliazione col consumo che il router dichiara per chiave (#1520)
    MOTIVI_SCARTO, VIOLAZIONI_USO, motiviScarto, usiFuoriPolitica, consumoRouter,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
