// Gli strumenti del modello della chat (tool calling nativo): pochi strumenti generali con un'`azione`, uguali per ogni
// utente, sistema e ruolo (SPEC-CONTESTO § Gli strumenti). Ogni azione resta il tipo che executeFiloAction esegue e che
// il registro dei costi conosce. Regole: tests/unit/actionTools.test.mjs e tests/unit/tettiDelContesto.test.mjs.

(function (global) {
  'use strict';

  // Tipi senza descrizione: il nome basta, quello che serve sta nella riga dell'azione.
  const S = (extra) => ({ type: 'string', ...(extra || {}) });
  const B = () => ({ type: 'boolean' });
  const I = () => ({ type: 'integer' });
  const LISTA = (items) => ({ type: 'array', items: items || { type: 'string' } });

  // Nel main i moduli sono già caricati dal loader; negli unit test che caricano solo questo, li porta require.
  function modulo(nome, file) {
    if (!global[nome] && typeof require === 'function') { try { require(file); } catch (_) {} }
    return global[nome] || null;
  }

  // I documenti di trasparenza che esistono davvero, dal registro generato dai markdown (#515): un elenco scritto a
  // mano prometteva documenti che non c'erano.
  function idTrasparenza() {
    try {
      const T = global.SN_TRANSPARENCY;
      const docs = T && typeof T.all === 'function' ? T.all().map((d) => String(d.id || '')).filter(Boolean) : [];
      const note = T && typeof T.conNota === 'function' ? T.conNota().map((n) => String(n.id || '')).filter(Boolean) : [];
      return docs.concat(note);
    } catch (_) { return []; }
  }

  const RIPETI = { anyOf: [LISTA(), S()] };

  // Ogni azione: lo strumento e il nome con cui il modello la chiama, una riga d'uso, i parametri (tipi soli) e i
  // campi obbligatori. `risultato`: l'esito torna al modello per intero, non come riga di conferma.
  const TOOLS = {
    // ── impostazioni ──
    LEGGI_IMPOSTAZIONI: {
      via: ['impostazioni', 'leggi'], risultato: true,
      description: 'com\'è impostato Filo adesso: ogni voce con chiave e valori ammessi, i permessi dei siti, i token dell\'aspetto. Prima di dire com\'è impostato qualcosa o di un cambio relativo.',
      properties: { cerca: S() }, required: [],
    },
    IMPOSTA_PREFERENZA: {
      via: ['impostazioni', 'imposta'],
      description: 'una chiave per chiamata. Frequenti: tema (sistema|chiaro|scuro), dimensione_testo, colore_tab (più vivaci|più neutre|nessuno|predefinito), blocco_pubblicita, gestione_cookie, modalita_terminale, guarda_schermo, stile_agente, autonomia (solo se l\'utente lo chiede). Chiavi e valori ammessi con leggi.',
      properties: { chiave: S(), valore: { anyOf: [S(), { type: 'number' }, B()] } }, required: ['chiave', 'valore'],
    },
    IMPOSTA_ESTETICA: {
      via: ['impostazioni', 'aspetto'],
      description: 'un token dell\'aspetto di Filo (accent, background, text, topbar, font, radius, motion…; tutti con leggi). Scegli tu un valore concreto: #rrggbb, "8px", opacità 0-1, "450ms", motion 0-3 ("0" toglie le animazioni), "Georgia, serif"; "predefinito" torna di serie.',
      properties: { token: S(), valore: S() }, required: ['token', 'valore'],
    },
    PULSANTE_PREFERENZE: {
      via: ['impostazioni', 'pulsante'],
      description: 'i pulsanti di Preferenze: prova suoni (tono) e voci (voce), rifai l\'intervista, aspetto o tutto di serie. Un\'intervista di prima si toglie a mano da filo://preferences/preferences.html#restartOnboarding.',
      properties: {
        pulsante: S({ enum: ['prova_suono', 'prova_suoneria', 'prova_voce', 'prova_voce_sistema', 'rifai_intervista', 'ripristina_aspetto', 'ripristina_tutto'] }),
        tono: S(), voce: S(),
      },
      required: ['pulsante'],
    },
    TOGLI_PERMESSO_SITO: {
      via: ['impostazioni', 'togli_permesso'],
      description: 'toglie una risposta ricordata per un sito (permesso: microfono, fotocamera, appunti, posizione, notifiche, schermi, presenza, strumenti, rete, file, scaricamenti); senza permesso tutte.',
      properties: { sito: S(), permesso: S() }, required: ['sito'],
    },
    INSTALLA_AGGIORNAMENTO: {
      via: ['impostazioni', 'aggiorna'], risultato: true,
      description: 'aggiorna Filo stesso alla versione nuova (non la pagina).',
      properties: {}, required: [],
    },
    RIMEDIO_CREDITI: {
      via: ['impostazioni', 'crediti'], risultato: true,
      description: 'i rimedi dell\'avviso crediti: modello (più economici) o automatiche (spente); elenca dice chi consuma.',
      properties: { operazione: S({ enum: ['applica', 'annulla', 'elenca'] }), rimedio: S({ enum: ['modello', 'automatiche'] }) },
      required: ['operazione'],
    },
    ACCOUNT: {
      via: ['impostazioni', 'account'],
      description: 'accedi (con Google), collega_google (YouTube, Gmail, Drive nelle schede), esci.',
      properties: { cosa: S({ enum: ['accedi', 'collega_google', 'esci'] }) }, required: ['cosa'],
    },

    // ── scheda ──
    NAVIGA: {
      via: ['scheda', 'apri'],
      description: 'apre un sito in una scheda nuova (background: dietro). Per cercare dentro un sito: url la home e cerca_nel_sito le parole.',
      properties: { url: S(), etichetta: S(), background: B(), cerca_nel_sito: S() }, required: ['url'],
    },
    MOSTRA_SCHEDA: {
      via: ['scheda', 'mostra'],
      description: 'porta l\'utente su una scheda già aperta, senza ricaricarla.',
      properties: { scheda: I() }, required: ['scheda'],
    },
    CHIUDI_SCHEDE: {
      via: ['scheda', 'chiudi'],
      description: 'chiude schede per numero, per sito o tutte, tranne quelle in tranne; tutte e sito lasciano aperta questa chat.',
      properties: { schede: LISTA(I()), sito: S(), tutte: B(), tranne: LISTA(I()) }, required: [],
    },
    PULISCI_TAB: {
      via: ['scheda', 'riordina'],
      description: 'archivia le schede che non servono più, scelte da Filo.',
      properties: {}, required: [],
    },
    SCHEDE_CHIUSE: {
      via: ['scheda', 'chiuse'], risultato: true,
      description: 'cerca fra le schede chiuse o archiviate; da e a ISO o AAAA-MM-GG.',
      properties: { cerca: S(), da: S(), a: S(), motivo: S({ enum: ['mano', 'filo', 'pulizia', 'doppione', 'pagina'] }) }, required: [],
    },
    RIAPRI_SCHEDA: {
      via: ['scheda', 'riapri'], risultato: true,
      description: 'riapre com\'era una scheda trovata con chiuse.',
      properties: { id: S() }, required: ['id'],
    },
    CERCA_SALVATE: {
      via: ['scheda', 'salvate'], risultato: true,
      description: 'cerca in «Aperti per dopo»; vuoto: tutte.',
      properties: { cerca: S() }, required: [],
    },
    APRI_SALVATA: {
      via: ['scheda', 'apri_salvata'],
      description: 'apre una pagina salvata e la toglie dalla lista (tieni: resta).',
      properties: { id: S(), tieni: B() }, required: ['id'],
    },
    ZOOM_PAGINA: {
      via: ['scheda', 'zoom'],
      description: 'lo zoom della pagina davanti: percentuale 25-500 o verso; dura finché Filo non si chiude.',
      properties: { percentuale: I(), verso: S({ enum: ['in', 'out', 'reset'] }) }, required: [],
    },
    STILE_PAGINA: {
      via: ['scheda', 'stile'],
      description: 'regole CSS [{selettore, css}] sulla pagina web davanti, senza url() né @import; ricaricando se ne vanno.',
      properties: {
        regole: LISTA({ type: 'object', properties: { selettore: S(), css: S() }, required: ['selettore', 'css'] }),
        descrizione: S(),
      },
      required: ['regole'],
    },
    RIPRISTINA_STILE_PAGINA: {
      via: ['scheda', 'stile_via'],
      description: 'toglie lo stile messo con stile.',
      properties: {}, required: [],
    },
    PROXY_TAB: {
      via: ['scheda', 'paese'],
      description: 'la scheda web davanti esce da un altro paese (codice di 2 lettere).',
      properties: { country: S() }, required: ['country'],
    },
    RIMUOVI_PROXY: {
      via: ['scheda', 'paese_via'],
      description: 'connessione diretta per la scheda davanti.',
      properties: {}, required: [],
    },
    RIMUOVI_PROXY_TUTTE: {
      via: ['scheda', 'paese_via_tutte'],
      description: 'connessione diretta per tutte.',
      properties: {}, required: [],
    },
    REGOLA_PROXY_DOMINIO: {
      via: ['scheda', 'regola_paese'],
      description: 'un dominio si apre sempre da un paese (senza dominio: la scheda davanti).',
      properties: { country: S(), dominio: S() }, required: ['country'],
    },
    RIMUOVI_REGOLA_PROXY: {
      via: ['scheda', 'togli_regola_paese'],
      description: 'toglie la regola del paese di un dominio.',
      properties: { dominio: S() }, required: [],
    },
    TIENI_APERTA: {
      via: ['scheda', 'tieni_aperta'],
      description: 'la pulizia non archivia mai questo sito.',
      properties: { dominio: S() }, required: [],
    },
    NON_TENERE_APERTA: {
      via: ['scheda', 'non_tenere_aperta'],
      description: 'toglie la regola di tieni_aperta.',
      properties: { dominio: S() }, required: [],
    },
    RIPRENDI_AUDIO: {
      via: ['scheda', 'riprendi_audio'],
      description: 'riparte l\'audio di prima (senza scheda: l\'ultima che ha suonato); vai: ci porta l\'utente.',
      properties: { scheda: I(), vai: B() }, required: [],
    },
    PAUSA_AUDIO: {
      via: ['scheda', 'pausa_audio'],
      description: 'mette in pausa l\'audio (senza scheda: tutte quelle che suonano).',
      properties: { scheda: I() }, required: [],
    },
    COMANDO_FINESTRA: {
      via: ['scheda', 'finestra'],
      description: 'un controllo della finestra di Filo (account apre solo il menu).',
      properties: { comando: S({ enum: ['fullscreen', 'minimize', 'home', 'settings', 'apps', 'account', 'sidebar', 'sidebar_close', 'sidebar_lock', 'sidebar_unlock', 'aiuto'] }) },
      required: ['comando'],
    },

    // ── home ──
    CARTA_HOME: {
      via: ['home', 'carta'],
      description: 'operazione togli, rimetti, sposta (verso su|giu|cima|fondo, o prima_di), ripristina. A destra editor, suggerimenti, rapide; a sinistra timer, avvisi, scaricamenti…, detti a parole.',
      properties: { operazione: S(), carta: S(), verso: S(), prima_di: S() }, required: ['operazione'],
    },
    SPOSTA_ICONA: {
      via: ['home', 'icona'],
      description: () => {
        const D = global.SN_DISPOSIZIONE_ICONE;
        const contesti = D && D.CONTESTI ? Object.keys(D.CONTESTI).join(', ') : '';
        return 'sposta un\'icona per id (uno sbagliato torna con l\'elenco): dove barra o altro della barra laterale, fila o altro_fila del tasto destro col contesto'
          + (contesti ? ` (${contesti})` : '') + '.';
      },
      properties: { icona: S(), dove: S(), contesto: S(), prima_di: S() },
      required: ['icona', 'dove'],
    },
    PANNELLO_APP: {
      via: ['home', 'pannello'],
      description: () => {
        const P = global.SN_PANNELLI_APP;
        const cat = P ? P.catalogo('editor') : null;
        const ids = cat ? cat.elementi.map((e) => e.id).join(', ') : '';
        return 'il pannello sul bordo destro dell\'Editor: operazione apri, chiudi, blocca, sblocca, aggiungi o togli un elemento' + (ids ? ` (${ids})` : '') + '.';
      },
      properties: { operazione: S(), elemento: S() }, required: ['operazione'],
    },

    // ── promemoria ──
    TIMER: {
      via: ['promemoria', 'timer'],
      description: 'un timer di secondi, come carta nella home.',
      properties: { secondi: I(), etichetta: S() }, required: ['secondi'],
    },
    // Dentro uno strumento un dato ha un nome solo (orario, etichetta, secondi): il modello copia quello dell'azione
    // accanto, e un nome diverso per la stessa cosa veniva respinto come mancante (#1564).
    SVEGLIA: {
      via: ['promemoria', 'sveglia'],
      description: 'una sveglia che suona: orario "HH:MM" o data-ora ISO, calcolata dall\'ora del messaggio; ripeti ["lun","mer"] o "feriali", "weekend", "ogni giorno".',
      properties: { orario: S(), etichetta: S(), ripeti: RIPETI }, required: ['orario'],
    },
    MODIFICA_SVEGLIA: {
      via: ['promemoria', 'modifica'],
      description: 'sposta una sveglia (orario "HH:MM", ripeti) o cambia la durata di un timer (secondi).',
      properties: { etichetta: S(), orario: S(), secondi: I(), ripeti: RIPETI }, required: [], unoDi: ['orario', 'secondi', 'ripeti'],
    },
    CANCELLA_SVEGLIA: {
      via: ['promemoria', 'cancella'],
      description: 'toglie sveglie o timer (etichetta: una parola o l\'orario).',
      properties: { etichetta: S(), tutte: B(), tipo: S({ enum: ['sveglia', 'timer'] }) }, required: [],
    },
    EVENTO_CALENDARIO: {
      via: ['promemoria', 'evento'],
      description: 'un evento col bottone per il calendario: date "AAAA-MM-GG", ore "HH:MM" (senza: tutto il giorno).',
      properties: { data: S(), titolo: S(), ora: S(), dettagli: S(), luogo: S(), durata_min: I(), data_fine: S(), ora_fine: S() },
      required: ['data', 'titolo'],
    },

    // ── file ──
    CERCA_DOCUMENTI: {
      via: ['file', 'cerca'], risultato: true,
      description: 'cerca i documenti dell\'utente per contenuto: cosa con le parole che il documento contiene; cartella solo se detta.',
      properties: { cosa: S(), cartella: S() }, required: ['cosa'],
    },
    LEGGI_DOCUMENTO: {
      via: ['file', 'leggi'], risultato: true,
      description: 'il testo di un documento dal disco: PDF (solo così, non col terminale), Word, LibreOffice, testo.',
      properties: { percorso: S() }, required: ['percorso'],
    },
    LEGGI_FILE: {
      via: ['file', 'leggi_editor'], risultato: true,
      description: 'il contenuto di un file dell\'Editor per id.',
      properties: { fileId: S() }, required: ['fileId'],
    },
    APRI_FILE: {
      via: ['file', 'mostra'],
      description: 'mette in chat il bottone di un file, che l\'utente apre con un clic.',
      properties: { percorso: S(), etichetta: S() }, required: ['percorso'],
    },
    RINOMINA_FILE: {
      via: ['file', 'rinomina'], risultato: true,
      description: 'nomi sensati ai file (percorsi, o i nomi vuoti di una cartella; tutti: anche gli altri); nome: quello dell\'utente.',
      properties: { percorsi: LISTA(), cartella: S(), tutti: B(), nome: S() }, required: [],
    },
    ELIMINA_FILE: {
      via: ['file', 'elimina'], risultato: true,
      description: 'sposta file o cartelle nel cestino; per_sempre solo se l\'utente lo dice.',
      properties: { percorsi: LISTA(), per_sempre: B() }, required: ['percorsi'],
    },
    SALVA_APPUNTO: {
      via: ['file', 'appunto'],
      description: 'un appunto nell\'Editor: accoda finché l\'argomento è quello; nuovo: file a parte.',
      properties: { testo: S(), contesto: S(), nuovo: B() }, required: ['testo', 'contesto'],
    },

    // ── computer ──
    ESEGUI_COMANDO: {
      via: ['computer', 'comando'], risultato: true,
      description: 'un comando shell per chiamata (la cartella resta); spiegazione: cosa fa, in prima persona, per chi non conosce il terminale. Per cancellare file c\'è file(elimina).',
      properties: { comando: S(), spiegazione: S() }, required: ['comando', 'spiegazione'],
    },
    VEDI_SCHERMO: {
      via: ['computer', 'guarda'], risultato: true,
      description: 'il testo di una finestra o di uno schermo; senza finestra l\'elenco di quelle aperte. Guarda soltanto.',
      properties: { finestra: S(), domanda: S() }, required: [],
    },
    VOLUME: {
      via: ['computer', 'volume'],
      description: 'il volume del computer (livello 0-100, verso su|giu).',
      properties: { livello: I(), verso: S(), muto: B() }, required: [],
    },
    WIFI: {
      via: ['computer', 'wifi'],
      description: 'il Wi-Fi e le reti conosciute.',
      properties: { acceso: B(), rete: S(), dimentica: B(), elenca: B() }, required: [],
    },
    BLUETOOTH: {
      via: ['computer', 'bluetooth'],
      description: 'il Bluetooth e i dispositivi già abbinati.',
      properties: { acceso: B(), dispositivo: S(), collega: B(), dimentica: B(), preferito: B(), elenca: B() }, required: [],
    },
    ORDINA_DESKTOP: {
      via: ['computer', 'ordina_desktop'],
      description: 'mette in ordine le icone del desktop (ordine nome|tipo|data|dimensione, verso righe|colonne).',
      properties: { ordine: S(), verso: S(), al_contrario: B(), cartelle_prima: B() }, required: [],
    },

    // ── web ──
    CERCA_WEB: {
      via: ['web', 'cerca'], risultato: true,
      description: 'risultati con titolo, indirizzo e un pezzo di testo.',
      properties: { query: S() }, required: ['query'],
    },
    LEGGI_PAGINA: {
      via: ['web', 'leggi'], risultato: true,
      description: 'il testo di una pagina (url, o scheda aperta per numero), anche le parti chiuse; da: il seguito.',
      properties: { url: S(), scheda: I(), da: I(), cerca_nel_sito: S() }, required: [],
    },

    // ── memoria ──
    SALVA_LEZIONE: {
      via: ['memoria', 'impara'],
      description: 'una regola breve in terza persona su come comportarti con l\'utente, che vale da subito in ogni conversazione.',
      properties: { testo: S() }, required: ['testo'],
    },
    CORREGGI_MEMORIA: {
      via: ['memoria', 'correggi'],
      description: 'corregge una riga della memoria (testo: un pezzo di quella di adesso; nuovo: quella giusta).',
      properties: { testo: S(), nuovo: S() }, required: ['testo', 'nuovo'],
    },
    DIMENTICA: {
      via: ['memoria', 'dimentica'],
      description: 'nasconde una riga della memoria; per_sempre la cancella.',
      properties: { testo: S(), per_sempre: B() }, required: ['testo'],
    },
    CANCELLA_MEMORIA: {
      via: ['memoria', 'cancella_tutto'],
      description: 'cancella tutta la memoria di Filo.',
      properties: {}, required: [],
    },

    // ── filo ──
    CERCA_CHAT: {
      via: ['filo', 'cerca'], risultato: true,
      description: 'conversazioni di ogni giorno, pagine visitate, cambi; con id rilegge una conversazione (da: il seguito).',
      properties: { query: S(), id: S(), da: I() }, required: [],
    },
    ESPANDI_FILO: {
      via: ['filo', 'espandi'], risultato: true,
      description: 'il filo com\'era fra due istanti ISO (messaggi, pagine, azioni), sotto le righe del diario.',
      properties: { da: S(), a: S() }, required: ['da'],
    },
    TOGLI_CHAT: {
      via: ['filo', 'togli_chat'],
      description: 'nasconde una conversazione (senza id quella di adesso); per_sempre la cancella.',
      properties: { id: S(), per_sempre: B() }, required: [],
    },
    RIMETTI_CHAT: {
      via: ['filo', 'rimetti_chat'],
      description: 'rimette una conversazione nascosta.',
      properties: { id: S() }, required: ['id'],
    },
    CANCELLA_PAGINE: {
      via: ['filo', 'cancella_pagine'],
      description: 'cancella pagine visitate per periodo, ore, giorni, da/a o sito.',
      properties: { periodo: S({ enum: ['ultima_ora', 'oggi', 'ieri', 'tutto'] }), ore: I(), giorni: I(), da: S(), a: S(), sito: S() }, required: [],
    },
    CANCELLA_ARCHIVIO: {
      via: ['filo', 'cancella_archivio'],
      description: 'elimina per sempre schede archiviate che combaciano con query, o tutto.',
      properties: { query: S(), tutto: B() }, required: [],
    },
    ANNULLA_CAMBIO: {
      via: ['filo', 'annulla'],
      description: 'rimette com\'era un cambio (impostazione, aspetto, sveglia, proxy, zoom, icone della barra laterale o del desktop) per id «cambio <id>»; senza id l\'ultimo.',
      properties: { id: S() }, required: [],
    },

    // ── filo_su_di_se ──
    LEGGI_TRASPARENZA: {
      via: ['filo_su_di_se', 'documento'], risultato: true,
      description: () => {
        const ids = idTrasparenza();
        return `un documento di trasparenza${ids.length ? ` (${ids.join(', ')})` : ''}: modelli e aziende scelti, costi, soldi e dati. Leggilo prima di rispondere su questo.`;
      },
      properties: () => {
        const ids = idTrasparenza();
        return { doc: S(ids.length ? { enum: ids } : null) };
      },
      required: [],
    },
    CAPACITA_DETTAGLIO: {
      via: ['filo_su_di_se', 'capacita'], risultato: true,
      description: 'cosa fa, come si attiva e i limiti di una capacità di Filo, per id.',
      properties: { ids: LISTA() }, required: ['ids'],
    },
    INVIA_FEEDBACK: {
      via: ['filo_su_di_se', 'feedback'],
      description: 'una segnalazione a chi sviluppa Filo (titolo 2-6 parole), anche quando Filo non sa fare una cosa.',
      properties: { testo: S(), titolo: S() }, required: ['testo', 'titolo'],
    },
    // Vale solo nella conversazione dell'intervista di benvenuto (#524): fuori la ferma executeFiloAction.
    ONBOARDING: {
      via: ['filo_su_di_se', 'intervista'],
      description: 'intervista di benvenuto: spunta le voci fatte, nello stesso turno; autonomia, privacy, contatori mostrano la scelta; fine la chiude.',
      properties: () => {
        const O = modulo('SN_ONBOARDING', './onboarding.js');
        return {
          spunta: LISTA(S({ enum: O ? O.ITEM_IDS.slice() : [] })), autonomia: B(), contatori: B(), privacy: B(), fine: B(),
        };
      },
      required: [],
    },
  };

  const NAMES = Object.keys(TOOLS);

  // L'apertura di ogni strumento; le azioni le elenca il codice dalle righe di TOOLS.
  const STRUMENTI = {
    impostazioni: 'Impostazioni, aspetto e account di Filo.',
    scheda: 'Schede e finestra di Filo; una scheda è il suo numero in TAB APERTE.',
    home: 'Home, barra laterale, fila del tasto destro, pannello delle app.',
    promemoria: 'Timer, sveglie, calendario.',
    file: 'File del computer (percorsi come in IL COMPUTER DELL\'UTENTE, o con ~) e dell\'Editor.',
    computer: 'Il computer dell\'utente.',
    web: 'Il web.',
    memoria: 'Quello che Filo ricorda dell\'utente.',
    filo: 'Tutto quello che l\'utente ha fatto con Filo.',
    filo_su_di_se: 'Filo su di sé.',
  };
  const NOMI_STRUMENTI = Object.keys(STRUMENTI);

  // strumento → { azione: tipo }
  const AZIONI = Object.fromEntries(NOMI_STRUMENTI.map((s) => [s, {}]));
  for (const tipo of NAMES) {
    const [s, a] = TOOLS[tipo].via;
    AZIONI[s][a] = tipo;
  }

  const valore = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

  // La firma di un'azione: i parametri obbligatori nudi, gli altri con «?».
  function firma(tipo, ctx) {
    const t = TOOLS[tipo];
    const props = Object.keys(valore(t.properties, ctx) || {});
    const req = new Set(t.required || []);
    return `${t.via[1]}(${props.map((p) => (req.has(p) ? p : `${p}?`)).join(', ')})`;
  }

  // Lo stesso nome in due azioni dello stesso strumento: un tipo solo se coincide, altrimenti l'uno o l'altro, e
  // l'elenco dei valori resta solo se è lo stesso.
  function unisci(a, b) {
    if (JSON.stringify(a) === JSON.stringify(b)) return a;
    const senzaEnum = (x) => { const { enum: _e, ...r } = x; return r; };
    const tipi = [...(a.anyOf || [a]), ...(b.anyOf || [b])].map(senzaEnum);
    const unici = [];
    for (const t of tipi) if (!unici.some((u) => JSON.stringify(u) === JSON.stringify(t))) unici.push(t);
    return unici.length === 1 ? unici[0] : { anyOf: unici };
  }

  // Formato OpenRouter (stile OpenAI). Niente argomenti: gli stessi strumenti per ogni utente, sistema e ruolo, o la cache
  // si rompe dal primo byte (sentinella tests/unit/richiestaChat.test.mjs).
  function definitions() {
    const ctx = {};
    return NOMI_STRUMENTI.map((nome) => {
      const tipi = Object.values(AZIONI[nome]);
      const properties = { azione: { type: 'string', enum: Object.keys(AZIONI[nome]) } };
      for (const tipo of tipi) {
        for (const [p, sch] of Object.entries(valore(TOOLS[tipo].properties, ctx) || {})) {
          properties[p] = properties[p] ? unisci(properties[p], sch) : sch;
        }
      }
      const righe = tipi.map((tipo) => `- ${firma(tipo, ctx)}: ${valore(TOOLS[tipo].description, ctx)}`);
      return {
        type: 'function',
        function: {
          name: nome,
          description: `${STRUMENTI[nome]}\n${righe.join('\n')}`,
          parameters: { type: 'object', properties, required: ['azione'] },
        },
      };
    });
  }

  function haRisultato(type) {
    const t = TOOLS[String(type || '').toUpperCase()];
    return !!(t && t.risultato);
  }

  // Come si cita un'azione nei testi per il modello: «filo(cerca)».
  function chiamata(type) {
    const t = TOOLS[String(type || '').toUpperCase()];
    return t ? `${t.via[0]}(${t.via[1]})` : String(type || '');
  }

  // Lo strumento generale e l'azione → il tipo eseguito. Un nome di tipo (le storie di prima, le prove) vale ancora.
  // Ogni voce porta `_callId` e, se gli argomenti non si leggono o non bastano, `_argsError`: l'azione non si esegue e
  // l'errore torna al modello come esito, così riprova invece di tacere.
  function toolCallsToActions(toolCalls) {
    const out = [];
    for (const c of Array.isArray(toolCalls) ? toolCalls : []) {
      if (!c) continue;
      const nome = String(c.name || (c.function && c.function.name) || '').trim();
      if (!nome) continue;
      const rawArgs = c.arguments != null ? c.arguments : (c.function && c.function.arguments);
      let args = {};
      let argsError = null;
      if (rawArgs && typeof rawArgs === 'object') args = rawArgs;
      else if (typeof rawArgs === 'string' && rawArgs.trim()) {
        try {
          const parsed = JSON.parse(rawArgs);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
          else argsError = 'gli argomenti devono essere un oggetto JSON';
        } catch (e) {
          argsError = `argomenti non leggibili: ${e && e.message ? e.message : 'JSON non valido'}`;
        }
      }
      // `type` è nostro: un argomento omonimo non deve poter cambiare azione. I campi con «_» li scrive solo il main.
      const campi = Object.fromEntries(Object.entries(args).filter(([k]) => !k.startsWith('_') && k !== 'type'));
      let type = nome.toUpperCase();
      const strumento = AZIONI[nome.toLowerCase()];
      if (strumento) {
        const azione = String(campi.azione == null ? '' : campi.azione).trim().toLowerCase();
        delete campi.azione;
        if (strumento[azione]) type = strumento[azione];
        else if (!argsError) {
          argsError = `${azione ? `l'azione «${azione}» non c'è` : 'manca l\'azione'} in ${nome.toLowerCase()}: scegli fra ${Object.keys(strumento).join(', ')}`;
        }
      }
      // Lo schema generale non può dire i campi obbligatori di ogni azione: li controlla qui, prima del gestore.
      if (strumento && !argsError && TOOLS[type]) {
        const manca = (TOOLS[type].required || []).filter((k) => campi[k] === undefined || campi[k] === null);
        if (manca.length) argsError = `per ${chiamata(type)} manca ${manca.join(', ')}`;
        const unoDi = TOOLS[type].unoDi || [];
        if (!argsError && unoDi.length && unoDi.every((k) => campi[k] === undefined || campi[k] === null)) {
          argsError = `per ${chiamata(type)} serve almeno uno fra ${unoDi.join(', ')}`;
        }
      }
      const action = { ...campi, type, _callId: String(c.id || '') };
      if (argsError) action._argsError = argsError;
      out.push(action);
    }
    return out;
  }

  // Tolleranza per un modello che ignora gli strumenti e scrive il JSON con testo e azioni:
  // se c'è si accetta, così passa dal registro invece di finire in chat come JSON grezzo.
  function legacyEnvelope(text) {
    if (!text) return null;
    let t = String(text).trim();
    if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    if (!t.startsWith('{')) return null;
    let obj = null;
    try { obj = JSON.parse(t); } catch (_) {
      const last = t.lastIndexOf('}');
      if (last > 0) { try { obj = JSON.parse(t.slice(0, last + 1)); } catch (_) {} }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (!('text' in obj) && !Array.isArray(obj.actions)) return null;
    return {
      text: obj.text == null ? '' : String(obj.text),
      actions: (Array.isArray(obj.actions) ? obj.actions : []).filter((a) => a && typeof a === 'object')
        .map((a) => Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith('_')))),
    };
  }

  // Per un giro con chiamate il fornitore rivuole testo, chiamate e ragionamento com'erano
  // (`reasoning_details`): al posto giusto il modello riprende da dove aveva lasciato.
  function assistantMessage({ text, toolCalls, reasoningDetails }) {
    const msg = { role: 'assistant', content: text ? String(text) : '' };
    const calls = (Array.isArray(toolCalls) ? toolCalls : []).map((c, i) => ({
      id: String(c.id || `call_${i}`),
      type: 'function',
      function: {
        name: String(c.name || (c.function && c.function.name) || ''),
        arguments: typeof c.arguments === 'string' ? c.arguments
          : JSON.stringify(c.arguments != null ? c.arguments : ((c.function && c.function.arguments) || {})),
      },
    }));
    if (calls.length) msg.tool_calls = calls;
    if (Array.isArray(reasoningDetails) && reasoningDetails.length) msg.reasoning_details = reasoningDetails;
    return msg;
  }

  function toolMessage(callId, content) {
    return { role: 'tool', tool_call_id: String(callId || ''), content: String(content == null ? '' : content) };
  }

  global.SN_ACTION_TOOLS = {
    TOOLS, NAMES, STRUMENTI, NOMI_STRUMENTI, AZIONI, definitions, haRisultato, chiamata, toolCallsToActions, legacyEnvelope,
    assistantMessage, toolMessage,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
