// Registro delle azioni di Filo: COSTO e CAMPO di ogni potere (#146.2, #530).
//
// Ogni azione che Filo (l'AI) può intraprendere dichiara STATICAMENTE qui —
// mai deciso dall'LLM a runtime — due cose:
//
//   costo — quanto costa sbagliarla, 0-3:
//     0  solo chat: leggere, cercare, rispondere. Non lascia traccia fuori
//        dalla conversazione (leggere è sempre libero).
//     1  si disfa: una sveglia, il tema, una scheda archiviata.
//     2  dura, o si vede fuori, ma si rimedia: una lezione in memoria, una
//        regola di automazione, un messaggio a un destinatario scelto.
//     3  irreversibile o costoso: un acquisto, un file eliminato, un comando
//        che modifica.
//   campo — posta, messaggistica, file, terminale, web (o nessuno): i campi
//     non hanno un livello proprio, hanno due manopole che solo restringono
//     (src/shared/autonomia.js).
//
// Più, quando serve:
//   fonte   — che cosa l'azione fa ENTRARE nel contesto (una ricerca, un
//             documento dal disco, un file dell'editor). È così che il motore
//             sa se il compito è ancora pulito: non lo chiede al modello.
//   vietato — l'azione ricade in una voce dell'elenco fisso: no a ogni
//             livello, per quanto pulito sia il compito. Con `rifiuto` si dice
//             al modello DOVE si fa a mano, che è l'unica risposta utile.
//   allenta — l'azione abbassa una difesa (alza il livello, alza una fonte di
//             classe, abbassa un costo): vuole la parola digitata, sempre.
//
// Il costo NON è più la risposta: la risposta («sì», «chiede», «conferma»,
// «no») la dà src/shared/autonomia.js combinando costo, livello di autonomia
// scelto dall'utente e stato del compito. Qui si dichiara solo la posta in
// gioco. Il dispatch (executeFiloAction in src/main/services/handlers.js)
// RIFIUTA le azioni senza costo: ogni nuovo potere di Filo è obbligato a
// dichiararlo, altrimenti non viene eseguito.
//
// Per IMPOSTA_PREFERENZA costo e «allenta» dipendono dalla preferenza
// specifica (li dichiara il setter in src/shared/preferences.js, come prima
// faceva il `level`): cambiare il tema è innocuo, dare a Filo la shell o
// spegnere la navigazione sicura è tutt'altro.

