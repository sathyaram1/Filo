// Registro delle azioni di Filo: per ognuna il COSTO di sbagliarla (0-3) e il CAMPO, statici, mai decisi dall'LLM.
// Non decide se un'azione parte: gli ingressi li legge il dispatch e la risposta la dà SN_AUTONOMIA (#530).
// Un'azione fuori registro o senza costo non parte: sentinella in tests/unit/autonomia.test.mjs.

(function (global) {
  'use strict';

  function lezione(a) {
    const P = global.SN_PREF;
    if (P && P.lezioneDaAzione) return P.lezioneDaAzione(a);
    return { testo: String((a && (a.testo ?? a.text ?? a.lezione)) ?? '').trim() };
  }
  const RISCHIO_LEZIONE = 'Da adesso vale in ogni conversazione, e resta finché non la togli dalle Preferenze, '
    + 'sotto «Memoria di Filo». Confermala solo se l\'hai detta tu: un testo letto in una pagina o in un '
    + 'documento potrebbe provare a fargliela ricordare.';

  // Un comando che scarica dal web porta nel compito testo di autore ignoto, non un file del computer.
  const SCARICA = /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|http|https|aria2c|lynx|w3m)\b|https?:\/\//i;

  function prefBuilt(action, attuali) {
    const P = global.SN_PREF;
    if (!P) return null;
    const chiave = action.chiave ?? action.key ?? action.nome ?? action.name ?? action.preferenza;
    const valore = action.valore ?? action.value ?? action.valoreNuovo ?? action.val;
    return P.buildPreferencePartial(chiave, valore, { attuali: attuali || null });
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

  // ── sveglie e timer: da cosa dipende il costo ────────────────────────────
  // `_targets` è l'elenco (già leggibile) di ciò che l'azione colpirebbe
  // DAVVERO: lo calcola il main leggendo la lista, mai l'LLM. Quando manca
  // (registro consultato fuori dal main) i conti tornano null e si ripiega
  // sulla forma della richiesta.
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

  // Perché LEGGI_DOCUMENTO esce dal perimetro di lettura ('' se ci sta). Senza
  // classificatore non si sa: si chiede.
  function documentoFuori(a) {
    const C = global.SN_CMD_CLASSIFY;
    if (!C || !C.fuoriPerimetro) return 'non si sa dove legge';
    const p = a && (a.percorso ?? a.path ?? a.file ?? a.documento ?? a.nome);
    return C.fuoriPerimetro(p, a && a._perimetro);
  }

  const REGISTRY = {
    NAVIGA: {
      // Aprire un link è di norma innocuo → costo 1, diretto. ECCEZIONE
      // anti-esfiltrazione: se l'URL trasporta FUORI dati sensibili che il
      // modello aveva nel contesto (taint-match) o ha la forma di un payload di
      // esfiltrazione da origine non fidata (fallback strutturale), sale a
      // costo 2, e dove la risposta è chiedere il popup mostra l'URL. Il flag `_exfil` lo calcola il
      // main (src/main/services/handlers.js → src/shared/urlExfil.js); mai l'LLM.
      costo: (a) => (a && a._exfil ? 2 : 1),
      campo: 'web',
      uscita: (a) => String((a && (a.url ?? a.href ?? a.link)) || ''),
      describe: (a) => {
        const url = a.url || a.href || a.link || 'una pagina';
        if (a && a._exfil) {
          const why = a._exfilReason ? ` che ${a._exfilReason}` : '';
          return `Aprire un link${why}:\n${url}\n\n`
            + 'Potrebbe inviare tuoi dati a un sito esterno. Apri solo se l\'hai chiesto tu.';
        }
        return `Aprire ${url}`;
      },
    },
    APRI_FILE: {
      costo: 1,
      campo: 'file',
      describe: (a) => `Aprire il file ${a.percorso || a.path || ''}`.trim(),
    },
    TIMER: {
      costo: 1,
      campo: null,
      describe: (a) => `Avviare il timer "${a.label || a.etichetta || 'Timer'}"`,
    },
    SVEGLIA: {
      costo: 1,
      campo: null,
      describe: (a) => `Impostare una sveglia ${a.time || a.orario || ''}`.trim(),
    },
    // Cancellare e spostare sveglie e timer dalla chat. Il criterio del costo
    // è QUANTE cose sparirebbero, non come la richiesta è formulata: togliere la
    // sveglia che l'utente ha appena nominato è reversibile a costo zero (la
    // richiede di nuovo) → costo 1, si fa e basta. Cancellarne PIÙ D'UNA con
    // un colpo solo no: "leva tutte le sveglie, sono in ferie" porta via anche
    // quella dell'antibiotico, e chi l'ha detto se ne accorge il giorno dopo →
    // costo 2, e quando si chiede il popup elenca cosa sta per sparire. Il conto (`_targets`) lo
    // fa il main, che ha la lista vera; mai l'LLM. Senza il conto ripieghiamo
    // sulla forma della richiesta ("tutte" → 2), che è il caso prudente.
    CANCELLA_SVEGLIA: {
      costo: (a) => (targetCount(a) > 1 || (targetCount(a) == null && wantsAll(a)) ? 2 : 1),
      campo: null,
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
      // Spostare un orario è reversibile (basta rispostarlo) → costo 1.
      // Stesso freno della cancellazione quando il riferimento ne prende più
      // d'una: cambiare in blocco l'orario di cose che l'utente non ha in mente
      // è indistinguibile da un errore di comprensione.
      costo: (a) => (targetCount(a) > 1 ? 2 : 1),
      campo: null,
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
      costo: 1,
      campo: 'file',
      describe: () => 'Salvare un appunto',
    },
    SALVA_LEZIONE: {
      // Una lezione entra in ogni conversazione e ci resta, come lo stile: se la
      // propone il modello, l'utente ne conferma il testo esatto (#592). Vuota
      // o oltre il tetto → 1: niente da confermare, il dispatch la respinge.
      costo: (a) => { const l = lezione(a); return l.testo && !l.rifiuto ? 2 : 1; },
      campo: null,
      describe: (a) => {
        const l = lezione(a);
        if (!l.testo || l.rifiuto) return 'Ricordare una cosa';
        return `Filo vuole ricordare una cosa.\n\nTesto esatto:\n«${l.testo}»\n\n${RISCHIO_LEZIONE}`;
      },
      describeDone: (a) => `Ricordato: «${lezione(a).testo}»`,
    },
    INVIA_FEEDBACK: {
      // Filo invia un feedback agli sviluppatori a NOME dell'utente (#146.5).
      // Esce dall'app verso un destinatario scelto (Firestore) → costo 2;
      // quando si chiede, il popup mostra il testo che partirebbe.
      costo: 2,
      campo: null,
      uscita: (a) => [a.titolo ?? a.title ?? '', a.testo ?? a.text ?? a.messaggio ?? ''].join('\n'),
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
      // Cercare è leggere, e il risultato resta in chat → costo 0. ECCEZIONE anti-esfiltrazione: se
      // la query trasporta FUORI un segreto (memoria, o ciò che il modello ha
      // letto nel turno) sale a costo 2, e il popup mostra la query. Il
      // flag `_exfil` lo calcola il main (→ urlExfil.js); mai l'LLM.
      costo: (a) => (a && a._exfil ? 2 : 0),
      campo: 'web',
      uscita: (a) => String((a && (a.query ?? a.q ?? a.testo ?? a.text)) || ''),
      fonte: (a, out) => (Array.isArray(out.results) && out.results.length
        ? { classe: 5, campo: 'web', chiave: 'web:ricerca', motivo: 'ho fatto una ricerca sul web' } : null),
      describe: (a) => {
        const q = a.query || a.q || a.testo || a.text || '';
        if (a && a._exfil) {
          const why = a._exfilReason ? ` che ${a._exfilReason}` : '';
          return `Cercare sul web un testo${why}:\n"${q}"\n\n`
            + 'Potrebbe inviare tuoi dati a un motore di ricerca. Cerca solo se l\'hai chiesto tu.';
        }
        return `Cercare sul web "${q}"`;
      },
    },
    ONBOARDING: {
      // Filo tiene il conto della micro-intervista di benvenuto (#524): spunta
      // le cose che ha scoperto o detto e dichiara quando l'intervista è
      // finita. Non tocca nulla dell'utente — le impostazioni che l'intervista
      // applica passano dalle LORO azioni (IMPOSTA_PREFERENZA, SALVA_LEZIONE),
      // ognuna col proprio costo — e non ha nulla da annullare: chiudere
      // l'accoglienza è quello che l'utente vuole appena dice "basta così", e
      // dalle Preferenze la si rilancia quando vuole. Costo 1.
      costo: 1,
      campo: null,
      describe: (a) => {
        if (a && (a.fine ?? a.chiudi ?? a.done)) return 'Chiudere l’intervista di benvenuto';
        const ids = Array.isArray(a?.spunta) ? a.spunta : [];
        return `Segnare come fatto nell’intervista di benvenuto${ids.length ? `: ${ids.join(', ')}` : ''}`;
      },
    },
    CAPACITA_DETTAGLIO: {
      // Filo consulta il proprio manifesto delle capacità per rispondere a "puoi
      // fare X?" (#F2). Sola lettura di dati statici interni, nessun effetto
      // collaterale né uscita verso l'esterno: resta in chat → costo 0.
      costo: 0,
      campo: null,
      describe: (a) => {
        const ids = Array.isArray(a.ids) ? a.ids : (a.id ? [a.id] : []);
        return `Verificare cosa sa fare Filo${ids.length ? ` (${ids.join(', ')})` : ''}`;
      },
    },
    CERCA_CHAT: {
      // #525 — Filo rilegge le conversazioni passate con lo stesso utente per
      // riprendere un discorso di ieri. Sola lettura di dati che sono già
      // dell'utente e che sono già passati da questo contesto (le ha scritte
      // lui, con Filo): niente scritture, niente cancellazioni, niente che
      // esca dal computer → costo 0, come LEGGI_FILE. Sono di classe 1: non sporcano il compito.
      costo: 0,
      campo: null,
      describe: (a) => {
        const q = String((a && (a.query ?? a.testo)) || '').trim();
        if (a && a.id && !q) return 'Rileggere una conversazione passata';
        return `Cercare fra le conversazioni passate${q ? ` ("${q}")` : ''}`;
      },
    },
    LEGGI_FILE: {
      // Filo apre per intero un file dell'EDITOR di cui vede solo il riassunto
      // (#379.5). Sola lettura di dati che sono già in parte nel contesto (i
      // riassunti ci stanno sempre), nessuna scrittura e nessuna uscita → costo 0.
      // Mancava dal registro: senza una voce qui il dispatch rifiuta l'azione,
      // quindi la lettura on-demand dei documenti dell'editor non partiva mai.
      costo: 0,
      campo: 'file',
      fonte: (a, out) => (out.text ? { classe: 2, campo: 'file', chiave: `editor:${a.fileId ?? a.id ?? ''}`, motivo: 'ho letto un file dell\'editor' } : null),
      describe: (a) => {
        const id = a && (a.fileId ?? a.id ?? a.file);
        return `Leggere per intero un documento dell'editor${id ? ` (${id})` : ''}`;
      },
    },
    LEGGI_DOCUMENTO: {
      // Filo legge un documento dal DISCO dell'utente — un PDF (bolletta,
      // estratto conto, contratto) o un file di testo — perché l'utente gli ha
      // chiesto di leggerlo. Costo 0: leggere è sempre libero, non modifica niente, non
      // esegue niente, non manda niente fuori dal computer — il testo entra solo
      // nel contesto del modello. Una conferma a ogni documento sarebbe attrito
      // su una cosa che l'utente ha appena chiesto, e una conferma che si accetta
      // sempre smette di essere un controllo. Fuori dal perimetro di lettura
      // (#587: altri dischi, file nascosti, profilo) costo 2, come `cat`. Quello che legge
      // sporca il compito: classe 4, o 5 se il file è scaricato.
      costo: (a) => (documentoFuori(a) ? 2 : 0),
      campo: 'file',
      fonte: (a, out) => {
        if (!out.text) return null;
        return out.scaricato
          ? { classe: 5, campo: 'file', chiave: `file:${out.documentRead || ''}`, motivo: 'ho letto un file scaricato' }
          : { classe: 4, campo: 'file', chiave: `file:${out.documentRead || ''}`, motivo: 'ho letto un documento dal tuo disco' };
      },
      describe: (a) => {
        const p = a && (a.percorso ?? a.path ?? a.file ?? a.documento);
        const perche = documentoFuori(a);
        return `Leggere il documento ${p || ''}`.trim() + (perche ? `\nPerché te lo chiedo: ${perche}` : '');
      },
    },
    LEGGI_TRASPARENZA: {
      // Filo rilegge i propri documenti di trasparenza per rispondere a "perché
      // usi questo modello?", "che fine fanno i miei dati?". Sola lettura di
      // testo statico incluso nell'app, nessuna uscita verso l'esterno → 1.
      costo: 0,
      campo: null,
      describe: (a) => `Rileggere la pagina di trasparenza${a && a.doc ? ` (${a.doc})` : ''}`,
    },
    EVENTO_CALENDARIO: {
      costo: 1,
      campo: null,
      describe: (a) => `Creare l'evento "${a.title || a.titolo || ''}"`,
    },
    PULISCI_TAB: {
      costo: 2,
      campo: null,
      describe: () => 'Valutare le schede aperte e archiviare quelle non più utili. '
        + 'Le schede archiviate restano riapribili da “Tab archiviate”.',
    },
    CANCELLA_ARCHIVIO: {
      costo: 3,
      campo: null,
      describe: (a) => `Eliminare DEFINITIVAMENTE dall'archivio le schede pertinenti a `
        + `“${a.query || a.testo || ''}”.`,
    },
    CANCELLA_MEMORIA: {
      // Cancella tutti i moduli di memoria di Filo (PROFILO, PREFERENZE, espansioni)
      // e il buffer delle lezioni non ancora compattate. Irreversibile: il profilo
      // utente che Filo ha costruito nel tempo va perso. Cancellare dati in modo definitivo
      // sta nell'elenco fisso: Filo non lo fa a nessun livello, e dice all'utente dove farlo da sé.
      costo: 3,
      campo: null,
      elenco: () => 'cancella-definitivo',
      dove: 'Le righe della memoria le può togliere l\'utente, una per una, in Preferenze sotto «Memoria di Filo».',
      describe: () => 'Eliminare DEFINITIVAMENTE tutta la memoria di Filo: '
        + 'profilo utente, preferenze apprese e lezioni non ancora salvate. '
        + 'Filo ripartirà senza ricordare nulla di te.',
    },
    DIMENTICA: {
      // Toglie dalla memoria le righe indicate a voce: le stesse della × nelle
      // Preferenze. Il main risolve la frase in `_righe` prima del gate, mai
      // l'LLM; nessuna riga → 1, il dispatch lo dice. Oltre tre è quasi un
      // «dimentica tutto» → costo 3.
      costo: (a) => {
        const n = Array.isArray(a && a._righe) ? a._righe.length : 0;
        return n === 0 ? 1 : n > 3 ? 3 : 2;
      },
      campo: null,
      describe: (a) => {
        const righe = Array.isArray(a && a._righe) ? a._righe : [];
        if (!righe.length) return 'Dimenticare una cosa';
        return `Filo sta per dimenticare ${righe.length === 1 ? 'questa riga' : `queste ${righe.length} righe`} della sua memoria:\n`
          + righe.map((r) => `• ${r}`).join('\n')
          + '\n\nNon entreranno più nelle conversazioni.';
      },
      describeDone: (a) => `Dimenticato: ${(a._righe || []).map((r) => `«${r}»`).join(', ')}`,
    },
    IMPOSTA_PREFERENZA: {
      // Costo, difesa abbassata ed elenco fisso li dichiara il setter in preferences.js.
      // Preferenza sconosciuta/non valida → 2 per prudenza (tanto il dispatch non
      // la eseguirà comunque). Un `rifiuto` → 1: il dispatch lo respinge spiegando perché.
      costo: (a) => {
        const built = prefBuilt(a);
        return built ? (built.rifiuto ? 1 : built.costo) : 2;
      },
      campo: null,
      elenco: (a) => { const built = prefBuilt(a); return (built && !built.rifiuto && built.elenco) || ''; },
      difesa: (a, ctx) => { const built = prefBuilt(a, ctx && ctx.impostazioni); return !!(built && !built.rifiuto && built.allenta); },
      dove: (a) => { const built = prefBuilt(a); return (built && built.dove) || ''; },
      describe: (a) => {
        const built = prefBuilt(a);
        if (!built || built.rifiuto) return 'Modificare una preferenza';
        // Il popup di conferma spiega COSA Filo sta per fare e, per le
        // impostazioni sensibili (costo 2 o difesa), anche i RISCHI (#183). Il `risk`
        // arriva dal setter in preferences.js, che deve dichiararlo.
        // Un testo libero si mostra per intero: si conferma quello (#592). La
        // prima riga resta corta perché fa anche da bottone.
        const base = `Filo vuole impostare: ${built.label}.`;
        const testo = built.testo ? `\n\nTesto esatto:\n«${built.testo}»` : '';
        return built.risk ? `${base}${testo}\n\n${built.risk}` : `${base}${testo}`;
      },
      // A cosa fatta (esito allo strumento): niente «vuole», niente rischi.
      describeDone: (a) => {
        const built = prefBuilt(a);
        return built && !built.rifiuto ? `Impostazione applicata: ${built.label}` : 'Preferenza modificata';
      },
    },
    IMPOSTA_ESTETICA: {
      // Cambio di un token estetico (colore, font, raggio, opacità) su richiesta
      // in chat (#146.4). Reversibile → costo 1: si applica subito, e nella
      // bolla compare un controllo per raffinarlo. ECCEZIONE: se la modifica
      // rende il testo ~uguale allo sfondo (illeggibilità estrema) il costo
      // sale a 2. Il flag `_illegible` lo calcola
      // il main process (ha i token correnti); mai l'LLM.
      costo: (a) => (a && a._illegible ? 2 : 1),
      campo: null,
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
      // Filo lancia un comando nel terminale (#146.6). Il costo NON è fisso:
      // dipende dal comando EFFETTIVO, classificato dal main (mai dall'LLM) in
      // src/shared/cmdClassify.js. 1 = sola lettura; 2 = modifica recuperabile;
      // 3 = cancellazioni, comandi pericolosi e qualsiasi comando non riconosciuto.
      // Una sequenza di comandi (`&&`/`||`/`;`) prende il costo massimo dei suoi pezzi.
      // L'uscita sporca il compito: classe 4, o 5 se il comando scarica dal web.
      // Comando assente o classificatore non caricato → 3 per massima cautela.
      costo: (a) => {
        const C = global.SN_CMD_CLASSIFY;
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim();
        if (!cmd || !C) return 3;
        const lvl = C.classify(cmd, a._perimetro);
        return lvl === 1 || lvl === 2 || lvl === 3 ? lvl : 3;
      },
      campo: 'terminale',
      fonte: (a, out) => {
        if (out.blocked) return null;
        const t = `${typeof out.stdout === 'string' ? out.stdout : ''}${typeof out.stderr === 'string' ? out.stderr : ''}`;
        if (!t.trim()) return null;
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '');
        return SCARICA.test(cmd)
          ? { classe: 5, campo: 'terminale', chiave: 'web:comando', motivo: 'ho scaricato una pagina dal web con un comando' }
          : { classe: 4, campo: 'terminale', chiave: 'terminale:uscita', motivo: 'ho letto l\'uscita di un comando' };
      },
      describe: (a) => {
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim();
        // DOVE il comando agisce non si legge nel comando: la cartella di lavoro
        // è persistente e la sposta l'assistente da sé (`cd` è costo 1, non
        // chiede niente). Senza dirlo, `wget http://x/authorized_keys` ha lo
        // stesso identico testo nella home — dove è innocuo — e dentro ~/.ssh,
        // dove sovrascrive una chiave. La cartella la inietta il main come
        // `_cwd` (mai l'LLM); il costo non ci si appoggia mai.
        const cwd = String((a && a._cwd) || '').trim();
        const C = global.SN_CMD_CLASSIFY;
        let perche = '';
        try { perche = (cmd && C && C.classifyDetail) ? C.classifyDetail(cmd, a._perimetro).motivo : ''; } catch (_) {}
        return `Eseguire nel terminale:\n${cmd || '(comando vuoto)'}`
          + (cwd ? `\nCartella di lavoro: ${cwd}` : '')
          + (perche ? `\nPerché te lo chiedo: ${perche}` : '');
      },
    },
    // ── proxy per-tab via linguaggio naturale (#152) ──────────────────────────
    // Tutte costo 1: instradare una scheda da un altro paese (o salvare una
    // regola per dominio) è completamente reversibile — "torna in Italia" /
    // "togli la regola" annullano. La separazione del cookie jar è inerente al
    // proxy e l'utente l'ha chiesta esplicitamente; il flusso AUTOMATICO da
    // geo-block (che invece propone quando ci sono login attivi) vive altrove.
    PROXY_TAB: {
      costo: 1,
      campo: 'web',
      describe: (a) => `Aprire questa scheda da ${countryLabel(proxyCountry(a)) || 'un altro paese'}`,
    },
    RIMUOVI_PROXY: {
      costo: 1,
      campo: 'web',
      describe: () => 'Riportare questa scheda alla connessione diretta (Italia)',
    },
    RIMUOVI_PROXY_TUTTE: {
      costo: 1,
      campo: 'web',
      describe: () => 'Riportare tutte le schede instradate da un altro paese alla connessione diretta',
    },
    REGOLA_PROXY_DOMINIO: {
      costo: 1,
      campo: 'web',
      describe: (a) => `Aprire sempre ${proxyDomain(a) || 'questo sito'} da ${countryLabel(proxyCountry(a)) || 'un altro paese'}`,
    },
    RIMUOVI_REGOLA_PROXY: {
      costo: 1,
      campo: 'web',
      describe: (a) => `Togliere la regola "apri sempre da un altro paese" per ${proxyDomain(a) || 'questo sito'}`,
    },
    // ── comandi della finestra / barra di Filo via chat (#419) ────────────────
    // L'agente della home aziona i controlli del browser stesso (schermo intero,
    // riduci a icona, menu Impostazioni/App/Account, home) — la stessa cosa che
    // sa già fare l'assistente di pagina. Tutti costo 1: azionare un controllo
    // della finestra è benigno e completamente reversibile (uno schermo intero si
    // toglie, un menu si richiude). "close" è ESCLUSO di proposito: l'AI non
    // chiude finestra né schede.
    COMANDO_FINESTRA: {
      costo: 1,
      campo: null,
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
    // ("scrivi in grassetto tutti i titoli"). Costo 1: si applica subito, vale
    // SOLO per quella pagina (CSS iniettato live) ed è completamente reversibile
    // (basta ricaricare la pagina, o "togli le modifiche" → RIPRISTINA_STILE_PAGINA).
    // Il CSS prodotto dall'LLM viene SANIFICATO dal main (src/shared/pageRestyle.js)
    // prima dell'iniezione: niente at-rule, url(), graffe o markup.
    STILE_PAGINA: {
      costo: 1,
      campo: 'web',
      describe: (a) => {
        const d = a && (a.descrizione ?? a.description);
        if (d) return `Cambiare l'aspetto della pagina: ${String(d).trim()}`;
        return 'Cambiare l\'aspetto del testo della pagina';
      },
    },
    RIPRISTINA_STILE_PAGINA: {
      costo: 1,
      campo: 'web',
      describe: () => 'Togliere le modifiche di stile applicate alla pagina',
    },
    // ── zoom della pagina via chat (#686) ────────────────────────────────────
    // Costo 1: è la stessa cosa che fanno Ctrl +/- e Ctrl 0, visibile e
    // reversibile in un tasto.
    ZOOM_PAGINA: {
      costo: 1,
      campo: null,
      describe: (a) => {
        const Z = global.SN_ZOOM;
        const perc = Z ? Z.leggiPercentuale(a && (a.percentuale ?? a.percent ?? a.valore)) : null;
        if (perc != null) return `Portare lo zoom della pagina al ${Math.round(perc)}%`;
        const verso = String((a && (a.verso ?? a.direzione ?? a.direction)) || '').trim().toLowerCase();
        if (verso === 'in') return 'Ingrandire la pagina di un passo';
        if (verso === 'out') return 'Rimpicciolire la pagina di un passo';
        if (verso === 'reset') return 'Riportare la pagina alla dimensione reale (100%)';
        return 'Cambiare lo zoom della pagina';
      },
    },
  };

  function voce(action) {
    if (!action || typeof action !== 'object') return null;
    return REGISTRY[String(action.type || '').toUpperCase()] || null;
  }
  function valore(v, action, ctx) { return typeof v === 'function' ? v(action, ctx) : v; }

  // Costo 0-3, oppure null se l'azione non è registrata o non dichiara un costo valido (il dispatch la rifiuta).
  function costoFor(action) {
    const entry = voce(action);
    if (!entry) return null;
    let c = null;
    try { c = valore(entry.costo, action); } catch (_) { c = null; }
    return Number.isInteger(c) && c >= 0 && c <= 3 ? c : null;
  }

  function campoFor(action) {
    const entry = voce(action);
    const c = entry ? valore(entry.campo, action) : null;
    return typeof c === 'string' && c ? c : null;
  }

  // Cosa un'azione già fatta ha portato nel compito (la sua uscita `_output`): una fonte con la sua classe,
  // o null se non ha letto niente di nuovo. Lo stato del compito si calcola da qui, mai dal modello.
  function fonteDi(action) {
    const entry = voce(action);
    const out = action && action._output;
    if (!entry || typeof entry.fonte !== 'function' || !out || typeof out !== 'object') return null;
    try { return entry.fonte(action, out) || null; } catch (_) { return null; }
  }

  // Gli ingressi del dispatch per SN_AUTONOMIA. `ctx.richiesta` = cosa ha scritto l'utente nel compito,
  // `ctx.impostazioni` = le impostazioni correnti (per sapere se una preferenza abbassa una difesa).
  function ingressi(action, ctx = {}) {
    const entry = voce(action);
    const costo = costoFor(action);
    if (!entry || costo == null) return null;
    let elenco = '';
    let segreto = '';
    try { elenco = String(valore(entry.elenco, action, ctx) || ''); } catch (_) { elenco = ''; }
    const A = global.SN_AUTONOMIA;
    if (!elenco && typeof entry.uscita === 'function' && A) {
      try { segreto = A.segreto(entry.uscita(action), { richiesta: ctx.richiesta || '' }); } catch (_) { segreto = ''; }
      if (segreto) elenco = 'segreto';
    }
    let difesa = false;
    try { difesa = !!valore(entry.difesa, action, ctx); } catch (_) { difesa = true; }
    let dove = '';
    try { dove = String(valore(entry.dove, action, ctx) || ''); } catch (_) { dove = ''; }
    return { costo, campo: campoFor(action), elenco, segreto, difesa, dove };
  }

  // Spiegazione in chiaro di cosa Filo sta tentando, per il popup di conferma.
  function describe(action) {
    if (!action || typeof action !== 'object') return '';
    const entry = REGISTRY[String(action.type || '').toUpperCase()];
    if (!entry) return '';
    try { return entry.describe(action) || ''; } catch (_) { return ''; }
  }

  // La stessa cosa a fatto compiuto, per l'esito che torna al modello: dove
  // il registro non distingue («Avviare il timer “pasta”») vale `describe`.
  function describeDone(action) {
    if (!action || typeof action !== 'object') return '';
    const entry = REGISTRY[String(action.type || '').toUpperCase()];
    if (!entry) return '';
    try { return (entry.describeDone ? entry.describeDone(action) : entry.describe(action)) || ''; } catch (_) { return ''; }
  }

  global.SN_ACTION_LEVELS = { REGISTRY, costoFor, campoFor, fonteDi, ingressi, describe, describeDone };
})(typeof globalThis !== 'undefined' ? globalThis : self);
