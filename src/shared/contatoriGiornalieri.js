// I contatori anonimi (#969, #1461, #1464): cosa si conta, in che forma esce, cosa non passa. Logica pura, niente rete.
// Esce solo ciò che sta negli elenchi chiusi di questo file; le regole Firestore ne tengono la forma, e la sentinella
// tests/unit/firestoreRulesContatori.test.mjs le confronta. Misura e spedizione: src/main/services/contatori.js.

(function (global) {
  'use strict';

  // Un documento per pseudonimo e ora (#1461). I giorni rimasti in attesa da prima partono nella forma di allora.
  const VERSIONE = 2;
  const VERSIONE_GIORNO = 1;
  const COLLEZIONE = 'contatori-giornalieri';
  // Le misure delle chiamate ai modelli (#1464) partono in un documento a parte, con lo stesso id dell'ora: le regole
  // dell'ora sono già vicine al tetto di mille espressioni che Firestore valuta per scrittura.
  const VERSIONE_CHIAMATE = 1;
  const COLLEZIONE_CHIAMATE = 'contatori-chiamate';

  // Il tipo di guasto di una chiamata: l'elenco chiuso della decisione dell'owner (#969).
  const ERRORI = Object.freeze(['rete', 'tempo', 'crediti', 'chiave', 'nessun_host', 'fornitore']);
  const OS = Object.freeze(['win', 'mac', 'linux', 'altro']);
  // L'attesa in fasce, e non una mediana: le fasce di cento installazioni si sommano, le mediane no.
  const FASCE = Object.freeze([
    ['ms500', 500], ['s1', 1000], ['s2', 2000], ['s5', 5000], ['s10', 10000], ['s30', 30000], ['oltre', Infinity],
  ]);
  const NOMI_FASCE = Object.freeze(FASCE.map(([k]) => k));
  // La posizione della voce scelta in un pannello di ricerca, in fasce come le attese.
  const POSIZIONI = Object.freeze([['p1', 1], ['p2', 2], ['p3', 3], ['p5', 5], ['p10', 10], ['oltre', Infinity]]);
  const NOMI_POSIZIONI = Object.freeze(POSIZIONI.map(([k]) => k));

  const CAMPI_GIORNO = Object.freeze(['v', 'pseudonimo', 'giorno', 'mese', 'app', 'os', 'uso', 'errori']);
  const MISURE_ORA = Object.freeze(['uso', 'errori', 'azioni', 'impostazioni', 'ricerche', 'correttore', 'conferme', 'annullati',
    'anticipi', 'chiedi', 'erroriVisti', 'intervista', 'primeVolte']);
  const CAMPI = Object.freeze(['v', 'pseudonimo', 'giorno', 'mese', 'ora', 'app', 'os', 'primo', ...MISURE_ORA]);

  // ── Le chiamate ai modelli (#1464) ────────────────────────────────────────
  // Misurate al cancello, sul tentativo che ha servito: per funzione e modello, «modello|…|n». Fasce in token da 1024.
  const K = 1024;
  const FASCE_CONTESTO = Object.freeze([['t2k', 2 * K], ['t8k', 8 * K], ['t16k', 16 * K], ['t32k', 32 * K], ['t64k', 64 * K],
    ['t128k', 128 * K], ['oltre', Infinity]]);
  // «nd»: l'host non dice quanta parte del contesto ha letto dalla cache, o quanto ha ragionato.
  const ND = 'nd';
  const FASCE_CACHE = Object.freeze(['zero', 'q25', 'q50', 'q75', 'q100', ND]);
  const FASCE_RAGIONAMENTO = Object.freeze([['r0', 0], ['r1k', K], ['r4k', 4 * K], ['r16k', 16 * K], ['oltre', Infinity]]);
  const FASCE_USCITA = Object.freeze([['o256', 256], ['o1k', K], ['o4k', 4 * K], ['o16k', 16 * K], ['oltre', Infinity]]);
  const FINI = Object.freeze(['stop', 'length', 'tool_calls', 'filtro', 'altro']);
  const TENTATIVI = Object.freeze(['t1', 't2', 't3', 't4_oltre']);
  // Il costo detto dal router, quello stimato dal listino delle Opzioni, quello chiesto dopo (voce, dettatura, una
  // risposta rotta a metà). Si somma in centomillesimi di dollaro.
  const ORIGINI_SPESA = Object.freeze(['router', 'stima', 'tardiva']);
  const CENTOMILLESIMI = 100000;
  const FASCE_CHIAMATE = Object.freeze([['c1', 1], ['c2', 2], ['c3_5', 5], ['c6_12', 12], ['oltre', Infinity]]);
  // Quando Filo cambia la richiesta per stare nei limiti del modello: la conversazione stretta dopo un rifiuto per
  // lunghezza e la finestra imparata più piccola del tetto delle Opzioni (la chat), il ragionamento tolto e richiesto.
  const ADATTAMENTI = Object.freeze(['contesto_stretto', 'finestra_piccola', 'ragionamento_tolto']);
  const nomi = (fasce) => fasce.map(([k]) => k);
  // Quello che segue il modello in ogni voce, per misura: l'elenco chiuso intero.
  const RESTI = Object.freeze({
    contesto: Object.freeze(nomi(FASCE_CONTESTO)),
    cache: FASCE_CACHE,
    ragionamento: Object.freeze([...nomi(FASCE_RAGIONAMENTO), ND]),
    uscita: Object.freeze(nomi(FASCE_USCITA).flatMap((f) => FINI.map((x) => `${f}|${x}`))),
    ripieghi: Object.freeze(TENTATIVI.flatMap((t) => [`${t}|si`, `${t}|no`])),
    spesa: ORIGINI_SPESA,
    adattamenti: ADATTAMENTI,
  });
  const MISURE_MODELLI = Object.freeze(Object.keys(RESTI));
  const MISURE_CHIAMATE = Object.freeze([...MISURE_MODELLI, 'chiamate']);
  const CAMPI_CHIAMATE = Object.freeze(['v', 'pseudonimo', 'giorno', 'mese', 'ora', 'app', 'os', ...MISURE_CHIAMATE]);
  // ── Le attività di Filo da solo o a metà con la persona (#1467) ─────────────
  // Nel loro documento, accanto all'ora e con lo stesso id, come le chiamate. Per misura una mappa «combinazione → n»:
  // la combinazione è fatta di nomi da elenchi chiusi uniti da «|», e le sue parti stanno in DIMENSIONI_ATTIVITA.
  const VERSIONE_ATTIVITA = 1;
  const COLLEZIONE_ATTIVITA = 'contatori-attivita';
  const MIN_MS = 60 * 1000;
  const ORA_MS = 60 * MIN_MS;
  const GIORNO_MS = 24 * ORA_MS;
  const SI_NO = Object.freeze(['si', 'no']);
  const FASCE_PASSI = Object.freeze([['p0', 0], ['p1', 1], ['p2_5', 5], ['p6_20', 20], ['oltre', Infinity]]);
  const FASCE_TROVATI = Object.freeze([['n0', 0], ['n1', 1], ['n2_oltre', Infinity]]);
  const FASCE_RISULTATI = Object.freeze([['r0', 0], ['r1_2', 2], ['r3_5', 5], ['oltre', Infinity]]);
  const FASCE_FRASI = Object.freeze([['f0', 0], ['f1', 1], ['f2_5', 5], ['oltre', Infinity]]);
  const FASCE_LEZIONI = Object.freeze([['l0', 0], ['l1', 1], ['l2_3', 3], ['oltre', Infinity]]);
  const FASCE_NON_RIMESSE = Object.freeze([['r0', 0], ['r1', 1], ['r2_5', 5], ['oltre', Infinity]]);
  const FASCE_SCHEDE = Object.freeze([['s0', 0], ['s1', 1], ['s2_5', 5], ['s6_20', 20], ['oltre', Infinity]]);
  const ETA_RIGA = Object.freeze([['giorno', GIORNO_MS], ['settimana', 7 * GIORNO_MS], ['mese', 31 * GIORNO_MS], ['oltre', Infinity]]);
  const ETA_RIAPERTA = Object.freeze([['min10', 10 * MIN_MS], ['ora', ORA_MS], ['giorno', GIORNO_MS], ['oltre', Infinity]]);
  const ETA_HOME = Object.freeze([['ora', ORA_MS], ['giorno', GIORNO_MS], ['oltre', Infinity]]);
  const POSIZIONI_SUGGERIMENTO = Object.freeze([['1', 1], ['2', 2], ['3', 3], ['4_oltre', Infinity]]);
  const ESITI_AIUTO = Object.freeze(['fatto', 'chiusa_prima', 'tetto_passi', 'errore']);
  const DA_RICERCA = Object.freeze(['chat', 'aiuto']);
  const FORNITORI_RICERCA = Object.freeze(['tavily', 'duckduckgo', 'nessuno']);
  // I motivi con cui SN_ASCOLTO chiude una sessione del microfono.
  const MOTIVI_DETTATURA = Object.freeze(['utente', 'finito', 'muto', 'tempo', 'errore', 'altro', 'annulla']);
  // «a_mano»: inviata dalla persona senza cambiarla; «nessuno»: niente da inviare (nessuna frase, o la dettatura in un
  // campo di una pagina, che non ha un invio).
  const INVII_DETTATURA = Object.freeze(['da_sola', 'cambiata', 'tenuta', 'annullata', 'a_mano', 'nessuno']);
  const VOCI_LETTURA = Object.freeze(['modello', 'browser', 'mista']);
  // Perché la lettura è passata alla voce del browser: i codici che l'avviso spiega, la chiave rifiutata, nessun modello.
  const CODICI_LETTURA = Object.freeze(['NO_API_KEY', 'LIMIT_REACHED', 'NO_MODEL_FOR_ACTION', 'NO_OPEN_WEIGHTS_MODEL',
    'NO_ALLOWED_HOST', 'TTS_VOICE_REQUIRED', 'TTS_VOICE_UNKNOWN']);
  const MOTIVI_LETTURA = Object.freeze(['nessuno', ...CODICI_LETTURA.map((c) => c.toLowerCase()), 'chiave_rifiutata',
    'no_tts_model', 'altro']);
  // «q100»: fermata nell'ultimo quarto; «fine»: letta fino in fondo.
  const FINO_LETTURA = Object.freeze(['q25', 'q50', 'q75', 'q100', 'fine']);
  const ESITI_COMPATTAZIONE = Object.freeze(['nessuna', 'applicata', 'rimandata']);
  const VIE_MEMORIA = Object.freeze(['quaderno', 'chat']);
  const OPERAZIONI_MEMORIA = Object.freeze(['togli', 'correggi', 'ripristina', 'svuota']);
  const RIGHE_MEMORIA = Object.freeze(['profilo', 'preferenze', 'espansioni', 'lezione', 'tutte']);
  const TRIGGER_PULIZIA = Object.freeze(['idle', 'reopen', 'manual']);
  const CHIUSE_DA = Object.freeze(['pulizia', 'duplicato', 'persona']);
  const ESITI_HOME = Object.freeze(['generata', 'senza_ai_chiave', 'senza_ai_pesi_aperti', 'senza_ai_modelli']);
  // Il tipo dell'azione di un suggerimento cresce col registro: nelle regole ne sta la forma, l'elenco lo tiene l'app.
  const TIPO_SUGGERIMENTO = 'tipo';
  const nomiDi = (fasce) => Object.freeze(fasce.map(([k]) => k));
  const ND_ETA = 'nd';
  const conNd = (fasce) => Object.freeze([...nomiDi(fasce), ND_ETA]);
  // Per misura, le forme possibili della combinazione: ogni forma è l'elenco chiuso di ogni sua parte.
  const DIMENSIONI_ATTIVITA = Object.freeze({
    aiuto: [[ESITI_AIUTO, nomiDi(FASCE_PASSI), nomiDi(FASCE_PASSI), nomiDi(FASCE_TROVATI), nomiDi(FASCE_TROVATI)]],
    ricercaWeb: [[DA_RICERCA, FORNITORI_RICERCA, SI_NO, nomiDi(FASCE_RISULTATI)], [['aiuto'], ['al_tetto']]],
    dettatura: [[MOTIVI_DETTATURA, nomiDi(FASCE_FRASI), INVII_DETTATURA, SI_NO]],
    lettura: [[VOCI_LETTURA, MOTIVI_LETTURA, FINO_LETTURA]],
    lezioni: [[['nulla']], [nomiDi(FASCE_LEZIONI), nomiDi(FASCE_LEZIONI)]],
    compattazioni: [[ESITI_COMPATTAZIONE, nomiDi(FASCE_NON_RIMESSE)]],
    memoria: [[VIE_MEMORIA, OPERAZIONI_MEMORIA, RIGHE_MEMORIA, conNd(ETA_RIGA)]],
    pulizia: [[TRIGGER_PULIZIA, nomiDi(FASCE_SCHEDE), nomiDi(FASCE_SCHEDE), nomiDi(FASCE_SCHEDE), SI_NO]],
    riaperte: [[CHIUSE_DA, nomiDi(ETA_RIAPERTA)]],
    home: [[ESITI_HOME]],
    suggerimenti: [[TIPO_SUGGERIMENTO, nomiDi(POSIZIONI_SUGGERIMENTO), conNd(ETA_HOME)]],
  });
  const MISURE_ATTIVITA = Object.freeze(Object.keys(DIMENSIONI_ATTIVITA));
  const CAMPI_ATTIVITA = Object.freeze(['v', 'pseudonimo', 'giorno', 'mese', 'ora', 'app', 'os', ...MISURE_ATTIVITA]);
  // Le combinazioni diverse di una misura in un'ora: oltre, la nuova si somma in «altro», e il conto non perde niente.
  const TETTO_VOCI_ATTIVITA = 100;

  // Tutto quello che un'ora tiene sul disco, nei tre documenti.
  const MISURE = Object.freeze([...MISURE_ORA, ...MISURE_CHIAMATE, ...MISURE_ATTIVITA]);
  // Il primo documento di un giorno, o di un mese, di una copia di Filo: chi conta le installazioni legge solo quelli.
  const PRIMI = Object.freeze(['', 'giorno', 'mese']);

  // ── Gli elenchi chiusi ────────────────────────────────────────────────────
  // Chi ha cambiato un'impostazione: a mano, chiedendolo a Filo, Filo da sé, o un file di dati importato.
  const VIE = Object.freeze(['mano', 'chat', 'auto', 'import']);
  // «menu»: ogni menu a comparsa di Filo (Impostazioni, App, profilo, tasto destro su una scheda, i menu della barra).
  const PANNELLI = Object.freeze(['cerca-filo', 'incolla', 'font', 'modello', 'barra-laterale', 'tasto-destro', 'menu']);
  // Il correttore: parola rossa, frase blu, coerenza ocra; «suggerimento» è il posto delle proposte in arrivo (#1446–#1449).
  const TIPI_PROPOSTA = Object.freeze(['ortografia', 'frase', 'coerenza', 'suggerimento']);
  const ESITI_PROPOSTA = Object.freeze(['mostrata', 'accettata', 'rifiutata', 'ignorata']);
  // I cinque ingressi della tabella dei permessi (patterns/azioni-di-filo-livello-di-sicurezza-statico-nel-registro.md).
  const LIVELLI_AUTONOMIA = Object.freeze(['conservativo', 'default', 'automatico', 'yolo']);
  const STATI_COMPITO = Object.freeze(['pulito', 'contaminato']);
  const COSTI = Object.freeze(['0', '1', '2', '3']);
  const PERIMETRI = Object.freeze(['dentro', 'fuori']);
  const ORIGINI = Object.freeze(['chat', 'automazione']);
  const RISPOSTE = Object.freeze(['si', 'chiede', 'conferma', 'no', 'propone']);
  const ESITI_CONFERMA = Object.freeze(['automatica', 'approvata', 'rifiutata', 'senza-risposta', 'negata', 'pannello']);
  // Ciò che Filo cambia in una pagina e che Ctrl/Cmd+Z lì disfa: si conta accanto ai tipi delle azioni della chat.
  const ANNULLABILI_IN_PAGINA = Object.freeze(['correzione', 'correzione-automatica', 'modifica-testo']);
  // Dove un processo è caduto o si è bloccato, e perché, come lo dice Electron.
  const DOVE_CRASH = Object.freeze(['scheda', 'finestra', 'vista', 'processo']);
  const MOTIVI_CRASH = Object.freeze(['abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure',
    'memory-eviction', 'altro']);
  // Il guasto che una persona legge in una risposta: i tipi delle chiamate più i rifiuti che non sono guasti di rete.
  const TIPI_ERRORE_VISTO = Object.freeze([...ERRORI, 'senza_chiave', 'limite_spesa', 'senza_modello', 'senza_pesi_aperti',
    'dati_fornitore', 'risposta_tagliata', 'tetto_risposta', 'modello_assente', 'moderazione', 'troppe_richieste', 'altro']);
  // Gli avvisi d'errore dei content script, per chiave del testo: mai il testo (tests/unit/contatoriAgganci.test.mjs).
  const AVVISI_ERRORE = Object.freeze(['toast_paste_failed', 'err_no_selection', 'toast_save_failed', 'toast_image_save_failed',
    'toast_video_save_failed', 'toast_audio_save_failed', 'toast_file_save_failed', 'toast_pip_failed', 'err_provider_failed',
    'err_color_picker_unsupported', 'qr_error', 'toast_page_translate_failed', 'tts_model_fallback_reason',
    'toast_cannot_paste_image', 'toast_not_an_address', 'toast_media_stream_only', 'tts_not_supported',
    'menu_dictate_not_supported', 'toast_transcribe_empty', 'download_failed',
    // Quelli che Filo manda a tutte le schede dal main, e quelli delle sue pagine (la barra delle schede, i Mazzi).
    'crediti_finiti', 'tetto_automatiche', 'pesi_aperti_violati', 'allegati_non_caricati', 'accesso_non_riuscito',
    'mazzi_non_riuscito',
    // Quelli della cornice della finestra, della barra delle schede e dell'Editor.
    'dati_illeggibili', 'dati_non_salvati', 'segnalazione_non_partita', 'aggiornamento_non_avviato', 'scheda_da_altro_paese',
    'file_non_aperto', 'cartella_non_aperta', 'nome_non_rimesso', 'editor_non_salvato', 'titolo_non_generato',
    // I comandi del computer dalla home, e la lettura ad alta voce che ripiega sulla voce del sistema.
    'comando_sistema_non_riuscito', 'tts_model_fallback', 'tts_model_fallback_nokey']);
  // I passi dell'intervista oltre alle sue voci, e le scelte che vi si fanno.
  const PASSI_EXTRA = Object.freeze(['chiusura']);
  const SCELTE_INTERVISTA = Object.freeze(['spuntata', 'abbandono', 'si', 'no', ...LIVELLI_AUTONOMIA,
    'completa', 'anticipata', 'saltata', 'uscita', 'tetto']);
  const AVVIO = 'avvio';

  // Tetti larghi: in un'ora le combinazioni vere sono poche; oltre si somma in «altro», detto, e non si perde niente.
  const TETTO_COMBINAZIONI = 50;
  // Gli errori di un'ora per funzione: trenta combinazioni di modello e host bastano anche a un pomeriggio di guasti.
  const TETTO_ERRORI_ORA = 30;
  const TETTO_CONFERME = 20;
  const TETTO_VALORI = 12;
  const TETTO_PRIME_VOLTE = 400;
  // Le voci con un modello di un'ora in una misura delle chiamate, su tutte le funzioni insieme: oltre, il modello
  // diventa «altro». Le righe «altro» restano libere, così la somma non perde niente.
  const TETTO_MODELLI_ORA = 80;
  // Due mesi di ore in attesa, e trecento invii a giro: un server tornato dopo settimane si rimette in pari in un giorno.
  const TETTO_ORE_IN_ATTESA = 62 * 24;
  const TETTO_GIORNI_IN_ATTESA = 62;
  const TETTO_INVII_PER_GIRO = 300;
  // Una richiesta rifatta entro questo tempo è una richiesta ripetuta: la prima risposta non è bastata.
  const RIPETUTA_MS = 10 * 1000;
  // Ctrl/Cmd+Z o «annulla» entro questo tempo da un'azione di Filo la disfanno.
  const ANNULLO_MS = 30 * 1000;

  const MAX_CONTO = 999999999;
  const PSEUDONIMO_RE = /^[0-9a-f]{20}$/;
  const GIORNO_RE = /^20\d{2}-[01]\d-[0-3]\d$/;
  const ORA_RE = /^([01]\d|2[0-3])$/;
  const CHIAVE_ORA_RE = /^20\d{2}-[01]\d-[0-3]\dT([01]\d|2[0-3])$/;
  const APP_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;
  // Un id di modello come lo scrive il router («fornitore/nome:variante»). Quello che non gli somiglia, compreso un
  // testo scritto a mano nelle Opzioni, esce come «altro».
  const MODELLO_RE = /^[a-z0-9][a-z0-9._-]{0,59}(?:\/[a-z0-9][a-z0-9._-]{0,79})?(?::[a-z0-9._-]{1,30})?$/;
  // Chi ha servito, come lo dichiara il router («DeepInfra», «Google Vertex»): mai scritto da chi usa Filo.
  const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,47}$/;
  const ALTRO = 'altro';

  // ── Le forme di quello che esce ───────────────────────────────────────────
  // Ogni valore annidato esce come UNA stringa di forma fissa: le regole Firestore non sanno passare in rassegna una
  // mappa, ma ne uniscono valori e chiavi in una stringa sola, che si misura e si confronta. Le regole ne tengono la
  // copia esatta. Le chiavi degli elenchi che crescono a ogni funzione nuova (azioni, impostazioni, tipi d'azione)
  // hanno nelle regole la loro forma, non l'elenco: l'elenco chiuso lo tiene l'app, che ricostruisce ogni documento da lì.
  const N = '[0-9]{1,9}';
  const F7 = `${N}(,${N}){6}`;
  const P6 = `${N}(,${N}){5}`;
  const MOD = '[a-z0-9._:/-]{1,120}';
  const alternative = (l) => `(${l.join('|')})`;
  const forma = (voce) => `^${voce}(;${voce})*$`;
  const USO_FORMA = `^${N};${F7}$`;
  const VOCE_ERRORE = `${MOD}[|][A-Za-z0-9 ._-]{0,48}[|]${alternative(ERRORI)}[|]${N}`;
  const ERRORI_FORMA = forma(VOCE_ERRORE);
  // Usi dei modelli e azioni: quante, attesa fino alla prima cosa visibile, attesa fino alla fine, quante rifatte subito.
  const MISURA_FORMA = `^${N};${F7};${F7};${N}$`;
  const VOCE_IMPOSTAZIONE = `[A-Za-z0-9_.-]{1,40}[|]${alternative(VIE)}[|]${N}`;
  const IMPOSTAZIONI_FORMA = forma(VOCE_IMPOSTAZIONE);
  // Ricerche: aperture, attesa fino alla scelta, posizione della voce scelta, chiusure senza scelta.
  const RICERCA_FORMA = `^${N};${F7};${P6};${N}$`;
  const VOCE_PROPOSTA = `${MOD}[|]${N},${N},${N},${N}`;
  const CORRETTORE_FORMA = forma(VOCE_PROPOSTA);
  const conAltro = (l) => alternative([...l, ALTRO]);
  const CHIAVE_CONFERMA = [conAltro(LIVELLI_AUTONOMIA), conAltro(STATI_COMPITO), conAltro(COSTI), conAltro(PERIMETRI),
    conAltro(ORIGINI), conAltro(RISPOSTE), alternative(ESITI_CONFERMA)].join('[|]');
  const VOCE_CONFERMA = `${CHIAVE_CONFERMA}[|]${N}`;
  const CONFERME_FORMA = forma(VOCE_CONFERMA);
  const CONTO_FORMA = `^${N}$`;
  const ANTICIPO_FORMA = `^${N};${N}$`;
  const VOCE_INTERVISTA = `[a-z0-9_-]{1,30}[|]${N}`;
  const INTERVISTA_FORMA = forma(VOCE_INTERVISTA);
  const CHIAVE_AZIONE_FORMA = '^[a-z0-9][a-z0-9-]{0,59}$';
  const CHIAVE_IMPOSTAZIONE_FORMA = '^[A-Za-z0-9_.*-]{1,80}$';
  const TIPO_AZIONE_FORMA = '^[A-Za-z][A-Za-z0-9_-]{0,39}$';
  const ERRORE_VISTO_FORMA = '^[a-z0-9_:.-]{1,80}$';
  const PASSO_FORMA = '^[a-z0-9_-]{1,30}$';
  // Le misure delle chiamate: «modello|resto|n», col resto dal suo elenco chiuso; le chiamate per uso in cinque fasce.
  const RESTI_FORMA = Object.freeze({
    contesto: alternative(RESTI.contesto), cache: alternative(RESTI.cache), ragionamento: alternative(RESTI.ragionamento),
    uscita: `${alternative(nomi(FASCE_USCITA))}[|]${alternative(FINI)}`, ripieghi: `${alternative(TENTATIVI)}[|](si|no)`,
    spesa: alternative(RESTI.spesa), adattamenti: alternative(RESTI.adattamenti),
  });
  const FORME_MODELLI = Object.freeze(Object.fromEntries(MISURE_MODELLI.map((c) => [c, forma(`${MOD}[|]${RESTI_FORMA[c]}[|]${N}`)])));
  const CHIAMATE_FORMA = `^${N}(,${N}){4}$`;
  // Le attività: per misura la forma di una combinazione (le chiavi); i valori sono conti.
  const parteForma = (d) => (d === TIPO_SUGGERIMENTO ? TIPO_AZIONE_FORMA.slice(1, -1) : alternative(d));
  const FORME_ATTIVITA = Object.freeze(Object.fromEntries(MISURE_ATTIVITA.map((m) => [m,
    `^${alternative([...DIMENSIONI_ATTIVITA[m].map((f) => f.map(parteForma).join('[|]')), ALTRO])}$`])));

  const re = (s) => new RegExp(s);
  const USO_RE = re(USO_FORMA);
  const ERRORI_RE = re(ERRORI_FORMA);
  const MISURA_RE = re(MISURA_FORMA);
  const IMPOSTAZIONI_RE = re(IMPOSTAZIONI_FORMA);
  const RICERCA_RE = re(RICERCA_FORMA);
  const CORRETTORE_RE = re(CORRETTORE_FORMA);
  const CONFERME_RE = re(CONFERME_FORMA);
  const CONTO_RE = re(CONTO_FORMA);
  const ANTICIPO_RE = re(ANTICIPO_FORMA);
  const INTERVISTA_RE = re(INTERVISTA_FORMA);
  const MODELLI_RE = Object.freeze(Object.fromEntries(MISURE_MODELLI.map((c) => [c, re(FORME_MODELLI[c])])));
  const CHIAMATE_RE = re(CHIAMATE_FORMA);

  // Il tetto di caratteri di ogni valore annidato, misurato sulla sua voce più lunga possibile, con margine.
  const TETTO_CARATTERI_USO = 80;
  const TETTO_CARATTERI_ERRORI = 190 * TETTO_COMBINAZIONI;
  const TETTO_CARATTERI_ERRORI_ORA = 190 * TETTO_ERRORI_ORA;
  const TETTO_CARATTERI_MISURA = 180;
  const TETTO_CARATTERI_IMPOSTAZIONE = 60 * TETTO_VALORI;
  const TETTO_CARATTERI_RICERCA = 160;
  const TETTO_CARATTERI_CORRETTORE = 170 * TETTO_COMBINAZIONI;
  const TETTO_CARATTERI_CONFERME = 80 * TETTO_CONFERME;
  const TETTO_CARATTERI_CONTO = 9;
  const TETTO_CARATTERI_ANTICIPO = 19;
  const TETTO_CARATTERI_INTERVISTA = 45 * SCELTE_INTERVISTA.length;
  // Una funzione sola può avere tutte le voci col modello dell'ora, più una riga «altro» per resto.
  const lungo = (campo) => Math.max(...RESTI[campo].map((r) => r.length));
  const TETTI_CARATTERI_MODELLI = Object.freeze(Object.fromEntries(MISURE_MODELLI.map((c) => [c,
    TETTO_MODELLI_ORA * (120 + lungo(c) + 13) + RESTI[c].length * (ALTRO.length + lungo(c) + 13)])));
  const TETTO_CARATTERI_CHIAMATE = 49;
  // Le chiavi di una misura delle attività: tutte le combinazioni ammesse più «altro», alla loro lunghezza massima.
  const lungaParte = (d) => (d === TIPO_SUGGERIMENTO ? 40 : Math.max(...d.map((x) => x.length)));
  const lungaChiave = (m) => Math.max(ALTRO.length,
    ...DIMENSIONI_ATTIVITA[m].map((f) => f.reduce((a, d) => a + lungaParte(d), f.length - 1)));
  const TETTI_CHIAVI_ATTIVITA = Object.freeze(Object.fromEntries(MISURE_ATTIVITA.map((m) => [m,
    (TETTO_VOCI_ATTIVITA + 1) * (lungaChiave(m) + 1)])));
  const TETTO_CARATTERI_ATTIVITA = (TETTO_VOCI_ATTIVITA + 1) * 10;

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const intero = (n) => Number.isInteger(n) && n >= 0;
  const oggetto = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const conto = (n) => (intero(n) ? Math.min(n, MAX_CONTO) : 0);

  // ── I cataloghi, letti dai moduli che li possiedono ─────────────────────────
  function censimento() {
    const U = global.SN_MODEL_USAGE;
    return (U && Array.isArray(U.ENTRIES)) ? U.ENTRIES : [];
  }

  // Le funzioni dell'app che usano un modello: quelle di chi usa Filo e quelle dell'owner che girano sul suo computer.
  // I punti del server (giudici, sanificatore) non passano di qui.
  function funzioni() {
    return censimento().filter((e) => (e.from === 'user' && e.ref) || (e.from === 'owner' && e.action)).map((e) => e.id);
  }

  function funzioneDi(action) {
    if (!action) return '';
    const e = censimento().find((x) => (x.from === 'user' && x.ref === action) || (x.from === 'owner' && x.action === action));
    return e ? e.id : '';
  }

  // Le azioni di cui si misura l'attesa: il manifesto delle capacità, più l'avvio di Filo.
  function azioni() {
    const K = global.SN_CAPABILITIES;
    const ids = K && Array.isArray(K.CAPABILITIES) ? K.CAPABILITIES.map((c) => c.id) : [];
    return [...ids, AVVIO];
  }

  // Le icone del tasto destro e della barra laterale, per capacità: un'icona vale l'azione che fa.
  const AZIONE_DI_ICONA = Object.freeze({
    translate: 'translate-page', screenshot: 'screenshot', screenshotCrop: 'screenshot', transcribe: 'ocr',
    share: 'share-copy-link', saveForLater: 'save-for-later', qrCode: 'qr-code', colorPicker: 'color-picker',
    fullscreen: 'fullscreen', back: 'navigate-back-forward', forward: 'navigate-back-forward', reload: 'reload',
    closeTab: 'close-tab', newTab: 'new-tab', incognito: 'incognito', openOptions: 'options-models', home: 'home',
    editorApp: 'editor', feedbackApp: 'feedback',
  });

  // Le pagine di Filo aperte da un gesto (una voce del menu «App», un'icona, la barra): l'azione è la pagina che si
  // apre, da qualunque strada ci si arrivi.
  const AZIONE_DI_PAGINA = Object.freeze({
    'filo://editor/': 'editor', 'filo://feedback/': 'feedback', 'filo://options/options.html': 'options-models',
    'filo://options/': 'preferences', 'filo://preferences/': 'preferences', 'filo://history/': 'history',
    'filo://downloads/': 'downloads-list', 'filo://board/': 'board', 'filo://redteam/': 'red-team',
    'filo://home/': 'open-for-later', 'filo://credits/': 'credits', 'filo://quaderno/': 'filo-memory',
    'filo://decks/': 'deck-builder', 'filo://security/': 'security', 'filo://transparency/': 'transparency-docs',
    'filo://spellcheck/': 'spellcheck-manage',
  });
  function azioneDiPagina(url) {
    const u = String(url || '');
    const k = Object.keys(AZIONE_DI_PAGINA).find((p) => u.startsWith(p));
    return k && azioni().includes(AZIONE_DI_PAGINA[k]) ? AZIONE_DI_PAGINA[k] : '';
  }

  // Le azioni che l'Aiuto fa da sé nella pagina (copia, cerca, condividi) non stanno nel registro: chiedono con un tipo solo.
  const AZIONE_PAGINA = 'AZIONE_PAGINA';
  function tipiAzione() {
    const L = global.SN_ACTION_LEVELS;
    return [...(L && L.REGISTRY ? Object.keys(L.REGISTRY) : []), AZIONE_PAGINA];
  }

  // Le impostazioni che hanno un nome nel registro dei cambi, più quanto Filo fa da solo, che il registro non annulla
  // ma che conta (#1442). L'interruttore dei contatori no: spento, non esce niente, nemmeno il suo cambio.
  const IMPOSTAZIONI_EXTRA = Object.freeze({ 'autonomia.livello': LIVELLI_AUTONOMIA, 'autonomia.*': null });
  const MAI_CONTATE = Object.freeze(['contatori.attivi']);
  // Calcolato una volta per catalogo: ogni scrittura delle impostazioni ci passa, per ogni foglia cambiata.
  let catalogo = null;
  function catalogoImpostazioni() {
    const K = global.SN_CAMBI;
    const fonte = K && oggetto(K.VOCI) ? K.VOCI : null;
    if (catalogo && catalogo.fonte === fonte) return catalogo;
    const voci = {};
    if (fonte) for (const [k, v] of Object.entries(fonte)) if (!(v && v.segreto) && !MAI_CONTATE.includes(k)) voci[k] = v || {};
    for (const [k, valori] of Object.entries(IMPOSTAZIONI_EXTRA)) voci[k] = { valoriContati: valori };
    const jolly = Object.keys(voci).filter((k) => k.endsWith('.*')).sort((a, b) => b.length - a.length);
    catalogo = { fonte, voci, jolly };
    return catalogo;
  }
  function vociImpostazioni() { return catalogoImpostazioni().voci; }
  function chiaviImpostazioni() { return Object.keys(vociImpostazioni()); }

  // La voce del catalogo di un percorso scritto: quella esatta, o la jolly «base.*» (mai il pezzo dopo la base, che
  // può essere un nome scritto da chi usa Filo). Un percorso senza nome esce come «altro».
  function chiaveImpostazione(percorso) {
    const p = String(percorso || '');
    if (MAI_CONTATE.includes(p)) return '';
    const { voci, jolly } = catalogoImpostazioni();
    if (has(voci, p) && !p.endsWith('.*')) return p;
    return jolly.find((k) => p.startsWith(k.slice(0, -1))) || ALTRO;
  }

  // Il valore esce solo se viene anch'esso da un elenco chiuso: acceso/spento, o uno dei valori nominati. Altrimenti
  // si sa solo che è cambiato.
  function valoreImpostazione(chiave, v) {
    if (typeof v === 'boolean') return v ? 'acceso' : 'spento';
    const voce = vociImpostazioni()[chiave];
    if (!voce || (typeof v !== 'string' && typeof v !== 'number')) return 'cambiato';
    const s = String(v);
    const elenco = Array.isArray(voce.valoriContati) ? voce.valoriContati : (oggetto(voce.valori) ? Object.keys(voce.valori) : []);
    return elenco.includes(s) && /^[A-Za-z0-9_.-]{1,40}$/.test(s) ? s : 'cambiato';
  }

  // Il valore com'è nell'ora: già ridotto da `valoreImpostazione`, si rilegge contro lo stesso elenco.
  function valoreScritto(chiave, s) {
    return ['acceso', 'spento', 'cambiato'].includes(s) ? s : valoreImpostazione(chiave, s);
  }

  function viaDi(prov) {
    const v = String((prov && prov.via) || '');
    if (v === 'chat' || v === 'assistente') return 'chat';
    if (v === 'interfaccia' || v === 'pagina') return 'mano';
    if (v === 'importazione') return 'import';
    return 'auto';
  }

  function passiIntervista() {
    const O = global.SN_ONBOARDING;
    return [...(O && Array.isArray(O.ITEM_IDS) ? O.ITEM_IDS : []), ...PASSI_EXTRA];
  }

  // Gli errori che una persona vede: crash e blocchi, pagine d'errore di rete (il codice di Chromium è un numero),
  // risposte non arrivate (in chat o in una pagina), avvisi d'errore per chiave.
  function erroreVisto(tipo) {
    const s = String(tipo || '');
    const [a, b, c] = s.split(':');
    if (a === 'crash') return DOVE_CRASH.includes(b) && MOTIVI_CRASH.includes(c) ? s : '';
    if (a === 'bloccata') return DOVE_CRASH.includes(b) && c === undefined ? s : '';
    if (a === 'rete') return /^(-\d{1,4}|bloccato)$/.test(b || '') && c === undefined ? s : '';
    if (a === 'chat' || a === 'modello') return TIPI_ERRORE_VISTO.includes(b) && c === undefined ? s : '';
    if (a === 'avviso') return AVVISI_ERRORE.includes(b) && c === undefined ? s : '';
    return '';
  }

  // Il guasto che una risposta non arrivata mostra: il codice che il cancello o il router ha dato, nell'elenco chiuso.
  const CODICI_VISTI = Object.freeze({
    NO_API_KEY: 'senza_chiave', LIMIT_REACHED: 'limite_spesa', NO_MODEL_FOR_ACTION: 'senza_modello',
    NO_OPEN_WEIGHTS_MODEL: 'senza_pesi_aperti', NO_ALLOWED_HOST: 'nessun_host', NO_PROVIDER_ALLOWED: 'nessun_host',
    NO_TOOL_HOST: 'nessun_host', DATA_POLICY: 'dati_fornitore', RISPOSTA_TAGLIATA: 'risposta_tagliata',
    TETTO_RISPOSTA: 'tetto_risposta', MODEL_UNAVAILABLE: 'modello_assente',
  });
  function tipoErroreVisto(err) {
    if (!err) return '';
    const code = String(err.code || err.errorCode || '');
    if (err.name === 'AbortError' || code === 'ABORT_ERR') return '';
    if (has(CODICI_VISTI, code)) return CODICI_VISTI[code];
    const st = Number(err.status) || 0;
    if (st === 429) return 'troppe_richieste';
    if (/moderat/i.test(code) || /moderat/i.test(String(err.message || ''))) return 'moderazione';
    return tipoErrore(err) || 'altro';
  }

  function fasciaDi(ms) {
    const v = Number(ms);
    if (!Number.isFinite(v) || v < 0) return '';
    const hit = FASCE.find(([, fino]) => v <= fino);
    return hit ? hit[0] : 'oltre';
  }

  function posizioneDi(i) {
    const v = Number(i);
    if (!Number.isInteger(v) || v < 1) return '';
    return POSIZIONI.find(([, fino]) => v <= fino)[0];
  }

  function famigliaOs(platform) {
    if (platform === 'win32') return 'win';
    if (platform === 'darwin') return 'mac';
    if (platform === 'linux') return 'linux';
    return ALTRO;
  }

  function versioneApp(v) {
    const s = String(v || '').trim();
    return APP_RE.test(s) ? s : '0.0.0';
  }

  function modelloPulito(m) {
    const s = String(m || '').trim().toLowerCase();
    return s && s.length <= 120 && MODELLO_RE.test(s) ? s : ALTRO;
  }

  function hostPulito(h) {
    const s = String(h || '').trim();
    return HOST_RE.test(s) ? s : '';
  }

  // ── Il tipo di guasto ─────────────────────────────────────────────────────
  // Stesso ordine di SN_CHAT_ERRORS.friendly. `null`: non è un guasto di una chiamata (annullata da chi la usa, o mai
  // partita perché mancano chiave, modello o margine di spesa) e non si conta fra gli errori.
  const MAI_PARTITE = new Set(['NO_API_KEY', 'LIMIT_REACHED', 'NO_MODEL_FOR_ACTION', 'NO_OPEN_WEIGHTS_MODEL',
    'GATE_METHOD', 'PROVIDER_METHOD_MISSING', 'NO_KEY_INFO']);
  const SENZA_HOST = new Set(['NO_ALLOWED_HOST', 'DATA_POLICY', 'NO_PROVIDER_ALLOWED', 'MODEL_UNAVAILABLE', 'NO_TOOL_HOST']);
  const RETE_RE = /fetch failed|failed to fetch|network error|networkerror|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|EHOSTUNREACH|ENETUNREACH|ENETDOWN|socket hang up|other side closed/i;
  const TEMPO_RE = /ETIMEDOUT|timed out|timeout/i;

  function testoDi(err) {
    const own = String((err && err.message) || err || '');
    const c = err && err.cause;
    return c ? `${own} ${String(c.message || c.code || c)}` : own;
  }

  function tipoErrore(err) {
    if (!err) return null;
    const code = String(err.code || '');
    if (err.name === 'AbortError' || code === 'ABORT_ERR') return null;
    if (MAI_PARTITE.has(code)) return null;
    // Un modello che i crediti di Filo non pagano (#830) non è partito: conta solo la chiave propria che è stata rifiutata.
    if (code === 'NO_ALLOWED_HOST' && err.reason === 'crediti') return err.chiaveRifiutata ? 'chiave' : null;
    // Il produttore che non risponde (#829) porta il codice del «nessun host», ma è un guasto del servizio: si conta per status.
    if (SENZA_HOST.has(code) && err.reason !== 'produttore') return 'nessun_host';
    const W = global.SN_WALLET;
    const st = Number(err.status) || 0;
    if (st === 402 || (W && typeof W.isOutOfCredits === 'function' && W.isOutOfCredits(err))) return 'crediti';
    if (st === 401 || (W && typeof W.keyRefusalOf === 'function' && W.keyRefusalOf(err))) return 'chiave';
    if (err.name === 'TimeoutError' || st === 408 || st === 504 || st === 524) return 'tempo';
    if (!st) {
      const causa = String((err.cause && err.cause.code) || '');
      if (TEMPO_RE.test(code) || TEMPO_RE.test(causa)) return 'tempo';
      const t = testoDi(err);
      if (RETE_RE.test(code) || RETE_RE.test(causa) || RETE_RE.test(t)) return 'rete';
      if (TEMPO_RE.test(t)) return 'tempo';
    }
    return 'fornitore';
  }

  // ── L'ora, in memoria ─────────────────────────────────────────────────────
  // Ogni registrazione controlla la sua chiave contro l'elenco chiuso; il documento poi si ricostruisce da capo.

  function oraVuota() {
    return {
      uso: {}, errori: {}, azioni: {}, impostazioni: {}, ricerche: {}, correttore: {}, conferme: {}, annullati: {},
      anticipi: {}, chiedi: {}, erroriVisti: {}, intervista: {}, primeVolte: [],
      contesto: {}, cache: {}, ragionamento: {}, uscita: {}, ripieghi: {}, spesa: {}, adattamenti: {}, chiamate: {},
      ...Object.fromEntries(MISURE_ATTIVITA.map((m) => [m, {}])),
    };
  }

  function normale(o) {
    const d = oggetto(o) ? o : {};
    for (const k of MISURE) {
      if (k === 'primeVolte') { if (!Array.isArray(d[k])) d[k] = []; } else if (!oggetto(d[k])) d[k] = {};
    }
    return d;
  }

  function piuUno(mappa, chiave) { mappa[chiave] = conto(mappa[chiave]) + 1; }

  function misura(mappa, chiave, { visto = null, fine = null, ripetuta = false } = {}) {
    const m = oggetto(mappa[chiave]) ? mappa[chiave] : { n: 0, visto: {}, fine: {}, rip: 0 };
    m.n = conto(m.n) + 1;
    for (const [campo, ms] of [['visto', visto], ['fine', fine]]) {
      if (!oggetto(m[campo])) m[campo] = {};
      const f = ms == null ? '' : fasciaDi(ms);
      if (f) piuUno(m[campo], f);
    }
    if (ripetuta) m.rip = conto(m.rip) + 1;
    mappa[chiave] = m;
  }

  // Un uso della funzione. `visto` è l'attesa fino alla prima risposta visibile, `fine` fino alla fine; null se non
  // sono arrivate.
  function registraUso(ora, funzione, attese = {}) {
    if (!funzioni().includes(funzione)) return false;
    misura(normale(ora).uso, funzione, attese);
    return true;
  }

  function registraAzione(ora, azione, attese = {}) {
    if (!azioni().includes(azione)) return false;
    misura(normale(ora).azioni, azione, attese);
    return true;
  }

  function registraErrore(ora, funzione, { modello, host, tipo } = {}) {
    if (!funzioni().includes(funzione) || !ERRORI.includes(tipo)) return false;
    const g = normale(ora);
    const per = oggetto(g.errori[funzione]) ? g.errori[funzione] : {};
    let chiave = `${modelloPulito(modello)}|${hostPulito(host)}|${tipo}`;
    // Il posto per le sei righe «altro» (una per tipo) resta sempre libero: oltre il tetto non si perde niente.
    const specifiche = Object.keys(per).filter((k) => !k.startsWith(`${ALTRO}||`)).length;
    if (!has(per, chiave) && specifiche >= TETTO_ERRORI_ORA - ERRORI.length) chiave = `${ALTRO}||${tipo}`;
    piuUno(per, chiave);
    g.errori[funzione] = per;
    return true;
  }

  function registraImpostazione(ora, percorso, valore, via) {
    const chiave = chiaveImpostazione(percorso);
    if (!chiave || !VIE.includes(via)) return false;
    const g = normale(ora);
    const per = oggetto(g.impostazioni[chiave]) ? g.impostazioni[chiave] : {};
    let k = `${chiave === ALTRO ? 'cambiato' : valoreImpostazione(chiave, valore)}|${via}`;
    if (!has(per, k) && Object.keys(per).length >= TETTO_VALORI - VIE.length) k = `cambiato|${via}`;
    piuUno(per, k);
    g.impostazioni[chiave] = per;
    return true;
  }

  // `esito`: 'aperta' all'apertura, poi 'scelta' (con l'attesa dall'apertura e la posizione, da 1) o 'vuota'.
  function registraRicerca(ora, pannello, { esito, attesaMs = null, posizione = null } = {}) {
    if (!PANNELLI.includes(pannello) || !['aperta', 'scelta', 'vuota'].includes(esito)) return false;
    const g = normale(ora);
    const r = oggetto(g.ricerche[pannello]) ? g.ricerche[pannello] : { aperte: 0, scelte: {}, posizioni: {}, vuote: 0 };
    if (!oggetto(r.scelte)) r.scelte = {};
    if (!oggetto(r.posizioni)) r.posizioni = {};
    if (esito === 'aperta') r.aperte = conto(r.aperte) + 1;
    if (esito === 'vuota') r.vuote = conto(r.vuote) + 1;
    if (esito === 'scelta') {
      const f = attesaMs == null ? '' : fasciaDi(attesaMs);
      piuUno(r.scelte, f || 'oltre');
      const p = posizioneDi(posizione);
      if (p) piuUno(r.posizioni, p);
    }
    g.ricerche[pannello] = r;
    return true;
  }

  function registraProposta(ora, tipo, modello, esito) {
    if (!TIPI_PROPOSTA.includes(tipo) || !ESITI_PROPOSTA.includes(esito)) return false;
    const g = normale(ora);
    const per = oggetto(g.correttore[tipo]) ? g.correttore[tipo] : {};
    let m = modelloPulito(modello);
    if (!has(per, m) && Object.keys(per).filter((k) => k !== ALTRO).length >= TETTO_COMBINAZIONI - 1) m = ALTRO;
    const c = Array.isArray(per[m]) && per[m].length === 4 ? per[m] : [0, 0, 0, 0];
    const i = ESITI_PROPOSTA.indexOf(esito);
    c[i] = conto(c[i]) + 1;
    per[m] = c;
    g.correttore[tipo] = per;
    return true;
  }

  function dalElenco(v, elenco) { const s = String(v ?? ''); return elenco.includes(s) ? s : ALTRO; }

  function registraConferma(ora, tipoAzione, { livello, stato, costo, perimetro, origine, risposta, esito } = {}) {
    if (!tipiAzione().includes(tipoAzione) || !ESITI_CONFERMA.includes(esito)) return false;
    const g = normale(ora);
    const per = oggetto(g.conferme[tipoAzione]) ? g.conferme[tipoAzione] : {};
    const campi = [dalElenco(livello, LIVELLI_AUTONOMIA), dalElenco(stato, STATI_COMPITO), dalElenco(costo, COSTI),
      dalElenco(perimetro, PERIMETRI), dalElenco(origine, ORIGINI), dalElenco(risposta, RISPOSTE)];
    let k = `${campi.join('|')}|${esito}`;
    const piene = Object.keys(per).filter((x) => !x.startsWith(`${ALTRO}|${ALTRO}|`)).length;
    if (!has(per, k) && piene >= TETTO_CONFERME - ESITI_CONFERMA.length) k = `${Array(6).fill(ALTRO).join('|')}|${esito}`;
    piuUno(per, k);
    g.conferme[tipoAzione] = per;
    return true;
  }

  function registraAnnullato(ora, tipo) {
    if (!tipiAzione().includes(tipo) && !ANNULLABILI_IN_PAGINA.includes(tipo)) return false;
    piuUno(normale(ora).annullati, tipo);
    return true;
  }

  // `cosa`: 'preparato' quando un anticipo ha la sua risposta pronta, 'aperto' quando la persona la apre.
  function registraAnticipo(ora, funzione, cosa) {
    if (!funzioni().includes(funzione) || !['preparato', 'aperto'].includes(cosa)) return false;
    const g = normale(ora);
    const a = oggetto(g.anticipi[funzione]) ? g.anticipi[funzione] : { preparati: 0, aperti: 0 };
    if (cosa === 'preparato') a.preparati = conto(a.preparati) + 1; else a.aperti = conto(a.aperti) + 1;
    g.anticipi[funzione] = a;
    return true;
  }

  function registraChiesto(ora, funzione) {
    if (!funzioni().includes(funzione)) return false;
    piuUno(normale(ora).chiedi, funzione);
    return true;
  }

  function registraErroreVisto(ora, tipo) {
    const t = erroreVisto(tipo);
    if (!t) return false;
    piuUno(normale(ora).erroriVisti, t);
    return true;
  }

  function registraIntervista(ora, passo, scelta) {
    if (!passiIntervista().includes(passo) || !SCELTE_INTERVISTA.includes(scelta)) return false;
    const g = normale(ora);
    const per = oggetto(g.intervista[passo]) ? g.intervista[passo] : {};
    piuUno(per, scelta);
    g.intervista[passo] = per;
    return true;
  }

  // La prima volta nel mese che la copia usa una funzione o fa un'azione: chi tiene il conto del mese è il servizio.
  function registraPrimaVolta(ora, id) {
    if (!funzioni().includes(id) && !azioni().includes(id)) return false;
    const g = normale(ora);
    if (g.primeVolte.includes(id) || g.primeVolte.length >= TETTO_PRIME_VOLTE) return false;
    g.primeVolte.push(id);
    return true;
  }

  // ── Le chiamate ai modelli (#1464) ──────────────────────────────────────
  const numero = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));
  function fasciaIn(fasce, v) {
    const n = numero(v);
    return n == null ? '' : fasce.find(([, fino]) => n <= fino)[0];
  }
  function fasciaCache(letti, ingresso, detta) {
    if (!detta) return ND;
    const q = (numero(letti) || 0) / ingresso;
    if (!(q > 0)) return 'zero';
    return q <= 0.25 ? 'q25' : q <= 0.5 ? 'q50' : q <= 0.75 ? 'q75' : 'q100';
  }
  function fineDi(f) {
    const s = String(f == null ? '' : f).toLowerCase();
    if (s === 'content_filter') return 'filtro';
    return ['stop', 'length', 'tool_calls'].includes(s) ? s : ALTRO;
  }
  function tentativoDi(t) {
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1) return '';
    return n >= 4 ? 't4_oltre' : `t${n}`;
  }

  function voceSpecifiche(mappa) {
    let n = 0;
    for (const per of Object.values(mappa)) if (oggetto(per)) for (const k of Object.keys(per)) if (!k.startsWith(`${ALTRO}|`)) n++;
    return n;
  }

  // `quanto` è 1 per un conto; per la spesa, i centomillesimi con la virgola: si arrotonda quando il documento parte.
  function piuModello(ora, campo, funzione, modello, resto, quanto = 1) {
    if (!RESTI[campo].includes(resto)) return false;
    const mappa = normale(ora)[campo];
    const per = oggetto(mappa[funzione]) ? mappa[funzione] : {};
    let m = modelloPulito(modello);
    if (m !== ALTRO && !has(per, `${m}|${resto}`) && voceSpecifiche(mappa) >= TETTO_MODELLI_ORA) m = ALTRO;
    const k = `${m}|${resto}`;
    const prima = Number(per[k]);
    per[k] = Math.min(MAX_CONTO, (Number.isFinite(prima) && prima > 0 ? prima : 0) + quanto);
    mappa[funzione] = per;
    return true;
  }

  function registraSpesa(ora, funzione, modello, origine, usd) {
    const u = numero(usd);
    if (!funzioni().includes(funzione) || !ORIGINI_SPESA.includes(origine) || !(u > 0)) return false;
    return piuModello(ora, 'spesa', funzione, modello, origine, u * CENTOMILLESIMI);
  }

  function registraAdattamento(ora, funzione, modello, tipo) {
    if (!funzioni().includes(funzione) || !ADATTAMENTI.includes(tipo)) return false;
    return piuModello(ora, 'adattamenti', funzione, modello, tipo);
  }

  // Una chiamata servita: ogni misura entra solo se la risposta porta il suo dato. `ingresso`, `cacheLetti`, `uscita`
  // e `ragionamento` sono token; `cacheDetta` e `ragionamento` null dicono che l'host non li ha dati; `fine` c'è solo
  // per le risposte di testo; `tentativo` (da 1) solo per le catene di ripiego.
  function registraChiamata(ora, funzione, c = {}) {
    if (!funzioni().includes(funzione) || !oggetto(c)) return false;
    const m = c.modello;
    const ingresso = numero(c.ingresso);
    if (ingresso > 0) {
      piuModello(ora, 'contesto', funzione, m, fasciaIn(FASCE_CONTESTO, ingresso));
      if (c.cacheDetta !== undefined) piuModello(ora, 'cache', funzione, m, fasciaCache(c.cacheLetti, ingresso, c.cacheDetta));
    }
    if (c.ragionamento !== undefined) {
      const r = numero(c.ragionamento);
      piuModello(ora, 'ragionamento', funzione, m, r == null ? ND : fasciaIn(FASCE_RAGIONAMENTO, r));
    }
    if (c.fine !== undefined && numero(c.uscita) != null) {
      piuModello(ora, 'uscita', funzione, m, `${fasciaIn(FASCE_USCITA, c.uscita)}|${fineDi(c.fine)}`);
    }
    const t = tentativoDi(c.tentativo);
    if (t) piuModello(ora, 'ripieghi', funzione, m, `${t}|${c.ricominciata ? 'si' : 'no'}`);
    if (c.ragionamentoTolto) piuModello(ora, 'adattamenti', funzione, m, 'ragionamento_tolto');
    if (oggetto(c.spesa)) registraSpesa(ora, funzione, m, c.spesa.origine, c.spesa.usd);
    return true;
  }

  // Le chiamate al modello di un uso: un messaggio di chat coi suoi giri di strumenti ne fa più d'una.
  function registraChiamate(ora, funzione, n) {
    const f = Number.isInteger(n) && n >= 1 ? fasciaIn(FASCE_CHIAMATE, n) : '';
    if (!funzioni().includes(funzione) || !f) return false;
    const g = normale(ora);
    const per = oggetto(g.chiamate[funzione]) ? g.chiamate[funzione] : {};
    piuUno(per, f);
    g.chiamate[funzione] = per;
    return true;
  }

  // ── Le attività (#1467) ──────────────────────────────────────────────────
  // Il tipo d'azione di un suggerimento della home: quelli del registro, la domanda in chat, e «altro».
  function tipiSuggerimento() { return [...tipiAzione(), 'CHAT', ALTRO]; }
  function tipoSuggerimento(t) {
    const s = String(t || '').toUpperCase();
    return tipiSuggerimento().includes(s) ? s : ALTRO;
  }
  const elencoParte = (d) => (d === TIPO_SUGGERIMENTO ? tipiSuggerimento() : d);

  function combinazioneValida(misura, k) {
    const forme = has(DIMENSIONI_ATTIVITA, misura) ? DIMENSIONI_ATTIVITA[misura] : null;
    if (!forme || typeof k !== 'string') return false;
    if (k === ALTRO) return true;
    const parti = k.split('|');
    return forme.some((f) => f.length === parti.length && f.every((d, i) => elencoParte(d).includes(parti[i])));
  }

  const quanti = (n) => { const v = numero(n); return v == null ? 0 : Math.floor(v); };
  const fasciaEta = (fasce, ms) => (numero(ms) == null ? ND_ETA : fasciaIn(fasce, ms));
  const siNo = (b) => (b === true ? 'si' : 'no');
  function posizioneSuggerimento(i) {
    const v = Number(i);
    return Number.isInteger(v) && v >= 1 ? fasciaIn(POSIZIONI_SUGGERIMENTO, v) : '';
  }

  // Le parti della combinazione di un'attività, dai suoi dati: numeri e nomi, che qui diventano fasce ed elenchi.
  function partiAttivita(misura, x) {
    const o = oggetto(x) ? x : {};
    switch (misura) {
      case 'aiuto': return [o.esito, fasciaIn(FASCE_PASSI, quanti(o.passiDaSolo)), fasciaIn(FASCE_PASSI, quanti(o.passiCliccati)),
        fasciaIn(FASCE_TROVATI, quanti(o.nonTrovati)), fasciaIn(FASCE_TROVATI, quanti(o.documenti))];
      case 'ricercaWeb': return o.alTetto === true ? ['aiuto', 'al_tetto']
        : [o.da, o.fornitore, siNo(o.ripiego), fasciaIn(FASCE_RISULTATI, quanti(o.risultati))];
      case 'dettatura': return [o.motivo, fasciaIn(FASCE_FRASI, quanti(o.frasi)), o.invio, siNo(o.provvisorie)];
      case 'lettura': return [o.voce, o.motivo, o.fino];
      case 'lezioni': return o.nulla === true ? ['nulla']
        : [fasciaIn(FASCE_LEZIONI, quanti(o.scritte)), fasciaIn(FASCE_LEZIONI, quanti(o.scartate))];
      case 'compattazioni': return [o.esito, fasciaIn(FASCE_NON_RIMESSE, quanti(o.nonRimesse))];
      case 'memoria': return [o.via, o.operazione, o.riga, fasciaEta(ETA_RIGA, o.etaMs)];
      case 'pulizia': return [o.trigger, fasciaIn(FASCE_SCHEDE, quanti(o.candidate)), fasciaIn(FASCE_SCHEDE, quanti(o.archiviate)),
        fasciaIn(FASCE_SCHEDE, quanti(o.duplicati)), siNo(o.giudizioMancato)];
      case 'riaperte': return [o.chiusaDa, fasciaIn(ETA_RIAPERTA, o.etaMs)];
      case 'home': return [o.esito];
      case 'suggerimenti': return [tipoSuggerimento(o.tipo), posizioneSuggerimento(o.posizione), fasciaEta(ETA_HOME, o.etaMs)];
      default: return null;
    }
  }

  // La chiave che l'attività scrive nell'ora, o '' se una parte non sta nel suo elenco.
  function chiaveAttivita(misura, x) {
    const p = partiAttivita(misura, x);
    if (!p || p.some((v) => typeof v !== 'string' || !v)) return '';
    const k = p.join('|');
    return k !== ALTRO && combinazioneValida(misura, k) ? k : '';
  }

  function registraAttivita(ora, misura, x) {
    const k = chiaveAttivita(misura, x);
    if (!k) return false;
    const mappa = normale(ora)[misura];
    const piene = Object.keys(mappa).filter((c) => c !== ALTRO).length;
    piuUno(mappa, has(mappa, k) || piene < TETTO_VOCI_ATTIVITA ? k : ALTRO);
    return true;
  }

  // Chi ha risposto a una ricerca web (SN_WEB_SEARCH.search), se è il ripiego di Tavily, e quanti risultati.
  function esitoRicerca(r) {
    const ok = !!(r && r.ok);
    const fornitore = ok && ['tavily', 'duckduckgo'].includes(r.provider) ? r.provider : 'nessuno';
    return { fornitore, ripiego: !!(r && r.ripiego === true), risultati: ok && Array.isArray(r.results) ? r.results.length : 0 };
  }

  // Perché una lettura è passata alla voce del browser, dalla risposta che non ha portato l'audio.
  function motivoLettura({ ripiego = false, codice = '', chiaveRifiutata = false, errore = '' } = {}) {
    if (!ripiego) return 'nessuno';
    if (CODICI_LETTURA.includes(codice)) return codice.toLowerCase();
    if (chiaveRifiutata === true) return 'chiave_rifiutata';
    return errore === 'no_tts_model' ? 'no_tts_model' : ALTRO;
  }

  // Fin dove è arrivata una lettura: `quota` da 0 a 1 di quello che c'era da leggere.
  function finoLettura(quota, finita = false) {
    if (finita === true) return 'fine';
    const q = numero(quota);
    if (q == null) return '';
    return q <= 0.25 ? 'q25' : q <= 0.5 ? 'q50' : q <= 0.75 ? 'q75' : 'q100';
  }

  // Chi aveva chiuso la scheda che si riapre dall'archivio: «manual» è la persona, il resto il giro di pulizia.
  function chiusaDa(reason) {
    const r = String(reason || 'manual');
    return r === 'manual' ? 'persona' : r === 'duplicato' ? 'duplicato' : 'pulizia';
  }

  function rigaMemoria({ modulo = '', lezione = false } = {}) {
    if (lezione === true) return 'lezione';
    return modulo === 'PROFILO' ? 'profilo' : modulo === 'PREFERENZE' ? 'preferenze' : 'espansioni';
  }

  // La home servita senza un modello, col motivo di SN_CONST.whyCannotServe.
  function esitoHome(motivo) {
    return { chiave: 'senza_ai_chiave', 'pesi-aperti': 'senza_ai_pesi_aperti', modelli: 'senza_ai_modelli' }[motivo] || '';
  }

  // ── Il documento che esce ─────────────────────────────────────────────────
  // Si ricostruisce dagli elenchi chiusi, non si copia: un disco manomesso o un campo nuovo non arrivano al server.

  function fasceIn(mappa, nomi, tetto) {
    let somma = 0;
    return nomi.map((k) => {
      const v = oggetto(mappa) && has(mappa, k) ? mappa[k] : 0;
      if (!intero(v) || v === 0 || somma + v > tetto) return 0;
      somma += v;
      return v;
    }).join(',');
  }

  function misurePulite(mappa, ammesse) {
    const out = {};
    for (const k of ammesse) {
      const m = oggetto(mappa) && has(mappa, k) ? mappa[k] : null;
      if (!oggetto(m) || !intero(m.n) || m.n === 0) continue;
      const n = conto(m.n);
      out[k] = `${n};${fasceIn(m.visto, NOMI_FASCE, n)};${fasceIn(m.fine, NOMI_FASCE, n)};${Math.min(conto(m.rip), n)}`;
    }
    return out;
  }

  // Errori: «modello|host|tipo|n» separati da «;», al più TETTO_COMBINAZIONI per funzione.
  function erroriPuliti(errori, tetto = TETTO_ERRORI_ORA) {
    const out = {};
    for (const f of funzioni()) {
      const per = oggetto(errori) && has(errori, f) ? errori[f] : null;
      if (!oggetto(per)) continue;
      const lista = [];
      for (const [chiave, n] of Object.entries(per)) {
        if (!intero(n) || n === 0) continue;
        const [m, h, t] = String(chiave).split('|');
        if (!ERRORI.includes(t)) continue;
        lista.push(`${modelloPulito(m)}|${hostPulito(h)}|${t}|${conto(n)}`);
        if (lista.length >= tetto) break;
      }
      if (lista.length) out[f] = lista.join(';');
    }
    return out;
  }

  function impostazioniPulite(imp) {
    const out = {};
    for (const chiave of [...chiaviImpostazioni(), ALTRO]) {
      const per = oggetto(imp) && has(imp, chiave) ? imp[chiave] : null;
      if (!oggetto(per) || !re(CHIAVE_IMPOSTAZIONE_FORMA).test(chiave)) continue;
      const lista = [];
      for (const [k, n] of Object.entries(per)) {
        const [valore, via] = String(k).split('|');
        if (!intero(n) || n === 0 || !VIE.includes(via)) continue;
        const v = chiave === ALTRO ? 'cambiato' : valoreScritto(chiave, valore);
        lista.push(`${v}|${via}|${conto(n)}`);
        if (lista.length >= TETTO_VALORI) break;
      }
      if (lista.length) out[chiave] = lista.join(';');
    }
    return out;
  }

  function ricerchePulite(ricerche) {
    const out = {};
    for (const p of PANNELLI) {
      const r = oggetto(ricerche) && has(ricerche, p) ? ricerche[p] : null;
      if (!oggetto(r)) continue;
      const fasce = fasceIn(r.scelte, NOMI_FASCE, MAX_CONTO);
      const scelte = fasce.split(',').reduce((a, n) => a + Number(n), 0);
      const aperte = conto(r.aperte);
      const vuote = conto(r.vuote);
      if (!aperte && !scelte && !vuote) continue;
      out[p] = `${aperte};${fasce};${fasceIn(r.posizioni, NOMI_POSIZIONI, scelte)};${vuote}`;
    }
    return out;
  }

  function correttorePulito(correttore) {
    const out = {};
    for (const t of TIPI_PROPOSTA) {
      const per = oggetto(correttore) && has(correttore, t) ? correttore[t] : null;
      if (!oggetto(per)) continue;
      const lista = [];
      for (const [m, c] of Object.entries(per)) {
        if (!Array.isArray(c) || c.length !== 4 || !c.every(intero) || c.every((x) => x === 0)) continue;
        lista.push(`${modelloPulito(m)}|${c.map(conto).join(',')}`);
        if (lista.length >= TETTO_COMBINAZIONI) break;
      }
      if (lista.length) out[t] = lista.join(';');
    }
    return out;
  }

  function confermePulite(conferme) {
    const out = {};
    const voce = re(`^${CHIAVE_CONFERMA}$`);
    for (const t of tipiAzione()) {
      const per = oggetto(conferme) && has(conferme, t) ? conferme[t] : null;
      if (!oggetto(per) || !re(TIPO_AZIONE_FORMA).test(t)) continue;
      const lista = [];
      for (const [k, n] of Object.entries(per)) {
        if (!intero(n) || n === 0 || !voce.test(k)) continue;
        lista.push(`${k}|${conto(n)}`);
        if (lista.length >= TETTO_CONFERME) break;
      }
      if (lista.length) out[t] = lista.join(';');
    }
    return out;
  }

  function contiPuliti(mappa, ammesse, formaChiave) {
    const out = {};
    for (const k of ammesse) {
      const n = oggetto(mappa) && has(mappa, k) ? mappa[k] : 0;
      if (intero(n) && n > 0 && (!formaChiave || re(formaChiave).test(k))) out[k] = String(conto(n));
    }
    return out;
  }

  function anticipiPuliti(anticipi) {
    const out = {};
    for (const f of funzioni()) {
      const a = oggetto(anticipi) && has(anticipi, f) ? anticipi[f] : null;
      if (!oggetto(a) || (!conto(a.preparati) && !conto(a.aperti))) continue;
      out[f] = `${conto(a.preparati)};${conto(a.aperti)}`;
    }
    return out;
  }

  function erroriVistiPuliti(visti) {
    const out = {};
    for (const [k, n] of Object.entries(oggetto(visti) ? visti : {})) {
      if (erroreVisto(k) === k && intero(n) && n > 0) out[k] = String(conto(n));
    }
    return out;
  }

  function intervistaPulita(intervista) {
    const out = {};
    for (const p of passiIntervista()) {
      const per = oggetto(intervista) && has(intervista, p) ? intervista[p] : null;
      if (!oggetto(per) || !re(PASSO_FORMA).test(p)) continue;
      const lista = SCELTE_INTERVISTA.filter((s) => intero(per[s]) && per[s] > 0).map((s) => `${s}|${conto(per[s])}`);
      if (lista.length) out[p] = lista.join(';');
    }
    return out;
  }

  function primeVoltePulite(lista) {
    const ammesse = new Set([...funzioni(), ...azioni()]);
    const visti = new Set();
    const out = [];
    for (const id of Array.isArray(lista) ? lista : []) {
      if (typeof id !== 'string' || !ammesse.has(id) || visti.has(id) || !re(CHIAVE_AZIONE_FORMA).test(id)) continue;
      visti.add(id);
      out.push(id);
      if (out.length >= TETTO_PRIME_VOLTE) break;
    }
    return out;
  }

  // Una misura delle chiamate: «modello|resto|n» separati da «;». Oltre TETTO_MODELLI_ORA voci col modello, su tutte le
  // funzioni, il modello diventa «altro» e la voce si somma alla sua riga.
  function modelliPuliti(mappa, campo) {
    const out = {};
    const resti = RESTI[campo];
    let specifiche = 0;
    for (const f of funzioni()) {
      const per = oggetto(mappa) && has(mappa, f) ? mappa[f] : null;
      if (!oggetto(per)) continue;
      const voci = new Map();
      for (const [k, v] of Object.entries(per)) {
        const i = String(k).indexOf('|');
        const resto = i < 0 ? '' : k.slice(i + 1);
        const n = Math.round(Number(v));
        if (!resti.includes(resto) || !intero(n) || n === 0) continue;
        let m = modelloPulito(k.slice(0, i));
        if (m !== ALTRO && !voci.has(`${m}|${resto}`)) {
          if (specifiche >= TETTO_MODELLI_ORA) m = ALTRO; else specifiche += 1;
        }
        voci.set(`${m}|${resto}`, conto(Math.min(MAX_CONTO, (voci.get(`${m}|${resto}`) || 0) + n)));
      }
      if (voci.size) out[f] = [...voci].map(([k, n]) => `${k}|${n}`).join(';');
    }
    return out;
  }

  function chiamatePulite(mappa) {
    const out = {};
    for (const f of funzioni()) {
      const per = oggetto(mappa) && has(mappa, f) ? mappa[f] : null;
      if (!oggetto(per)) continue;
      const v = fasceIn(per, nomi(FASCE_CHIAMATE), MAX_CONTO);
      if (/[1-9]/.test(v)) out[f] = v;
    }
    return out;
  }

  function meseDi(giorno) { return String(giorno || '').slice(0, 7); }

  function documento({ pseudonimo, chiave, app, os, dati, primo = '' }) {
    const d = normale(oggetto(dati) ? JSON.parse(JSON.stringify(dati)) : {});
    const [giorno, ora] = String(chiave || '').split('T');
    return {
      v: VERSIONE,
      pseudonimo: String(pseudonimo || ''),
      giorno: String(giorno || ''),
      mese: meseDi(giorno),
      ora: String(ora || ''),
      app: versioneApp(app),
      os: OS.includes(os) ? os : ALTRO,
      primo: PRIMI.includes(primo) ? primo : '',
      uso: misurePulite(d.uso, funzioni()),
      errori: erroriPuliti(d.errori),
      azioni: misurePulite(d.azioni, azioni().filter((a) => re(CHIAVE_AZIONE_FORMA).test(a))),
      impostazioni: impostazioniPulite(d.impostazioni),
      ricerche: ricerchePulite(d.ricerche),
      correttore: correttorePulito(d.correttore),
      conferme: confermePulite(d.conferme),
      annullati: contiPuliti(d.annullati, [...tipiAzione(), ...ANNULLABILI_IN_PAGINA], TIPO_AZIONE_FORMA),
      anticipi: anticipiPuliti(d.anticipi),
      chiedi: contiPuliti(d.chiedi, funzioni()),
      erroriVisti: erroriVistiPuliti(d.erroriVisti),
      intervista: intervistaPulita(d.intervista),
      primeVolte: primeVoltePulite(d.primeVolte),
    };
  }

  // Le chiamate ai modelli della stessa ora, nel loro documento: stesso pseudonimo, stessa ora, stesso id.
  function documentoChiamate({ pseudonimo, chiave, app, os, dati }) {
    const d = normale(oggetto(dati) ? JSON.parse(JSON.stringify(dati)) : {});
    const [giorno, ora] = String(chiave || '').split('T');
    return {
      v: VERSIONE_CHIAMATE,
      pseudonimo: String(pseudonimo || ''),
      giorno: String(giorno || ''),
      mese: meseDi(giorno),
      ora: String(ora || ''),
      app: versioneApp(app),
      os: OS.includes(os) ? os : ALTRO,
      ...Object.fromEntries(MISURE_MODELLI.map((c) => [c, modelliPuliti(d[c], c)])),
      chiamate: chiamatePulite(d.chiamate),
    };
  }
  // Un'ora senza chiamate ai modelli non ha il secondo documento.
  function senzaChiamate(doc) { return MISURE_CHIAMATE.every((c) => !oggetto(doc && doc[c]) || !Object.keys(doc[c]).length); }

  // Una misura delle attività: le sole combinazioni ammesse, al più TETTO_VOCI_ATTIVITA più la riga «altro».
  function attivitaPulite(mappa, misura) {
    const out = {};
    let specifiche = 0;
    for (const [k, v] of Object.entries(oggetto(mappa) ? mappa : {})) {
      if (!intero(v) || v === 0 || !combinazioneValida(misura, k)) continue;
      let c = k;
      if (c !== ALTRO && !has(out, c)) { if (specifiche >= TETTO_VOCI_ATTIVITA) c = ALTRO; else specifiche += 1; }
      out[c] = String(conto((Number(out[c]) || 0) + v));
    }
    return out;
  }

  // Le attività della stessa ora, nel loro documento: stesso pseudonimo, stessa ora, stesso id (#1467).
  function documentoAttivita({ pseudonimo, chiave, app, os, dati }) {
    const d = normale(oggetto(dati) ? JSON.parse(JSON.stringify(dati)) : {});
    const [giorno, ora] = String(chiave || '').split('T');
    return {
      v: VERSIONE_ATTIVITA,
      pseudonimo: String(pseudonimo || ''),
      giorno: String(giorno || ''),
      mese: meseDi(giorno),
      ora: String(ora || ''),
      app: versioneApp(app),
      os: OS.includes(os) ? os : ALTRO,
      ...Object.fromEntries(MISURE_ATTIVITA.map((m) => [m, attivitaPulite(d[m], m)])),
    };
  }
  function senzaAttivita(doc) { return MISURE_ATTIVITA.every((m) => !oggetto(doc && doc[m]) || !Object.keys(doc[m]).length); }

  // I giorni rimasti da prima dell'invio ogni ora: «n;f1,…,f7» per funzione, come allora.
  function documentoGiorno({ pseudonimo, giorno, app, os, dati }) {
    const d = oggetto(dati) ? dati : {};
    const uso = {};
    for (const f of funzioni()) {
      const u = oggetto(d.uso) && has(d.uso, f) ? d.uso[f] : null;
      if (!oggetto(u) || !intero(u.n) || u.n === 0) continue;
      const n = conto(u.n);
      uso[f] = `${n};${fasceIn(u.fasce, NOMI_FASCE, n)}`;
    }
    return {
      v: VERSIONE_GIORNO,
      pseudonimo: String(pseudonimo || ''),
      giorno: String(giorno || ''),
      mese: meseDi(giorno),
      app: versioneApp(app),
      os: OS.includes(os) ? os : ALTRO,
      uso,
      errori: erroriPuliti(d.errori, TETTO_COMBINAZIONI),
    };
  }

  function idDocumento(doc) {
    return oggetto(doc) && has(doc, 'ora') ? `${doc.pseudonimo}_${doc.giorno}_${doc.ora}` : `${doc.pseudonimo}_${doc.giorno}`;
  }

  // ── Il contrario, per chi legge i documenti ───────────────────────────────
  function fasceLette(s, nomi) {
    const out = {};
    String(s).split(',').forEach((v, i) => { if (Number(v) > 0) out[nomi[i]] = Number(v); });
    return out;
  }
  function leggiUso(s) {
    if (!USO_RE.test(String(s))) return null;
    const [n, resto] = String(s).split(';');
    return { n: Number(n), fasce: fasceLette(resto, NOMI_FASCE) };
  }
  function leggiMisura(s) {
    if (!MISURA_RE.test(String(s))) return null;
    const [n, visto, fine, rip] = String(s).split(';');
    return { n: Number(n), visto: fasceLette(visto, NOMI_FASCE), fine: fasceLette(fine, NOMI_FASCE), ripetute: Number(rip) };
  }
  function leggiErrori(s) {
    if (!ERRORI_RE.test(String(s))) return null;
    return String(s).split(';').map((v) => {
      const [modello, host, tipo, n] = v.split('|');
      return { modello, host, tipo, n: Number(n) };
    });
  }
  function leggiRicerca(s) {
    if (!RICERCA_RE.test(String(s))) return null;
    const [aperte, scelte, posizioni, vuote] = String(s).split(';');
    return { aperte: Number(aperte), scelte: fasceLette(scelte, NOMI_FASCE), posizioni: fasceLette(posizioni, NOMI_POSIZIONI), vuote: Number(vuote) };
  }
  // Una misura delle chiamate: { modello, resto, n }, col resto com'è nella voce («o1k|stop», «t2|no»).
  function leggiModelli(campo, s) {
    if (!MODELLI_RE[campo] || !MODELLI_RE[campo].test(String(s))) return null;
    return String(s).split(';').map((v) => {
      const p = v.split('|');
      return { modello: p[0], resto: p.slice(1, -1).join('|'), n: Number(p[p.length - 1]) };
    });
  }
  function leggiChiamate(s) { return CHIAMATE_RE.test(String(s)) ? fasceLette(s, nomi(FASCE_CHIAMATE)) : null; }
  const somma = (o) => Object.values(o).reduce((a, n) => a + n, 0);

  // ── La validazione: la stessa forma che chiedono le regole, e in più i conti che devono tornare ─────────────
  function valida(doc) {
    const no = (motivo) => ({ ok: false, motivo });
    if (!oggetto(doc)) return no('non è un documento');
    if (doc.v === VERSIONE_GIORNO) return validaGiorno(doc);
    const chiavi = Object.keys(doc);
    if (chiavi.length !== CAMPI.length || !CAMPI.every((k) => has(doc, k))) return no(`campi: ${chiavi.join(',')}`);
    if (doc.v !== VERSIONE) return no('versione');
    const base = validaTesta(doc);
    if (base) return no(base);
    if (!ORA_RE.test(String(doc.ora))) return no('ora');
    if (!PRIMI.includes(doc.primo)) return no('primo');
    const mappe = {
      uso: [funzioni(), MISURA_RE, TETTO_CARATTERI_MISURA],
      errori: [funzioni(), ERRORI_RE, TETTO_CARATTERI_ERRORI_ORA],
      azioni: [re(CHIAVE_AZIONE_FORMA), MISURA_RE, TETTO_CARATTERI_MISURA],
      impostazioni: [re(CHIAVE_IMPOSTAZIONE_FORMA), IMPOSTAZIONI_RE, TETTO_CARATTERI_IMPOSTAZIONE],
      ricerche: [PANNELLI, RICERCA_RE, TETTO_CARATTERI_RICERCA],
      correttore: [TIPI_PROPOSTA, CORRETTORE_RE, TETTO_CARATTERI_CORRETTORE],
      conferme: [re(TIPO_AZIONE_FORMA), CONFERME_RE, TETTO_CARATTERI_CONFERME],
      annullati: [re(TIPO_AZIONE_FORMA), CONTO_RE, TETTO_CARATTERI_CONTO],
      anticipi: [funzioni(), ANTICIPO_RE, TETTO_CARATTERI_ANTICIPO],
      chiedi: [funzioni(), CONTO_RE, TETTO_CARATTERI_CONTO],
      erroriVisti: [re(ERRORE_VISTO_FORMA), CONTO_RE, TETTO_CARATTERI_CONTO],
      intervista: [re(PASSO_FORMA), INTERVISTA_RE, TETTO_CARATTERI_INTERVISTA],
    };
    for (const [campo, [chiaviAmmesse, formaValore, tetto]] of Object.entries(mappe)) {
      const m = doc[campo];
      if (!oggetto(m)) return no(campo);
      for (const [k, v] of Object.entries(m)) {
        const chiaveOk = Array.isArray(chiaviAmmesse) ? chiaviAmmesse.includes(k) : chiaviAmmesse.test(k);
        if (!chiaveOk) return no(`${campo}: chiave ${k}`);
        if (typeof v !== 'string' || v.length > tetto || !formaValore.test(v)) return no(`${campo} di ${k}`);
      }
    }
    for (const [campo, s] of [...Object.entries(doc.uso), ...Object.entries(doc.azioni)].map(([k, v]) => [k, leggiMisura(v)])) {
      if (somma(s.visto) > s.n || somma(s.fine) > s.n || s.ripetute > s.n) return no(`attese di ${campo} oltre gli usi`);
    }
    for (const [p, v] of Object.entries(doc.ricerche)) {
      const r = leggiRicerca(v);
      if (somma(r.posizioni) > somma(r.scelte)) return no(`posizioni di ${p} oltre le scelte`);
    }
    for (const [f, e] of Object.entries(doc.errori)) {
      const lista = leggiErrori(e);
      if (lista.length > TETTO_ERRORI_ORA || lista.some((x) => x.n === 0)) return no(`errori di ${f}`);
    }
    if (!Array.isArray(doc.primeVolte) || doc.primeVolte.length > TETTO_PRIME_VOLTE
      || doc.primeVolte.some((x) => typeof x !== 'string' || !re(CHIAVE_AZIONE_FORMA).test(x))
      || new Set(doc.primeVolte).size !== doc.primeVolte.length) return no('primeVolte');
    return { ok: true, motivo: '' };
  }

  function validaChiamate(doc) {
    const no = (motivo) => ({ ok: false, motivo });
    if (!oggetto(doc)) return no('non è un documento');
    const chiavi = Object.keys(doc);
    if (chiavi.length !== CAMPI_CHIAMATE.length || !CAMPI_CHIAMATE.every((k) => has(doc, k))) return no(`campi: ${chiavi.join(',')}`);
    if (doc.v !== VERSIONE_CHIAMATE) return no('versione');
    const base = validaTesta(doc);
    if (base) return no(base);
    if (!ORA_RE.test(String(doc.ora))) return no('ora');
    const ammesse = funzioni();
    for (const c of MISURE_CHIAMATE) {
      const [forma, tetto] = c === 'chiamate' ? [CHIAMATE_RE, TETTO_CARATTERI_CHIAMATE] : [MODELLI_RE[c], TETTI_CARATTERI_MODELLI[c]];
      if (!oggetto(doc[c])) return no(c);
      for (const [f, v] of Object.entries(doc[c])) {
        if (!ammesse.includes(f)) return no(`${c}: funzione ${f}`);
        if (typeof v !== 'string' || v.length > tetto || !forma.test(v)) return no(`${c} di ${f}`);
      }
      if (c === 'chiamate') continue;
      const tutte = Object.values(doc[c]).flatMap((v) => leggiModelli(c, v));
      if (tutte.filter((x) => x.modello !== ALTRO).length > TETTO_MODELLI_ORA) return no(`${c}: voci oltre il tetto`);
    }
    return { ok: true, motivo: '' };
  }

  function validaTesta(doc) {
    if (!PSEUDONIMO_RE.test(String(doc.pseudonimo))) return 'pseudonimo';
    if (!GIORNO_RE.test(String(doc.giorno)) || doc.mese !== meseDi(doc.giorno)) return 'giorno';
    if (!APP_RE.test(String(doc.app))) return 'versione dell\'app';
    if (!OS.includes(doc.os)) return 'sistema';
    return '';
  }

  function validaGiorno(doc) {
    const no = (motivo) => ({ ok: false, motivo });
    const chiavi = Object.keys(doc);
    if (chiavi.length !== CAMPI_GIORNO.length || !CAMPI_GIORNO.every((k) => has(doc, k))) return no(`campi: ${chiavi.join(',')}`);
    const base = validaTesta(doc);
    if (base) return no(base);
    const ammesse = funzioni();
    if (!oggetto(doc.uso)) return no('uso');
    for (const [f, u] of Object.entries(doc.uso)) {
      if (!ammesse.includes(f)) return no(`funzione ${f}`);
      if (typeof u !== 'string' || u.length > TETTO_CARATTERI_USO) return no(`uso di ${f}`);
      const letto = leggiUso(u);
      if (!letto) return no(`uso di ${f}`);
      if (somma(letto.fasce) > letto.n) return no(`fasce di ${f} oltre gli usi`);
    }
    if (!oggetto(doc.errori)) return no('errori');
    for (const [f, e] of Object.entries(doc.errori)) {
      if (!ammesse.includes(f)) return no(`funzione ${f}`);
      if (typeof e !== 'string' || e.length > TETTO_CARATTERI_ERRORI) return no(`errori di ${f}`);
      const lista = leggiErrori(e);
      if (!lista || lista.length > TETTO_COMBINAZIONI || lista.some((x) => x.n === 0)) return no(`errori di ${f}`);
    }
    return { ok: true, motivo: '' };
  }

  // ── Ore, giorni e pseudonimo ──────────────────────────────────────────────

  function due(n) { return String(n).padStart(2, '0'); }

  // Il giorno e l'ora di chi usa Filo, nel suo fuso: l'ora che ha vissuto lui. L'ora ripetuta al cambio dell'ora
  // legale si somma a quella prima: la chiave è la stessa e non è ancora partita, perché è ancora l'ora in corso.
  function giornoDi(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`;
  }
  function oraDi(ms) { return `${giornoDi(ms)}T${due(new Date(ms).getHours())}`; }

  function giornoPrima(giorno) {
    const [y, m, d] = String(giorno).split('-').map(Number);
    const t = new Date(y, m - 1, d - 1);
    return giornoDi(t.getTime());
  }

  // Le ore chiuse da spedire, dalla più vecchia, al più `tetto`.
  function oreDaInviare(ore, adesso, tetto = TETTO_INVII_PER_GIRO) {
    return Object.keys(ore || {}).filter((k) => CHIAVE_ORA_RE.test(k) && k < adesso).sort().slice(0, Math.max(0, tetto));
  }

  function daInviare(giorni, oggi, tetto = TETTO_INVII_PER_GIRO) {
    return Object.keys(giorni || {}).filter((g) => GIORNO_RE.test(g) && g < oggi).sort().slice(0, Math.max(0, tetto));
  }

  // Oltre il tetto si lasciano andare le più vecchie: sono quelle che il server rifiuta da settimane.
  function pota(mappa, tetto, forma) {
    const tutte = Object.keys(mappa || {}).filter((k) => forma.test(k)).sort();
    const via = tutte.slice(0, Math.max(0, tutte.length - tetto));
    for (const k of via) delete mappa[k];
    for (const k of Object.keys(mappa || {})) if (!forma.test(k)) delete mappa[k];
    return via;
  }
  function potaOre(ore, tetto = TETTO_ORE_IN_ATTESA) { return pota(ore, tetto, CHIAVE_ORA_RE); }
  function potaGiorni(giorni, tetto = TETTO_GIORNI_IN_ATTESA) { return pota(giorni, tetto, GIORNO_RE); }

  // Lo pseudonimo è del MESE DEL GIORNO che si spedisce, non di quando parte: l'ultima ora di ottobre parte a
  // novembre, e con lo pseudonimo di novembre la stessa copia di Filo conterebbe due volte in ottobre. Uno nuovo nasce
  // alla prima spedizione di un mese; diverso per costruzione dal codice dei feedback e dallo pseudonimo dei crediti.
  function pseudonimoDelMese(pseudonimi, mese, { casuale, esclusi = [] } = {}) {
    const p = oggetto(pseudonimi) ? { ...pseudonimi } : {};
    if (has(p, mese) && PSEUDONIMO_RE.test(String(p[mese]))) return { pseudonimi: p, id: p[mese], nuovo: false };
    const vietati = new Set([...esclusi.map((x) => String(x || '').toLowerCase()), ...Object.values(p)]);
    let id = '';
    for (let i = 0; i < 8 && (!PSEUDONIMO_RE.test(id) || vietati.has(id)); i++) id = String(casuale ? casuale() : '').toLowerCase();
    if (!PSEUDONIMO_RE.test(id) || vietati.has(id)) throw new Error('pseudonimo dei contatori non generato');
    p[mese] = id;
    // Si tengono gli ultimi tre mesi: bastano per le ore ancora in attesa, e un mese vecchio non si ricuce al nuovo.
    for (const k of Object.keys(p).sort().slice(0, Math.max(0, Object.keys(p).length - 3))) delete p[k];
    return { pseudonimi: p, id, nuovo: true };
  }

  global.SN_CONTATORI = {
    VERSIONE, VERSIONE_GIORNO, VERSIONE_CHIAMATE, COLLEZIONE, COLLEZIONE_CHIAMATE, ERRORI, OS, PRIMI, FASCE, NOMI_FASCE, POSIZIONI,
    NOMI_POSIZIONI, CAMPI, CAMPI_GIORNO, CAMPI_CHIAMATE, MISURE, MISURE_ORA, MISURE_MODELLI, MISURE_CHIAMATE,
    FASCE_CONTESTO, FASCE_CACHE, FASCE_RAGIONAMENTO, FASCE_USCITA, FINI, TENTATIVI, ORIGINI_SPESA, CENTOMILLESIMI, FASCE_CHIAMATE,
    ADATTAMENTI, RESTI, TETTO_MODELLI_ORA,
    VIE, PANNELLI, TIPI_PROPOSTA, ESITI_PROPOSTA, LIVELLI_AUTONOMIA, STATI_COMPITO, COSTI, PERIMETRI, ORIGINI, RISPOSTE,
    ESITI_CONFERMA, ANNULLABILI_IN_PAGINA, DOVE_CRASH, MOTIVI_CRASH, TIPI_ERRORE_VISTO, AVVISI_ERRORE, SCELTE_INTERVISTA,
    AVVIO, AZIONE_PAGINA, AZIONE_DI_ICONA, AZIONE_DI_PAGINA, IMPOSTAZIONI_EXTRA, MAI_CONTATE,
    TETTO_COMBINAZIONI, TETTO_ERRORI_ORA, TETTO_CONFERME, TETTO_VALORI, TETTO_PRIME_VOLTE, TETTO_ORE_IN_ATTESA, TETTO_GIORNI_IN_ATTESA,
    TETTO_INVII_PER_GIRO, RIPETUTA_MS, ANNULLO_MS,
    PSEUDONIMO_RE, GIORNO_RE, ORA_RE, CHIAVE_ORA_RE, APP_RE, MODELLO_RE, HOST_RE,
    FORME: Object.freeze({
      USO_FORMA, ERRORI_FORMA, MISURA_FORMA, IMPOSTAZIONI_FORMA, RICERCA_FORMA, CORRETTORE_FORMA, CONFERME_FORMA,
      CONTO_FORMA, ANTICIPO_FORMA, INTERVISTA_FORMA, CHIAVE_AZIONE_FORMA, CHIAVE_IMPOSTAZIONE_FORMA, TIPO_AZIONE_FORMA,
      ERRORE_VISTO_FORMA, PASSO_FORMA, CHIAMATE_FORMA, MODELLI: FORME_MODELLI,
    }),
    TETTI: Object.freeze({
      TETTO_CARATTERI_USO, TETTO_CARATTERI_ERRORI, TETTO_CARATTERI_ERRORI_ORA, TETTO_CARATTERI_MISURA, TETTO_CARATTERI_IMPOSTAZIONE,
      TETTO_CARATTERI_RICERCA, TETTO_CARATTERI_CORRETTORE, TETTO_CARATTERI_CONFERME, TETTO_CARATTERI_CONTO,
      TETTO_CARATTERI_ANTICIPO, TETTO_CARATTERI_INTERVISTA, TETTO_CARATTERI_CHIAMATE, MODELLI: TETTI_CARATTERI_MODELLI,
    }),
    funzioni, funzioneDi, azioni, azioneDiPagina, tipiAzione, chiaviImpostazioni, chiaveImpostazione, valoreImpostazione, viaDi,
    passiIntervista, erroreVisto, tipoErroreVisto, fasciaDi, posizioneDi, famigliaOs, versioneApp, modelloPulito,
    hostPulito, tipoErrore,
    oraVuota, registraUso, registraAzione, registraErrore, registraImpostazione, registraRicerca, registraProposta,
    registraConferma, registraAnnullato, registraAnticipo, registraChiesto, registraErroreVisto, registraIntervista,
    registraPrimaVolta, registraChiamata, registraSpesa, registraAdattamento, registraChiamate,
    documento, documentoGiorno, documentoChiamate, senzaChiamate, idDocumento, valida, validaChiamate, leggiUso, leggiMisura, leggiErrori, leggiRicerca, leggiModelli, leggiChiamate,
    giornoDi, oraDi, giornoPrima, meseDi, oreDaInviare, daInviare, potaOre, potaGiorni, pseudonimoDelMese,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
