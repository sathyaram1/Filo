// Registro azione→livello (#146.2), statico: il livello non lo decide mai l'LLM a runtime.
// 1 si esegue subito, 2 popup che spiega, 3 l'utente digita «conferma».
// Il dispatch RIFIUTA un'azione non registrata: ogni nuovo potere dichiara qui il livello.

(function (global) {
  'use strict';

  function prefBuilt(action) {
    const P = global.SN_PREF;
    if (!P) return null;
    const chiave = action.chiave ?? action.key ?? action.nome ?? action.name ?? action.preferenza;
    const valore = action.valore ?? action.value ?? action.valoreNuovo ?? action.val;
    return P.buildPreferencePartial(chiave, valore);
  }

  // Token e valore di un'azione estetica, con i sinonimi che un LLM può produrre.
  function estTok(action) {
    return action.token ?? action.nome ?? action.name ?? action.chiave ?? action.elemento;
  }
  function estVal(action) {
    return action.valore ?? action.value ?? action.val ?? action.colore;
  }

  // Le location curate combaciano con ProxyTab.LOCATIONS; ogni altro alpha-2 valido ripiega
  // sul codice maiuscolo: a voce si può chiedere un paese fuori dalla lista.
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

  // `_targets` è ciò che l'azione colpirebbe DAVVERO: lo calcola il main sulla lista vera,
  // mai l'LLM. Quando manca i conti tornano null e vale la forma della richiesta.
  function targetList(action) {
    return Array.isArray(action && action._targets) ? action._targets : [];
  }
  function targetCount(action) {
    return Array.isArray(action && action._targets) ? action._targets.length : null;
  }
  function wantsAll(action) {
    const v = action && (action.tutte ?? action.tutti ?? action.all);
    if (v === true) return true;
    return /^(true|1|si|sì|yes|tutte|tutti)$/i.test(String(v ?? ''));
  }
  function timerRefLabel(action) {
    const kind = String((action && (action.tipo ?? action.kind)) || '').toLowerCase();
    const cosa = /timer/.test(kind) ? 'i timer' : (/svegli|alarm/.test(kind) ? 'le sveglie' : 'sveglie e timer');
    const etichetta = String((action && (action.etichetta ?? action.label ?? action.nome)) || '').trim();
    if (wantsAll(action) && !etichetta) return `TUTTI ${cosa}`;
    if (etichetta) return `“${etichetta}”`;
    return cosa;
  }
  function repeatLabel(action) {
    const M = global.SN_FILO_MEMORY;
    const raw = action && (action.ripeti ?? action.repeat ?? action.giorni);
    if (!raw || !M || !M.formatRepeat) return '';
    return M.formatRepeat(raw);
  }

  const REGISTRY = {
    NAVIGA: {
      // Aprire un link è di norma innocuo → 1. Eccezione anti-esfiltrazione: se l'URL porta fuori
      // dati sensibili sale a 2 e la conferma lo mostra. `_exfil` lo calcola il main, mai l'LLM.
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
      describe: (a) => `Aprire il file ${a.percorso || a.path || ''}`.trim(),
    },
    TIMER: {
      level: 1,
      describe: (a) => `Avviare il timer "${a.label || a.etichetta || 'Timer'}"`,
    },
    SVEGLIA: {
      level: 1,
      describe: (a) => `Impostare una sveglia ${a.time || a.orario || ''}`.trim(),
    },
    // Conta QUANTE cose sparirebbero, non come è formulata la richiesta: una sola è reversibile
    // → 1; «leva tutte le sveglie» porta via anche quella dell'antibiotico → 2, col popup.
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
      // Spostare un orario è reversibile → 1, con lo stesso freno della cancellazione quando il
      // riferimento ne prende più d'una: un cambio in blocco somiglia a un fraintendimento.
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
    SALVA_LEZIONE: {
      // Una LEZIONE entra nello stesso buffer che l'agente riempie da solo → 1: stesso canale,
      // stessa fiducia; e un popup confermerebbe proprio chi la lezione vuole tenere fuori.
      level: 1,
      describe: (a) => {
        const testo = String(a?.testo ?? a?.text ?? a?.lezione ?? '').trim();
        return `Fissare una lezione nella memoria di Filo:\n“${testo || '(vuota)'}”`;
      },
    },
    INVIA_FEEDBACK: {
      // Un feedback esce dall'app a NOME dell'utente (#146.5) → livello 2: il testo va nel popup
      // e parte solo dopo l'OK.
      level: 2,
      describe: (a) => {
        // Il popup mostra il testo INTERO, mai tagliato: un consenso su un testo che non si può
        // leggere per intero non è un consenso. Se è lungo scorre il popup.
        const testo = String(a.testo ?? a.text ?? a.messaggio ?? '').trim();
        return `Inviare questo feedback agli sviluppatori di Filo a tuo nome:\n“${testo || '(vuoto)'}”`;
      },
    },
    CERCA_WEB: {
      level: 1,
      describe: (a) => `Cercare sul web "${a.query || ''}"`,
    },
    ONBOARDING: {
      // Tiene il conto della micro-intervista di benvenuto (#524): non tocca nulla dell'utente e
      // non ha niente da annullare — dalle Preferenze si rilancia. Livello 1.
      level: 1,
      describe: (a) => {
        if (a && (a.fine ?? a.chiudi ?? a.done)) return 'Chiudere l’intervista di benvenuto';
        const ids = Array.isArray(a?.spunta) ? a.spunta : [];
        return `Segnare come fatto nell’intervista di benvenuto${ids.length ? `: ${ids.join(', ')}` : ''}`;
      },
    },
    CAPACITA_DETTAGLIO: {
      // Sola lettura del manifesto delle capacità, dati statici interni, nessuna uscita → 1.
      level: 1,
      describe: (a) => {
        const ids = Array.isArray(a.ids) ? a.ids : (a.id ? [a.id] : []);
        return `Verificare cosa sa fare Filo${ids.length ? ` (${ids.join(', ')})` : ''}`;
      },
    },
    LEGGI_FILE: {
      // Apre per intero un file dell'editor di cui il contesto ha solo il riassunto (#379.5):
      // sola lettura → 1. Senza una voce qui il dispatch rifiuta e la lettura non parte mai.
      level: 1,
      describe: (a) => {
        const id = a && (a.fileId ?? a.id ?? a.file);
        return `Leggere per intero un documento dell'editor${id ? ` (${id})` : ''}`;
      },
    },
    LEGGI_DOCUMENTO: {
      // Legge un documento dal disco su richiesta dell'utente: non modifica, non esegue, non manda
      // niente fuori → 1. Una conferma che si accetta sempre smette di essere un controllo.
      level: 1,
      describe: (a) => {
        const p = a && (a.percorso ?? a.path ?? a.file ?? a.documento);
        return `Leggere il documento ${p || ''}`.trim();
      },
    },
    LEGGI_TRASPARENZA: {
      // Documenti di trasparenza inclusi nell'app: testo statico, nessuna uscita → 1.
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
      // Cancella tutti i moduli di memoria e il buffer delle lezioni: il profilo costruito nel
      // tempo va perso ed è irreversibile → livello 3.
      level: 3,
      describe: () => 'Eliminare DEFINITIVAMENTE tutta la memoria di Filo: '
        + 'profilo utente, preferenze apprese e lezioni non ancora salvate. '
        + 'Filo ripartirà senza ricordare nulla di te.',
    },
    IMPOSTA_PREFERENZA: {
      // Il livello lo dichiara il setter in preferences.js (default 1). Preferenza sconosciuta o
      // non valida → 2 per prudenza, tanto il dispatch non la eseguirà.
      level: (a) => {
        const built = prefBuilt(a);
        return (built && built.level) || (built ? 1 : 2);
      },
      describe: (a) => {
        const built = prefBuilt(a);
        if (!built) return 'Modificare una preferenza';
        // Il popup spiega COSA Filo sta per fare e, per le impostazioni sensibili di livello 2,
        // anche i RISCHI (#183): `risk` arriva dal setter ed è obbligatorio per il livello 2.
        const base = `Filo vuole impostare: ${built.label}.`;
        return built.risk ? `${base}\n\n${built.risk}` : base;
      },
      // A cosa fatta (esito allo strumento): niente «vuole», niente rischi.
      describeDone: (a) => {
        const built = prefBuilt(a);
        return built ? `Impostazione applicata: ${built.label}` : 'Preferenza modificata';
      },
    },
    IMPOSTA_ESTETICA: {
      // Cambio di un token estetico (#146.4): reversibile → 1, si applica subito.
      // Eccezione: se rende il testo quasi uguale allo sfondo sale a 2 (`_illegible`, dal main).
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
      // Il livello dipende dal comando EFFETTIVO, classificato dal main in cmdClassify.js, mai
      // dall'LLM. Una sequenza prende il massimo dei pezzi; senza comando o classificatore → 3.
      level: (a) => {
        const C = global.SN_CMD_CLASSIFY;
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim();
        if (!cmd || !C) return 3;
        const lvl = C.classify(cmd);
        return lvl === 1 || lvl === 2 || lvl === 3 ? lvl : 3;
      },
      describe: (a) => {
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim();
        // DOVE il comando agisce non si legge nel comando: la cartella di lavoro è persistente e la sposta l'assistente da sé (`cd` è livello 1). `wget http://x/authorized_keys` ha lo stesso testo nella home, dove è innocuo, e dentro ~/.ssh, dove sovrascrive una chiave. La cartella la inietta il main come `_cwd`.
        const cwd = String((a && a._cwd) || '').trim();
        return `Eseguire nel terminale:\n${cmd || '(comando vuoto)'}`
          + (cwd ? `\nCartella di lavoro: ${cwd}` : '');
      },
    },
    // Proxy per-tab (#152), tutte livello 1: instradare una scheda da un altro paese o salvare
    // una regola per dominio è reversibile, e il jar separato è inerente al proxy chiesto.
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
    // Comandi della finestra e della barra via chat (#419): livello 1, azionare un controllo è
    // benigno e reversibile. «close» è ESCLUSO: l'AI non chiude né finestra né schede.
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
    // Estetica del CONTENUTO della pagina (#185) → 1: vale solo per quella pagina ed è
    // reversibile ricaricando. Il CSS dell'LLM lo sanifica il main (pageRestyle.js).
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

  // 1|2|3, oppure null se l'azione NON è registrata: allora il dispatch deve rifiutarla.
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

  // A fatto compiuto, per l'esito che torna al modello; senza voce propria vale `describe`.
  function describeDone(action) {
    if (!action || typeof action !== 'object') return '';
    const entry = REGISTRY[String(action.type || '').toUpperCase()];
    if (!entry) return '';
    try { return (entry.describeDone ? entry.describeDone(action) : entry.describe(action)) || ''; } catch (_) { return ''; }
  }

  global.SN_ACTION_LEVELS = { REGISTRY, levelFor, describe, describeDone };
})(typeof globalThis !== 'undefined' ? globalThis : self);
