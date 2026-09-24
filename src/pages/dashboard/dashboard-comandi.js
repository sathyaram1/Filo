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
  let runShellCommand = () => {};

  // Vero se l'account loggato è l'owner (admin): abilita i comandi /users e
  // /gift in /help. Il gate forte resta nel main (auth.isAdmin) + Firestore rules.
  let isOwner = false;

  const SLASH_COMMANDS = {
    '/home': () => { goHome(); },
    '/clear': () => { goHome(); },
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
        showFiloLine('I feedback li vede chi li gestisce. Per mandarne uno: tasto destro → «Invia feedback», oppure scrivimi cosa non va e lo scrivo io.', chat);
        return;
      }
      send({ type: MSG.OPEN_URL, url: 'filo://feedback/feedback.html' });
    },
    '/incognito': () => { send({ type: MSG.OPEN_INCOGNITO }); },
    '/pulisci': (text, chat) => { runTabCleanup(chat); },
    '/pulizia': (text, chat) => { runTabCleanup(chat); },
    '/riordina': (text, chat) => { runTabReorder(chat); },
    '/set': (text, chat) => { handleSetCommand(text, chat); },
    '/users': (text, chat) => { handleUsersCommand(chat); },
    '/gift': (text, chat) => { handleGiftCommand(text, chat); },
    '/help': (text, chat) => {
      if (document.body.dataset.state !== 'thread') goThread();
      const lines = [
        '/home, /clear — ricarica la dashboard',
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
        '/help — lista comandi',
        '/google.com — apri un sito',
      ];
      if (isOwner) {
        lines.push(
          '/feedback — apri la posta delle segnalazioni (proprietario)',
          '/users — elenca gli utenti registrati (proprietario)',
          '/gift NUMERO EMAIL — regala crediti a un utente (proprietario)',
        );
      }
      showFiloLine(lines.join('\n'), chat);
    },
  };

  // "/users": elenca le email degli utenti registrati. Riservato al proprietario
  // (il main rifiuta i non-admin con un messaggio chiaro).
  async function handleUsersCommand(chat) {
    showFiloLine('Recupero gli utenti registrati…', chat);
    const r = await send({ type: MSG.OWNER_LIST_USERS });
    if (!r || r.ok === false) { showFiloLine(r?.error || 'Non sono riuscito a recuperare gli utenti.', chat); return; }
    const users = Array.isArray(r.users) ? r.users : [];
    if (!users.length) { showFiloLine('Nessun utente registrato.', chat); return; }
    const lines = users.map((u) => `• ${u.email}${u.name ? ` (${u.name})` : ''} — ${u.balance} crediti`);
    showFiloLine(`Utenti registrati (${users.length}):\n${lines.join('\n')}`, chat);
  }

  // "/gift NUMERO EMAIL": regala crediti a un utente. Riservato al proprietario.
  async function handleGiftCommand(text, chat) {
    const m = /^\/gift\s+(\S+)\s+(\S+)\s*$/i.exec(String(text || '').trim());
    if (!m) { showFiloLine('Uso: /gift NUMERO EMAIL — es. /gift 2000 mario@esempio.com', chat); return; }
    const amount = Number(m[1]);
    const email = m[2];
    if (!Number.isInteger(amount) || amount <= 0) {
      showFiloLine(`"${m[1]}" non è un numero di crediti valido. Usa un intero positivo.`, chat);
      return;
    }
    showFiloLine(`Regalo ${amount} crediti a ${email}…`, chat);
    const r = await send({ type: MSG.OWNER_GIFT_CREDITS, amount, email });
    if (!r || r.ok === false) { showFiloLine(r?.error || 'Operazione non riuscita.', chat); return; }
    showFiloLine(`✓ Regalati ${r.amount} crediti a ${r.email}. Nuovo saldo del destinatario: ${r.balance}.`, chat);
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
  function showFiloLine(text, chat) {
    try { archiviaRiga(text, 'filo', chat); } catch (_) {}
    if (!inChatAperta(chat)) return;
    if (document.body.dataset.state !== 'thread') goThread();
    const bubble = makeBubble({ role: 'filo', text });
    bubblesEl.appendChild(bubble);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
  }

  // "/pulisci" (o "/pulizia"): avvia il riordino/archiviazione delle schede non
  // più utili, con la STESSA conferma del bottone "🧹 Riordina e archivia le
  // schede" (mai automatico, spec §2.1). Riusa il popup Filo SN_CONFIRM_UI.
  async function runTabCleanup(chat) {
    const text = 'Filo valuterà tutte le schede aperte e archivierà quelle non più utili. '
      + 'Le schede archiviate restano riapribili da “Tab archiviate”.';
    const ok = window.SN_CONFIRM_UI
      ? await window.SN_CONFIRM_UI.confirm({ title: 'Riordino delle schede', text, okLabel: 'Procedi' })
      : window.confirm(`${text} Procedo?`);
    if (!ok) return;
    showFiloLine('🧹 Riordino in corso…', chat);
    const r = await send({ type: MSG.RUN_TAB_TRIAGE });
    const e = global.SN_DASH_ATTIVITA.esitoRiordino(r);
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

  // Cache "il comando shell esiste?" (token → bool), per non rifare lo spawn
  // di controllo a ogni tasto. Il risultato non dipende dalla cwd per i comandi
  // su PATH; per i casi limite (script relativi) la piccola imprecisione è ok.
  const shellCmdCache = new Map();
  let whichTimer = null;

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
      const cmd = firstToken.slice(1);
      if (!cmd) return 'none';
      if (shellCmdCache.has(cmd)) return shellCmdCache.get(cmd) ? 'shell' : 'unknown';
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

  // Verifica (con debounce) se il primo token è un comando shell esistente e
  // poi ricolora. Debounce così il controllo parte solo quando l'utente si
  // ferma: digitando di getto "/git" i prefissi non vengono mai controllati e
  // il rosso non lampeggia.
  function scheduleShellWhich(value) {
    clearTimeout(whichTimer);
    whichTimer = setTimeout(async () => {
      const firstToken = value.trim().split(/\s+/)[0];
      const cmd = firstToken.slice(1);
      if (!cmd || shellCmdCache.has(cmd)) { updateInputClass(); return; }
      let exists = false;
      try {
        const r = await window.filo?.shellWhich?.({ command: cmd, shell: getShell(), cwd: getCwd() });
        exists = !!(r && r.exists);
      } catch (_) { exists = false; }
      shellCmdCache.set(cmd, exists);
      updateInputClass(); // ricolora sullo stato attuale dell'input
    }, 250);
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
      // L'utente ha deciso: da qui in poi quell'host non viene più messo in
      // dubbio (niente rosso, niente avviso al prossimo invio).
      siteResolveCache.set(host, true);
      send({ type: MSG.OPEN_URL, url: siteUrlOf(text) });
      if (inputEl.value.trim() === text) { inputEl.value = ''; autoGrowInput(); }
      updateInputClass();
    });
    row.appendChild(btn);
    bubble.appendChild(row);
    bubblesEl.appendChild(bubble);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
    unresolvedLine = { el: bubble, host };
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
    // 'pending' (terminale, esistenza del comando ancora da verificare) viene
    // mostrato GIÀ in rosso: aggiungere caratteri a un "/comando" non deve far
    // lampeggiare il colore tornando a neutro a ogni tasto mentre il controllo
    // è in corso. Quando il check risolve, il comando diventa azzurro (esiste)
    // o resta rosso (non esiste), senza flicker intermedi.
    const showUnknown = kind === 'unknown' || kind === 'pending';
    inputEl.classList.toggle('is-cmd-filo', kind === 'filo');
    inputEl.classList.toggle('is-cmd-shell', kind === 'shell');
    inputEl.classList.toggle('is-cmd-unknown', showUnknown);
    // In attesa del controllo "esiste?": rosso (vedi sopra) e avvia il check.
    if (kind === 'pending') scheduleShellWhich(inputEl.value);
    // Sito (arancione) non ancora verificato: avvia il lookup DNS (debounce)
    // così, se il dominio non esiste, l'input diventa rosso.
    const t = inputEl.value.trim();
    if (kind === 'filo' && t.startsWith('/') && isSiteToken(t)) {
      const host = siteHostOf(t);
      if (host && !siteResolveCache.has(host)) scheduleSiteResolve(host);
    }
  }

  function handleSlashCommand(text) {
    if (!text.startsWith('/')) return false;
    const firstToken = text.split(/\s+/)[0];
    // 1) Comandi interni di Filo: vincono SEMPRE, anche in modalità terminale.
    const handler = SLASH_COMMANDS[text] || SLASH_COMMANDS[firstToken];
    // La targa della conversazione si prende ADESSO, mentre l'utente preme
    // Invio: quello che il comando dirà fra dieci secondi appartiene a questa
    // chat anche se intanto l'utente è tornato alla home.
    if (handler) {
      handler(text, chatDellaRiga());
      inputEl.value = ''; autoGrowInput(); updateInputClass(); return true;
    }
    // 2) Navigazione diretta a un sito: solo se è un singolo token "tipo sito".
    //    L'URL (e lo schema: http per i server locali/IP privati, https per i
    //    domini pubblici) lo compone la stessa logica della vecchia barra
    //    indirizzi — SN_URL_NAV.normalizeUrl (#398) — così "/localhost:3000" o
    //    "/192.168.1.1" si aprono davvero invece di partire su un https vuoto.
    if (isSiteToken(text)) {
      send({ type: MSG.OPEN_URL, url: siteUrlOf(text) });
      inputEl.value = '';
      autoGrowInput();
      updateInputClass();
      return true;
    }
    // 3) Modalità terminale: tutto il resto con `/` viene eseguito dalla shell
    //    (non passa mai all'LLM).
    if (isTerminalMode()) {
      runShellCommand(text.slice(1).trim(), chatDellaRiga());
      inputEl.value = '';
      autoGrowInput();
      updateInputClass();
      return true;
    }
    // 4) Modalità normale, comando `/` sconosciuto: lascialo all'LLM (storico).
    return false;
  }

  function init(deps) {
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
    showFiloLine,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
