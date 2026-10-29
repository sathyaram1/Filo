// Comandi della barra della home: i comandi con lo slash, il riconoscimento di
// cosa l'utente ha scritto (comando di Filo, sito, comando di shell, testo
// normale) e l'evidenziazione live mentre scrive.
//
// Un solo posto decide che cos'è una riga di input: la colorazione mentre si
// digita e quello che succede a Invio devono dire la stessa cosa — se
// divergono, l'utente vede azzurro e ottiene un'altra cosa.
//
// Forma del modulo: IIFE che si registra su globalThis e NON tocca il DOM al
// caricamento — solo dentro `init`.
(function (global) {
  'use strict';

  const { MSG } = global.SN_MSG;

  // Dipendenze dalla pagina, riempite da init().
  let send = null;
  let bubblesEl = null;
  let inputEl = null;
  let makeBubble = null;
  let goHome = null;
  let goThread = null;
  let autoGrowInput = null;
  let refreshLive = null;
  // #525 — mette una riga di Filo nell'archivio della chat in corso (la targa
  // la sa la pagina, che è la stessa che la manda coi turni normali).
  let archiviaRiga = () => {};
  let chatDellaRiga = () => null;
  let inChatAperta = () => true;
  // Il terminale: stato e esecuzione stanno nel suo modulo, qui si chiedono.
  let isTerminalMode = () => false;
  let getShell = () => 'powershell';
  let getCwd = () => '';
  let runShellCommand = async () => false;
  let rimettiNellaBarra = () => {};

  // I contatori della barra (#1473): il nome del comando o la strada, mai quello che si è scritto dopo.
  function contaComando(cosa, scelta = '') {
    try { Promise.resolve(send({ type: MSG.CONTATORI_EVENTO, misura: 'comando-home', cosa, ...(scelta ? { scelta } : {}) })).catch(() => {}); } catch (_) {}
  }

  // Vero se l'account loggato è l'owner (admin): abilita i comandi /users e
  // /gift in /help. Il gate forte resta nel main (auth.isAdmin) e sul server.
  let isOwner = false;

  const SLASH_COMMANDS = {
    '/home': () => { goHome(); },
    // Il filo è uno (#869): «pulisci» chiude la conversazione in corso, e il messaggio dopo ne comincia un'altra.
    '/clear': () => { goHome({ nuova: true }); },
    '/clear all': () => { send({ type: MSG.CLOSE_ALL_TABS }); },
    '/kill': () => { send({ type: MSG.QUIT_APP }); },
    '/newtab': () => { send({ type: MSG.OPEN_URL, url: 'filo://newtab/' }); },
    '/models': () => { send({ type: MSG.OPEN_OPTIONS }); },
    '/modelli': () => { send({ type: MSG.OPEN_OPTIONS }); },
    '/sicurezza': () => { send({ type: MSG.OPEN_URL, url: 'filo://security/security.html' }); },
    '/preferenze': () => { send({ type: MSG.OPEN_URL, url: 'filo://preferences/preferences.html' }); },
    '/editor': () => { send({ type: MSG.OPEN_URL, url: 'filo://editor/editor.html' }); },
    // #583 — apre la POSTA delle segnalazioni, che legge solo chi le gestisce:
    // a chiunque altro darebbe una pagina vuota. Chi vuole MANDARE un feedback
    // lo fa dal menu del tasto destro → "Invia feedback", oppure chiedendolo a
    // Filo in chat, e quella strada non cambia.
    '/feedback': (text, chat) => {
      if (!isOwner) {
        // #986 — chi cerca le sue segnalazioni ci arriva, non legge solo dove sono.
        showFiloLine('I feedback li vede chi li gestisce: ti apro quelli che hai mandato tu. Per mandarne uno: tasto destro → «Invia feedback», oppure scrivimi cosa non va e lo scrivo io.', chat);
        send({ type: MSG.OPEN_URL, url: 'filo://board/board.html#segnalazioni' });
        return;
      }
      send({ type: MSG.OPEN_URL, url: 'filo://feedback/feedback.html' });
    },
    '/incognito': () => { send({ type: MSG.OPEN_INCOGNITO }); },
    '/pulisci': (text, chat) => { runTabCleanup(chat); },
    '/pulizia': (text, chat) => { runTabCleanup(chat); },
    '/riordina': (text, chat) => { runTabReorder(chat); },
    '/set': (text, chat) => { handleSetCommand(text, chat); },
    // #664 — l'invito anche dalla chat: col codice (o il link, o la riga del messaggio) lo riscatta, da solo apre Crediti.
    '/invito': (text, chat) => { handleInviteCommand(text, chat); },
    '/users': (text, chat) => { handleUsersCommand(text, chat); },
    '/gift': (text, chat) => { handleGiftCommand(text, chat); },
    '/help': (text, chat) => {
      if (document.body.dataset.state !== 'thread') goThread();
      const lines = [
        '/home — torna in fondo al filo',
        '/clear — chiudi la conversazione in corso: il messaggio dopo ne apre un\'altra',
        '/clear all — chiudi tutte le schede',
        '/kill — chiudi Filo',
        '/newtab — apri una nuova scheda',
        '/models, /modelli — impostazioni modelli',
        '/sicurezza — impostazioni sicurezza',
        '/preferenze — preferenze',
        '/editor — apri l\'editor',
        '/incognito — apri una finestra in incognito',
        '/pulisci, /pulizia — riordina e archivia le schede non più utili',
        '/riordina — riordina le schede per colore (nessuna viene chiusa)',
        '/set timer 5:00 — avvia un timer (anche /set timer 8 = 8 minuti)',
        '/invito CODICE — riscatta un invito (va bene anche il link); da solo apre i Crediti',
        '/help — lista comandi',
        '/google.com — apri un sito',
      ];
      if (isOwner) {
        lines.push(
          '/feedback — apri la posta delle segnalazioni (proprietario)',
          '/users — elenca chi ha un portafoglio: pseudonimo, saldo, chi l\'ha invitato (proprietario)',
          '/users INIZIO — cerca una persona dall\'inizio dello pseudonimo (proprietario)',
          '/gift NUMERO PSEUDONIMO — regala crediti a una persona, basta l\'inizio dello pseudonimo (proprietario)',
        );
      }
      showFiloLine(lines.join('\n'), chat);
    },
  };

  // /users e /gift parlano col portafoglio (#895): una persona esiste per
  // pseudonimo e l'email non arriva all'owner. Vista e regalo sono quelli della
  // pagina «Inviti e utenti»: un regalo scritto altrove non arriva a nessuno.
  const USERS_PAGINA = 50;
  const USO_GIFT = 'Uso: /gift NUMERO PSEUDONIMO. Basta l’inizio dello pseudonimo, se è di una persona sola. '
    + 'Gli pseudonimi li elenca /users.';

  function crediti(n) { return global.SN_WALLET.formatCredits(n); }

  // Uno pseudonimo si incolla come capita: fra virgolette, con la virgola in coda.
  function pezziScritti(testo) {
    const pezzi = String(testo || '').split(/[\s,;]+/)
      .map((p) => p.replace(/^[«"'`<([]+|[»"'`>)\].:!?]+$/g, ''))
      .filter(Boolean);
    return [...new Set(pezzi)];
  }

  // Quello che l'owner ha scritto torna in chat per intero solo se ci sta in una riga.
  function citato(t) { return t.length > 40 ? `${t.slice(0, 40)}…` : t; }

  // «2.000» scritto all'italiana sono duemila crediti, non due.
  function numeroCrediti(raw) {
    const t = String(raw || '').trim();
    if (/^\d+$/.test(t)) return Number(t);
    if (/^\d{1,3}([.'’]\d{3})+$/.test(t)) return Number(t.replace(/[.'’]/g, ''));
    return NaN;
  }

  // Lo pseudonimo intero vince; poi chi comincia così, e le maiuscole contano
  // solo se senza di loro non si trova nessuno.
  function chiComincia(utenti, inizio) {
    const esatti = utenti.filter((u) => u.pseudonym === inizio);
    if (esatti.length === 1) return esatti;
    const stessi = utenti.filter((u) => u.pseudonym.startsWith(inizio));
    if (stessi.length) return stessi;
    const basso = inizio.toLowerCase();
    return utenti.filter((u) => u.pseudonym.toLowerCase().startsWith(basso));
  }

  // `certo`: la richiesta non è partita, o il server l'ha respinta. Altrimenti
  // un regalo può essere arrivato anche senza risposta.
  function fraseGuasto(raw) {
    const t = String(raw || '');
    if (/not_admin|riservat/i.test(t)) return { certo: true, frase: 'comando riservato al proprietario' };
    if (/not_signed_in|sessione scaduta/i.test(t)) return { certo: true, frase: 'la sessione è scaduta, rifai l’accesso col tuo account' };
    if (/PERMISSION_DENIED|\b40[13]\b/i.test(t)) return { certo: true, frase: 'il server non ha accettato la richiesta, rientra col tuo account e riprova' };
    return { certo: false, frase: 'il server dei crediti non risponde adesso' };
  }
  function maiuscola(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Dalla più nuova, come nella pagina «Inviti e utenti».
  async function leggiVista() {
    let r = null;
    try { r = await send({ type: MSG.WALLET_OWNER_OVERVIEW }); } catch (_) { r = null; }
    if (!r || r.ok === false || !r.overview) return { errore: `${maiuscola(fraseGuasto(r && r.error).frase)}.` };
    const utenti = (Array.isArray(r.overview.users) ? r.overview.users : [])
      .filter((u) => u && typeof u.pseudonym === 'string' && u.pseudonym)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { utenti };
  }

  function rigaPersona(u) {
    const b = u.balance || {};
    const saldo = b.credits == null ? 'saldo non letto' : `${crediti(b.credits)} crediti`;
    const chi = u.invitedBy === 'owner' ? 'te' : String(u.invitedBy || '');
    return `• ${u.pseudonym} — ${saldo}${chi ? `, invitata da ${chi}` : ''}`;
  }

  // «/users altri» sfoglia la vista letta all'ultimo «/users», senza rileggerla:
  // due letture diverse sotto lo stesso conto salterebbero o ripeterebbero righe.
  let usersElenco = [];
  let usersMostrati = 0;
  let usersCerca = '';
  let usersGiro = 0;

  function mostraPaginaUtenti(chat) {
    const primo = usersMostrati + 1;
    const pagina = usersElenco.slice(usersMostrati, usersMostrati + USERS_PAGINA);
    usersMostrati += pagina.length;
    const totale = usersElenco.length;
    const testa = usersCerca && totale === 1 ? 'Trovata:'
      : `${usersCerca ? `Persone con uno pseudonimo che comincia per «${citato(usersCerca)}»` : 'Persone con un portafoglio'} ${primo}-${usersMostrati} di ${totale}:`;
    const coda = usersMostrati < totale
      ? `\n\nScrivi /users altri per le prossime${usersCerca ? '' : ', o /users e l’inizio di uno pseudonimo per cercare una persona'}.`
      : '';
    showFiloLine(`${testa}\n${pagina.map(rigaPersona).join('\n')}${coda}`, chat);
  }

  async function handleUsersCommand(text, chat) {
    const dopo = String(text || '').trim().replace(/^\/users\b/i, '').trim();
    if (/^(altri|ancora|avanti)$/i.test(dopo)) {
      if (usersMostrati >= usersElenco.length) {
        showFiloLine('Non ho altre persone da mostrare. Scrivi /users per ripartire dall’inizio.', chat);
        return;
      }
      mostraPaginaUtenti(chat);
      return;
    }
    if (dopo.includes('@')) {
      showFiloLine('Le persone si cercano per pseudonimo, non per email. Scrivi /users e l’inizio di uno pseudonimo, o /users per vederle tutte.', chat);
      return;
    }
    const pezzi = /^tutti$/i.test(dopo) ? [] : pezziScritti(dopo);
    if (pezzi.length > 1) {
      showFiloLine(`Hai scritto ${pezzi.length} pseudonimi (${pezzi.join(', ')}). Cercane uno per volta.`, chat);
      return;
    }
    const cerca = pezzi[0] || '';
    usersElenco = [];
    usersMostrati = 0;
    usersCerca = cerca;
    const giro = ++usersGiro;
    showFiloLine(cerca ? `Cerco chi ha uno pseudonimo che comincia per «${citato(cerca)}»…` : 'Recupero le persone con un portafoglio…', chat);
    const vista = await leggiVista();
    // Un «/users» dato mentre questa risposta viaggiava vale al suo posto.
    if (giro !== usersGiro) return;
    if (vista.errore) { showFiloLine(vista.errore, chat); return; }
    usersElenco = cerca ? chiComincia(vista.utenti, cerca) : vista.utenti;
    if (!usersElenco.length) {
      showFiloLine(cerca
        ? `Non trovo uno pseudonimo che comincia per «${citato(cerca)}». Con /users le vedi tutte.`
        : 'Nessuna persona ha ancora un portafoglio.', chat);
      return;
    }
    mostraPaginaUtenti(chat);
  }

  // "/gift NUMERO PSEUDONIMO": regala crediti a una persona. Riservato al proprietario.
  async function handleGiftCommand(text, chat) {
    const m = /^\/gift\s+(\S+)\s+(.+)$/i.exec(String(text || '').trim());
    if (!m) { showFiloLine(USO_GIFT, chat); return; }
    let [, quanti, chi] = m;
    // L'ordine rovesciato («/gift abcd 500») si capisce lo stesso.
    if (Number.isNaN(numeroCrediti(quanti)) && pezziScritti(chi).length === 1 && !Number.isNaN(numeroCrediti(chi.trim()))) {
      [quanti, chi] = [chi.trim(), quanti];
    }
    const amount = numeroCrediti(quanti);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      showFiloLine(`"${quanti}" non è un numero di crediti valido. Usa un intero positivo.`, chat);
      return;
    }
    if (chi.includes('@')) {
      showFiloLine(`I regali ora vanno per pseudonimo, non per email, quindi non ho regalato niente. La persona trova il suo nella pagina Crediti, alla voce «Il tuo pseudonimo». Con quello scrivi /gift ${amount} PSEUDONIMO.`, chat);
      return;
    }
    const pezzi = pezziScritti(chi);
    if (pezzi.length !== 1) {
      showFiloLine(pezzi.length > 1
        ? `Hai scritto ${pezzi.length} pseudonimi (${pezzi.join(', ')}), quindi non ho regalato niente. Scrivi /gift una volta per ciascuno.`
        : USO_GIFT, chat);
      return;
    }
    const inizio = pezzi[0];
    showFiloLine(`Regalo ${crediti(amount)} crediti a «${citato(inizio)}»…`, chat);
    const vista = await leggiVista();
    if (vista.errore) { showFiloLine(vista.errore, chat); return; }
    const trovati = chiComincia(vista.utenti, inizio);
    if (!trovati.length) {
      showFiloLine(`Non trovo uno pseudonimo che comincia per «${citato(inizio)}», quindi non ho regalato niente. Con /users le vedi tutte.`, chat);
      return;
    }
    if (trovati.length > 1) {
      const nomi = trovati.slice(0, 10).map((u) => u.pseudonym).join(', ');
      const resto = trovati.length > 10 ? ` e altri ${trovati.length - 10}` : '';
      showFiloLine(`«${citato(inizio)}» è l’inizio di ${trovati.length} pseudonimi (${nomi}${resto}), quindi non ho regalato niente. Scrivi qualche carattere in più.`, chat);
      return;
    }
    const pseudonym = trovati[0].pseudonym;
    let r = null;
    try { r = await send({ type: MSG.WALLET_OWNER_GRANT, pseudonym, credits: amount, why: 'owner' }); } catch (_) { r = null; }
    const res = r && r.ok !== false ? r.result : null;
    if (!res || !res.ok) {
      const rifiuto = {
        no_wallet: 'nessuna persona con questo pseudonimo',
        global_cap: 'si supererebbe il tetto di tutti i regali, alzalo in Gestione, sezione Utenti, o carica OpenRouter',
        missing_exchange_rate: 'manca il cambio del giorno',
        provider_error: 'OpenRouter non ha accettato il tetto nuovo, niente è cambiato',
      }[res && res.reason];
      const guasto = fraseGuasto(r && r.error);
      if (rifiuto || (res && res.reason) || guasto.certo) {
        showFiloLine(`Regalo non fatto: ${rifiuto || (res && res.reason) || guasto.frase}.`, chat);
      } else {
        showFiloLine(`Non so se il regalo è arrivato, ${guasto.frase}. Prima di riprovare controlla il saldo con /users ${pseudonym}.`, chat);
      }
      return;
    }
    const dati = Number(res.credits) > 0 ? Number(res.credits) : amount;
    const dopo = await leggiVista();
    const lei = (dopo.utenti || []).find((u) => u.pseudonym === pseudonym);
    const saldo = lei && lei.balance && lei.balance.credits != null
      ? `Nuovo saldo: ${crediti(lei.balance.credits)} crediti.`
      : `Il saldo nuovo non sono riuscito a leggerlo, lo vedi con /users ${pseudonym}.`;
    showFiloLine(`✓ Regalati ${crediti(dati)} crediti a ${pseudonym}. ${saldo}`, chat);
  }

  // Mostra una riga di risposta da Filo nel thread (usata dai comandi che
  // hanno bisogno di dire qualcosa: es. l'uso corretto di /set timer).
  // Una riga che Filo scrive senza passare da un modello: la risposta a un
  // comando con lo slash (l'elenco dei comandi, la conferma di un timer, il
  // resoconto del riordino delle schede).
  //
  // #525 — va anche NELL'ARCHIVIO. Prima restava solo a schermo: riaprendo
  // quella chat da Cronologia la riga non c'era più e la conversazione si
  // rileggeva con un buco in mezzo. È una riga che l'utente ha letto, e questo
  // lavoro promette di conservarle tutte.
  // `chat` è la targa presa quando l'utente ha dato il comando: una riga che
  // arriva quando quella conversazione qui non c'è più si archivia lì dentro e
  // basta, senza riportare a schermo una chat che l'utente aveva chiuso.
  async function handleInviteCommand(text, chat) {
    const resto = String(text || '').trim().replace(/^\/invito/i, '').trim();
    if (!resto) { send({ type: MSG.OPEN_URL, url: 'filo://credits/credits.html' }); return; }
    let r = null;
    try { r = await send({ type: MSG.WALLET_REDEEM, code: resto }); } catch (_) { r = null; }
    showFiloLine((r && r.message) || 'Non ci sono riuscito: riprova.', chat);
  }

  function showFiloLine(text, chat) {
    try { archiviaRiga(text, 'filo', chat); } catch (_) {}
    if (!inChatAperta(chat)) return;
    if (document.body.dataset.state !== 'thread') goThread();
    const bubble = makeBubble({ role: 'filo', text });
    bubblesEl.appendChild(bubble);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
  }

  // "/pulisci" (o "/pulizia"): il riordino delle schede con la stessa regola e lo stesso popup della chat (#530).
  async function runTabCleanup(chat) {
    showFiloLine('🧹 Riordino in corso…', chat);
    const e = await global.SN_DASH_ATTIVITA.riordinaSchede();
    if (e.annullato) { showFiloLine('Riordino annullato.', chat); return; }
    showFiloLine(e.ok ? `✓ ${e.testo}.` : `✗ ${e.testo}: ${e.motivo}`, chat);
  }

  // "/riordina": riordina la striscia delle schede per colore, esattamente come
  // succede alla riapertura di Filo, ma SENZA chiudere/archiviare nulla (a
  // differenza di /pulisci). Immediato: è deterministico e non tocca i contenuti,
  // quindi niente popup di conferma — l'utente può sempre rifarlo o riaprire una
  // scheda. Diamo comunque un feedback esplicito (spec: ogni azione ha un esito).
  async function runTabReorder(chat) {
    const r = await send({ type: MSG.REORDER_TABS });
    showFiloLine(r && r.reordered
      ? '✓ Schede riordinate per colore.'
      : '✓ Le schede erano già in ordine.', chat);
  }

  // Converte l'argomento di "/set timer" in secondi.
  //   "5:00" → 5 minuti 0 secondi → 300 ; "8" → 8 minuti → 480.
  // Ritorna null se non è una durata valida.
  function parseTimerArg(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (s.includes(':')) {
      const parts = s.split(':');
      if (parts.length !== 2) return null;
      // Ogni parte deve essere un intero esplicito: "5:", ":30" o "5: 30" non
      // sono durate valide (Number('') === 0 le farebbe passare in silenzio).
      if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
      const mm = Number(parts[0]);
      const ss = Number(parts[1]);
      if (ss > 59) return null;
      const total = mm * 60 + ss;
      return total > 0 ? total : null;
    }
    if (!/^\d+$/.test(s)) return null;
    const mins = Number(s);
    return mins > 0 ? mins * 60 : null;
  }

  // "/set timer 5:00" oppure "/set timer 8" → avvia un timer.
  function handleSetCommand(text, chat) {
    const m = /^\/set\s+timer\s+(.+)$/i.exec(String(text || '').trim());
    if (!m) {
      showFiloLine('Uso: /set timer 5:00 oppure /set timer 8 (minuti).', chat);
      return;
    }
    const seconds = parseTimerArg(m[1]);
    if (seconds == null) {
      showFiloLine(`Non ho capito la durata "${m[1].trim()}". Prova /set timer 5:00 o /set timer 8.`, chat);
      return;
    }
    send({ type: MSG.FILO_ADD_TIMER, label: 'Timer', seconds }).then((r) => {
      if (r && r.ok !== false) {
        goHome();
        refreshLive();
      } else {
        showFiloLine('Non sono riuscito ad avviare il timer.', chat);
      }
    });
  }

  // Riconosce un singolo token "tipo sito" (es. google.com, github.com/x,
  // http://localhost:3000, localhost:3000, 127.0.0.1:8080, 192.168.1.1). DEVE
  // essere preciso: un comando di shell come `/git log v1.2` o `/cat file.txt`
  // NON è un sito. La logica (e la simmetria con la vecchia barra indirizzi della
  // shell) vive in src/shared/urlNav.js (#398): qui togliamo la "/" e chiediamo
  // a SN_URL_NAV.looksLikeAddress — così indirizzi locali e IP sono riconosciuti
  // come lo erano dalla barra, invece di finire all'LLM.
  function isSiteToken(text) {
    return !!(self.SN_URL_NAV && self.SN_URL_NAV.looksLikeAddress(text.slice(1)));
  }

  // Estrae l'host da un token "/sito" (toglie "/", lo schema e l'eventuale
  // path/porta), per la verifica DNS.
  function siteHostOf(text) {
    const raw = text.slice(1).replace(/^https?:\/\//i, '');
    return (raw.split(/[/:?#]/)[0] || '').toLowerCase();
  }

  // URL navigabile di un token "/sito". Lo schema (http per i server locali, i
  // dispositivi della rete di casa e gli IP privati; https per i domini
  // pubblici) lo sceglie la stessa logica della barra indirizzi — #398.
  function siteUrlOf(text) {
    const raw = text.slice(1);
    return (self.SN_URL_NAV && self.SN_URL_NAV.normalizeUrl(raw))
      || (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  }

  // Cache "il comando shell esiste?" (shell + token → bool), per non rifare lo
  // spawn di controllo a ogni tasto: decide anche se l'Invio va alla shell o a Filo (#892.1).
  // Tiene solo risposte certe: un controllo scaduto (macchina carica) resta senza
  // colore e si ritenta passati RIPROVA_INCERTO_MS, alla prossima battitura (#1176).
  const shellCmdCache = new Map();
  const shellCmdIncerti = new Map(); // chiave → quando non ha saputo rispondere
  const shellCmdInVolo = new Set();
  const RIPROVA_INCERTO_MS = 20000;
  let whichTimer = null;
  // Un programma dato col percorso dipende dalla cartella: lo stesso «./x» c'è in una e non nell'altra.
  const chiaveShell = (cmd) => `${getShell() || ''}\u0000${/[\\/]/.test(cmd) ? getCwd() || '' : ''}\u0000${cmd}`;

  // Cache "il dominio /sito.tld esiste?" (host → bool). Evita di rifare il
  // lookup DNS a ogni tasto; popolata sia dalla verifica live sia da quella
  // sull'invio. Un host non in cache = ancora da verificare (resta arancione).
  const siteResolveCache = new Map();
  let siteResolveTimer = null;

  // Classifica l'input corrente per l'evidenziazione live:
  //   'filo'    → comando interno di Filo (o navigazione a sito) → arancione
  //   'shell'   → comando shell esistente (modalità terminale) → azzurro
  //   'unknown' → inizia con "/" ma non è un comando riconosciuto → rosso
  //   'pending' → modalità terminale, esistenza del comando ancora da verificare
  //   'incerto' → modalità terminale, il controllo non ha saputo rispondere → neutro
  //   'none'    → testo normale (va all'LLM)
  function classifyInput(value) {
    const t = value.trim();
    if (!t.startsWith('/')) return 'none';
    const firstToken = t.split(/\s+/)[0];
    if (SLASH_COMMANDS[t] || SLASH_COMMANDS[firstToken]) return 'filo';
    if (isSiteToken(t)) {
      // Sito: arancione di default; rosso SOLO se abbiamo già verificato che il
      // dominio non esiste (niente flicker mentre il lookup è in volo).
      const host = siteHostOf(t);
      if (host && siteResolveCache.get(host) === false) return 'unknown';
      return 'filo';
    }
    if (isTerminalMode()) {
      // In terminale "/x" è un comando shell: azzurro se esiste, rosso se no.
      const cmd = programmaDi(t);
      if (cmd === SINTASSI) return 'incerto';
      // Senza programma va a Filo: rosso, salvo mentre si sta ancora aprendo la riga («/», «/(»).
      if (!cmd) return /^\/[\s({!&]*$/.test(t) ? 'none' : 'unknown';
      const chiave = chiaveShell(cmd);
      if (shellCmdCache.has(chiave)) return shellCmdCache.get(chiave) ? 'shell' : 'unknown';
      if (Date.now() - (shellCmdIncerti.get(chiave) ?? -Infinity) < RIPROVA_INCERTO_MS) return 'incerto';
      return 'pending'; // verifica in corso (vedi scheduleShellWhich)
    }
    // Modalità normale: un "/comando" che non è interno né un sito non verrà
    // riconosciuto (finirebbe all'LLM come testo). Lo segnaliamo in rosso —
    // MA non mentre l'utente sta ancora digitando un prefisso che potrebbe
    // diventare un comando valido (es. "/he" → "/help"): in quel caso restiamo
    // neutri così il rosso non lampeggia a ogni tasto.
    const hasSpace = /\s/.test(t);
    if (!hasSpace && isCommandPrefix(firstToken)) return 'none';
    return 'unknown';
  }

  // Vero se `token` (es. "/he") è il prefisso non vuoto di un comando Filo noto
  // (es. "/help"), ma non è ancora il comando completo.
  function isCommandPrefix(token) {
    if (!token || token === '/') return false;
    return Object.keys(SLASH_COMMANDS).some(
      (cmd) => cmd !== token && cmd.startsWith(token)
    );
  }

  // Il programma che la shell lancerebbe, sempre da cercare (#892.1): oltre i segni d'apertura e le assegnazioni, fino
  // al primo segno che chiude la parola. «(nota) …», «ciao; …», «$5 …» non esistono e restano messaggi per Filo.
  // SINTASSI: una riga senza programma da cercare (`$x = 1`, `X=1`, `` `date` ``); un percorso fra virgolette è uno (#968).
  const SINTASSI = Symbol('sintassi');
  function programmaDi(t) {
    let s = String(t).trim().slice(1).trimStart();
    for (let prima = null; prima !== s;) {
      prima = s;
      s = s.replace(/^[({!&]+\s*/, '');
      const a = s.match(/^[\p{L}_][\p{L}\p{N}_]*=("[^"]*"|'[^']*'|\S*)(\s+|$)/u);
      if (a) { s = s.slice(a[0].length); if (!s) return SINTASSI; }
    }
    if (/^\$[\p{L}_{(]/u.test(s) || s.startsWith('`') || /^\[[\p{L}\p{N}_.]+\]::/u.test(s)) return SINTASSI;
    const V = global.SN_VIRGOLETTE;
    if (V && /^["']/.test(s)) return V.primoComando(s);
    return s.split(/[\s|<>;&(){}`]/)[0] || '';
  }

  // Verifica (con debounce) se il primo token è un comando shell esistente e
  // poi ricolora. Debounce così il controllo parte solo quando l'utente si
  // ferma: digitando di getto "/git" i prefissi non vengono mai controllati e
  // il rosso non lampeggia.
  function scheduleShellWhich(value) {
    clearTimeout(whichTimer);
    whichTimer = setTimeout(async () => {
      const cmd = programmaDi(value.trim());
      if (!cmd || cmd === SINTASSI) { updateInputClass(); return; }
      const chiave = chiaveShell(cmd);
      // Lo stesso comando già in controllo non ne lancia un secondo (sotto carico ogni spawn in più allunga gli
      // altri): ricolora quello in volo, quando risponde.
      if (shellCmdInVolo.has(chiave)) return;
      if (shellCmdCache.has(chiave)) { updateInputClass(); return; }
      await esisteInShell(cmd);
      updateInputClass(); // ricolora sullo stato attuale dell'input
    }, 250);
  }

  // true/false se la shell ha risposto, null se il controllo non ha saputo dirlo.
  const controlliInVolo = new Map();
  function esisteInShell(cmd) {
    const chiave = chiaveShell(cmd);
    if (shellCmdCache.has(chiave)) return Promise.resolve(shellCmdCache.get(chiave));
    if (controlliInVolo.has(chiave)) return controlliInVolo.get(chiave);
    shellCmdInVolo.add(chiave);
    const p = (async () => {
      let exists = null;
      try {
        const r = await window.filo?.shellWhich?.({ command: cmd, shell: getShell(), cwd: getCwd() });
        if (r && typeof r.exists === 'boolean') exists = r.exists;
      } catch (_) { exists = null; }
      shellCmdInVolo.delete(chiave);
      controlliInVolo.delete(chiave);
      if (exists === null) shellCmdIncerti.set(chiave, Date.now());
      else { shellCmdCache.set(chiave, exists); shellCmdIncerti.delete(chiave); }
      return exists;
    })();
    controlliInVolo.set(chiave, p);
    return p;
  }

  // Verifica (immediata) se l'host di un "/sito.tld" risolve, e popola la cache.
  // Usata sull'invio: in caso di dubbio (rete giù, errore) torna true così non
  // blocca mai una navigazione legittima.
  async function ensureSiteResolved(host) {
    if (!host) return true;
    if (siteResolveCache.has(host)) return siteResolveCache.get(host);
    let resolves = true;
    try {
      const r = await window.filo?.siteResolves?.({ host });
      resolves = !(r && r.resolves === false);
    } catch (_) { resolves = true; }
    siteResolveCache.set(host, resolves);
    return resolves;
  }

  // #433 — Enter su "/sito" il cui host il DNS non conosce. Prima non succedeva
  // ASSOLUTAMENTE NULLA: nessuna scheda, nessun messaggio, solo l'input rosso —
  // indistinguibile da un tasto Invio rotto. Il controllo esistenza serve a non
  // finire su una pagina bianca dopo un errore di battitura, ma può sbagliarsi
  // (VPN, rete aziendale, DNS che non conosce quel nome): quindi Filo lo dice e
  // lascia comunque aprire con un clic, invece di rifiutare in silenzio.
  // Il testo resta nel campo: se era un typo, si corregge senza riscriverlo.
  let unresolvedLine = null; // { el, host } dell'ultimo avviso ancora non agito
  // L'avviso che aspetta ancora una scelta per i contatori (#1473): l'invio dopo, o la pagina che se ne va, lo lascia.
  let nonRisoltoInAttesa = null;
  function lasciaNonRisolto() {
    if (!nonRisoltoInAttesa) return;
    nonRisoltoInAttesa = null;
    contaComando('sito_non_risolto', 'lascia');
  }
  function showUnresolvedSite(text, host) {
    // Un secondo invio dello STESSO indirizzo non impila avvisi identici. Uno su
    // un indirizzo diverso, o uno già agito ("Apri comunque"), resta in chat: è
    // roba successa, non rumore da sostituire.
    if (unresolvedLine && unresolvedLine.host === host) {
      unresolvedLine.el.remove();
      unresolvedLine = null;
    }
    if (document.body.dataset.state !== 'thread') goThread();
    const bubble = makeBubble({
      role: 'filo',
      // Una riga sola: il bottone qui sotto dice già l'altra metà. Spiegare a
      // parole cosa fa un bottone è la spiegazione della UI dentro la UI.
      text: `Non trovo “${host}” — controlla se c’è un errore di battitura.`,
    });
    const row = document.createElement('div');
    row.className = 'dash-bubble-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-action-btn dash-action-btn-primary';
    btn.textContent = '↗ Apri comunque';
    btn.title = `Apri ${host} senza il controllo`;
    btn.addEventListener('click', () => {
      btn.disabled = true;
      if (unresolvedLine && unresolvedLine.el === bubble) unresolvedLine = null;
      if (nonRisoltoInAttesa === bubble) { nonRisoltoInAttesa = null; contaComando('sito_non_risolto', 'apri_lo_stesso'); }
      // L'utente ha deciso: da qui in poi quell'host non viene più messo in
      // dubbio (niente rosso, niente avviso al prossimo invio).
      siteResolveCache.set(host, true);
      send({ type: MSG.OPEN_URL, url: siteUrlOf(text), parole: [text] });
      if (inputEl.value.trim() === text) { inputEl.value = ''; autoGrowInput(); }
      updateInputClass();
    });
    row.appendChild(btn);
    bubble.appendChild(row);
    bubblesEl.appendChild(bubble);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
    unresolvedLine = { el: bubble, host };
    lasciaNonRisolto();
    nonRisoltoInAttesa = bubble;
    contaComando('sito_non_risolto', 'in_attesa');
  }

  // Come sopra ma con debounce, per la verifica live mentre si scrive: parte
  // solo quando l'utente si ferma, poi ricolora (rosso se il dominio non esiste).
  function scheduleSiteResolve(host) {
    clearTimeout(siteResolveTimer);
    siteResolveTimer = setTimeout(async () => {
      if (!host || siteResolveCache.has(host)) { updateInputClass(); return; }
      await ensureSiteResolved(host);
      updateInputClass();
    }, 250);
  }

  function updateInputClass() {
    const kind = classifyInput(inputEl.value);
    // 'pending' (controllo "esiste?" in corso) tiene il colore che c'era: aggiungere
    // caratteri a un "/comando" non fa lampeggiare il rosso a ogni tasto, e un comando
    // incollato non diventa rosso prima che il controllo dica «non esiste» (#1176).
    if (kind === 'pending') {
      inputEl.classList.remove('is-cmd-filo');
      scheduleShellWhich(inputEl.value);
    } else {
      inputEl.classList.toggle('is-cmd-filo', kind === 'filo');
      inputEl.classList.toggle('is-cmd-shell', kind === 'shell');
      inputEl.classList.toggle('is-cmd-unknown', kind === 'unknown');
    }
    // Sito (arancione) non ancora verificato: avvia il lookup DNS (debounce)
    // così, se il dominio non esiste, l'input diventa rosso.
    const t = inputEl.value.trim();
    if (kind === 'filo' && t.startsWith('/') && isSiteToken(t)) {
      const host = siteHostOf(t);
      if (host && !siteResolveCache.has(host)) scheduleSiteResolve(host);
    }
  }

  async function handleSlashCommand(text, { incollato = false } = {}) {
    if (!text.startsWith('/')) return false;
    const firstToken = text.split(/\s+/)[0];
    // 1) Comandi interni di Filo: vincono SEMPRE, anche in modalità terminale.
    const handler = SLASH_COMMANDS[text] || SLASH_COMMANDS[firstToken];
    // La targa della conversazione si prende ADESSO, mentre l'utente preme
    // Invio: quello che il comando dirà fra dieci secondi appartiene a questa
    // chat anche se intanto l'utente è tornato alla home.
    if (handler) {
      const chiave = SLASH_COMMANDS[text] ? text : firstToken;
      if (chiave !== '/incognito') contaComando(chiave);
      handler(text, chatDellaRiga());
      inputEl.value = ''; autoGrowInput(); updateInputClass(); return true;
    }
    // 2) Navigazione diretta a un sito: solo se è un singolo token "tipo sito".
    //    L'URL (e lo schema: http per i server locali/IP privati, https per i
    //    domini pubblici) lo compone la stessa logica della vecchia barra
    //    indirizzi — SN_URL_NAV.normalizeUrl (#398) — così "/localhost:3000" o
    //    "/192.168.1.1" si aprono davvero invece di partire su un https vuoto.
    if (isSiteToken(text)) {
      contaComando('sito_diretto');
      send({ type: MSG.OPEN_URL, url: siteUrlOf(text), parole: [text] });
      inputEl.value = '';
      autoGrowInput();
      updateInputClass();
      return true;
    }
    // 3) Modalità terminale: alla shell va un programma che c'è (#892.1). Una parola qualsiasi o un percorso incollato
    //    dopo la barra restano un messaggio per Filo, come col terminale spento; un controllo senza risposta non decide.
    if (isTerminalMode()) {
      const chat = chatDellaRiga();
      const programma = programmaDi(text);
      if (!programma || (programma !== SINTASSI && (await esisteInShell(programma)) === false)) { updateInputClass(); return false; }
      inputEl.value = '';
      autoGrowInput();
      updateInputClass();
      // Passa dai livelli di autonomia: se la persona dice no, il comando torna nella barra com'era.
      const partito = await runShellCommand(text.slice(1).trim(), chat, { daFuori: incollato });
      if (partito === false) rimettiNellaBarra(text, incollato);
      else contaComando('shell');
      return true;
    }
    // 4) Modalità normale, comando `/` sconosciuto: lascialo all'LLM (storico).
    return false;
  }

  function init(deps) {
    // Una home appena aperta riparte dalla prima persona: la vista sfogliata
    // da «/users altri» è di quella sessione di pagina, non della precedente.
    usersElenco = [];
    usersMostrati = 0;
    usersCerca = '';
    send = deps.send;
    bubblesEl = deps.bubblesEl;
    inputEl = deps.inputEl;
    makeBubble = deps.makeBubble;
    goHome = deps.goHome;
    goThread = deps.goThread;
    autoGrowInput = deps.autoGrowInput;
    refreshLive = deps.refreshLive;
    if (deps.archiviaRiga) archiviaRiga = deps.archiviaRiga;
    if (deps.chatDellaRiga) chatDellaRiga = deps.chatDellaRiga;
    if (deps.inChatAperta) inChatAperta = deps.inChatAperta;
    if (deps.isTerminalMode) isTerminalMode = deps.isTerminalMode;
    if (deps.getShell) getShell = deps.getShell;
    if (deps.getCwd) getCwd = deps.getCwd;
    if (deps.runShellCommand) runShellCommand = deps.runShellCommand;
    if (deps.rimettiNellaBarra) rimettiNellaBarra = deps.rimettiNellaBarra;
  }

  global.SN_DASH_COMANDI = {
    init,
    setOwner: (v) => { isOwner = !!v; },
    classifyInput,
    updateInputClass,
    handleSlashCommand,
    isSiteToken,
    siteHostOf,
    siteUrlOf,
    ensureSiteResolved,
    showUnresolvedSite,
    lasciaNonRisolto,
    contaComando,
    showFiloLine,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
