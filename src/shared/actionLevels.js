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

  function lezione(a) {
    const P = global.SN_PREF;
    if (P && P.lezioneDaAzione) return P.lezioneDaAzione(a);
    return { testo: String((a && (a.testo ?? a.text ?? a.lezione)) ?? '').trim() };
  }
  const RISCHIO_LEZIONE = 'Da adesso vale in ogni conversazione, e resta finché non la togli dalle Preferenze, '
    + 'sotto «Memoria di Filo». Confermala solo se l\'hai detta tu: un testo letto in una pagina o in un '
    + 'documento potrebbe provare a fargliela ricordare.';

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

  // ── sveglie e timer: da cosa dipende il livello ───────────────────────────
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
  function periodoDetto(action) {
    const vuoto = (v) => v == null || v === '';
    if (action && (!vuoto(action.da) || !vuoto(action.a)) && action._periodo) {
      const quando = (iso) => new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      const { da, a } = action._periodo;
      return da ? `dal ${quando(da)} al ${quando(a)}` : `fino al ${quando(a)}`;
    }
    const ore = Number(action && action.ore);
    if (Number.isFinite(ore) && ore > 0) return ore === 1 ? 'dell’ultima ora' : `delle ultime ${ore} ore`;
    const giorni = Number(action && action.giorni);
    if (Number.isFinite(giorni) && giorni > 0) return giorni === 1 ? 'dell’ultimo giorno' : `degli ultimi ${giorni} giorni`;
    const p = String((action && (action.periodo || action._nomePeriodo)) || '').toLowerCase();
    if (p === 'oggi') return 'di oggi';
    if (p === 'ieri') return 'di ieri';
    if (p === 'tutto') return 'di sempre';
    return 'dell’ultima ora';
  }
  function sitoDetto(action) {
    const s = String((action && (action._sito || action.sito)) || '').trim();
    return s ? ` su ${s}` : '';
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

  // Il nome che l'utente vede sulla carta, non l'id che il modello manda.
  function descriviCarta(a, fatto) {
    const C = global.SN_CARTE_HOME;
    // Un nome di destra si riconosce solo esatto: «lo scaricamento del file» è una carta di sinistra, non l'Editor.
    const id = C ? C.risolvi(a && a.carta, { esatto: true }) : null;
    const detto = String((a && a.carta) || '').trim();
    // Una chiave («avviso:…») non è un nome da mostrare: la frase resta senza.
    const nome = id ? ` «${C.carta(id).titolo}»` : (detto && !/^[a-z]+:/.test(detto) ? ` «${detto.length > 60 ? `${detto.slice(0, 59)}…` : detto}»` : '');
    const op = String((a && (a.operazione ?? a.op)) || '').toLowerCase();
    if (op === 'ripristina') return fatto ? 'Carte della home rimesse com\'erano all\'inizio' : 'Rimettere le carte della home com\'erano all\'inizio';
    if (op === 'togli' && !id) return fatto ? `Carta${nome} tolta dalla home` : `Togliere la carta${nome} dalla home`;
    if (op === 'togli') return fatto ? `Carta${nome} tolta dalla home: ora è un'icona in «altro»` : `Togliere la carta${nome} dalla home`;
    if (op === 'rimetti' || op === 'aggiungi') return fatto ? `Carta${nome} rimessa nella home` : `Rimettere la carta${nome} nella home`;
    return fatto ? `Carta${nome} spostata nella home` : `Spostare la carta${nome} nella home`;
  }

  // Perché LEGGI_DOCUMENTO esce dal perimetro di lettura ('' se ci sta). Senza
  // classificatore non si sa: si chiede.
  function documentoFuori(a) {
    const C = global.SN_CMD_CLASSIFY;
    if (!C || !C.fuoriPerimetro) return 'non si sa dove legge';
    const p = a && (a.percorso ?? a.path ?? a.file ?? a.documento ?? a.nome);
    return C.fuoriPerimetro(p, a && a._perimetro);
  }

  // Cosa fa un comando, a parole (#892): la scrive il modello e apre bottone e
  // popup, sopra il comando vero. È solo testo, il livello non la legge mai.
  // Via i caratteri invisibili o che rigirano il testo; il tetto si vede (…).
  const SPIEGAZIONE_MAX = 300;
  function spiegazioneComando(a) {
    const v = a && (a.spiegazione ?? a.descrizione);
    let t = (typeof v === 'string' ? v : '')
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
    const segni = Array.from(t);
    if (segni.length > SPIEGAZIONE_MAX) t = `${segni.slice(0, SPIEGAZIONE_MAX - 1).join('').trimEnd()}…`;
    return t || 'Uso il terminale del computer';
  }

  function nomeLeggibile(n) {
    const N = global.SN_NOMI_FILE;
    const s = N ? N.nomeVisibile(n) : String(n == null ? '' : n).replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '');
    return s.trim();
  }
  function elencoRinomine(a) {
    const proposte = Array.isArray(a && a._proposte) ? a._proposte : [];
    const saltati = Array.isArray(a && a._saltati) ? a._saltati : [];
    const n = proposte.length;
    const righe = proposte.map((p) => `«${nomeLeggibile(p && p.prima)}» → «${nomeLeggibile(p && p.nome)}»`);
    let t = `${n === 1 ? 'Rinominare questo file' : `Rinominare questi ${n} file`}:\n${righe.join('\n')}`;
    if (saltati.length) {
      t += `\n\nRestano come sono:\n${saltati.map((x) => `«${nomeLeggibile(x && x.nome)}»: ${nomeLeggibile(x && x.perche)}`).join('\n')}`;
    }
    if (a && a._oltre > 0) t += `\n\nNe restano altri ${a._oltre}: chiedimelo di nuovo dopo questi.`;
    return `${t}\n\nL'estensione non cambia e nessun file viene sovrascritto. Dopo puoi rimettere i nomi di prima con «Annulla».`;
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
          const why = a._exfilReason ? ` che ${a._exfilReason}` : '';
          return `Aprire un link${why}:\n${url}\n\n`
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
    // Rinominare file dell'utente (#950): si torna indietro con «Annulla», ma un programma che cercava il file
    // per nome non lo trova più → 2. L'elenco vecchio → nuovo lo prepara il main (`_proposte`), mai il modello.
    RINOMINA_FILE: {
      level: 2,
      describe: (a) => elencoRinomine(a),
      describeDone: (a) => {
        const fatti = a && a._output && Array.isArray(a._output.rinominati) ? a._output.rinominati : null;
        const n = fatti ? fatti.length : (Array.isArray(a && a._proposte) ? a._proposte.length : 0);
        return n === 1 ? 'Rinominato un file (si rimette com\'era con «Annulla»)' : `Rinominati ${n} file (si rimettono com'erano con «Annulla»)`;
      },
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
    SALVA_LEZIONE: {
      // Una lezione entra in ogni conversazione e ci resta, come lo stile: se la
      // propone il modello, l'utente ne conferma il testo esatto (#592). Vuota
      // o oltre il tetto → 1: niente da confermare, il dispatch la respinge.
      level: (a) => { const l = lezione(a); return l.testo && !l.rifiuto ? 2 : 1; },
      describe: (a) => {
        const l = lezione(a);
        if (!l.testo || l.rifiuto) return 'Ricordare una cosa';
        return `Filo vuole ricordare una cosa.\n\nTesto esatto:\n«${l.testo}»\n\n${RISCHIO_LEZIONE}`;
      },
      describeDone: (a) => `Ricordato: «${lezione(a).testo}»`,
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
      // Cercare è di norma innocuo → livello 1. ECCEZIONE anti-esfiltrazione: se
      // la query trasporta FUORI un segreto (memoria, o ciò che il modello ha
      // letto nel turno) sale a livello 2 → conferma con la query mostrata. Il
      // flag `_exfil` lo calcola il main (→ urlExfil.js); mai l'LLM.
      level: (a) => (a && a._exfil ? 2 : 1),
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
      // ognuna col proprio livello — e non ha nulla da annullare: chiudere
      // l'accoglienza è quello che l'utente vuole appena dice "basta così", e
      // dalle Preferenze la si rilancia quando vuole. Livello 1.
      level: 1,
      describe: (a) => {
        if (a && (a.fine ?? a.chiudi ?? a.done)) return 'Chiudere l’intervista di benvenuto';
        const ids = Array.isArray(a?.spunta) ? a.spunta : [];
        return `Segnare come fatto nell’intervista di benvenuto${ids.length ? `: ${ids.join(', ')}` : ''}`;
      },
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
    LEGGI_IMPOSTAZIONI: {
      // #949 — rilegge le impostazioni dell'utente, senza le chiavi: sola lettura, niente esce.
      level: 1,
      describe: (a) => {
        const cerca = String((a && (a.cerca ?? a.query ?? a.chiave)) || '').replace(/\s+/g, ' ').trim();
        return cerca ? `Leggere com'è impostato «${cerca.slice(0, 60)}»` : 'Leggere le impostazioni';
      },
      describeDone: (a) => {
        const cerca = String((a && (a.cerca ?? a.query ?? a.chiave)) || '').replace(/\s+/g, ' ').trim();
        return cerca ? `Letto com'è impostato «${cerca.slice(0, 60)}»` : 'Lette le impostazioni';
      },
    },
    CERCA_CHAT: {
      // #525 — Filo rilegge le conversazioni passate con lo stesso utente per
      // riprendere un discorso di ieri. Sola lettura di dati che sono già
      // dell'utente e che sono già passati da questo contesto (le ha scritte
      // lui, con Filo): niente scritture, niente cancellazioni, niente che
      // esca dal computer → livello 1, come LEGGI_FILE.
      level: 1,
      describe: (a) => {
        const q = String((a && (a.query ?? a.testo)) || '').trim();
        if (a && a.id && !q) return 'Rileggere una conversazione passata';
        return `Cercare fra le conversazioni passate${q ? ` ("${q}")` : ''}`;
      },
    },
    LEGGI_FILE: {
      // Filo apre per intero un file dell'EDITOR di cui vede solo il riassunto
      // (#379.5). Sola lettura di dati che sono già in parte nel contesto (i
      // riassunti ci stanno sempre), nessuna scrittura e nessuna uscita → 1.
      // Mancava dal registro: senza una voce qui il dispatch rifiuta l'azione,
      // quindi la lettura on-demand dei documenti dell'editor non partiva mai.
      level: 1,
      describe: (a) => {
        const id = a && (a.fileId ?? a.id ?? a.file);
        return `Leggere per intero un documento dell'editor${id ? ` (${id})` : ''}`;
      },
    },
    LEGGI_DOCUMENTO: {
      // Filo legge un documento dal DISCO dell'utente — un PDF (bolletta,
      // estratto conto, contratto) o un file di testo — perché l'utente gli ha
      // chiesto di leggerlo. Livello 1, per le stesse ragioni per cui un comando
      // di sola lettura nel terminale è livello 1: non modifica niente, non
      // esegue niente, non manda niente fuori dal computer — il testo entra solo
      // nel contesto del modello. Una conferma a ogni documento sarebbe attrito
      // su una cosa che l'utente ha appena chiesto, e una conferma che si accetta
      // sempre smette di essere un controllo. Fuori dal perimetro di lettura
      // (#587: altri dischi, file nascosti, profilo) chiede un OK, come `cat`.
      level: (a) => (documentoFuori(a) ? 2 : 1),
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
      level: 1,
      describe: (a) => `Rileggere la pagina di trasparenza${a && a.doc ? ` (${a.doc})` : ''}`,
    },
    EVENTO_CALENDARIO: {
      level: 1,
      describe: (a) => `Creare l'evento "${a.title || a.titolo || ''}"`,
    },
    // La prima riga di describe è quella che il diario mostra mentre si aspetta il clic.
    PULISCI_TAB: {
      level: 2,
      describe: () => 'Riordinare le schede e archiviare quelle non più utili.\n'
        + 'Le schede archiviate restano riapribili da “Tab archiviate”.',
      describeDone: (a) => {
        const n = Number(a && a._output && a._output.archived) || 0;
        return n ? `Schede riordinate: archiviate ${n} non più utili` : 'Schede riordinate: nessuna da archiviare';
      },
    },
    CANCELLA_ARCHIVIO: {
      level: 3,
      describe: (a) => `Eliminare dall'archivio le schede su “${a.query || a.testo || ''}”.\n`
        + 'Vengono eliminate DEFINITIVAMENTE: non si possono recuperare.',
      describeDone: (a) => {
        const n = Number(a && a._output && a._output.eliminate) || 0;
        return `Eliminate DEFINITIVAMENTE dall'archivio ${n} ${n === 1 ? 'scheda' : 'schede'} su “${a.query || a.testo || ''}”`;
      },
    },
    // #866 — come in ogni browser: il popup dice quante pagine e di quale periodo, il conto lo fa il main (`_n`).
    CANCELLA_PAGINE: {
      level: 2,
      describe: (a) => {
        const n = Number(a && a._n);
        const quali = Number.isFinite(n) ? (n === 1 ? 'la pagina visitata' : `le ${n} pagine visitate`) : 'le pagine visitate';
        return `Cancellare ${quali}${sitoDetto(a)} ${periodoDetto(a)}.\nFilo non le ricorderà più. Chat e schede chiuse restano.`;
      },
      describeDone: (a) => {
        const n = Number(a && a._output && a._output.cancellate) || 0;
        return n ? `Cancellate ${n === 1 ? '1 pagina visitata' : `${n} pagine visitate`}${sitoDetto(a)} ${periodoDetto(a)}` : `Nessuna pagina visitata${sitoDetto(a)} ${periodoDetto(a)}`;
      },
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
    DIMENTICA: {
      // Toglie dalla memoria le righe indicate a voce: le stesse della × nelle
      // Preferenze. Il main risolve la frase in `_righe` prima del gate, mai
      // l'LLM; nessuna riga → 1, il dispatch lo dice. Oltre tre è quasi un
      // «dimentica tutto», e chiede di digitare «conferma» come CANCELLA_MEMORIA.
      level: (a) => {
        const n = Array.isArray(a && a._righe) ? a._righe.length : 0;
        return n === 0 ? 1 : n > 3 ? 3 : 2;
      },
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
      // Livello per-preferenza: lo dichiara il setter in preferences.js
      // (default 1). Preferenza sconosciuta/non valida → 2 per prudenza
      // (tanto il dispatch non la eseguirà comunque). Un `rifiuto` → 1: non
      // c'è niente da confermare, il dispatch lo respinge spiegando perché.
      level: (a) => {
        // Un elenco che resterebbe com'è: niente da confermare (`_invariato` lo mette il main, #949).
        if (a && a._invariato) return 1;
        const built = prefBuilt(a);
        return (built && built.level) || (built ? 1 : 2);
      },
      describe: (a) => {
        const built = prefBuilt(a);
        if (!built || built.rifiuto) return 'Modificare una preferenza';
        // Il popup di conferma spiega COSA Filo sta per fare e, per le
        // impostazioni sensibili (livello 2), anche i RISCHI (#183). Il `risk`
        // arriva dal setter in preferences.js: è obbligatorio per il livello 2.
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
        const lvl = C.classify(cmd, a._perimetro);
        return lvl === 1 || lvl === 2 || lvl === 3 ? lvl : 3;
      },
      describe: (a) => {
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim();
        // DOVE il comando agisce non si legge nel comando: la cartella di lavoro
        // è persistente e la sposta l'assistente da sé (`cd` è livello 1, non
        // chiede niente). Senza dirlo, `wget http://x/authorized_keys` ha lo
        // stesso identico testo nella home — dove è innocuo — e dentro ~/.ssh,
        // dove sovrascrive una chiave. La cartella la inietta il main come
        // `_cwd` (mai l'LLM); il livello non ci si appoggia mai.
        const cwd = String((a && a._cwd) || '').trim();
        const C = global.SN_CMD_CLASSIFY;
        let perche = '';
        try { perche = (cmd && C && C.classifyDetail) ? C.classifyDetail(cmd, a._perimetro).motivo : ''; } catch (_) {}
        return `${spiegazioneComando(a)}\n\nIl comando, nel terminale:\n${cmd || '(comando vuoto)'}`
          + (cwd ? `\nCartella di lavoro: ${cwd}` : '')
          + (perche ? `\nPerché te lo chiedo: ${perche}` : '');
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
    // #870 — le carte della home, come le dispone l'utente trascinandole. Livello 1: ogni mossa si annulla con
    // quella opposta, e una carta tolta resta in «altro», da cui si rimette.
    CARTA_HOME: {
      level: 1,
      describe: (a) => descriviCarta(a, false),
      describeDone: (a) => descriviCarta(a, true),
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
    // ── rimettere com'era un cambio di stato (#867) ─────────────────────────
    // Il livello è quello del cambio da rimettere: `_livelloCambio` lo scrive il main dal registro,
    // sempre, prima del cancello (mai dall'azione del modello). Rimettere la protezione dell'IP
    // spenta chiede la stessa conferma che chiederebbe spegnerla.
    ANNULLA_CAMBIO: {
      level: (a) => (a && a._livelloCambio === 1 ? 1 : 2),
      describe: (a) => {
        const f = String((a && a._fraseCambio) || '').trim();
        const base = f ? `Filo vuole rimettere com'era prima di: ${f}.` : 'Filo vuole rimettere com\'era l\'ultimo cambio.';
        if (a && a._livelloCambio === 1) return base;
        return `${base}\n\nTocca un'impostazione di sicurezza, dei modelli o delle spese: conferma solo se l'hai chiesto tu.`;
      },
      describeDone: (a) => {
        const f = String((a && a._fraseCambio) || '').trim();
        return f ? `Rimesso com'era prima di: ${f}` : 'Cambio annullato';
      },
    },
    // ── zoom della pagina via chat (#686) ────────────────────────────────────
    // Livello 1: è la stessa cosa che fanno Ctrl +/- e Ctrl 0, visibile e
    // reversibile in un tasto.
    ZOOM_PAGINA: {
      level: 1,
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

  // La stessa cosa a fatto compiuto, per l'esito che torna al modello: dove
  // il registro non distingue («Avviare il timer “pasta”») vale `describe`.
  function describeDone(action) {
    if (!action || typeof action !== 'object') return '';
    const entry = REGISTRY[String(action.type || '').toUpperCase()];
    if (!entry) return '';
    try { return (entry.describeDone ? entry.describeDone(action) : entry.describe(action)) || ''; } catch (_) { return ''; }
  }

  global.SN_ACTION_LEVELS = { REGISTRY, levelFor, describe, describeDone, spiegazioneComando };
})(typeof globalThis !== 'undefined' ? globalThis : self);
