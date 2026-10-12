// Elenco dei servizi esterni che Filo contatta da solo, e in una sezione a parte dei link che apre l'utente (#849).
// Solo dati: da qui non parte nessuna richiesta, e un servizio nuovo nel codice si aggiunge qui nello stesso commit.
// Lo tiene vero tests/unit/serviziEsterni.test.mjs, che confronta indirizzi e chiamate di rete con src/.

(function (global) {
  'use strict';

  const QUANDO = {
    avvio: 'all’avvio',
    pagina: 'a ogni pagina',
    sito: 'a ogni sito nuovo',
    funzione: 'quando usi una certa funzione',
  };

  const FIRESTORE = 'https://firestore.googleapis.com';
  const STORAGE = 'https://firebasestorage.googleapis.com';
  const FUNZIONI = 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
  const RINNOVO_ACCESSO = 'https://securetoken.googleapis.com/v1/token';

  // `base` vuoto vuol dire che l'indirizzo lo decide la pagina o l'utente, e allora `indirizzo` dice quale.
  // `prova`: il testo di codice che mostra l'uso quando l'indirizzo non sta scritto in src/ (lo mette Electron).
  const SERVIZI = [
    {
      id: 'modelli-openrouter', nome: 'OpenRouter, per i modelli',
      base: ['https://openrouter.ai/api/v1/'],
      quando: 'funzione',
      occasione: 'a ogni funzione che usa un modello (chat, spiegazioni, traduzione, correttore, voce, immagini), e quando scegli un modello o guardi il saldo della chiave',
      riceve: 'quello che serve alla funzione per rispondere: testo, immagini o audio, con la chiave dei crediti di Filo o la tua',
      dove: ['src/main/services/providers/openrouter.js', 'src/main/services/handlers/ai.js', 'src/pages/options/options.js'],
    },
    {
      id: 'identita-anonima', nome: 'Firebase, per l’identità dell’installazione',
      base: ['https://identitytoolkit.googleapis.com/v1/accounts:signUp', RINNOVO_ACCESSO],
      quando: 'avvio',
      occasione: 'la prima volta che serve un’identità, poi a ogni rinnovo del suo accesso',
      riceve: 'niente di tuo: crea e rinnova un account anonimo, senza email né password',
      dove: ['src/main/auth/anon-auth.js', 'src/main/auth/config.js'],
    },
    {
      id: 'configurazione-condivisa', nome: 'Il server di Filo, per la configurazione condivisa',
      base: [FIRESTORE],
      quando: 'avvio',
      occasione: 'a ogni avvio, e di nuovo quando la copia in memoria è vecchia',
      riceve: 'niente di tuo: legge quale modello usa ogni funzione e le altre impostazioni di serie',
      dove: ['src/main/services/defaultsStore.js'],
    },
    {
      id: 'crediti', nome: 'Il server di Filo, per i crediti',
      base: [FUNZIONI],
      quando: 'avvio',
      occasione: 'all’avvio per lo stato dei crediti, poi quando usi un invito o guardi il saldo',
      riceve: 'l’identità anonima dell’installazione, e il codice d’invito quando lo usi',
      dove: ['src/main/services/handlers/wallet.js'],
    },
    {
      id: 'invito-in-attesa', nome: 'Il server di Filo, per l’invito in attesa',
      base: [FUNZIONI],
      quando: 'avvio',
      occasione: 'all’avvio, nei primi giorni e finché non hai i crediti: chiede se un invito aperto dal sito aspetta questa installazione',
      riceve: 'l’identità anonima dell’installazione; il server confronta l’impronta del tuo indirizzo IP con quella lasciata dal link d’invito',
      dove: ['src/main/services/handlers/wallet.js'],
    },
    {
      id: 'registro-uso', nome: 'Il server di Filo, per il registro d’uso dei crediti',
      base: [FIRESTORE],
      quando: 'funzione',
      occasione: 'dopo le chiamate ai modelli fatte con i crediti di Filo, a gruppi',
      riceve: 'per ogni chiamata pseudonimo, ora, funzione, modello, chi l’ha servita, token e costo; mai il testo',
      dove: ['src/main/services/handlers/wallet.js'],
    },
    {
      id: 'feedback', nome: 'Il server di Filo, per i feedback',
      base: [FIRESTORE, STORAGE],
      quando: 'funzione',
      occasione: 'quando mandi un feedback, o lasci partire la segnalazione che Filo ti propone',
      riceve: 'il feedback: testo, indirizzo della pagina e allegati cifrati verso l’owner; in chiaro titolo della pagina, browser e sistema, titolo breve',
      dove: ['src/shared/feedback.js'],
    },
    {
      id: 'bacheca', nome: 'Il server di Filo, per la bacheca dei feedback',
      base: [FIRESTORE],
      quando: 'funzione',
      occasione: 'quando apri la bacheca, voti una scheda o chiedi di riaprirla',
      riceve: 'per leggere niente di tuo; con un voto, il codice interno del tuo account',
      dove: ['src/shared/feedback.js', 'src/main/services/handlers/board.js'],
    },
    {
      id: 'accesso-google', nome: 'Google, per il login',
      base: ['https://oauth2.googleapis.com/token', 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp', RINNOVO_ACCESSO],
      quando: 'funzione',
      occasione: 'quando fai il login con Google, e a ogni rinnovo dell’accesso',
      riceve: 'il codice d’accesso che Google ha dato a Filo nel browser di sistema',
      dove: ['src/main/auth/google-auth.js', 'src/main/auth/config.js'],
    },
    {
      id: 'crediti-con-login', nome: 'Il server di Filo, per il vecchio conteggio dei crediti',
      base: [FIRESTORE],
      quando: 'funzione',
      occasione: 'solo con il login Google: a ogni chiamata ai modelli e quando apri la pagina Crediti',
      riceve: 'email e nome dell’account, saldo, chiamate e crediti per funzione, costo; mai il testo',
      dove: ['src/main/services/handlers/credits.js'],
    },
    {
      id: 'percorsi-aiuto', nome: 'Il server di Filo, per i percorsi dell’Aiuto',
      base: [FIRESTORE, FUNZIONI],
      quando: 'funzione',
      occasione: 'quando apri l’Aiuto su una pagina o gli fai una domanda; l’invio dei percorsi riusciti è spento',
      riceve: 'il nome del sito (per esempio posta.esempio.it), senza il resto dell’indirizzo',
      dove: ['src/shared/paths.js'],
    },
    {
      id: 'red-team', nome: 'Il server di Filo, per il red team',
      base: [FUNZIONI],
      quando: 'funzione',
      occasione: 'solo se partecipi al red team, che oggi è in pausa',
      riceve: 'il testo dell’attacco e il nome in classifica che scegli tu',
      dove: ['src/main/services/handlers/redteam.js'],
    },
    {
      id: 'gestione-owner', nome: 'Il server di Filo, per la gestione',
      base: [FUNZIONI, FIRESTORE, STORAGE],
      quando: 'funzione',
      occasione: 'solo per l’owner, nella Gestione: feedback, modelli di serie, automazioni',
      riceve: 'le decisioni dell’owner; degli altri utenti niente',
      dove: ['src/main/services/handlers/auth.js', 'src/main/services/supportModelsStore.js'],
    },
    {
      id: 'safe-browsing', nome: 'Google Safe Browsing',
      base: ['https://safebrowsing.googleapis.com/v5/hashes:search'],
      quando: 'pagina',
      occasione: 'quando apri una pagina, se la risposta per quell’indirizzo non è già in memoria',
      riceve: 'i primi 4 byte dell’impronta dell’indirizzo e delle sue parti più corte: mai l’indirizzo',
      dove: ['src/main/services/safebrowse/net.js'],
    },
    {
      id: 'eta-dominio', nome: 'RDAP e crt.sh, i registri dei domini e dei certificati',
      base: ['https://rdap.org', 'https://crt.sh'],
      quando: 'sito',
      occasione: 'la prima volta che un sito mostra un segnale sospetto, per sapere da quanto esiste',
      riceve: 'il nome del sito (il dominio registrato, per esempio esempio.it)',
      dove: ['src/main/services/safebrowse/net.js'],
    },
    {
      id: 'link-sospetto-in-prova', nome: 'Il sito di un link sospetto, aperto di nascosto',
      base: [], indirizzo: 'il sito della pagina sospetta',
      quando: 'pagina',
      occasione: 'quando una pagina che apri ha un sospetto che i controlli non chiudono: la si carica in una finestra nascosta e isolata per vedere dove porta',
      riceve: 'una visita all’indirizzo completo, da una finestra che non ha i tuoi dati di navigazione',
      dove: ['src/main/services/safebrowse/sandbox.js'], prova: 'loadURL(',
    },
    {
      id: 'ricerca-web', nome: 'Tavily, o DuckDuckGo senza chiave',
      base: ['https://api.tavily.com', 'https://html.duckduckgo.com'],
      quando: 'funzione',
      occasione: 'quando l’agente cerca sul web',
      riceve: 'la ricerca che l’agente ha formulato',
      dove: ['src/main/services/webSearch.js'],
    },
    {
      id: 'llms-txt', nome: 'Il sito che stai visitando, per le sue istruzioni agli agenti',
      base: [], indirizzo: 'il sito della pagina',
      quando: 'funzione',
      occasione: 'quando apri l’Aiuto, al massimo una volta al giorno per sito',
      riceve: 'una richiesta del file llms.txt, senza il resto dell’indirizzo',
      dove: ['src/main/services/llmsTxt.js'],
    },
    {
      id: 'anteprima-link', nome: 'Il sito di un link, per titolo e descrizione',
      base: [], indirizzo: 'il sito del link',
      quando: 'funzione',
      occasione: 'quando fai tasto destro su un link; non parte se l’indirizzo sembra portare fuori dati riservati',
      riceve: 'una richiesta della pagina del link, senza i tuoi cookie',
      dove: ['src/main/services/handlers/misc.js', 'src/main/services/safe-fetch.js'],
    },
    {
      id: 'file-della-pagina', nome: 'Il sito di un’immagine o di un video',
      base: [], indirizzo: 'il sito che ospita il file',
      quando: 'funzione',
      occasione: 'quando salvi, copi, fai descrivere o controlli l’origine di un’immagine o di un video della pagina',
      riceve: 'la richiesta del file, con i cookie di quel sito, come la fa la pagina',
      dove: ['src/main/services/handlers/misc.js', 'src/content/actions.js'],
    },
    {
      id: 'colore-del-sito', nome: 'Il sito che stai visitando, per il suo colore',
      base: [], indirizzo: 'il sito della pagina',
      quando: 'pagina',
      occasione: 'quando una pagina non dichiara il suo colore ma ha un manifest, per tingere la scheda',
      riceve: 'una richiesta del manifest del sito, senza cookie',
      dove: ['src/content/pageColor.js'],
    },
    {
      id: 'icone-google', nome: 'Il servizio di icone di Google',
      base: ['https://www.google.com/s2/favicons'],
      quando: 'funzione',
      occasione: 'quando la home mostra i siti che Filo ti suggerisce',
      riceve: 'il nome di quei siti',
      dove: ['src/pages/dashboard/dashboard.js'],
    },
    {
      id: 'aggiornamenti', nome: 'GitHub, per gli aggiornamenti',
      base: ['https://github.com/sathyaram1/Filo/releases'],
      quando: 'avvio',
      occasione: 'all’avvio e quando chiedi se c’è una versione nuova; il file dell’aggiornamento arriva dall’archivio di GitHub',
      riceve: 'la richiesta della versione più recente',
      dove: ['src/main/updater.js'], prova: "require('electron-updater')",
    },
    {
      id: 'liste-pubblicita', nome: 'EasyList, StevenBlack e le liste nazionali, per bloccare la pubblicità',
      base: [
        'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
        'https://easylist.to/easylist/easylist.txt',
        'https://easylist-downloads.adblockplus.org/easylistitaly.txt',
        'https://raw.githubusercontent.com/easylist/listefr/master/liste_fr.txt',
      ],
      quando: 'avvio',
      occasione: 'col blocco della pubblicità acceso: all’avvio se la copia ha più di una settimana, poi una volta alla settimana',
      riceve: 'niente di tuo',
      dove: ['src/main/services/adblock.js'],
    },
    {
      id: 'liste-cookie', nome: 'Fanboy ed EasyList, per i banner dei cookie',
      base: [
        'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt',
        'https://raw.githubusercontent.com/easylist/easylist/master/easylist_cookie/',
      ],
      quando: 'avvio',
      occasione: 'come le liste della pubblicità, una volta alla settimana',
      riceve: 'niente di tuo',
      dove: ['src/main/services/cookieBanners.js'],
    },
    {
      id: 'firmatari-c2pa', nome: 'L’elenco dei firmatari C2PA, su GitHub',
      base: ['https://raw.githubusercontent.com/c2pa-org/conformance-public/'],
      quando: 'avvio',
      occasione: 'in sottofondo, una volta al giorno, e quando controlli l’origine di un’immagine con l’elenco vecchio',
      riceve: 'niente di tuo: il confronto con l’immagine avviene sul computer',
      dove: ['src/main/services/firmatariC2pa.js'],
    },
    {
      id: 'cambi-valuta', nome: 'Frankfurter, per i cambi della BCE',
      base: ['https://api.frankfurter.dev'],
      quando: 'funzione',
      occasione: 'quando una spiegazione converte una valuta, al massimo una volta al giorno',
      riceve: 'niente di tuo',
      dove: ['src/main/services/fxRates.js'],
    },
    {
      id: 'scryfall', nome: 'Scryfall, per le carte di Magic',
      base: ['https://api.scryfall.com'],
      quando: 'funzione',
      occasione: 'nei mazzi di Magic, quando cerchi o apri una carta; le immagini arrivano dal suo archivio',
      riceve: 'il nome della carta che cerchi',
      dove: ['src/main/services/scryfall.js'],
    },
    {
      id: 'dizionari-correttore', nome: 'Google, per i dizionari del correttore ortografico',
      base: ['https://redirector.gvt1.com/edgedl/chrome/dict/'],
      quando: 'avvio',
      occasione: 'la prima volta per ogni lingua del correttore, su Windows e Linux: su Mac il correttore è quello del sistema',
      riceve: 'la lingua del dizionario che manca',
      dove: ['src/main/main.js'], prova: 'setSpellCheckerLanguages(',
    },
    {
      id: 'proxy-altro-paese', nome: 'Il proxy che imposti tu',
      base: [], indirizzo: 'il fornitore di proxy scritto nelle impostazioni',
      quando: 'funzione',
      occasione: 'solo se ne hai impostato uno, nelle schede che apri da un altro paese',
      riceve: 'tutto il traffico di quelle schede',
      dove: ['src/main/tabs.js', 'src/main/services/proxyTab.js'], prova: 'setProxy(',
    },
  ];

  // Link che si aprono solo se l'utente li apre: il servizio lo contatta la scheda o il browser di sistema, non Filo da solo.
  const LINK_APERTI = [
    {
      id: 'ricerca-google', nome: 'Google, come motore di ricerca',
      base: ['https://www.google.com/search'],
      occasione: 'quando scrivi nella barra qualcosa che non è un indirizzo, o scegli «cerca» dal tasto destro',
      riceve: 'la ricerca',
      dove: ['src/shared/urlNav.js', 'src/content/actions.js'],
    },
    {
      id: 'google-lens', nome: 'Google Lens',
      base: ['https://lens.google.com/uploadbyurl'],
      occasione: 'quando cerchi un’immagine dal tasto destro',
      riceve: 'l’indirizzo dell’immagine',
      dove: ['src/content/actions.js'],
    },
    {
      id: 'pagina-accesso-google', nome: 'La pagina di accesso di Google',
      base: ['https://accounts.google.com/o/oauth2/v2/auth'],
      occasione: 'quando fai il login, nel browser di sistema',
      riceve: 'quello che scrivi a Google per entrare',
      dove: ['src/main/auth/config.js'],
    },
    {
      id: 'scryfall-sito', nome: 'Il sito di Scryfall',
      base: ['https://scryfall.com/search'],
      occasione: 'quando dai mazzi apri una ricerca su Scryfall',
      riceve: 'la ricerca della carta',
      dove: ['src/pages/decks/decks.js'],
    },
    {
      id: 'chiave-tavily', nome: 'Il sito di Tavily',
      base: ['https://app.tavily.com/'],
      occasione: 'quando apri dalle impostazioni il link per prendere una chiave',
      riceve: 'la visita, come ogni sito',
      dove: ['src/pages/options/options.html'],
    },
    {
      id: 'sito-filo', nome: 'Il sito di Filo',
      base: ['https://filo.red'],
      occasione: 'quando apri la pagina per scaricare Filo, o qualcuno apre un tuo link d’invito',
      riceve: 'la visita; dal link d’invito anche il codice',
      dove: ['src/main/updater.js', 'src/pages/dashboard/dashboard-carte.js', 'src/shared/wallet.js'],
    },
  ];

  // Vero se `url` sta sotto `base`: stesso prefisso, e la base finisce dove finisce un pezzo dell'indirizzo
  // (così https://crt.sh non copre https://crt.sh.esempio.it).
  function copre(base, url) {
    const b = String(base || '').toLowerCase();
    const u = String(url || '').toLowerCase();
    if (!b || !u.startsWith(b)) return false;
    return u.length === b.length || b.endsWith('/') || '/?#:'.includes(u[b.length]);
  }

  global.SN_SERVIZI_ESTERNI = { QUANDO, SERVIZI, LINK_APERTI, copre };
})(typeof globalThis !== 'undefined' ? globalThis : self);
