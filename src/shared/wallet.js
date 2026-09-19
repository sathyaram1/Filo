// Crediti sul server e chiave personale — la logica PURA condivisa fra main e
// pagine (feedback #598). Niente rete, niente Electron: gli unit test la
// caricano così com'è.
//
// - riconoscere «crediti finiti» in un errore del provider (402), che NON si
//   ritenta: OpenRouter rifiuta finché il tetto non sale;
// - la riga del registro d'uso, con i soli campi che le regole Firestore
//   accettano (hasOnly): una riga con un campo in più viene rifiutata, e un
//   registro che non si scrive è un abuso agli occhi della riconciliazione;
// - il testo che spiega all'utente cosa fare, in base a come sta usando Filo.

(function (global) {
  'use strict';

  // I campi di una riga del registro, nell'ordine. Sono gli stessi elencati
  // nelle regole Firestore (wallet-usage): cambiarli qui senza cambiarli lì
  // fa rifiutare ogni riga.
  const USAGE_FIELDS = Object.freeze([
    'pseudonym', 'at', 'action', 'model', 'servedBy',
    'promptTokens', 'completionTokens', 'costUsd', 'credits',
  ]);

  // 402 dal servizio AI = il tetto della chiave è esaurito (o l'account non ha
  // credito). Con la chiave personale vuol dire «crediti finiti».
  function isOutOfCredits(err) {
    if (!err) return false;
    const st = Number(err.status);
    if (st === 402) return true;
    const raw = String((err && err.message) || err || '');
    return /^OpenRouter(?:\s+\S+)?\s+402\b/.test(raw) || /insufficient credits|key limit exceeded/i.test(raw);
  }

  // Quanti crediti vale una spesa in dollari, coi parametri del server
  // (euro per credito, cambio). Per eccesso al decimo: ciò che si scala al
  // saldo mostrato non deve essere meno di ciò che OpenRouter conta.
  function creditsForUsd(costUsd, { eurPerCredit, eurUsd } = {}) {
    const usd = Number(costUsd);
    if (!Number.isFinite(usd) || usd <= 0) return 0;
    const e = Number(eurPerCredit) || 0.0007;
    const fx = Number(eurUsd) || 1.1;
    return Math.ceil((usd / (e * fx)) * 10 - 1e-6) / 10;
  }

  // Costruisce la riga, scartando tutto ciò che non è nel contratto. `at` è
  // ISO UTC: il server confronta per intervallo di tempo.
  function usageRow({ pseudonym, at, action, model, servedBy, usage, costUsd, credits } = {}) {
    if (!pseudonym) return null;
    const u = usage || {};
    const usd = Number(costUsd != null ? costUsd : u.costUsd);
    return {
      pseudonym: String(pseudonym),
      at: at || new Date().toISOString(),
      action: String(action || ''),
      model: String(model || ''),
      servedBy: String(servedBy || ''),
      promptTokens: Math.max(0, Math.floor(Number(u.promptTokens) || 0)),
      completionTokens: Math.max(0, Math.floor(Number(u.completionTokens) || 0)),
      costUsd: Number.isFinite(usd) && usd > 0 ? usd : 0,
      credits: Math.max(0, Number(credits) || 0),
    };
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
  function ownKeyRefusalNote({ at, status } = {}) {
    let quando = '';
    try {
      const d = new Date(at);
      if (!Number.isNaN(d.getTime())) {
        quando = ` l'ultima volta il ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} alle ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
      }
    } catch (_) { quando = ''; }
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
    const usd = (n) => `${new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)} $`;
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
    internal: 'Qualcosa è andato storto sul server: riprova.',
    not_reachable: 'Non riesco a raggiungere il server: controlla la connessione.',
  });

  function redeemMessage(status) {
    return REDEEM_MESSAGES[status] || REDEEM_MESSAGES.internal;
  }

  // La frase del riscatto riuscito, coi numeri che il server manda: quanti
  // crediti d'ingresso, quanti del vecchio conteggio locale sono passati e,
  // se non tutti, perché. Chi aveva 12.000 crediti e ne ritrova 10.000 deve
  // leggerlo qui, non scoprirlo dal saldo (primo giro di verifica del ramo -b).
  function fmtInt(n) {
    return String(Math.max(0, Math.floor(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function redeemOkMessage({ entryCredits, migrated, localRequested, cutReason } = {}) {
    const entry = Math.max(0, Math.floor(Number(entryCredits) || 0));
    const got = Math.max(0, Math.floor(Number(migrated) || 0));
    const asked = Math.max(0, Math.floor(Number(localRequested) || 0));
    if (!entry || !asked) return REDEEM_MESSAGES.ok;
    if (got >= asked) return `Invito riscattato: ${fmtInt(entry)} crediti d’ingresso più i ${fmtInt(got)} che avevi già.`;
    const why = cutReason === 'global_cap'
      ? 'oltre non c’è posto in questo periodo'
      : 'oltre non si portano';
    const passati = got > 0 ? `${fmtInt(got)} dei ${fmtInt(asked)} che avevi già` : `nessuno dei ${fmtInt(asked)} che avevi già`;
    return `Invito riscattato: ${fmtInt(entry)} crediti d’ingresso più ${passati} (${why}).`;
  }

  // Il codice dentro quello che l'utente incolla. Il codice arriva per
  // messaggio e si ricopia com'è, spesso con la riga intorno («Codice:
  // ABCD-EFGH», «il tuo invito è abcd efgh»): se il testo, ripulito, non è un
  // codice, si cerca dentro un blocco di otto caratteri (anche quattro più
  // quattro) staccato dal resto. Se non c'è, torna il testo com'era: sarà il
  // server a dire «non esiste». Un testo che è già un codice passa com'è (il
  // server tollera trattini, spazi e minuscole).
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
  // cerca per primo.
  const LINK_NEL_TESTO = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*filo\.red\/i\/([a-z0-9-]+)/i;
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

  // Il blocco di otto caratteri dentro una riga incollata («Codice:
  // ABCD-EFGH»). Si guardano TUTTI i blocchi, non solo il primo: un messaggio
  // comincia con un saluto, e «Ciao Anna» è quattro più quattro: fermarsi lì
  // vuol dire rifiutare un incollaggio giusto perché davanti al codice c'erano
  // due parole corte (quarto giro di verifica del #651). Il primo blocco che è
  // davvero un codice vince; se nessuno lo è, `null`.
  const BLOCCO_OTTO = /(?<![A-Z0-9])([A-Z0-9]{4})[\s-]*([A-Z0-9]{4})(?![A-Z0-9])/g;
  function codeBlockInText(raw) {
    const s = String(raw == null ? '' : raw).toUpperCase();
    BLOCCO_OTTO.lastIndex = 0;
    let m;
    while ((m = BLOCCO_OTTO.exec(s))) {
      const c = normalizeCode(m[1] + m[2]);
      if (c) { BLOCCO_OTTO.lastIndex = 0; return c; }
      // Il blocco scartato può aver mangiato metà di quello buono: «ecco ABCD
      // EFGH» si legge prima come «ECCO ABCD», e «ABCD EFGH» non verrebbe più
      // guardato. Si riparte dal carattere dopo, non dalla fine del blocco.
      BLOCCO_OTTO.lastIndex = m.index + 1;
    }
    return null;
  }

  // Quello che l'utente ha messo nel campo dell'invito → il codice, o `null`.
  // Prima si prova a leggerlo com'è (codice o link); poi si cerca un link
  // d'invito dentro il testo; da ultimo un blocco di otto caratteri lungo la
  // riga incollata.
  function codeFromInput(raw) {
    return normalizeCode(raw) || codeFromLinkInText(raw) || codeBlockInText(raw);
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
  // Le sette impostazioni che l'owner può cambiare in `config/credits`: come si
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
    { chiave: 'maxGrantCredits', etichetta: 'Tetto dei crediti elargibili', min: 0, max: 1000000000, aiuto: 'Il massimo che Filo può regalare, sommando tutte le persone.' },
    { chiave: 'rewardFeedbackSent', etichetta: 'Premio per un feedback inviato', min: 0, max: 1000000, aiuto: 'Arriva quando la segnalazione passa i controlli.' },
    { chiave: 'rewardFeedbackClosed', etichetta: 'Premio per un feedback risolto', min: 0, max: 1000000, aiuto: 'Arriva solo se la segnalazione viene risolta.' },
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

  // Si è appena entrati con un invito: la frase che lo dice, in home e nella
  // pagina Crediti. Chi ha invitato non si può nominare — il server non manda
  // il suo pseudonimo con lo stato del portafoglio.
  function entryNoticeText({ credits } = {}) {
    const n = Math.max(0, Math.floor(Number(credits) || 0));
    return n > 0
      ? `Sei entrato con un invito: hai ${fmtInt(n)} crediti.`
      : 'Sei entrato con un invito: i tuoi crediti sono pronti.';
  }

  global.SN_WALLET = {
    USAGE_FIELDS, isOutOfCredits, creditsForUsd, usageRow, outOfCreditsMessage, redeemMessage, redeemOkMessage, extractCode, REDEEM_MESSAGES,
    isKeyRefusalStatus, isKeyRefusal, isModerationBlock, keyRefusalOf, keyRefusalReason, ownKeyFallbackLine, ownKeyRefusalNote, keyTail, ownKeyBalanceLine,
    // Inviti e link d'invito (#651)
    CODE_ALPHABET, CODE_LEN, INVITE_LINK_BASE,
    normalizeCode, formatCode, inviteLink, codeFromInput, isInviteDeepLink, inviteCodeFromDeepLink, filoUrlFromArgv,
    inviteView, inviteStateLine, entryNoticeText,
    // Manopole e movimenti della pagina dell'owner (#652)
    OWNER_KNOBS, OWNER_KNOB_KEYS, knobOf, GRANT_LABELS, grantLabel,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
