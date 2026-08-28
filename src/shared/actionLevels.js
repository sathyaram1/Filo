// Registro azione→livello di sicurezza (#146.2).
//
// Ogni azione che Filo (l'AI) può intraprendere ha un livello assegnato
// STATICAMENTE qui — mai deciso dall'LLM a runtime:
//
//   1 — completamente reversibile: si esegue subito, senza chiedere nulla.
//   2 — reversibile ma con possibili inconvenienti: popup di conferma che
//       spiega in chiaro la modifica E i suoi rischi, con OK e Annulla
//       (SN_CONFIRM_UI.confirm). Il popup si apre DA SOLO sulle risposte
//       fresche (#183), mai come chip inerte da cliccare; se ci sono più
//       azioni di livello 2 i popup si aprono uno alla volta.
//   3 — irreversibile: box con attrito maggiore, l'utente deve digitare
//       espressamente "conferma" (SN_CONFIRM_UI.confirmTyped).
//
// Il dispatch (executeFiloAction in src/main/services/handlers.js) RIFIUTA le
// azioni non registrate: ogni nuovo potere di Filo è obbligato a dichiarare
// qui il proprio livello, altrimenti non viene eseguito.
//
// Per IMPOSTA_PREFERENZA il livello dipende dalla preferenza specifica (il
// `level` del setter in src/shared/preferences.js, default 1): cambiare il
// tema è innocuo, abilitare la modalità terminale dà a Filo accesso alla
// shell e merita una conferma.

