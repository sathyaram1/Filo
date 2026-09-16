// Registro azione→livello di sicurezza (#146.2). Il livello è assegnato STATICAMENTE qui, mai deciso dall'LLM a runtime: 1 reversibile, si esegue subito; 2 reversibile con inconvenienti, popup che spiega modifica e rischi (SN_CONFIRM_UI.confirm), aperto da solo sulle risposte fresche (#183) e uno alla volta se ce n'è più d'uno; 3 irreversibile, l'utente digita «conferma» (confirmTyped).
// Il dispatch (executeFiloAction) RIFIUTA le azioni non registrate: ogni nuovo potere di Filo deve dichiarare qui il proprio livello, altrimenti non viene eseguito.
// Per IMPOSTA_PREFERENZA il livello dipende dalla preferenza (il `level` del setter in preferences.js, default 1): cambiare tema è innocuo, accendere la modalità terminale dà a Filo la shell.

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

  // Le location curate combaciano con ProxyTab.LOCATIONS; per ogni altro alpha-2 valido si ripiega sul codice maiuscolo, perché il linguaggio naturale può chiedere paesi fuori dalla lista.
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

  // `_targets` è l'elenco di ciò che l'azione colpirebbe DAVVERO: lo calcola il main leggendo la lista, mai l'LLM. Quando manca (registro consultato fuori dal main) i conti tornano null e si ripiega sulla forma della richiesta.
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
      // Aprire un link è di norma innocuo → livello 1. ECCEZIONE anti-esfiltrazione: se l'URL porta fuori dati sensibili che il modello aveva in contesto (taint-match), o ha la forma di un payload da origine non fidata, sale a 2 e la conferma mostra l'URL.
      // Il flag `_exfil` lo calcola il main (urlExfil.js); mai l'LLM.
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
    // Il livello dipende da QUANTE cose sparirebbero, non da come è formulata la richiesta: togliere la sveglia appena nominata è reversibile a costo zero (la si richiede) → 1.
    // Cancellarne più d'una in un colpo no: «leva tutte le sveglie, sono in ferie» porta via anche quella dell'antibiotico, e chi l'ha detto se ne accorge il giorno dopo → 2, col popup che elenca cosa sparisce.
    // Il conto (`_targets`) lo fa il main, che ha la lista vera; senza, si ripiega sulla forma della richiesta («tutte» → 2), il caso prudente.
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
      // Spostare un orario è reversibile → 1, con lo stesso freno della cancellazione quando il riferimento ne prende più d'una: cambiare in blocco cose che l'utente non ha in mente è indistinguibile da un errore di comprensione.
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
      // Filo fissa una LEZIONE nella propria memoria, su richiesta o di sua iniziativa quando una regola va fissata subito (es. proteggere i dati dell'utente da una richiesta sospetta): entra nello stesso buffer che l'agente-lezioni riempie da solo e vale da subito ovunque.
      // Livello 1 per la stessa ragione per cui le lezioni automatiche non chiedono conferma: stesso canale, stesso grado di fiducia, e restano visibili e cancellabili fra le memorie. Un popup sarebbe anche controproducente nel caso della protezione: confermerebbe chiunque sia alla tastiera, cioè proprio chi la lezione vuole tenere fuori.
      level: 1,
      describe: (a) => {
        const testo = String(a?.testo ?? a?.text ?? a?.lezione ?? '').trim();
        return `Fissare una lezione nella memoria di Filo:\n“${testo || '(vuota)'}”`;
      },
    },
    INVIA_FEEDBACK: {
      // Un feedback esce dall'app verso un servizio esterno a NOME dell'utente (#146.5) → livello 2: il testo va nel popup e parte solo dopo l'OK.
      level: 2,
      describe: (a) => {
        // Il popup mostra il testo INTERO, mai tagliato: è quello che parte a nome dell'utente, e un consenso su un testo che non si può leggere per intero non è un consenso. Se è lungo scorre il popup, non si accorcia il testo.
        const testo = String(a.testo ?? a.text ?? a.messaggio ?? '').trim();
        return `Inviare questo feedback agli sviluppatori di Filo a tuo nome:\n“${testo || '(vuoto)'}”`;
      },
    },
    CERCA_WEB: {
      level: 1,
      describe: (a) => `Cercare sul web "${a.query || ''}"`,
    },
    ONBOARDING: {
      // Filo tiene il conto della micro-intervista di benvenuto (#524). Non tocca nulla dell'utente — le impostazioni che l'intervista applica passano dalle LORO azioni, ognuna col proprio livello — e non ha niente da annullare: chiudere l'accoglienza è ciò che l'utente vuole quando dice «basta così», e dalle Preferenze si rilancia. Livello 1.
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
      // Apre per intero un file dell'EDITOR di cui il contesto ha solo il riassunto (#379.5): sola lettura, nessuna scrittura, nessuna uscita → 1. Senza una voce qui il dispatch rifiuta l'azione e la lettura on-demand non parte mai.
      level: 1,
      describe: (a) => {
        const id = a && (a.fileId ?? a.id ?? a.file);
        return `Leggere per intero un documento dell'editor${id ? ` (${id})` : ''}`;
      },
    },
    LEGGI_DOCUMENTO: {
      // Legge un documento dal DISCO (un PDF, un file di testo) perché l'utente gliel'ha chiesto. Livello 1 per le stesse ragioni di un comando di sola lettura nel terminale: non modifica, non esegue, non manda niente fuori dal computer — il testo entra solo nel contesto.
      // Una conferma a ogni documento sarebbe attrito su una cosa appena chiesta, e una conferma che si accetta sempre smette di essere un controllo.
      level: 1,
      describe: (a) => {
        const p = a && (a.percorso ?? a.path ?? a.file ?? a.documento);
        return `Leggere il documento ${p || ''}`.trim();
      },
    },
    LEGGI_TRASPARENZA: {
      // Rilettura dei documenti di trasparenza inclusi nell'app: testo statico, nessuna uscita → 1.
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
      // Cancella tutti i moduli di memoria e il buffer delle lezioni non ancora compattate: il profilo che Filo ha costruito nel tempo va perso, ed è irreversibile → livello 3.
      level: 3,
      describe: () => 'Eliminare DEFINITIVAMENTE tutta la memoria di Filo: '
        + 'profilo utente, preferenze apprese e lezioni non ancora salvate. '
        + 'Filo ripartirà senza ricordare nulla di te.',
    },
    IMPOSTA_PREFERENZA: {
      // Livello per-preferenza dichiarato dal setter in preferences.js (default 1). Preferenza sconosciuta o non valida → 2 per prudenza, tanto il dispatch non la eseguirà.
      level: (a) => {
        const built = prefBuilt(a);
        return (built && built.level) || (built ? 1 : 2);
      },
      describe: (a) => {
        const built = prefBuilt(a);
        if (!built) return 'Modificare una preferenza';
        // Il popup spiega COSA Filo sta per fare e, per le impostazioni sensibili di livello 2, anche i RISCHI (#183). Il `risk` arriva dal setter in preferences.js ed è obbligatorio per il livello 2.
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
      // Cambio di un token estetico su richiesta in chat (#146.4). Reversibile → 1: si applica subito e nella bolla compare un controllo per raffinarlo.
      // ECCEZIONE: se la modifica rende il testo quasi uguale allo sfondo, il livello sale a 2 e si conferma prima di applicare. Il flag `_illegible` lo calcola il main, che ha i token correnti; mai l'LLM.
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
      // Comando nel terminale (#146.6). Il livello NON è fisso: dipende dal comando EFFETTIVO, classificato dal main (mai dall'LLM) in cmdClassify.js — 1 sola lettura, 2 modifica recuperabile, 3 cancellazioni, comandi pericolosi e qualunque comando non riconosciuto.
      // Una sequenza (`&&`/`||`/`;`) prende il livello massimo dei suoi pezzi. Comando assente o classificatore non caricato → 3, massima cautela.
      level: (a) => {
        const C = global.SN_CMD_CLASSIFY;
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim();
        if (!cmd || !C) return 3;
        const lvl = C.classify(cmd);
        return lvl === 1 || lvl === 2 || lvl === 3 ? lvl : 3;
      },
      describe: (a) => {
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim();
        // DOVE il comando agisce non si legge nel comando: la cartella di lavoro è persistente e la sposta l'assistente da sé (`cd` è livello 1). Senza dirlo, `wget http://x/authorized_keys` ha lo stesso identico testo nella home, dove è innocuo, e dentro ~/.ssh, dove sovrascrive una chiave.
        // La cartella la inietta il main come `_cwd`, mai l'LLM.
        const cwd = String((a && a._cwd) || '').trim();
        return `Eseguire nel terminale:\n${cmd || '(comando vuoto)'}`
          + (cwd ? `\nCartella di lavoro: ${cwd}` : '');
      },
    },
    // Proxy per-tab via linguaggio naturale (#152), tutte livello 1: instradare una scheda da un altro paese o salvare una regola per dominio è completamente reversibile.
    // La separazione del cookie jar è inerente al proxy e l'utente l'ha chiesta; il flusso AUTOMATICO da geo-block, che invece propone quando ci sono login attivi, vive altrove.
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
    // Comandi della finestra e della barra di Filo via chat (#419): schermo intero, riduci a icona, menu, home — la stessa cosa che sa già fare l'assistente di pagina. Tutti livello 1: azionare un controllo della finestra è benigno e reversibile.
    // «close» è ESCLUSO di proposito: l'AI non chiude né finestra né schede.
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
    // Estetica del CONTENUTO della pagina via chat (#185): livello 1 perché vale SOLO per quella pagina (CSS iniettato live) ed è reversibile ricaricando o con RIPRISTINA_STILE_PAGINA.
    // Il CSS prodotto dall'LLM è SANIFICATO dal main (pageRestyle.js) prima dell'iniezione: niente at-rule, url(), graffe o markup.
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

  // La stessa cosa a fatto compiuto, per l'esito che torna al modello; dove il registro non distingue vale `describe`.
  function describeDone(action) {
    if (!action || typeof action !== 'object') return '';
    const entry = REGISTRY[String(action.type || '').toUpperCase()];
    if (!entry) return '';
    try { return (entry.describeDone ? entry.describeDone(action) : entry.describe(action)) || ''; } catch (_) { return ''; }
  }

  global.SN_ACTION_LEVELS = { REGISTRY, levelFor, describe, describeDone };
})(typeof globalThis !== 'undefined' ? globalThis : self);
