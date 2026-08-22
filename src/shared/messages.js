// Protocollo messaggi tra content script, background e pagine.

(function (global) {
  'use strict';

  const MSG = {
    // Da content -> background
    AI_REQUEST: 'ai_request',                     // { action, payload }
    AI_REQUEST_STREAM_START: 'ai_request_stream', // streaming via port
    // Sintesi vocale via modello (TTS). Ritorna l'audio grezzo; se nessun
    // provider/modello TTS è disponibile torna { ok:false } e il chiamante
    // ripiega sulla voce del browser (Web Speech). { text, voice? }
    TTS_SYNTH: 'tts_synth',                        // → { ok, audioBase64, mimeType } | { ok:false, error }
    // Stato lettura ad alta voce condiviso tra le schede. Il content script che
    // legge segnala l'avvio/arresto al main ({ reading: bool }); il main tiene il
    // conteggio globale e ribroadcast TTS_GLOBAL_READING a TUTTE le schede, così
    // anche una scheda diversa da quella che legge mostra "Interrompi lettura".
    TTS_READING_STATE: 'tts_reading_state',        // content→main { reading: bool }
    // Richiesta di fermare la lettura attiva ovunque sia (anche in un'altra
    // scheda). Il main inoltra TTS_STOP a tutte le schede.
    TTS_STOP_READING: 'tts_stop_reading',          // content→main
    // Una scheda appena caricata chiede lo stato corrente (la lettura potrebbe
    // essere partita PRIMA che esistesse, quindi avrebbe perso il broadcast).
    TTS_READING_STATUS: 'tts_reading_status',       // content→main → { active: bool }
    SAVE_PAGE: 'save_page',                       // { page }
    SAVE_LINK: 'save_link',                       // { url, title }
    GET_SETTINGS: 'get_settings',
    UPDATE_SETTINGS: 'update_settings',           // { settings }
    RESET_SETTINGS: 'reset_settings',             // → riporta TUTTE le impostazioni ai predefiniti
    EXPORT_DATA: 'export_data',                   // → salva tutti i dati come .zip
    // Reimportazione del .zip di EXPORT_DATA, in due passi: prima si sceglie e
    // si LEGGE il file (anteprima con quante sezioni/immagini contiene), poi si
    // APPLICA dopo la conferma dell'utente. Come EXPORT_DATA sono riservati
    // all'origine filo://: una pagina web non deve poter aprire un file dialog
    // né riscrivere lo storage (comprese le chiavi API).
    IMPORT_DATA_PREVIEW: 'import_data_preview',   // → { ok, fileName, exportedAt, sections, images, token }
    IMPORT_DATA_APPLY: 'import_data_apply',       // { token } → { ok, added, updated, images }
    GET_HISTORY: 'get_history',
    APPEND_HISTORY: 'append_history',             // { entry }
    REMOVE_HISTORY_ENTRY: 'remove_history_entry', // { id }
    CLEAR_HISTORY: 'clear_history',
    GET_SAVED_PAGES: 'get_saved_pages',
    REMOVE_SAVED_PAGE: 'remove_saved_page',       // { id }
    CONSUME_SAVED_PAGE: 'consume_saved_page',     // { id }
    SET_SAVED_PAGE_THUMB: 'set_saved_page_thumb', // { id, thumbnail } — miniatura best-effort dopo il salvataggio

    // §3.1/§3.3 — archivio tab chiuse (metadati). La scrittura avviene nel main
    // alla chiusura di una tab; queste servono alla pagina archivio per leggere/
    // rimuovere/svuotare.
    GET_ARCHIVED_TABS: 'get_archived_tabs',
    REMOVE_ARCHIVED_TAB: 'remove_archived_tab',   // { id }
    CLEAR_ARCHIVED_TABS: 'clear_archived_tabs',
    // Riapre una scheda archiviata come nuova tab, ripristinando lo scroll
    // registrato. { url, scrollPct? }
    REOPEN_ARCHIVED_TAB: 'reopen_archived_tab',
    // §3.2 — ricerca semantica nell'archivio (embedding Google). { query }
    SEARCH_ARCHIVED_TABS: 'search_archived_tabs',
    // §5 — cancellazione PERMANENTE di più tab archiviate (dopo conferma). { ids }
    DELETE_ARCHIVED_TABS: 'delete_archived_tabs',
    // Deck builder Commander (DECK-BUILDER-SPEC.md): CRUD dei mazzi, storage
    // locale nel main (deckStore). Usati dalla pagina filo://decks.
    DECKS_LIST: 'decks_list',
    DECKS_GET: 'decks_get',             // { id }
    DECKS_CREATE: 'decks_create',       // { nome? }
    DECKS_UPDATE: 'decks_update',       // { deck } (mazzo intero già toccato dal modello)
    DECKS_DELETE: 'decks_delete',       // { id }
    DECKS_DUPLICATE: 'decks_duplicate', // { id }
    // Imposta il commander di un mazzo (§8.4): il main risolve la carta via
    // Scryfall e scrive commander + commanderMeta (nome, identity, art crop).
    DECKS_SET_COMMANDER: 'decks_set_commander', // { id, scryfallId }
    // Chat unificata del Builder (§3-§4): NL → query Scryfall / carte
    // cross-mazzo via LLM. { deckId, text, history?, lastResults? } →
    // { ok, reply, cardIds, cards, query, deck? }. `lastResults` sono gli id
    // dell'ultima CardList mostrata (per "valuta questi risultati", §6.1).
    DECKS_CHAT: 'decks_chat',
    // Parere LLM carta-vs-mazzo (§6). { deckId, cardIds, compute?, refresh? } →
    // { ok, opinions: { cardId → { text, versione, stale } } }.
    // compute=false: solo cache (mai LLM). refresh=true: ricalcola anche i freschi.
    DECKS_OPINION: 'decks_opinion',
    // Import/Export (§11): parser rigido testo↔carte (MAI l'LLM, quello vive
    // nella chat) per lo switcher. PREVIEW risolve ogni nome via Scryfall
    // fuzzy PRIMA di applicare (mai un import "a scatola chiusa"): l'utente
    // conferma cosa entrerà nel mazzo. APPLY scrive le carte confermate.
    DECKS_IMPORT_PREVIEW: 'decks_import_preview', // { id, text } → { ok, entries:[{name,qty,card}], commander:{name,card}|null, dirtyLines }
    DECKS_IMPORT_APPLY: 'decks_import_apply',     // { id, entries:[{scryfallId,qty}], commanderId? } → { ok, deck, addedCount, updatedCount }
    DECKS_EXPORT: 'decks_export',                 // { id } → { ok, text } (stesso formato testuale dell'import)
    // Client Scryfall (§13.2), tutto nel main (rate limit + cache condivisi).
    SCRYFALL_SEARCH: 'scryfall_search',   // { query, deckId? } → identity auto dal commander
    SCRYFALL_NAMED: 'scryfall_named',     // { name } (risoluzione fuzzy)
    SCRYFALL_CARDS: 'scryfall_cards',     // { ids, freshPrices? } → mappa id → carta
    SCRYFALL_SYMBOLS: 'scryfall_symbols', // {} → mappa '{U}' → svg_uri
    SCRYFALL_PRINTS: 'scryfall_prints',   // { name } → { ok, prints } (n. stampe, cache permanente)
    GET_COSTS: 'get_costs',
    // Crediti (gamification): saldo + consumo aggregato per tipo d'uso, per la
    // pagina Crediti del profilo. NON espone mai il costo in €. Vedi creditStore.
    GET_CREDITS: 'get_credits',
    // Broadcast main→renderer quando il saldo crediti cambia (consumo, refill,
    // ricompensa): la shell aggiorna l'icona/animazione, la pagina il grafico.
    CREDITS_CHANGED: 'credits_changed',
    // Ricompensa crediti per un feedback inviato (+5 subito). { } → { ok, credits, balance }
    CREDITS_AWARD_FEEDBACK: 'credits_award_feedback',
    // Recap aggiornamento (popup all'avvio): confronta la versione vista
    // l'ultima volta con app.getVersion() e ritorna le note delle versioni
    // saltate. { } → { ok, current, lastSeen, notes:[{version,date,features,fixes}] }.
    // Se non c'è una versione vista (primissimo avvio) la marca come vista e
    // non ritorna note (niente popup a sorpresa). Vedi src/shared/patchNotes.js.
    GET_UPDATE_RECAP: 'get_update_recap',
    // L'utente ha chiuso il recap: salva app.getVersion() come ultima vista.
    MARK_UPDATE_SEEN: 'mark_update_seen',
    // Feedback dell'utente passati a `done` da quando non guardava (C5): il main
    // cerca su Firestore i feedback inviati da questo client, accredita la
    // ricompensa per priorità (50/100/200/300) una volta sola per feedback, e
    // ritorna l'elenco da ringraziare. { } → { ok, rewards:[{num,name,explanation,
    // credits,priority}], totalCredits }. La home mostra un popup di
    // ringraziamento e anima i crediti verso il profilo.
    GET_FEEDBACK_REWARDS: 'get_feedback_rewards',
    // === Bacheca utente — voto funziona/non-funziona (DC2) ===================
    // BOARD_CAST_VOTE: l'utente loggato esprime/cambia il proprio voto su un
    // feedback già in produzione (DB3). Il main allega il SUO Firebase ID token
    // come Bearer (mai esposto al renderer) e scrive votes.<uid> via FB.castVote
    // (DB4). Premia +10 crediti (CREDIT.BOARD_VOTE) UNA SOLA VOLTA per feedback
    // per utente (anti-doppio-premio in creditStore — rewardedVotes), anche se
    // l'utente cambia idea works↔broken o rivota lo stesso valore: niente
    // timeout, niente penalità. { id, vote:'works'|'broken' } →
    // { ok, votes, awarded, credits, balance } | { ok:false, error }.
    // `votes` è il map aggiornato (per ridisegnare il conteggio reale lato UI).
    BOARD_CAST_VOTE: 'board_cast_vote',
    // BOARD_CLEAR_VOTE: l'utente ritira il proprio voto (cancella votes.<uid>).
    // NON revoca il premio già accreditato (non è una penalità, è solo ritiro
    // del voto): rewardedVotes resta marcato, quindi un voto successivo sullo
    // stesso feedback non ripaga. { id } → { ok, votes } | { ok:false, error }.
    BOARD_CLEAR_VOTE: 'board_clear_vote',
    // === Bacheca utente — riapertura a pagamento (DC4) =======================
    // BOARD_REOPEN: l'utente loggato segnala che un fix "Risolti" (DB3) è
    // ancora rotto. Crea un NUOVO feedback collegato all'originale (campo
    // `parentId`, stesso percorso di creazione anonimo di SN_FEEDBACK.submit —
    // nasce in `new`, come ogni feedback utente, per il triage dell'owner) e
    // scala CREDIT.BOARD_REOPEN crediti come anti-spam (rifiuta senza scrivere
    // nulla se il saldo è insufficiente — niente saldo negativo). Scrive anche
    // `reopenRequests.<uid>` SULL'ORIGINALE (stesso pattern non-admin di
    // `votes`, vedi firestore.rules) come segnale per il percorso fidato
    // (routine/owner) che deve flippare lo status dell'originale fuori da
    // "Risolti" — un utente normale NON può scrivere `status` di un doc che
    // non ha creato lui (ramo admin delle regole), quindi quel passo resta al
    // triage. { id, text } → { ok, feedbackId, balance } | { ok:false, error }.
    BOARD_REOPEN: 'board_reopen',
    // Comandi proprietario (#210). Riservati all'owner (auth.isAdmin()).
    // OWNER_LIST_USERS: elenco email degli utenti registrati (campo `email` sui
    //   doc credits/<uid>). { } → { ok, users:[{email,name,balance}] } | { ok:false, error }.
    OWNER_LIST_USERS: 'owner_list_users',
    // OWNER_GIFT_CREDITS: regala `amount` crediti all'utente con `email`.
    //   { amount, email } → { ok, email, amount, balance } | { ok:false, error }.
    OWNER_GIFT_CREDITS: 'owner_gift_credits',
    // Broadcast main→renderer: l'utente corrente ha ricevuto crediti in regalo
    // (#210.4). { amount } → la home mostra un popup una volta sola.
    GIFT_NOTICE: 'gift_notice',
    CAPTURE_VISIBLE_TAB: 'capture_visible_tab',
    // "Salva immagine come…" dal menu contestuale. Instradato dal main
    // (session download + will-download) perché l'attributo `download` di un
    // <a> lato pagina è onorato da Chromium SOLO per URL same-origin/blob:/
    // data:: per un'immagine su un altro dominio (la stragrande maggioranza)
    // veniva ignorato e la scheda NAVIGAVA sull'immagine senza scaricare nulla
    // (#274). { url } → { ok, path?, filename? } | { ok:false, cancelled?, error? }
    // (la risposta arriva a download concluso/annullato).
    DOWNLOAD_IMAGE: 'download_image',
    // "Salva video/audio come…" dal menu contestuale su <video>/<audio>.
    // Stesso identico cammino di DOWNLOAD_IMAGE (il download avviene nel main
    // con Referer + cookie della scheda): cambia solo il tipo di file, che
    // decide il nome di ripiego e l'header Accept.
    // { url, kind:'video'|'audio' } → { ok, path?, filename? } | { ok:false, cancelled?, error? }
    DOWNLOAD_MEDIA: 'download_media',
    // "Salva file" dal menu contestuale su un link a un file (#410.2). NON
    // scarica byte a mano come DOWNLOAD_IMAGE/MEDIA: fa partire il download
    // NATIVO della scheda (webContents.downloadURL), così passa per
    // l'intercettazione will-download di #410.1 e ottiene ESATTAMENTE lo stesso
    // trattamento del clic sul link — avanzamento in barra, salvataggio in
    // cartella Download, avviso finale, voce in cronologia (parità dei cammini).
    // { url } → { ok } | { ok:false, error }
    DOWNLOAD_LINK: 'download_link',
    // --- Download "nativi" della navigazione (#410.1) --------------------
    // Sono i download che partono cliccando un link a un file (PDF, ZIP,
    // allegato): il main ascolta will-download della sessione di navigazione,
    // ne segue l'avanzamento e lo mostra nella barra in alto. Distinti da
    // DOWNLOAD_IMAGE/DOWNLOAD_MEDIA, che scaricano byte "a mano" su richiesta
    // esplicita del menu. Questi messaggi servono alla shell per leggere la
    // cronologia e comandare i singoli scaricamenti.
    // RISERVATI alle superfici interne (shell + pagine filo://): la cronologia
    // espone i percorsi ASSOLUTI su disco e i comandi possono far APRIRE un file
    // al sistema operativo. Da origine http(s) l'handler risponde 'forbidden'.
    // Elenco cronologia (attivi + conclusi, più recenti prima). → { ok, items }
    DOWNLOADS_LIST: 'downloads_list',
    // Svuota la cronologia dei download CONCLUSI (gli attivi restano). → { ok, items }
    DOWNLOADS_CLEAR: 'downloads_clear',
    // Rimuove UNA voce dalla cronologia. { id } → { ok, items }
    DOWNLOAD_REMOVE: 'download_remove',
    // Apre il file scaricato col programma di sistema. { id } → { ok } | { ok:false, error }
    DOWNLOAD_OPEN_FILE: 'download_open_file',
    // Mostra il file nella cartella (evidenziato). { id } → { ok } | { ok:false, error }
    DOWNLOAD_OPEN_FOLDER: 'download_open_folder',
    // Comandi sul download in corso. { id } → { ok }
    DOWNLOAD_CANCEL: 'download_cancel',
    DOWNLOAD_PAUSE: 'download_pause',
    DOWNLOAD_RESUME: 'download_resume',
    // Segnale BROADCAST main→superfici: "la cronologia scaricamenti è cambiata"
    // (parte/avanza/finisce un download). VOLUTAMENTE contentless (nessun nome
    // file né percorso): la pagina filo://downloads lo riceve e ri-legge la
    // lista dal canale DOWNLOADS_LIST (che è gated alle sole superfici interne).
    // Il broadcast raggiunge anche le schede di siti esterni: mandarci i dati
    // esporrebbe i percorsi ASSOLUTI su disco, quindi qui viaggia solo il tipo.
    DOWNLOADS_UPDATED: 'downloads_updated',
    // Test provider: misura latenza al primo token e token al secondo
    // su un piccolo prompt fisso. Usato dalla pagina Opzioni.
    TEST_PROVIDER: 'test_provider',                 // { provider, apiKey, model? }
    // Test di un modello del registry PREDEFINITO con le chiavi predefinite.
    // { nickname } → risolve nel registry predefinito (lista read-only Opzioni);
    // { provider, model } → testa la riga così com'è scritta, anche non ancora
    // salvata (editor admin, solo amministratori).
    TEST_DEFAULT_MODEL: 'test_default_model',
    // Catalogo modelli di un provider recuperato dal main con le chiavi
    // predefinite (solo admin). { provider } → { ok, items: [{ id, label }] }
    DEFAULT_MODELS_LIST: 'default_models_list',

    OPEN_HOME: 'open_home',
    GO_HOME: 'go_home',                             // naviga la scheda corrente alla home (filo://newtab/)
    OPEN_HISTORY: 'open_history',
    OPEN_OPTIONS: 'open_options',
    OPEN_SPELLCHECK_PAGE: 'open_spellcheck_page',
    CLOSE_TAB: 'close_tab',
    CLOSE_ALL_TABS: 'close_all_tabs',               // chiude tutte le tab → 1 newtab
    OPEN_URL: 'open_url',                           // { url }
    QUIT_APP: 'quit_app',
    NAV_BACK: 'nav_back',
    NAV_FORWARD: 'nav_forward',
    NAV_RELOAD: 'nav_reload',
    NAV_STATE: 'nav_state',                         // → { ok, canBack, canFwd }
    TOGGLE_FULLSCREEN: 'toggle_fullscreen',
    EXIT_FULLSCREEN: 'exit_fullscreen',             // idempotente (Esc)
    FULLSCREEN_CHANGED: 'fullscreen_changed',       // broadcast → { fullscreen: bool }
    OPEN_NEW_TAB: 'open_new_tab',
    OPEN_INCOGNITO: 'open_incognito',               // apre una nuova finestra incognito
    // L'agente "Aiuto" aziona i comandi rapidi della barra di Filo (le icone in
    // alto): home, settings, apps, account, fullscreen, minimize. "close" è
    // ESCLUSO di proposito. Il main inoltra alla shell, che clicca il bottone
    // reale → si riusa tutto il comportamento esistente. → { ok } | { ok:false }
    SHELL_ACTION: 'shell_action',                   // { command }
    REPLACE_MISSPELLING: 'replace_misspelling',     // { suggestion }

    // "Vetro smerigliato" della tab attiva (spec §1.1): il content script
    // campiona il colore dominante della striscia in cima al viewport e lo manda
    // al main, che lo mette sullo snapshot così la shell tinge la tab attiva.
    TAB_DOMINANT_COLOR: 'tab_dominant_color',       // { color: 'rgb(r,g,b)' | null }

    // §1.2 — colore IDENTITÀ del sito (theme-color → manifest → favicon →
    // fallback), calcolato una volta dal content script e cachato per dominio dal
    // main; la shell lo applica attenuato alle tab INATTIVE.
    TAB_IDENTITY_COLOR: 'tab_identity_color',        // { color: 'rgb(r,g,b)' | null }

    // §2.1 — segnali di attività della tab riportati dal content script, per la
    // decisione di auto-archiviazione. Throttled. { lastInteractionAt?, scrollPct?, formDirty? }
    TAB_ACTIVITY: 'tab_activity',

    // §2.1 — pulizia/riordino su richiesta esplicita dell'utente (lo invoca
    // l'agente Filo dopo conferma). Esegue il triage su tutte le tab della finestra.
    RUN_TAB_TRIAGE: 'run_tab_triage',

    // Riordino cromatico ESPLICITO della striscia ("/riordina"): riordina tutte
    // le tab per colore come alla riapertura di Filo, ma senza archiviare nulla
    // (a differenza di RUN_TAB_TRIAGE). Nessuna scheda viene chiusa. → { reordered }
    REORDER_TABS: 'reorder_tabs',

    // #376 — porta in primo piano una scheda già aperta (per id). Serve ai
    // riferimenti in chat quando Filo ha aperto qualcosa in SECONDO PIANO: il
    // chip ci porta sopra invece di aprire una seconda scheda sullo stesso
    // indirizzo. → { ok }
    FOCUS_TAB: 'focus_tab',                        // { id }

    // Aiuto: invio percorso completato a fine sessione (passa per la pipeline
    // di sanitizzazione 2-LLM in pathsCollector.js prima di toccare Firestore).
    SAVE_PATH: 'save_path',                        // { path: { domain, initialUrl, sanitizedSteps, rawUserMessages, success } }

    // Invio feedback alpha → Firestore/Storage. Va instradato dal main process
    // perché le CSP delle pagine ospiti bloccano fetch diretti dal preload.
    SUBMIT_FEEDBACK: 'submit_feedback',           // { text, url, title, userAgent, clientId, images: [{dataUrl}] }
    // Broadcast main→content per mostrare un toast di sistema (es. esito
    // differito dell'invio di un feedback, #341). Lo mostra solo la scheda in
    // primo piano. { text, duration? }
    SHOW_TOAST: 'show_toast',                      // { text, duration? }
    // F4 — Annulla un auto-feedback appena inviato (undo dal toast). Marca il
    // feedback come `ignored` così non compare nel triage. { id } → { ok }
    CANCEL_AUTO_FEEDBACK: 'cancel_auto_feedback', // { id }
    // Entra/esce dalla "modalità annotazione" del box feedback: il box vive in
    // un content script sulla pagina (WebContentsView) e da lì non può oscurare
    // la barra in alto di Filo (renderizzata dalla shell). Questo messaggio fa
    // da ponte: il main lo inoltra alla shell, che mostra/nasconde un velo
    // d'ombra sopra la sua barra così TUTTO Filo entra in penombra. → { ok }
    FEEDBACK_ANNOTATE: 'feedback_annotate',       // { on: boolean }
    // Disegno sull'intera app: la barra in alto di Filo vive nella shell, non
    // nella pagina, quindi serve una tela di disegno anche lì. Questi messaggi
    // sincronizzano il disegno della barra (shell) con il box feedback (pagina):
    //   - FEEDBACK_CLEAR_DRAW: il box ha premuto "Cancella disegno" → il main
    //     dice alla shell di cancellare anche i tratti sulla barra in alto.
    //   - FEEDBACK_DRAW_STATE: broadcast main→pagina, { topbar: bool } → il box
    //     sa se c'è un disegno sulla barra (per mostrare "Cancella disegno" e
    //     allegare lo screenshot anche quando si è disegnato SOLO sulla barra).
    //   - CAPTURE_FEEDBACK_TOPBAR: il box chiede lo scatto annotato della sola
    //     barra in alto, da impilare sopra lo screenshot della pagina.
    FEEDBACK_CLEAR_DRAW: 'feedback_clear_draw',   // { } → { ok }
    FEEDBACK_DRAW_STATE: 'feedback_draw_state',   // broadcast → { topbar: bool }
    CAPTURE_FEEDBACK_TOPBAR: 'capture_feedback_topbar', // → { ok, dataUrl?, barHeight? }
    // Triage admin di un feedback (cambio stato/note/priorità). Instradato dal
    // main, che allega il Firebase ID token come Bearer e RIFIUTA se l'utente
    // loggato non è admin. → { ok } | { ok:false, error }
    FEEDBACK_UPDATE: 'feedback_update',           // { id, status?, notes?, userNote?, priority?, archiveOverride? }
    // S1.3: decifratura campi feedback lato main (la chiave privata NON lascia
    // mai il main process). Il renderer manda i campi con valori potenzialmente
    // cifrati; il main li decifra e torna il plaintext. Owner-only.
    // Modalità singola:  { fields: {text?,url?,name?,title?,notes?,reviewComment?} }
    //   → { ok, fields: {…decifrati} } | { ok:false, error }
    // Modalità batch:    { list: [{…}, …] }
    //   → { ok, list: [{…decifrati}, …] } | { ok:false, error }
    // (Il batch serve alle dashboard che caricano centinaia di feedback: una sola
    //  IPC per tutta la lista invece di N.)
    FEEDBACK_DECRYPT_FIELDS: 'feedback_decrypt_fields',
    // S1.2: decifratura di UN allegato immagine lato main (la chiave privata NON
    // lascia mai il main). Le immagini dei feedback sono cifrate come byte opachi
    // su Storage (application/octet-stream): un <img src=URL> diretto mostra un
    // allegato rotto. Il main scarica i byte, li decifra se cifrati, indovina il
    // MIME dai magic byte e torna un data URL mostrabile. Owner-only.
    //   { url } → { ok, dataUrl } | { ok:false, error }
    FEEDBACK_DECRYPT_IMAGE: 'feedback_decrypt_image',
    // Config "modelli predefiniti" condivisa (admin-only, propaga a tutti via
    // Firestore). GET ritorna la config senza esporre le chiavi vere (solo se
    // presenti); UPDATE scrive provider/models/modelRegistry/apiKeys.
    DEFAULTS_GET: 'defaults_get',                  // → { ok, config } | { ok:false, error }
    DEFAULTS_UPDATE: 'defaults_update',            // { config } → { ok, config } | { ok:false, error }
    // Modelli predefiniti EFFETTIVI (registry + modello per funzione), senza
    // nessuna chiave. Leggibile da chiunque: serve alla pagina Opzioni per
    // mostrare i modelli che l'app userà DAVVERO, invece di quelli scritti nel
    // codice — che possono essere stati cambiati o eliminati dalla config
    // condivisa. Nessun segreto: sono solo nomi di modelli.
    //   → { ok, modelRegistry, models } | { ok:false, error }
    DEFAULT_MODELS_PUBLIC: 'default_models_public',
    // Config "modelli di supporto" (doc Firestore config/supportModels, admin-only).
    // Un campo per slot: sanitizer, judge1, judge2, judge3, judgeDynamic,
    // judgeRedTeam, judgePriority. Valore di ogni slot = stringa catena (es.
    // "flash, flash-or"). Più `judgeRegistry` (nickname → modello OpenRouter,
    // dedicato ai giudici). La chiave OpenRouter dei giudici (segreta, separata da
    // quelle di Filo) sta nel doc config/judgeSecrets: GET ne ritorna solo il
    // booleano `openrouterKeyPresent`; UPDATE la scrive se passata in `openrouterKey`.
    // Tutto letto anche dal backend filo-security (DD3).
    SUPPORT_MODELS_GET: 'support_models_get',      // → { ok, models } | { ok:false, error }
    SUPPORT_MODELS_UPDATE: 'support_models_update',// { models, judgeRegistry?, openrouterKey? } → { ok, models } | { ok:false, error }
    // Ri-valutazione owner dei feedback "non filtrati" (panel parziale): la
    // dashboard passa gli id dei feedback bianchi; il backend ri-esegue SOLO i
    // giudici mancanti e riscrive il pipeline. Owner-only.
    FEEDBACK_REEVALUATE: 'feedback_reevaluate',    // { feedbackIds:[...] } → { ok, reevaluated, results } | { ok:false, error }
    // Impostazioni della tab Automazioni. Owner-only. Due interruttori distinti:
    //   `enabled` (doc config/automation) → chi entra in coda da solo (filo-security
    //     DESIGN §2);
    //   `routinesEnabled` (doc config/routines) → se le routine autonome lavorano.
    // Insieme viaggiano `autoApprove` e `proberWhenIdle`.
    AUTOMATION_GET: 'automation_get',              // → { ok, enabled, autoApprove, proberWhenIdle, routinesEnabled } | { ok:false, error }
    AUTOMATION_SET: 'automation_set',              // { enabled?, autoApprove?, proberWhenIdle?, routinesEnabled? } → { ok, … } | { ok:false, error }
    // Contatori del verificatore a tre esiti (doc config/routines, campi
    // `failCap` e `improvableCap` — SPEC-RIDISEGNO-MAX.md §13):
    //   failCap (M)       quante bocciature «fail» prima di fermare la pratica
    //                     e chiamare l'owner (il campo legacy `loopCap` resta
    //                     scritto come alias, per i lettori non ancora aggiornati);
    //   improvableCap (N) quanti giri «migliorabile» prima di promuovere il
    //                     lavoro e aprire il feedback dei rilievi residui.
    // Li applica il SERVER quando registra i verdetti. Owner-only.
    AUTOMATION_CAPS_GET: 'automation_caps_get',    // → { ok, failCap, improvableCap } | { ok:false, error }
    AUTOMATION_CAPS_SET: 'automation_caps_set',    // { failCap?, improvableCap? } → { ok, failCap, improvableCap } | { ok:false, error }
    // Log dei worker delle routine (doc config/automation, campo `workerLog`):
    // elenco degli ultimi worker spawnati, con ruolo e istante di avvio. Lo
    // scrive scripts/dispatch.mjs a ogni spawn; lo legge la tab "Log" della
    // dashboard Gestione. Owner-only, sola lettura dal client.
    WORKER_LOG_GET: 'worker_log_get',              // → { ok, entries:[{role,startedAt,num}] } | { ok:false, error }
    // Registri del canale autenticato delle routine (spec ROUTINE-AUTH-SPEC.md):
    // i RIFIUTI (una richiesta fuori dal perimetro del biglietto è il segnale
    // che qualcuno ha manipolato un lavoratore) e i CONFRONTI fra la scelta del
    // cammino su git e quella del server. Vivono in collezioni che nessun client
    // può leggere: si passa dalla callable owner-only del backend di sicurezza.
    ROUTINE_LOG_GET: 'routine_log_get',            // → { ok, rejections:[…], comparisons:[…] } | { ok:false, error }
    // Fusioni bloccate dai controlli di sicurezza del server, in attesa
    // dell'owner (SPEC-RIDISEGNO-MAX.md §10). Il server non le respinge e
    // basta: apre una richiesta, e l'owner la approva DENTRO Filo — su una
    // superficie diversa dal terminale, dove serve una persona davanti allo
    // schermo. Vivono in una collezione che nessun client può leggere: si passa
    // dalla callable owner-only del backend di sicurezza.
    //
    // ORIGINE: solo pagine `filo://`. Un sito visitato non deve poter né sapere
    // che c'è una fusione in attesa (dice cosa sta facendo l'owner) né tentare
    // di approvarla o scartarla.
    MERGE_APPROVALS_GET: 'merge_approvals_get',        // → { ok, pending:[…], recent:[…], ttlMs } | { ok:false, error }
    MERGE_APPROVAL_APPROVE: 'merge_approval_approve',  // { id } → { ok, result:'merged'|'conflict'|'stale', sha? } | { ok:false, error }
    MERGE_APPROVAL_DISCARD: 'merge_approval_discard',  // { id } → { ok, result:'discarded' } | { ok:false, error }
    // BROADCAST (main → pagine): l'elenco è cambiato, eccolo. Non è un
    // handler: nessuno lo "chiama", lo manda il main quando `npm run finish`
    // suona il campanello (services/mergeApprovalSignal.js) o quando l'owner
    // rientra nella finestra. Serve perché una prima schermata GIÀ APERTA se ne
    // accorga: prima l'elenco si leggeva solo all'apertura, e l'avviso di cui
    // parla il terminale non compariva mai sotto gli occhi di chi lo stava
    // aspettando. Porta il dato con sé (una lettura sola per tutte le pagine
    // aperte, invece di una per pagina) e va SOLO alle pagine filo://: dentro
    // ci sono nomi di rami e percorsi di file.
    MERGE_APPROVALS_CHANGED: 'merge_approvals_changed', // { pending:[…], recent:[…], ttlMs }
    WEB_SEARCH: 'web_search',                      // { query } → { ok, results: [{title,url,snippet}], provider }

    // === Rilevamento siti pericolosi (src/main/services/safebrowse/) ===
    // Il content script chiede il verdetto per la URL corrente (+ indizi di
    // pagina: presenza campo password/pagamento). Il main risponde col livello
    // e un messaggio specifico. → { ok, level:'safe'|'sospetto'|'pericoloso',
    // message:{title,body}|null, registrable }
    SAFEBROWSE_GET: 'safebrowse_get',              // { url, hasPassword?, hasPayment? }
    // L'utente ha scritto "confermo" sull'interstitial "pericoloso": registra un
    // bypass per (tab, dominio) così la pagina non viene più coperta. → { ok }
    SAFEBROWSE_PROCEED: 'safebrowse_proceed',      // { url }
    // L'utente ha chiuso con "ok" il banner "sospetto": non riproporlo per
    // questo dominio nel tab. → { ok }
    SAFEBROWSE_DISMISS: 'safebrowse_dismiss',      // { url }
    // Broadcast main→content: il verdetto per la URL è cambiato (navigazione o
    // arricchimento asincrono RDAP/GSB/sandbox). Il content (ri)disegna l'avviso.
    SAFEBROWSE_UPDATE: 'safebrowse_update',         // → { url, level, message }

    // === Geo-block: proposta inline (proxy-per-tab-spec.md §5, feedback #151) ===
    // Broadcast main→content: un contenuto bloccato in Italia è stato rilevato su
    // un tab con sessione di login attiva → non si riprova in silenzio, si propone.
    // Il content disegna una striscia "Lo apro dagli USA? In questa tab non sarai
    // loggato." con i bottoni Apri/No.
    GEO_PROPOSE: 'geo_propose',                     // → { url, country, countryLabel }
    // L'utente ha accettato la proposta inline: instrada la tab dal paese indicato.
    GEO_PROPOSE_ACCEPT: 'geo_propose_accept',       // { url, country } → { ok, country }
    // L'utente ha rifiutato/chiuso la proposta: non riproporla per questo dominio
    // nel tab.
    GEO_PROPOSE_DISMISS: 'geo_propose_dismiss',     // { url } → { ok }

    // === Gestione cookie / consenso (src/content/cookies.js) ===
    // Il content script chiede la modalità corrente per decidere se rifiutare i
    // banner CMP e riscrivere gli embed YouTube in nocookie. → { mode }
    COOKIES_CONFIG: 'cookies_config',               // → { mode: 'manual'|'default'|'privacy' }
    // Broadcast main→content quando la modalità cambia (UPDATE_SETTINGS): il
    // content (dis)attiva il rifiuto CMP e la riscrittura embed senza reload.
    COOKIES_CONFIG_UPDATE: 'cookies_config_update', // → { mode }

    // === Account "Accedi con Google" (vedi src/main/auth/) ===
    // Login/logout/stato. Tutto vive nel main process: i token non sono mai
    // esposti alle pagine. La risposta porta solo il profilo pubblico.
    AUTH_SIGNIN: 'auth_signin',                    // → { ok, profile: {email,name,picture} | null }
    AUTH_SIGNOUT: 'auth_signout',                  // → { ok }
    AUTH_STATUS: 'auth_status',                    // → { ok, signedIn, profile|null }
    AUTH_CHANGED: 'auth_changed',                  // broadcast → { signedIn, profile|null }

    // Clipboard history (per il menu "Incolla")
    GET_CLIPBOARD_HISTORY: 'get_clipboard_history',
    PUSH_CLIPBOARD_ENTRY: 'push_clipboard_entry',     // { entry }
    UPDATE_CLIPBOARD_DESCRIPTION: 'update_clipboard_description', // { dataUrl, description }
    REMOVE_CLIPBOARD_ENTRY: 'remove_clipboard_entry', // { entry }
    CLEAR_CLIPBOARD_HISTORY: 'clear_clipboard_history',

    // Categorie (Fase 2)
    GET_CATEGORIES: 'get_categories',
    RENAME_CATEGORY: 'rename_category',         // { id, name }
    DELETE_CATEGORY: 'delete_category',         // { id }
    MERGE_CATEGORIES: 'merge_categories',       // { fromId, toId }
    MOVE_PAGE_CATEGORY: 'move_page_category',   // { pageId, categoryId }

    // === Filo dashboard ===
    // Filo Chat: invio messaggio utente all'agente conversazionale
    // { userMessage, threadHistory: [{role, text, actions?}] }
    // Risposta: { ok, text, actions: [...], model, costEur }
    FILO_CHAT: 'filo_chat',
    // Filo State: assembla stato programmatico (tab aperte, tempo, processi).
    // Risposta: { ok, state: {...}, stateText: "..." }
    FILO_GET_STATE: 'filo_get_state',
    // Genera dashboard (messaggio centro + suggerimenti). Usa cache con cooldown.
    // { force?: boolean }
    // Risposta: { ok, message, suggestions, cached, ts }
    FILO_GENERATE_DASHBOARD: 'filo_generate_dashboard',
    // CRUD memoria/contenuti dashboard
    FILO_GET_MEMORY: 'filo_get_memory',
    // (Gli appunti non hanno più messaggi propri: sono file dell'editor, scritti
    // dall'azione SALVA_APPUNTO e letti aprendo l'editor.)
    FILO_GET_TIMERS: 'filo_get_timers',
    FILO_ADD_TIMER: 'filo_add_timer',              // { label, seconds }
    FILO_DELETE_TIMER: 'filo_delete_timer',        // { id }
    FILO_PAUSE_TIMER: 'filo_pause_timer',          // { id } — mette in pausa un timer (congela il conto alla rovescia)
    FILO_RESUME_TIMER: 'filo_resume_timer',        // { id } — riprende un timer in pausa
    FILO_STOP_TIMER_ALARM: 'filo_stop_timer_alarm', // { id } — silenzia/rimuove un timer che sta suonando
    FILO_GET_NOTIFICATIONS: 'filo_get_notifications',
    FILO_DISMISS_NOTIFICATION: 'filo_dismiss_notification', // { id }
    // L'utente ha confermato (popup livello 2 / digitato "conferma" livello 3)
    // un'azione di Filo rimasta in sospeso: ora va eseguita davvero. { action }
    FILO_CONFIRM_ACTION: 'filo_confirm_action',

    // Primo dispatch (non ancora confermato) di UNA singola azione di Filo,
    // usato dall'agente "Aiuto" (sidebar) per attivare le azioni tipizzate di
    // Filo — es. inviare un feedback — passando dallo stesso registro dei
    // livelli di sicurezza della chat dashboard. Torna { executed, kept,
    // needsConfirm, describe }: se needsConfirm il client mostra il popup di
    // conferma e poi rimanda l'azione via FILO_CONFIRM_ACTION. { action }
    FILO_RUN_ACTION: 'filo_run_action',

    // #405 — un'azione di PAGINA invocata dal menu aperto dentro un riquadro
    // incorporato (iframe). Il riquadro conosce solo se stesso: tradurre,
    // condividere, salvare o fare uno screenshot devono valere per la pagina
    // intera, non per il rettangolo dell'embed. Il content script del riquadro
    // chiede al main di rilanciare il comando nel frame principale della
    // scheda, che lo esegue come se il menu fosse stato aperto lì.
    // { iconId } oppure { surface }
    //
    // ORIGINE: chiamabile anche da una pagina web (è il content script di un
    // riquadro a mandarlo) — di proposito, e senza gate. Non legge dati, non
    // tocca il disco e non aziona il sistema: inoltra un messaggio a un frame
    // DELLA STESSA SCHEDA, che al più esegue una voce del menu del tasto destro
    // già raggiungibile con i suoi messaggi diretti. Non porta dati arbitrari:
    // solo un id del registro icone o il nome di un pannello.
    RUN_IN_TOP_FRAME: 'run_in_top_frame',

    // #445 — il menu del tasto destro aperto dentro un riquadro incorporato non
    // può uscire dai bordi del riquadro: in un player o in un banner alti 100-350
    // px diventa una fessura da scorrere. Quando non ci sta, il riquadro chiede
    // alla PAGINA di disegnarlo lei, sopra al riquadro, dove c'è tutta l'altezza
    // della finestra. Le azioni restano riferite all'elemento cliccato: la pagina
    // rimanda indietro il click, il riquadro esegue.
    // { phase, token, ... } — vedi src/content/menuRemote.js:
    //   'open'  (riquadro → pagina): { spec, x, y, keepOnScroll }
    //   'patch' (riquadro → pagina): { path, props } — la spiegazione AI arrivata
    //   'event' (pagina → riquadro): { id, arg } — voce scelta
    //   'close' (entrambe le direzioni): il menu si è chiuso di là
    //
    // ORIGINE: come RUN_IN_TOP_FRAME, lo manda il content script di una pagina
    // web. Il ponte instrada SOLO fra i frame della stessa scheda e SOLO verso
    // il frame che ha aperto il menu (il token deve corrispondere). Il contenuto
    // è dati, mai HTML: etichette e testo entrano come testo, le icone valgono
    // solo se coincidono con una del registro di Filo.
    PROJECT_MENU: 'project_menu',

    // Da background -> content (broadcast)
    SETTINGS_UPDATED: 'settings_updated',
    SHORTCUT_TRIGGERED: 'shortcut_triggered',     // { command }
    // Contropartita di RUN_IN_TOP_FRAME: arriva SOLO al frame principale della
    // scheda e gli fa eseguire l'azione di pagina chiesta da un riquadro. { iconId }
    TOP_FRAME_COMMAND: 'top_frame_command',
    // #405 — un altro frame della stessa scheda ha aperto il suo menu: chiudi
    // il tuo. Gli eventi del mouse non attraversano il confine di un iframe,
    // quindi senza questo due menu potrebbero restare aperti insieme.
    CLOSE_OTHER_MENUS: 'close_other_menus',
    // #445 — contropartita di PROJECT_MENU: il ponte consegna il messaggio al
    // frame dall'altra parte (la pagina che ospita il riquadro, o il riquadro
    // che ha aperto il menu). Stessi campi.
    PROJECTED_MENU: 'projected_menu',
    // #445 — il main dice a un riquadro dove si trova dentro la finestra, misurato
    // sull'ultimo click destro (coordinate native del context-menu meno quelle
    // locali dell'evento). Serve al riquadro per sapere DOVE far disegnare il menu
    // alla pagina. Senza, il menu resta dentro il riquadro. { x, y }
    FRAME_VIEW_POS: 'frame_view_pos',
    // Broadcast da background -> dashboard: lo stato live è cambiato
    // (nuovo timer, notifica, ecc.) e va re-renderizzato.
    FILO_LIVE_UPDATED: 'filo_live_updated',
    // Broadcast da background -> dashboard (#155): il ricalcolo in background
    // della home è pronto. La scheda aggiorna messaggio + suggerimenti senza
    // rifare la chiamata all'LLM. { message, suggestions, ts }
    FILO_DASHBOARD_UPDATED: 'filo_dashboard_updated',
    // Broadcast da background -> content: una lettura ad alta voce è attiva
    // (in QUALCHE scheda) oppure no. Ogni scheda usa questo flag per mostrare
    // "Interrompi lettura" nel menu anche se non è lei a leggere. { active: bool }
    TTS_GLOBAL_READING: 'tts_global_reading',
    // Broadcast da background -> content: ferma la tua lettura locale, se ne hai
    // una. Inviato a tutte le schede quando una di esse chiede lo stop globale.
    TTS_STOP: 'tts_stop',

    // ── Canale red-team (filo-redteam-ux-spec) ────────────────────────────────
    // Ponte verso le Cloud Function di filo-security (backend "cervello"). Il main
    // (handlers/redteam.js) le invoca col Firebase ID token dell'utente loggato.
    // REDTEAM_SUBMIT: invia un tentativo. { attackText, description } →
    //   { status:'ok', attemptId, balance, cost } | { status:'dormant' } |
    //   { status:'insufficient_credits', have, needed } | { status:'empty' }.
    REDTEAM_SUBMIT: 'redteam_submit',
    // REDTEAM_STATE: stato gamification dell'utente per la tab Statistiche.
    //   { } → { signedIn, verified, isOwner, handle?, bestPerJudge?, gridUnlocked?,
    //   milestones?, leaderboardScore?, recentAttempts?:[{ id, title, verdicts,
    //   score, isValidAttack, status, createdAt }] }.
    REDTEAM_STATE: 'redteam_state',
    // REDTEAM_ATTEMPT: un tentativo (polling rivelazione live). { attemptId } →
    //   { attempt:{ title, verdicts, score, isValidAttack, status } } |
    //   { hidden:true } | { notFound:true }.
    REDTEAM_ATTEMPT: 'redteam_attempt',
    // REDTEAM_LEADERBOARD: classifica (tutti i loggati). { } →
    //   { entries:[{ handle, leaderboardScore, bestPerJudge, totalAttempts, milestones }] }.
    REDTEAM_LEADERBOARD: 'redteam_leaderboard',
    // REDTEAM_REDEEM: riscatta un codice monouso. { code, handle } →
    //   { status:'ok', handle } | { status:'invalid_code'|'code_used'|'invalid_handle'|'handle_taken'|'already_verified', error? }.
    REDTEAM_REDEEM: 'redteam_redeem',
    // REDTEAM_GEN_CODES: genera codici monouso (SOLO owner). { count } →
    //   { ok, codes:[..] } | { ok:false, error }.
    REDTEAM_GEN_CODES: 'redteam_gen_codes',
    // REDTEAM_LIST_CODES: elenca i codici esistenti (SOLO owner). { } →
    //   { ok, codes:[{ code, used, usedAt?, createdAt?, handle? }] } | { ok:false, error }.
    REDTEAM_LIST_CODES: 'redteam_list_codes',
    // REDTEAM_REVOKE_CODE: revoca un codice ancora libero (SOLO owner). { code } →
    //   { ok } | { ok:false, status:'invalid_code'|'code_used', error? }.
    REDTEAM_REVOKE_CODE: 'redteam_revoke_code',
  };

  // Port-based streaming
  const PORTS = {
    AI_STREAM: 'ai_stream',
  };

  global.SN_MSG = { MSG, PORTS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
