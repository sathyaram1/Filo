// Le voci delle pagine delle impostazioni, una fonte sola (#949): per ogni controllo il percorso che scrive.
// Da qui la pagina sa cosa salva e riallinea, e la chat sa leggere (LEGGI_IMPOSTAZIONI) e cambiare ogni voce.
// Regole: tests/unit/vociImpostazioni.test.mjs (ogni controllo della pagina ha la sua voce e la sua chiave).

(function (global) {
  'use strict';

  // `campi`: id del controllo → percorso nelle impostazioni. `gruppi`: le sezioni che la pagina costruisce
  // da codice, con il percorso jolly delle loro voci. `altrove`: le sezioni che la pagina costruisce da dati
  // tenuti fuori dalle impostazioni (vedi ALTROVE). `fuori`: i controlli che non scrivono un'impostazione,
  // col perché. `messaggi`: ogni altro canale che la pagina usa → lo strumento della chat che fa lo stesso,
  // o il perché non serve.
  const PAGINE = {
    preferences: {
      titolo: 'Preferenze',
      campi: {
        theme: 'theme',
        textScale: 'textScale',
        showHomeMessage: 'showHomeMessage',
        homeSisOra: 'homeSistema.ora',
        homeSisBatteria: 'homeSistema.batteria',
        homeSisRete: 'homeSistema.rete',
        homeSisBluetooth: 'homeSistema.bluetooth',
        homeSisVolume: 'homeSistema.volume',
        tabPreviewEnabled: 'tabPreview.enabled',
        tabPreviewSize: 'tabPreview.size',
        autoArchiveEnabled: 'autoArchive.enabled',
        autoArchiveOnClose: 'autoArchive.onClose',
        autoArchiveIdleHours: 'autoArchive.idleHours',
        riassuntoSchede: 'riassuntoSchede.enabled',
        agentStylePreset: 'agentStyle',
        agentStyleText: 'agentStyle',
        ttsModelVoice: 'tts.modelVoice',
        ttsModelVoiceCustom: 'tts.modelVoice',
        ttsRate: 'tts.rate',
        ttsPitch: 'tts.pitch',
        ttsVoice: 'tts.voice',
        notifDuration: 'notifications.durationSec',
        notifSoundEnabled: 'notifications.soundEnabled',
        notifSound: 'notifications.sound',
        notifSoundVolume: 'notifications.soundVolume',
        dictationAutoSend: 'dictation.autoSend',
        dictationSilence: 'dictation.silenceSec',
        dictationCancel: 'dictation.cancelSec',
        timerRingtone: 'timerRingtone',
        timerRingtoneVolume: 'timerRingtoneVolume',
        terminalEnabled: 'terminal.enabled',
        schermoGuarda: 'schermo.guarda',
        terminalShell: 'terminal.shell',
        nomiSensatiScaricamenti: 'nomiSensati.scaricamenti',
        barraSpinta: 'barraLaterale.spinta',
        barraStriscia: 'barraLaterale.striscia',
        barraSchede: 'barraLaterale.schede',
        barraAttesa: 'barraLaterale.attesaMs',
        barraUscita: 'barraLaterale.uscitaMs',
        avvisoSchermoPienoDurata: 'avvisoSchermoPieno.durataMs',
        aggiornamentiAutomatici: 'aggiornamenti.automatici',
        aggiornamentiInstalla: 'aggiornamenti.installa',
        propostaEmailAttiva: 'propostaEmail.attiva',
        propostaEmailIncognito: 'propostaEmail.incognito',
        contestoGiorni: 'contestoFilo.giorni',
        contestoToken: 'contestoFilo.token',
        contestoCache: 'contestoFilo.cache',
        lunghezzaConversazioni: 'lunghezzaRisposte.conversazioni',
        lunghezzaTesti: 'lunghezzaRisposte.testi',
        lunghezzaBrevi: 'lunghezzaRisposte.brevi',
        avvisoCreditiAttivo: 'avvisoCrediti.attivo',
        avvisoCreditiGiorni: 'avvisoCrediti.giorni',
        avvisoCreditiPercento: 'avvisoCrediti.percento',
        spiegaAnticipata: 'spiegaAnticipata.enabled',
        descriviImmagini: 'descriviImmagini.enabled',
        contatoriAttivi: 'contatori.attivi',
        aiutoAcceso: 'featureFlags.help',
        correttoreAcceso: 'featureFlags.spellcheck',
        correttoreSuggerimenti: 'featureFlags.spellcheckContext',
        correttoreModello: 'correttore.modelloErrori',
        correttoreRipetizioni: 'correttore.ripetizioni',
        correttoreSegnaposti: 'correttore.segnaposti',
        correttoreSegnapostiWeb: 'correttore.segnapostiWeb',
        correttorePausaRapido: 'correttore.pausaRapidoMs',
        correttoreOgniRapido: 'correttore.ogniRapidoMs',
        correttorePausaRagionato: 'correttore.pausaRagionatoMs',
        correttoreAutomatica: 'correttore.automatica',
        correttoreAccetti: 'correttore.accettiPerImparare',
        correttoreAnnulli: 'correttore.annulliPerImparare',
        correttoreRiscritte: 'correttore.riscrittePerImparare',
        categorieAutomatiche: 'featureFlags.categorize',
      },
      gruppi: {
        tokenCode: 'themeTokens.*', tabColorCode: 'tabColor.*', documentiCartelle: 'documenti.cartelle', menuDelSitoSiti: 'menuDelSito.siti',
        scorciatoieFilo: 'scorciatoie.*',
      },
      altrove: { documentiCercate: 'cartelleCercate' },
      fuori: {},
      messaggi: {
        DOCUMENTI_STATO: 'CERCA_DOCUMENTI',
        DOCUMENTI_DIMENTICA: 'IMPOSTA_PREFERENZA',
        DOCUMENTI_SCEGLI_CARTELLA: 'apre la finestra del sistema per scegliere una cartella: dalla chat la cartella si dice col suo percorso (cartelle_documenti)',
        FILO_GET_ONBOARDING: 'rilegge le interviste di benvenuto passate per mostrarle: non è un valore da cambiare',
        DEFAULT_MODELS_PUBLIC: 'legge i valori predefiniti dei tetti della chat e delle risposte per mostrarli accanto ai campi: non salva niente',
        FILO_RESTART_ONBOARDING: 'pulsante che fa un’azione (rifà l’intervista di benvenuto): resta nella pagina',
        FILO_ONBOARDING_TOGLI: 'toglie un’intervista conservata dall’elenco qui sotto: dalla chat si cancellano tutte insieme chiedendo di dimenticare tutto',
        RESET_SETTINGS: 'pulsante che fa un’azione (ripristina tutte le impostazioni): resta nella pagina',
        TTS_SYNTH: 'prova d’ascolto della voce scelta: non salva niente',
        TTS_VOICES: 'legge le voci installate per riempire il menu: non salva niente',
        OPEN_URL: 'apre una pagina collegata: non salva niente',
        REGISTRA_TASTI: 'lascia arrivare alla pagina i tasti premuti mentre si registra una scorciatoia: dalla chat la combinazione si scrive (scorciatoia)',
        CONTATORI_EVENTO: 'conta per i contatori anonimi cosa si rimette di serie (#1471): non salva niente e non legge impostazioni',
      },
    },
    security: {
      titolo: 'Sicurezza',
      campi: {
        'sec-protect-ip': 'security.protectIpLeak',
        'sec-block-popups': 'security.blockPopups',
        'sec-adblock': 'security.adblock.enabled',
        'sec-adskip': 'security.adSkip.enabled',
        'sec-siteblock': 'security.siteBlock.enabled',
        'sec-siteblock-lists': 'security.siteBlock.useAdblockLists',
        'sec-siteblock-blacklist': 'security.siteBlock.blacklist',
        'sec-dl-exe': 'security.downloads.confirmExecutables',
        'sec-dl-trusted': 'security.downloads.trustedSites',
        'sec-safebrowse': 'security.safeBrowse.enabled',
        'sec-safebrowse-network': 'security.safeBrowse.networkSignals',
        'sec-safebrowse-llm': 'security.safeBrowse.llmJudge',
        'sec-safebrowse-sandbox': 'security.safeBrowse.sandbox',
        'sec-delicate': 'security.pagineDelicate.enabled',
        'sec-delicate-sites': 'security.pagineDelicate.siti',
        'sec-auto-feedback': 'security.autoFeedback',
        'sec-riquadri-modello': 'security.riquadriRotti.modello',
        'cookie-mode-manual': 'security.cookies.mode',
        'cookie-mode-default': 'security.cookies.mode',
        'cookie-mode-privacy': 'security.cookies.mode',
        'cookie-wl-input': 'security.cookies.trustedSites',
        'fp-mode-off': 'security.fingerprint.mode',
        'fp-mode-default': 'security.fingerprint.mode',
        'fp-mode-privacy': 'security.fingerprint.mode',
      },
      gruppi: { 'sec-cookies-banners': 'security.cookies.bannerSites', 'sec-delicate-campi': 'security.pagineDelicate.nonDelicati', 'sec-cookies-accessi': 'security.cookies.loggedSites', 'sec-cookies-riquadri': 'security.cookies.embedSites' },
      altrove: { 'sec-perm-list': 'permessiSiti' },
      fuori: {
        'sec-clip-search': 'cerca fra le voci della cronologia appunti mostrate nella pagina: non è un valore da salvare',
        'sec-wipe-identity': 'sceglie se «Cancella tutti i dati di Filo» porta via anche l’identità dei crediti: vale per quella conferma, non è un valore da salvare',
        'sec-wipe-word': 'la parola «conferma» che sblocca «Cancella tutti i dati di Filo»: la scrive l’utente, non è un valore da salvare',
        'sec-export-keys': 'sceglie se l’archivio esportato porta anche le chiavi API: vale per quell’esportazione, non è un valore da salvare',
        'sec-wipe-export-keys': 'la stessa scelta di «Includi le chiavi» dentro la conferma di «Cancella tutti i dati di Filo»: vale per quell’esportazione, non è un valore da salvare',
      },
      messaggi: {
        PERMESSI_SITI_GET: 'LEGGI_IMPOSTAZIONI',
        PERMESSI_SITI_TOGLI: 'TOGLI_PERMESSO_SITO',
        FILO_PAGINE_CONTA: 'CANCELLA_PAGINE',
        FILO_PAGINE_CANCELLA: 'CANCELLA_PAGINE',
        COOKIES_SITES: 'mostra i siti dove Filo ha già rifiutato i banner, da passare all’elenco dei banner visibili',
        PAGINE_DELICATE_CAMPI: 'mostra i siti dove Filo ha visto un campo password o carta; toglierne uno è l’elenco siti_non_delicati',
        PROXY_STATUS: 'mostra se la connessione da un altro paese è configurata: non è un valore da cambiare qui',
        DOWNLOADS_LIST: 'legge i siti da cui sono scesi programmi, per proporre il sito preciso a chi scrive una piattaforma fra i programmi fidati: non è un valore da cambiare',
        EXPORT_DATA: 'pulsante che fa un’azione (esporta i dati in un file, le chiavi solo con la spunta): resta nella pagina',
        IMPORT_DATA_PREVIEW: 'pulsante che fa un’azione (importa i dati da un file): resta nella pagina',
        IMPORT_DATA_APPLY: 'pulsante che fa un’azione (importa i dati da un file): resta nella pagina',
        CANCELLA_TUTTI_I_DATI: 'pulsante che fa un’azione (cancella tutti i dati di Filo con la parola scritta): resta nella pagina, la chat ci porta con NAVIGA e non cancella',
        CANCELLA_TUTTI_I_DATI_STATO: 'dice alla conferma di «Cancella tutti i dati di Filo» se c’è un’identità dei crediti da tenere: non è un valore da cambiare',
        GET_CLIPBOARD_HISTORY: 'la cronologia appunti è un dato dell’utente (anche password copiate), non un’impostazione: si legge nella pagina',
        REMOVE_CLIPBOARD_ENTRY: 'pulsante che fa un’azione (toglie una voce della cronologia appunti): resta nella pagina',
        CLEAR_CLIPBOARD_HISTORY: 'pulsante che fa un’azione (svuota la cronologia appunti): resta nella pagina',
      },
    },
    options: {
      titolo: 'Modelli',
      campi: {
        useDefaultModels: 'useDefaultModels',
        openWeightsOnly: 'openWeightsOnly',
        ownKeyAllProviders: 'ownKeyAllProviders',
        ordineHost: 'ordineHost',
        apiKey: 'apiKeys.openrouter',
        apiKeyTavily: 'apiKeys.tavily',
        monthlyLimit: 'monthlyLimitEur',
        costWarnRatio: 'costoModelli.soglia',
      },
      gruppi: {},
      fuori: {},
      messaggi: {
        DEFAULT_MODELS_PUBLIC: 'legge i modelli predefiniti condivisi per mostrarli: non salva niente',
        GET_COSTS: 'legge la spesa del mese per mostrarla: non salva niente',
        STIMA_COSTO_MODELLI: 'legge listino, saldo e token medi per stimare il costo accanto ai modelli: non salva niente',
        TEST_DEFAULT_MODEL: 'prova di un modello: non salva niente',
        TEST_PROVIDER: 'prova della chiave: non salva niente',
      },
    },
    altro: {
      titolo: 'Altro',
      campi: {
        blocklist: 'blocklist',
        spellcheckErrori: 'featureFlags.spellcheck',
        spellcheckSuggerimenti: 'featureFlags.spellcheckContext',
        spellcheckAutomatica: 'correttore.automatica',
        spellcheckSegnaposti: 'correttore.segnaposti',
      },
      gruppi: {},
      fuori: {},
      messaggi: {
        GET_CATEGORIES: 'le categorie delle pagine salvate sono dati dell’utente, non impostazioni',
        GET_SAVED_PAGES: 'le categorie delle pagine salvate sono dati dell’utente, non impostazioni',
        RENAME_CATEGORY: 'le categorie delle pagine salvate sono dati dell’utente, non impostazioni',
        DELETE_CATEGORY: 'le categorie delle pagine salvate sono dati dell’utente, non impostazioni',
      },
    },
  };

  // Le voci tenute fuori dalle impostazioni: chi le tiene (il main) le passa a righePerModello in `altrove`,
  // già scritte come righe da leggere.
  const ALTROVE = {
    permessiSiti: {
      nome: 'permessi dei siti (risposte ricordate)',
      come: 'TOGLI_PERMESSO_SITO per toglierne una',
      parole: 'permessi permesso microfono fotocamera appunti posizione notifiche schermi presenza strumenti rete file cartelle consentito negato',
    },
    // #947.3 — le cartelle fuori elenco in cui l'utente ha cercato: l'indice ne tiene i documenti già letti.
    cartelleCercate: {
      nome: 'cartelle dei documenti dove hai cercato una volta (Filo tiene i documenti già letti)',
      come: 'IMPOSTA_PREFERENZA chiave cartelle_documenti, valore "togli <cartella>" per fargliele dimenticare',
      parole: 'cartelle cartella documenti ricerca cercato cercata indice archivio letti dimentica',
    },
  };

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function dentro(o, percorso) {
    return String(percorso).split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
  }
  function jolly(percorso) {
    return String(percorso).endsWith('.*');
  }
  // Le voci di un percorso jolly: i token estetici, i sei parametri del colore delle tab, le quattro scorciatoie di Filo.
  function espandi(percorso) {
    if (!jolly(percorso)) return [percorso];
    const base = percorso.slice(0, -2);
    if (base === 'themeTokens') {
      const T = global.SN_THEME_TOKENS;
      return T && T.names ? T.names().map((n) => `themeTokens.${n}`) : [];
    }
    if (base === 'scorciatoie') {
      if (!global.SN_TASTI && typeof require === 'function') require('./tasti.js');
      const T = global.SN_TASTI;
      return T && T.AZIONI_FILO ? T.AZIONI_FILO.map((a) => `scorciatoie.${a.id}`) : [];
    }
    if (base === 'tabColor') {
      const TC = global.SN_TAB_COLOR;
      return TC && Array.isArray(TC.IDENTITY_PARAM_META) ? TC.IDENTITY_PARAM_META.map((m) => `tabColor.${m.key}`) : [];
    }
    return [];
  }

  function campi(pagina) {
    return { ...((PAGINE[pagina] && PAGINE[pagina].campi) || {}) };
  }

  function leggi(settings, percorso) {
    const v = dentro(settings, percorso);
    if (v !== undefined && v !== null) return v;
    const C = global.SN_CONST;
    const d = C && C.DEFAULT_SETTINGS ? dentro(C.DEFAULT_SETTINGS, percorso) : undefined;
    return d === undefined ? v : d;
  }

  // ── Le voci per la chat ────────────────────────────────────────────────────
  // Come la chat la cambia: la chiave di IMPOSTA_PREFERENZA, o il token di IMPOSTA_ESTETICA.
  function chiaveDi(percorso) {
    if (has(ALTROVE, percorso)) return { come: ALTROVE[percorso].come, chiave: '', conferma: false };
    if (percorso.startsWith('themeTokens.')) return { come: `IMPOSTA_ESTETICA token ${percorso.slice(12)}`, chiave: '', conferma: false };
    const P = global.SN_PREF;
    const s = P && P.setterDi ? P.setterDi(percorso) : null;
    return s ? { come: `chiave ${s.keys[0]}`, chiave: s.keys[0], conferma: s.costo >= 2 } : { come: '', chiave: '', conferma: false };
  }
  function minuscola(s) {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }
  function nomeDi(percorso) {
    if (has(ALTROVE, percorso)) return ALTROVE[percorso].nome;
    if (percorso.startsWith('themeTokens.')) {
      const T = global.SN_THEME_TOKENS;
      const t = T && T.get ? T.get(percorso.slice(12)) : null;
      return `aspetto, ${t && t.label ? minuscola(t.label) : percorso.slice(12)}`;
    }
    const K = global.SN_CAMBI;
    const v = K && K.voce ? K.voce(percorso) : null;
    return v && v.nome ? v.nome : percorso;
  }

  // Ogni voce leggibile: quelle delle pagine, nell'ordine della pagina, poi quelle che la chat cambia
  // senza che stiano in una di queste pagine.
  function voci() {
    const out = [];
    const visti = new Set();
    const aggiungi = (percorso, pagina) => {
      if (visti.has(percorso)) return;
      visti.add(percorso);
      const k = chiaveDi(percorso);
      out.push({
        percorso,
        pagina,
        titolo: pagina ? PAGINE[pagina].titolo : 'Altre impostazioni',
        nome: nomeDi(percorso),
        ...k,
      });
    };
    for (const [pagina, def] of Object.entries(PAGINE)) {
      for (const p of [...Object.values(def.campi), ...Object.values(def.gruppi || {}), ...Object.values(def.altrove || {})]) {
        for (const q of espandi(p)) aggiungi(q, pagina);
      }
    }
    const P = global.SN_PREF;
    for (const s of (P && P.PREF_SETTERS) || []) for (const p of s.scrive || []) aggiungi(p, null);
    return out;
  }

  const NON_CERCARE = new Set(['come', 'cosa', 'che', 'con', 'per', 'sono', 'quale', 'quali', 'impostato', 'impostata',
    'impostati', 'impostate', 'impostazione', 'impostazioni', 'attivo', 'attiva', 'attivi', 'acceso', 'accesa', 'spento',
    'spenta', 'adesso', 'filo', 'mio', 'mia', 'miei', 'mie', 'hai', 'dimmi', 'della', 'delle', 'dello', 'degli', 'dei',
    'del', 'nel', 'nella', 'una', 'uno', 'gli', 'le', 'il', 'la', 'di', 'da']);
  // Il pezzo eliso non è una parola da cercare: «com'è», «dell'anteprima» cercherebbero «com» e «dell».
  function senzaElisioni(s) {
    return String(s || '').replace(/\p{L}+['’](?=\p{L})/gu, ' ');
  }
  function piano(s) {
    return senzaElisioni(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_.\-'’«»"?!,;:()]/g, ' ');
  }
  function radice(w) {
    return w.length > 5 ? w.slice(0, w.length - 2) : w;
  }
  function sinonimi(percorso) {
    if (has(ALTROVE, percorso)) return ALTROVE[percorso].parole;
    const P = global.SN_PREF;
    const s = P && P.setterDi ? P.setterDi(percorso) : null;
    return s ? s.keys.join(' ') : '';
  }
  // Un sito di un elenco come lo legge una persona: münchen.de, non la forma «xn--» con cui si salva.
  function sitoLeggibile(x) {
    const N = global.SN_NOMI_SITO;
    return N && N.leggibile ? N.leggibile(x) : x;
  }
  // Le parole della ricerca che possono essere un sito («facebook», «facebook.com», «münchen.de»).
  function paroleSito(cerca) {
    return senzaElisioni(cerca).toLowerCase().split(/[\s,;«»"'’?!()]+/)
      .map((w) => w.replace(/^(?:[a-z]+:\/\/)?(?:www\.)?/, '').replace(/[/.:]+$/, ''))
      .filter((w) => w.length >= 3 && !NON_CERCARE.has(w));
  }
  function sitoCombacia(x, siti) {
    const a = String(x).toLowerCase();
    const b = sitoLeggibile(a);
    return siti.some((w) => a.includes(w) || b.includes(w));
  }
  // Una voce combacia per nome, o perché il suo elenco contiene il sito cercato («ho bloccato facebook.com?»).
  function cercaVoci(tutte, cerca, settings) {
    const parole = piano(cerca).split(/\s+/).filter((w) => w.length >= 3 && !NON_CERCARE.has(w)).map(radice);
    if (!parole.length) return tutte;
    const siti = paroleSito(cerca);
    const dominio = siti.some((w) => /[^.]\.[^.\d]{2,}$/.test(w));
    return tutte.filter((v) => {
      const testo = piano(`${v.nome} ${v.come} ${v.percorso} ${v.titolo} ${sinonimi(v.percorso)}`);
      if (parole.some((w) => testo.includes(w))) return true;
      const lista = settings ? leggi(settings, v.percorso) : null;
      if (!Array.isArray(lista)) return false;
      // Cercato un sito con la sua estensione, ogni elenco di siti torna: anche per poter dire «non c'è».
      return dominio || lista.some((x) => typeof x === 'string' && sitoCombacia(x, siti));
    });
  }

  // Il valore come lo legge una persona. I segreti non escono mai.
  const MAX_ELENCO = 100;
  function valoreLeggibile(percorso, settings, { tema = 'light', sistema = '', cerca = '' } = {}) {
    const v = leggi(settings, percorso);
    if (has(ALTROVE, percorso) && !Array.isArray(v)) return 'non letto';
    if (percorso.startsWith('themeTokens.')) {
      const T = global.SN_THEME_TOKENS;
      const nome = percorso.slice(12);
      const over = (settings && settings.themeTokens) || {};
      const eff = T && T.effectiveValue ? T.effectiveValue(nome, over, tema) : v;
      const t = T && T.get ? T.get(nome) : null;
      const cat = t && t.category && has(over, t.category) && T.get(t.category);
      const da = has(over, nome) ? 'personalizzato' : (cat ? `segue ${minuscola(cat.label)}` : 'predefinito');
      return `${eff == null ? 'predefinito' : eff} (${da})`;
    }
    const K = global.SN_CAMBI;
    const voce = K && K.voce ? K.voce(percorso) : null;
    if (voce && voce.segreto) return v ? 'inserita (il valore non si mostra)' : 'non inserita';
    if (Array.isArray(v)) {
      const tutti = v.filter((x) => typeof x === 'string' && x.trim());
      if (!tutti.length) return 'elenco vuoto';
      // I siti cercati vengono per primi: oltre il tetto restano visibili, ed è questo che promette la nota.
      const siti = paroleSito(cerca);
      const cercati = siti.length ? tutti.filter((x) => sitoCombacia(x, siti)) : [];
      const l = cercati.concat(tutti.filter((x) => !cercati.includes(x))).map(sitoLeggibile);
      const altri = l.length > MAX_ELENCO ? ` e altri ${l.length - MAX_ELENCO} (chiedi con una parola del sito per vederli)` : '';
      const trovati = cercati.length ? `, con la ricerca: ${cercati.map(sitoLeggibile).join(', ')}` : '';
      return `${l.length} ${l.length === 1 ? 'voce' : 'voci'}${trovati ? `${trovati}; elenco` : ''}: ${l.slice(0, MAX_ELENCO).join(', ')}${altri}`;
    }
    if (voce && voce.testo) return String(v || '').trim() ? `«${String(v).trim()}»` : 'nessuno';
    // Una scorciatoia di Filo vuota è quella di serie: si dice quale, coi tasti di chi chiede (#842).
    if (percorso.startsWith('scorciatoie.') && global.SN_TASTI) {
      const T = global.SN_TASTI;
      const a = T.AZIONI_FILO.find((x) => `scorciatoie.${x.id}` === percorso);
      if (a) return typeof v === 'string' && v ? T.etichettaFilo(v, sistema || undefined) : `${T.etichettaFilo(a.serie, sistema || undefined)} (di serie)`;
    }
    if (percorso === 'terminal.shell' && sistema && sistema !== 'win32' && !['bash', 'sh'].includes(v)) return 'shell di sistema (sh)';
    if (percorso === 'aggiornamenti.installa') {
      const A = global.SN_AGGIORNAMENTI;
      const altrove = A && A.sceltaNonVale ? A.sceltaNonVale() : null;
      if (altrove) return `non vale qui (${altrove})`;
    }
    if (K && K.valore) return K.valore(percorso, v);
    return typeof v === 'boolean' ? (v ? 'sì' : 'no') : String(v == null ? 'nessuno' : v);
  }

  // Le righe che LEGGI_IMPOSTAZIONI restituisce al modello, divise per pagina.
  function righePerModello(impostazioni, { cerca = '', tema = 'light', sistema = '', altrove = {} } = {}) {
    const settings = { ...(impostazioni || {}) };
    for (const k of Object.keys(ALTROVE)) if (Array.isArray(altrove[k])) settings[k] = altrove[k];
    const tutte = voci();
    let scelte = cercaVoci(tutte, cerca, settings);
    const nessuna = !!String(cerca || '').trim() && !scelte.length;
    if (nessuna) scelte = tutte;
    const righe = [];
    let titolo = null;
    for (const v of scelte) {
      if (v.titolo !== titolo) {
        titolo = v.titolo;
        righe.push(v.pagina ? `${titolo} (pagina)` : `${titolo} (si cambiano dalla chat o dalle loro pagine)`);
      }
      const chiave = v.come ? ` [${v.come}${v.conferma ? ', chiede conferma' : ''}]` : '';
      righe.push(`- ${v.nome}: ${valoreLeggibile(v.percorso, settings, { tema, sistema, cerca: nessuna ? '' : cerca })}${chiave}`);
    }
    return { righe, trovate: nessuna ? 0 : scelte.length, totale: tutte.length };
  }

  // ── Le pagine aperte seguono un cambio arrivato da altrove (la chat, un'altra scheda) ──
  // `salta(id)`: i campi che l'utente sta toccando. `elenco(id, valore)`: come la pagina scrive un elenco.
  function riallineaPagina(pagina, settings, { doc = global.document, salta = () => false, elenco = null } = {}) {
    const def = PAGINE[pagina];
    const cambiati = [];
    if (!def || !settings || !doc) return cambiati;
    for (const [id, percorso] of Object.entries(def.campi)) {
      const el = doc.getElementById(id);
      if (!el || salta(id, percorso, el)) continue;
      const v = leggi(settings, percorso);
      if (el.type === 'checkbox') {
        if (el.checked !== !!v) { el.checked = !!v; cambiati.push(id); }
      } else if (el.type === 'radio') {
        if (el.value === String(v) && !el.checked) { el.checked = true; cambiati.push(id); }
      } else {
        const testo = Array.isArray(v) ? (elenco ? elenco(id, v) : v.join('\n')) : String(v == null ? '' : v);
        if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === testo)) continue;
        if (el.value !== testo) { el.value = testo; cambiati.push(id); }
      }
    }
    return cambiati;
  }

  global.SN_VOCI_IMPOSTAZIONI = {
    PAGINE, ALTROVE, campi, leggi, espandi, voci, cercaVoci, valoreLeggibile, righePerModello, riallineaPagina,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