(function (global) {
  'use strict';

  function prefBuilt(action) {
    const P = global.SN_PREF;
    if (!P) return null;
    const chiave = action.chiave ?? action.key ?? action.nome ?? action.name ?? action.preferenza;
    const valore = action.valore ?? action.value ?? action.valoreNuovo ?? action.val;
    return P.buildPreferencePartial(chiave, valore);
  }

  // «Alza il livello di autonomia», «sposta di classe le pagine web»: la
  // richiesta di cambiare LE REGOLE STESSE. Riconoscimento deterministico sui
  // nomi che un modello può produrre — mai un giudizio del modello. Non esiste
  // un setter per queste: il punto è rispondere col motivo vero (elenco fisso)
  // invece che con «preferenza sconosciuta».
  const CHIAVI_AUTONOMIA = /^(livello[_ ]?(di[_ ])?autonomia|autonomia|autonomy|livello[_ ]?filo|classe[_ ]?fonte|classi[_ ]?fonti|costo[_ ]?azione|elenco[_ ]?fisso)$/i;
  function isRegolaAutonomia(action) {
    const chiave = action && (action.chiave ?? action.key ?? action.nome ?? action.name ?? action.preferenza);
    return CHIAVI_AUTONOMIA.test(String(chiave == null ? '' : chiave).trim());
  }

  // Grado di un comando secondo il classificatore (1 sola lettura, 2 modifica
  // recuperabile, 3 cancellazioni / pericolosi / non riconosciuti). Senza
  // comando o senza classificatore vale 3: la massima cautela.
  function gradoComando(action) {
    const C = global.SN_CMD_CLASSIFY;
    const cmd = String((action && (action.comando ?? action.command ?? action.cmd)) || '').trim();
    if (!cmd || !C) return 3;
    const g = C.classify(cmd);
    return g === 1 || g === 2 || g === 3 ? g : 3;
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
      // Aprire un link è di norma innocuo → livello 1, diretto. ECCEZIONE
      // anti-esfiltrazione: se l'URL trasporta FUORI dati sensibili che il
      // modello aveva nel contesto (taint-match) o ha la forma di un payload di
      // esfiltrazione da origine non fidata (fallback strutturale), sale a
      // costo 3: quei dati, una volta usciti, non rientrano — ed è il caso che
      // una pagina ostile prova a far scattare. Il flag `_exfil` lo calcola il
      // main (src/main/services/handlers.js → src/shared/urlExfil.js); mai l'LLM.
      // La pagina la legge l'utente, ma da qui in poi quella scheda è fra
      // quelle aperte, e il suo titolo — scritto dal sito — entra nel
      // riepilogo di stato di ogni turno successivo. Quindi una fonte c'è.
      costo: (a) => (a && a._exfil ? 3 : 1),
      campo: 'web',
      fonte: 'schede',
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
      costo: 1,
      campo: 'file',
      describe: (a) => `Aprire il file ${a.percorso || a.path || ''}`.trim(),
    },
    TIMER: {
      costo: 1,
      describe: (a) => `Avviare il timer "${a.label || a.etichetta || 'Timer'}"`,
    },
    SVEGLIA: {
      costo: 1,
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
      costo: (a) => (targetCount(a) > 1 || (targetCount(a) == null && wantsAll(a)) ? 2 : 1),
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
      costo: (a) => (targetCount(a) > 1 ? 2 : 1),
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
      describe: () => 'Salvare un appunto',
    },
    SALVA_LEZIONE: {
      // Filo fissa una LEZIONE nella propria memoria: entra nel buffer delle
      // lezioni — lo stesso che l'agente-lezioni riempie da solo dopo ogni
      // scambio — e vale da subito in TUTTE le conversazioni. Costo 2: dura
      // nel tempo e si rimedia (le lezioni restano visibili e cancellabili fra
      // le memorie), ma non è una cosa che si disfa da sé.
      //
      // È il caso che ha fatto nascere la regola (#530): con un compito pulito
      // non cambia niente rispetto a ieri — Filo la fissa e basta. Ma se in
      // questo stesso compito ha letto una pagina web, una ricerca o un
      // documento di qualcun altro, quel testo può aver chiesto lui la
      // lezione, e allora la chiede all'utente.
      costo: 2,
      describe: (a) => {
        const testo = String(a?.testo ?? a?.text ?? a?.lezione ?? '').trim();
        return `Fissare una lezione nella memoria di Filo:\n“${testo || '(vuota)'}”`;
      },
    },
    INVIA_FEEDBACK: {
      // Filo invia un feedback agli sviluppatori a NOME dell'utente (#146.5).
      // Esce dall'app verso un servizio esterno (Firestore) e non torna
      // indietro: un messaggio partito a nome di qualcuno non si ritira. È
      // «modulo inviato», uno degli esempi di costo 3 della regola (#530).
      // Conseguenza voluta: a livello normale con compito pulito resta il
      // popup col testo intero, che è la difesa del #414 — quello che parte a
      // tuo nome lo leggi prima. Dopo una pagina web diventa parola digitata.
      costo: 3,
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
      // Cercare è LEGGERE: costo 0, non si chiede mai. Quello che torna però
      // l'ha scritto un autore ignoto, e da qui in poi il compito è
      // contaminato: è la `fonte` a dirlo al motore.
      costo: 0,
      campo: 'web',
      fonte: 'ricerca',
      describe: (a) => `Cercare sul web "${a.query || ''}"`,
    },
    ONBOARDING: {
      // Filo tiene il conto della micro-intervista di benvenuto (#524): spunta
      // le cose che ha scoperto o detto e dichiara quando l'intervista è
      // finita. Non tocca nulla dell'utente — le impostazioni che l'intervista
      // applica passano dalle LORO azioni (IMPOSTA_PREFERENZA, SALVA_LEZIONE),
      // ognuna col proprio livello — e non ha nulla da annullare: chiudere
      // l'accoglienza è quello che l'utente vuole appena dice "basta così", e
      // dalle Preferenze la si rilancia quando vuole. Costo 1: si disfa.
      costo: 1,
      describe: (a) => {
        if (a && (a.fine ?? a.chiudi ?? a.done)) return 'Chiudere l’intervista di benvenuto';
        const ids = Array.isArray(a?.spunta) ? a.spunta : [];
        return `Segnare come fatto nell’intervista di benvenuto${ids.length ? `: ${ids.join(', ')}` : ''}`;
      },
    },
    CAPACITA_DETTAGLIO: {
      // Filo consulta il proprio manifesto delle capacità per rispondere a "puoi
      // fare X?" (#F2). Sola lettura di dati statici interni, nessun effetto
      // collaterale né uscita verso l'esterno → costo 0. Il manifesto lo
      // scrive Filo: leggerlo non sporca niente.
      costo: 0,
      fonte: 'capacita',
      describe: (a) => {
        const ids = Array.isArray(a.ids) ? a.ids : (a.id ? [a.id] : []);
        return `Verificare cosa sa fare Filo${ids.length ? ` (${ids.join(', ')})` : ''}`;
      },
    },
    LEGGI_FILE: {
      // Filo apre per intero un file dell'EDITOR di cui vede solo il riassunto
      // (#379.5). Sola lettura di dati che sono già in parte nel contesto (i
      // riassunti ci stanno sempre), nessuna scrittura e nessuna uscita → 0.
      // Mancava dal registro: senza una voce qui il dispatch rifiuta l'azione,
      // quindi la lettura on-demand dei documenti dell'editor non partiva mai.
      costo: 0,
      campo: 'file',
      // I file su cui l'utente lavora sono classe 2: a livello normale un
      // compito che ne ha letto uno resta pulito.
      fonte: 'editor',
      describe: (a) => {
        const id = a && (a.fileId ?? a.id ?? a.file);
        return `Leggere per intero un documento dell'editor${id ? ` (${id})` : ''}`;
      },
    },
    LEGGI_DOCUMENTO: {
      // Filo legge un documento dal DISCO dell'utente — un PDF (bolletta,
      // estratto conto, contratto) o un file di testo — perché l'utente gli ha
      // chiesto di leggerlo. Livello 1, per le stesse ragioni per cui un comando
      // di sola lettura nel terminale non chiede niente: non modifica niente,
      // non esegue niente, non manda niente fuori dal computer — il testo entra
      // solo nel contesto del modello. Una conferma a ogni documento sarebbe
      // attrito su una cosa che l'utente ha appena chiesto, e una conferma che
      // si accetta sempre smette di essere un controllo. Costo 0.
      //
      // Ma quel testo l'ha scritto qualcun altro: da qui in poi il compito è
      // contaminato, e quello che Filo fa DOPO aver letto costa di più.
      costo: 0,
      campo: 'file',
      fonte: 'documento',
      describe: (a) => {
        const p = a && (a.percorso ?? a.path ?? a.file ?? a.documento);
        return `Leggere il documento ${p || ''}`.trim();
      },
    },
    LEGGI_TRASPARENZA: {
      // Filo rilegge i propri documenti di trasparenza per rispondere a "perché
      // usi questo modello?", "che fine fanno i miei dati?". Sola lettura di
      // testo statico incluso nell'app, nessuna uscita verso l'esterno → 0.
      costo: 0,
      fonte: 'trasparenza',
      describe: (a) => `Rileggere la pagina di trasparenza${a && a.doc ? ` (${a.doc})` : ''}`,
    },
    EVENTO_CALENDARIO: {
      costo: 1,
      describe: (a) => `Creare l'evento "${a.title || a.titolo || ''}"`,
    },
    PULISCI_TAB: {
      // Archiviare una scheda si disfa (restano riapribili), ma qui Filo decide
      // su TUTTE insieme: costo 2.
      costo: 2,
      describe: () => 'Valutare le schede aperte e archiviare quelle non più utili. '
        + 'Le schede archiviate restano riapribili da “Tab archiviate”.',
    },
    CANCELLA_ARCHIVIO: {
      // Costo 3: quello che esce dall'archivio non torna. NON è però una
      // cancellazione FATTA da Filo — l'azione apre il pannello con l'elenco
      // di cosa sparirebbe, e a cancellare è l'utente, lì dentro, con le sue
      // mani. Per questo non ricade nell'elenco fisso.
      costo: 3,
      describe: (a) => `Eliminare DEFINITIVAMENTE dall'archivio le schede pertinenti a `
        + `“${a.query || a.testo || ''}”.`,
    },
    CANCELLA_MEMORIA: {
      // Cancella tutti i moduli di memoria di Filo (PROFILO, PREFERENZE, espansioni)
      // e il buffer delle lezioni non ancora compattate. Irreversibile: il profilo
      // utente che Filo ha costruito nel tempo va perso → costo 3. E ricade
      // nell'elenco fisso: una cancellazione definitiva la fa l'utente, da dove
      // si cancella (Preferenze → Memoria di Filo), non Filo su richiesta in
      // chat — che dopo aver letto una pagina web può essere la richiesta di
      // quella pagina.
      costo: 3,
      vietato: 'cancellazione-definitiva',
      // Quello che Filo risponde quando l'elenco fisso lo ferma: dove si fa,
      // non solo che non si può. Senza la strada, «no» è un vicolo cieco.
      rifiuto: 'Cancellare la memoria è una cosa che fa l\'utente con le sue mani: '
        + 'Preferenze → Memoria di Filo → «Cancella tutto quello che Filo sa di me», '
        + 'dove gli viene chiesto di scrivere «conferma». Dillo all\'utente e non riprovare.',
      describe: () => 'Eliminare DEFINITIVAMENTE tutta la memoria di Filo: '
        + 'profilo utente, preferenze apprese e lezioni non ancora salvate. '
        + 'Filo ripartirà senza ricordare nulla di te.',
    },
    IMPOSTA_PREFERENZA: {
      // Costo per-preferenza: lo dichiara il setter in preferences.js
      // (default 1). Preferenza sconosciuta/non valida → 2 per prudenza
      // (tanto il dispatch non la eseguirà comunque).
      costo: (a) => {
        const built = prefBuilt(a);
        return (built && built.costo) || (built ? 1 : 2);
      },
      // Il livello di autonomia (e le classi, i costi, l'elenco) non si
      // cambiano dalla chat: è l'elenco fisso, voce «regole-di-autonomia».
      // Filo non ha un setter per farlo, ma chi prova a chiederlo deve
      // ricevere il motivo vero, non «preferenza sconosciuta».
      vietato: (a) => (isRegolaAutonomia(a) ? 'regole-di-autonomia' : null),
      // Allentare una protezione (spegnere la navigazione sicura, accendere il
      // terminale, togliere i modelli predefiniti) vuole la parola digitata a
      // ogni livello, anche col compito pulito.
      allenta: (a) => {
        const built = prefBuilt(a);
        return !!(built && built.allenta);
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
      // A cosa fatta (esito allo strumento): niente «vuole», niente rischi.
      describeDone: (a) => {
        const built = prefBuilt(a);
        return built ? `Impostazione applicata: ${built.label}` : 'Preferenza modificata';
      },
    },
    IMPOSTA_ESTETICA: {
      // Cambio di un token estetico (colore, font, raggio, opacità) su richiesta
      // in chat (#146.4). Reversibile → livello 1: si applica subito, e nella
      // bolla compare un controllo per raffinarlo. ECCEZIONE: se la modifica
      // rende il testo ~uguale allo sfondo (illeggibilità estrema) il livello
      // sale a 3: non perché sia irreversibile in sé, ma perché la strada per
      // disfarlo passa da un'interfaccia che quella modifica ha appena reso
      // illeggibile. Costoso da rimediare, quindi si chiede prima. Il flag
      // `_illegible` lo calcola il main process (ha i token correnti), mai
      // l'LLM.
      costo: (a) => (a && a._illegible ? 3 : 1),
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
      // src/shared/cmdClassify.js. Una sequenza di comandi (`&&`/`||`/`;`)
      // prende il grado massimo dei suoi pezzi.
      //
      // La traduzione in costi non è quella meccanica (1→1, 2→2, 3→3), e il
      // motivo sta nella regola stessa (#530): fra i suoi esempi, «comando che
      // modifica» è costo 3. Quindi:
      //   sola lettura            → costo 1  (parte subito, come sempre)
      //   modifica recuperabile   → costo 3  (a livello normale: popup, come prima)
      //   cancellazioni, comandi pericolosi, non riconosciuti
      //                           → costo 3 + `allenta`
      // L'`allenta` sull'ultimo grado non è un'etichetta di comodo: un `rm` o
      // uno scaricamento che atterra in `~/.ssh` TOGLIE una difesa (#479), ed è
      // proprio il caso che una pagina ostile prova a far eseguire. La regola
      // (d) gli tiene addosso la parola digitata a ogni livello, che è quello
      // che pretendeva anche il framework di prima.
      //
      // Comando assente o classificatore non caricato → il grado più alto, per
      // massima cautela.
      campo: 'terminale',
      // Quello che un comando stampa entra nel contesto del modello e l'ha
      // scritto chissà chi: da lì in poi il compito è contaminato.
      fonte: 'comando',
      costo: (a) => (gradoComando(a) === 1 ? 1 : 3),
      allenta: (a) => gradoComando(a) === 3,
      describe: (a) => {
        const cmd = String((a && (a.comando ?? a.command ?? a.cmd)) || '').trim();
        // DOVE il comando agisce non si legge nel comando: la cartella di lavoro
        // è persistente e la sposta l'assistente da sé (`cd` è livello 1, non
        // chiede niente). Senza dirlo, `wget http://x/authorized_keys` ha lo
        // stesso identico testo nella home — dove è innocuo — e dentro ~/.ssh,
        // dove sovrascrive una chiave. La cartella la inietta il main come
        // `_cwd` (mai l'LLM); il livello non ci si appoggia mai.
        const cwd = String((a && a._cwd) || '').trim();
        return `Eseguire nel terminale:\n${cmd || '(comando vuoto)'}`
          + (cwd ? `\nCartella di lavoro: ${cwd}` : '');
      },
    },
    // ── proxy per-tab via linguaggio naturale (#152) ──────────────────────────
    // Tutte livello 1: instradare una scheda da un altro paese (o salvare una
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
    // sa già fare l'assistente di pagina. Tutti livello 1: azionare un controllo
    // della finestra è benigno e completamente reversibile (uno schermo intero si
    // toglie, un menu si richiude). "close" è ESCLUSO di proposito: l'AI non
    // chiude finestra né schede.
    COMANDO_FINESTRA: {
      costo: 1,
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
  };

  // Valore dichiarato dall'azione: o è un valore, o è una funzione che lo
  // calcola sull'azione concreta (quante sveglie prende, quale comando è,
  // quale preferenza). Mai l'LLM: le funzioni leggono solo campi che il main
  // ha già risolto.
  function valore(entry, chiave, action) {
    if (!entry) return undefined;
    const v = entry[chiave];
    if (typeof v !== 'function') return v;
    try { return v(action); } catch (_) { return undefined; }
  }
  function entryOf(action) {
    if (!action || typeof action !== 'object') return null;
    return REGISTRY[String(action.type || '').toUpperCase()] || null;
  }

  // COSTO di sbagliare l'azione: 0|1|2|3, oppure null se l'azione NON è
  // registrata o non lo dichiara (→ il dispatch deve rifiutarla). Non è la
  // risposta: la risposta la dà src/shared/autonomia.js.
  function costoFor(action) {
    const c = valore(entryOf(action), 'costo', action);
    const n = Number(c);
    return Number.isInteger(n) && n >= 0 && n <= 3 ? n : null;
  }

  // CAMPO dell'azione (posta, messaggistica, file, terminale, web) o null.
  function campoFor(action) {
    const c = valore(entryOf(action), 'campo', action);
    return c ? String(c) : null;
  }

  // Che cosa l'azione fa ENTRARE nel contesto (id di fonte in autonomia.js),
  // o null se non porta dentro niente.
  function fonteFor(action) {
    const f = valore(entryOf(action), 'fonte', action);
    return f ? String(f) : null;
  }

  // Voce dell'elenco fisso in cui l'azione ricade (no a ogni livello), o null.
  function vietatoFor(action) {
    const v = valore(entryOf(action), 'vietato', action);
    return v ? String(v) : null;
  }

  // La strada a mano, quando l'elenco fisso ferma l'azione: '' se non c'è.
  function rifiutoFor(action) {
    const v = valore(entryOf(action), 'rifiuto', action);
    return v ? String(v) : '';
  }

  // L'azione abbassa una difesa? (parola digitata a ogni livello)
  function allentaFor(action) {
    return !!valore(entryOf(action), 'allenta', action);
  }

  // Spiegazione in chiaro di cosa Filo sta tentando, per il popup di conferma.
  function describe(action) {
    const entry = entryOf(action);
    if (!entry) return '';
    try { return entry.describe(action) || ''; } catch (_) { return ''; }
  }

  // La stessa cosa a fatto compiuto, per l'esito che torna al modello: dove
  // il registro non distingue («Avviare il timer “pasta”») vale `describe`.
  function describeDone(action) {
    const entry = entryOf(action);
    if (!entry) return '';
    try { return (entry.describeDone ? entry.describeDone(action) : entry.describe(action)) || ''; } catch (_) { return ''; }
  }

  global.SN_ACTION_LEVELS = {
    REGISTRY, costoFor, campoFor, fonteFor, vietatoFor, rifiutoFor, allentaFor, describe, describeDone,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