(function (global) {
  'use strict';

  function prefBuilt(action) {
    const P = global.SN_PREF;
    if (!P) return null;
    const chiave = action.chiave ?? action.key ?? action.nome ?? action.name ?? action.preferenza;
    const valore = action.valore ?? action.value ?? action.valoreNuovo ?? action.val;
    return P.buildPreferencePartial(chiave, valore);
  }

  // Token + valore di un'azione estetica (più sinonimi che un LLM può produrre).
  function estTok(action) {
    return action.token ?? action.nome ?? action.name ?? action.chiave ?? action.elemento;
  }
  function estVal(action) {
    return action.valore ?? action.value ?? action.val ?? action.colore;
  }

  // Etichetta leggibile di un paese per le azioni proxy (#152). Le location
  // curate combaciano con ProxyTab.LOCATIONS; per qualsiasi altro alpha-2 valido
  // ripieghiamo sul codice maiuscolo (il linguaggio naturale può chiedere paesi
  // fuori dalla lista curata).
  const COUNTRY_LABELS = {
    us: 'Stati Uniti', gb: 'Regno Unito', fr: 'Francia', de: 'Germania',
    es: 'Spagna', nl: 'Paesi Bassi', jp: 'Giappone',
  };
  function proxyCountry(action) {
    return action.country ?? action.paese ?? action.codicePaese ?? action.location;
  }
  function countryLabel(c) {
    const code = String(c || '').trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(code)) return '';
    return COUNTRY_LABELS[code] || code.toUpperCase();
  }
  function proxyDomain(action) {
    return action.dominio ?? action.domain ?? action.sito;
  }

  const REGISTRY = {
    NAVIGA: {
      // Aprire un link è di norma innocuo → livello 1, diretto. ECCEZIONE
      // anti-esfiltrazione: se l'URL trasporta FUORI dati sensibili che il
      // modello aveva nel contesto (taint-match) o ha la forma di un payload di
      // esfiltrazione da origine non fidata (fallback strutturale), sale a
      // livello 2 → conferma con l'URL mostrato. Il flag `_exfil` lo calcola il
      // main (src/main/services/handlers.js → src/shared/urlExfil.js); mai l'LLM.
      level: (a) => (a && a._exfil ? 2 : 1),
      describe: (a) => {
        const url = a.url || a.href || a.link || 'una pagina';
        if (a && a._exfil) {
          const why = a._exfilReason ? ` (${a._exfilReason})` : '';
          return `Filo sta per aprire un link che${why}:\n${url}\n\n`
            + 'Potrebbe inviare tuoi dati a un sito esterno. Apri solo se l\'hai chiesto tu.';
        }
        return `Aprire ${url}`;
      },
    },
    APRI_FILE: {
      level: 1,
      describe: (a) => `Aprire il file ${a.path || ''}`.trim(),
    },
    TIMER: {
      level: 1,
      describe: (a) => `Avviare il timer "${a.label || a.etichetta || 'Timer'}"`,
    },
    SVEGLIA: {
      level: 1,
      describe: (a) => `Impostare una sveglia ${a.time || a.orario || ''}`.trim(),
    },
    // Cancellare e spostare sveglie e timer dalla chat. Il criterio del livello
    // è QUANTE cose sparirebbero, non come la richiesta è formulata: togliere la
    // sveglia che l'utente ha appena nominato è reversibile a costo zero (la
    // richiede di nuovo) → livello 1, si fa e basta. Cancellarne PIÙ D'UNA con
    // un colpo solo no: "leva tutte le sveglie, sono in ferie" porta via anche
    // quella dell'antibiotico, e chi l'ha detto se ne accorge il giorno dopo →
    // livello 2, il popup elenca cosa sta per sparire. Il conto (`_targets`) lo
    // fa il main, che ha la lista vera; mai l'LLM. Senza il conto ripieghiamo
    // sulla forma della richiesta ("tutte" → 2), che è il caso prudente.
    CANCELLA_SVEGLIA: {
      level: (a) => (targetCount(a) > 1 || (targetCount(a) == null && wantsAll(a)) ? 2 : 1),
      describe: (a) => {
        const list = targetList(a);
        if (list.length) {
          return `Filo sta per togliere ${list.length === 1 ? 'questa voce' : `queste ${list.length} voci`}:\n`
            + list.map((t) => `• ${t}`).join('\n')
            + '\n\nUna volta tolte non suoneranno più.';
        }
        const what = timerRefLabel(a);
        return `Togliere ${what}`;
      },
    },
    MODIFICA_SVEGLIA: {
      // Spostare un orario è reversibile (basta rispostarlo) → livello 1.
      // Stesso freno della cancellazione quando il riferimento ne prende più
      // d'una: cambiare in blocco l'orario di cose che l'utente non ha in mente
      // è indistinguibile da un errore di comprensione.
      level: (a) => (targetCount(a) > 1 ? 2 : 1),
      describe: (a) => {
        const list = targetList(a);
        const when = String(a.orario ?? a.time ?? a.at ?? '').trim();
        const rip = repeatLabel(a);
        const dove = when ? ` alle ${when}` : '';
        const quando = rip ? ` (${rip})` : '';
        if (list.length > 1) {
          return `Filo sta per spostare${dove}${quando} queste ${list.length} voci:\n`
            + list.map((t) => `• ${t}`).join('\n');
        }
        return `Spostare ${timerRefLabel(a)}${dove}${quando}`;
      },
    },
    SALVA_APPUNTO: {
      level: 1,
      describe: () => 'Salvare un appunto',
    },
    INVIA_FEEDBACK: {
      // Filo invia un feedback agli sviluppatori a NOME dell'utente (#146.5).
      // Esce dall'app verso un servizio esterno (Firestore) → livello 2:
      // mostra il testo nel popup e parte solo dopo l'OK dell'utente.
      level: 2,
      describe: (a) => {
        // Il popup mostra il testo INTERO, mai una versione tagliata: è quello
        // che parte a nome dell'utente, e un consenso su un testo che non si
        // può leggere per intero non è un consenso. Se è lungo, è il popup a
        // scorrere (src/shared/confirmUi.js), non il testo ad accorciarsi.
        const testo = String(a.testo ?? a.text ?? a.messaggio ?? '').trim();
        return `Inviare questo feedback agli sviluppatori di Filo a tuo nome:\n“${testo || '(vuoto)'}”`;
      },
    },
    CERCA_WEB: {
      level: 1,
      describe: (a) => `Cercare sul web "${a.query || ''}"`,
    },
    CAPACITA_DETTAGLIO: {
      // Filo consulta il proprio manifesto delle capacità per rispondere a "puoi
      // fare X?" (#F2). Sola lettura di dati statici interni, nessun effetto
      // collaterale né uscita verso l'esterno → livello 1.
      level: 1,
      describe: (a) => {
        const ids = Array.isArray(a.ids) ? a.ids : (a.id ? [a.id] : []);
        return `Verificare cosa sa fare Filo${ids.length ? ` (${ids.join(', ')})` : ''}`;
      },
    },
    LEGGI_TRASPARENZA: {
      // Filo rilegge i propri documenti di trasparenza per rispondere a "perché
      // usi questo modello?", "che fine fanno i miei dati?". Sola lettura di
      // testo statico incluso nell'app, nessuna uscita verso l'esterno → 1.
      level: 1,
      describe: (a) => `Rileggere la pagina di trasparenza${a && a.doc ? ` (${a.doc})` : ''}`,
    },
    EVENTO_CALENDARIO: {
      level: 1,
      describe: (a) => `Creare l'evento "${a.title || a.titolo || ''}"`,
    },
    PULISCI_TAB: {
      level: 2,
      describe: () => 'Valutare le schede aperte e archiviare quelle non più utili. '
        + 'Le schede archiviate restano riapribili da “Tab archiviate”.',
    },
    CANCELLA_ARCHIVIO: {
      level: 3,
      describe: (a) => `Eliminare DEFINITIVAMENTE dall'archivio le schede pertinenti a `
        + `“${a.query || a.testo || ''}”.`,
    },
    CANCELLA_MEMORIA: {
      // Cancella tutti i moduli di memoria di Filo (PROFILO, PREFERENZE, espansioni)
      // e il buffer delle lezioni non ancora compattate. Irreversibile: il profilo
      // utente che Filo ha costruito nel tempo va perso → livello 3, digita “conferma”.
      level: 3,
      describe: () => 'Eliminare DEFINITIVAMENTE tutta la memoria di Filo: '
        + 'profilo utente, preferenze apprese e lezioni non ancora salvate. '
        + 'Filo ripartirà senza ricordare nulla di te.',
    },
    IMPOSTA_PREFERENZA: {
      // Livello per-preferenza: lo dichiara il setter in preferences.js
      // (default 1). Preferenza sconosciuta/non valida → 2 per prudenza
      // (tanto il dispatch non la eseguirà comunque).
      level: (a) => {
        const built = prefBuilt(a);
        return (built && built.level) || (built ? 1 : 2);
      },
      describe: (a) => {
        const built = prefBuilt(a);
        if (!built) return 'Modificare una preferenza';
        // Il popup di conferma spiega COSA Filo sta per fare e, per le
        // impostazioni sensibili (livello 2), anche i RISCHI (#183). Il `risk`
        // arriva dal setter in preferences.js: è obbligatorio per il livello 2.
        const base = `Filo vuole impostare: ${built.label}.`;
        return built.risk ? `${base}\n\n${built.risk}` : base;
      },
    },
    IMPOSTA_ESTETICA: {
      // Cambio di un token estetico (colore, font, raggio, opacità) su richiesta
      // in chat (#146.4). Reversibile → livello 1: si applica subito, e nella
      // bolla compare un controllo per raffinarlo. ECCEZIONE: se la modifica
      // rende il testo ~uguale allo sfondo (illeggibilità estrema) il livello
      // sale a 2 → conferma prima di applicare. Il flag `_illegible` lo calcola
      // il main process (ha i token correnti); mai l'LLM.
      level: (a) => (a && a._illegible ? 2 : 1),
      describe: (a) => {
        const T = global.SN_THEME_TOKENS;
        const t = T && T.get(estTok(a));
        const label = (t && t.label) || estTok(a) || 'un elemento';
        const val = estVal(a);
        if (a && a._illegible) {
          return `Cambiare “${label}” a ${val || 'questo valore'} renderebbe il testo `
            + `quasi illeggibile (colore troppo vicino allo sfondo). Applico comunque?`;
        }
        return `Cambiare “${label}”${val ? ` a ${val}` : ''}`;
      },
    },
    ESEGUI_COMANDO: {
      // Filo lancia un comando nel terminale (#146.6). Il livello NON è fisso:
      // dipende dal comando EFFETTIVO, classificato dal main (mai dall'LLM) in
      // src/shared/cmdClassify.js. 1 = sola lettura (esegue subito); 2 =
      // modifica recuperabile (popup); 3 = cancellazioni, comandi pericolosi e
      // qualsiasi comando non riconosciuto (digita "conferma"). Una sequenza di
      // comandi (`&&`/`||`/`;`) prende il livello massimo dei suoi pezzi.
      // Comando assente o classificatore non caricato → 3 per massima cautela.
      level: (a) => {
        const C = global.SN_CMD_CLASSIFY;
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim();
        if (!cmd || !C) return 3;
        const lvl = C.classify(cmd);
        return lvl === 1 || lvl === 2 || lvl === 3 ? lvl : 3;
      },
      describe: (a) => {
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim();
        return `Eseguire nel terminale:\n${cmd || '(comando vuoto)'}`;
      },
    },
    // ── proxy per-tab via linguaggio naturale (#152) ──────────────────────────
    // Tutte livello 1: instradare una scheda da un altro paese (o salvare una
    // regola per dominio) è completamente reversibile — "torna in Italia" /
    // "togli la regola" annullano. La separazione del cookie jar è inerente al
    // proxy e l'utente l'ha chiesta esplicitamente; il flusso AUTOMATICO da
    // geo-block (che invece propone quando ci sono login attivi) vive altrove.
    PROXY_TAB: {
      level: 1,
      describe: (a) => `Aprire questa scheda da ${countryLabel(proxyCountry(a)) || 'un altro paese'}`,
    },
    RIMUOVI_PROXY: {
      level: 1,
      describe: () => 'Riportare questa scheda alla connessione diretta (Italia)',
    },
    RIMUOVI_PROXY_TUTTE: {
      level: 1,
      describe: () => 'Riportare tutte le schede instradate da un altro paese alla connessione diretta',
    },
    REGOLA_PROXY_DOMINIO: {
      level: 1,
      describe: (a) => `Aprire sempre ${proxyDomain(a) || 'questo sito'} da ${countryLabel(proxyCountry(a)) || 'un altro paese'}`,
    },
    RIMUOVI_REGOLA_PROXY: {
      level: 1,
      describe: (a) => `Togliere la regola "apri sempre da un altro paese" per ${proxyDomain(a) || 'questo sito'}`,
    },
    // ── comandi della finestra / barra di Filo via chat (#419) ────────────────
    // L'agente della home aziona i controlli del browser stesso (schermo intero,
    // riduci a icona, menu Impostazioni/App/Account, home) — la stessa cosa che
    // sa già fare l'assistente di pagina. Tutti livello 1: azionare un controllo
    // della finestra è benigno e completamente reversibile (uno schermo intero si
    // toglie, un menu si richiude). "close" è ESCLUSO di proposito: l'AI non
    // chiude finestra né schede.
    COMANDO_FINESTRA: {
      level: 1,
      describe: (a) => {
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim().toLowerCase();
        const labels = {
          fullscreen: 'Mettere o togliere lo schermo intero',
          minimize: 'Ridurre a icona la finestra di Filo',
          home: 'Aprire la home di Filo',
          settings: 'Aprire il menu Impostazioni',
          apps: 'Aprire il menu App',
          account: 'Aprire il menu Account',
        };
        return labels[cmd] || 'Azionare un comando della finestra di Filo';
      },
    },
    // ── estetica del CONTENUTO della pagina via chat (#185) ───────────────────
    // Filo cambia l'aspetto del testo della pagina che l'utente sta guardando
    // ("scrivi in grassetto tutti i titoli"). Livello 1: si applica subito, vale
    // SOLO per quella pagina (CSS iniettato live) ed è completamente reversibile
    // (basta ricaricare la pagina, o "togli le modifiche" → RIPRISTINA_STILE_PAGINA).
    // Il CSS prodotto dall'LLM viene SANIFICATO dal main (src/shared/pageRestyle.js)
    // prima dell'iniezione: niente at-rule, url(), graffe o markup.
    STILE_PAGINA: {
      level: 1,
      describe: (a) => {
        const d = a && (a.descrizione ?? a.description);
        if (d) return `Cambiare l'aspetto della pagina: ${String(d).trim()}`;
        return 'Cambiare l\'aspetto del testo della pagina';
      },
    },
    RIPRISTINA_STILE_PAGINA: {
      level: 1,
      describe: () => 'Togliere le modifiche di stile applicate alla pagina',
    },
  };

  // Livello dell'azione: 1|2|3, oppure null se l'azione NON è registrata
  // (→ il dispatch deve rifiutarla).
  function levelFor(action) {
    if (!action || typeof action !== 'object') return null;
    const entry = REGISTRY[String(action.type || '').toUpperCase()];
    if (!entry) return null;
    const lvl = typeof entry.level === 'function' ? entry.level(action) : entry.level;
    return lvl === 1 || lvl === 2 || lvl === 3 ? lvl : null;
  }

  // Spiegazione in chiaro di cosa Filo sta tentando, per il popup di conferma.
  function describe(action) {
    if (!action || typeof action !== 'object') return '';
    const entry = REGISTRY[String(action.type || '').toUpperCase()];
    if (!entry) return '';
    try { return entry.describe(action) || ''; } catch (_) { return ''; }
  }

  global.SN_ACTION_LEVELS = { REGISTRY, levelFor, describe };
})(typeof globalThis !== 'undefined' ? globalThis : self);
