// Protocollo messaggi tra content script, background e pagine.

(function (global) {
  'use strict';

  const MSG = {
    // Da content -> background
    AI_REQUEST: 'ai_request',                     // { action, payload }
    AI_REQUEST_STREAM_START: 'ai_request_stream', // streaming via port
    // Sintesi vocale via modello: senza provider/modello TTS torna { ok:false } e il chiamante
    // ripiega sulla voce del browser. { text, lang? } — la lingua sceglie la voce.
    TTS_SYNTH: 'tts_synth',                        // → { ok, audioBase64, mimeType } | { ok:false, error }
    TTS_VOICES: 'tts_voices',                      // → { ok, model, catalog, required, groups, chosen } (voci del modello di lettura in uso)
    // Stato lettura condiviso: il main tiene il conteggio globale e lo ribroadcast a tutte,
    // così anche una scheda che non sta leggendo mostra «Interrompi lettura».
    TTS_READING_STATE: 'tts_reading_state',        // content→main { reading: bool }
    // Richiesta di fermare la lettura attiva ovunque sia (anche in un'altra
    // scheda). Il main inoltra TTS_STOP a tutte le schede.
    TTS_STOP_READING: 'tts_stop_reading',          // content→main
    // Una scheda appena caricata chiede lo stato: la lettura può essere partita PRIMA che
    // esistesse, quindi avrebbe perso il broadcast.
    TTS_READING_STATUS: 'tts_reading_status',       // content→main → { active: bool }
    SAVE_PAGE: 'save_page',                       // { page }
    SAVE_LINK: 'save_link',                       // { url, title }
    GET_SETTINGS: 'get_settings',
    UPDATE_SETTINGS: 'update_settings',           // { settings }
    RESET_SETTINGS: 'reset_settings',             // → riporta TUTTE le impostazioni ai predefiniti
    EXPORT_DATA: 'export_data',                   // → salva tutti i dati come .zip
    // Reimportazione del .zip in due passi: si LEGGE (anteprima) e si APPLICA dopo la conferma.
    // Solo filo://: una pagina web non deve aprire un dialog né riscrivere lo storage.
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

    // §3.1/§3.3 — archivio tab chiuse (metadati). La scrittura la fa il main alla chiusura;
    // questi servono alla pagina archivio per leggere, rimuovere, svuotare.
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
    // Chat unificata del Builder: NL → query Scryfall o carte cross-mazzo via LLM.
    // `lastResults` sono gli id dell'ultima CardList mostrata («valuta questi risultati»).
    DECKS_CHAT: 'decks_chat',
    // Parere LLM carta-vs-mazzo. { deckId, cardIds, compute?, refresh? } → { ok, opinions }.
    // compute=false: solo cache (mai LLM). refresh=true: ricalcola anche i freschi.
    DECKS_OPINION: 'decks_opinion',
    // Import/Export: parser rigido testo↔carte, MAI l'LLM (quello vive nella chat).
    // PREVIEW risolve ogni nome via Scryfall PRIMA di applicare: mai un import a scatola chiusa.
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
    // Crediti: saldo e consumo aggregato per tipo d'uso, per la pagina Crediti. NON espone mai
    // il costo in €.
    GET_CREDITS: 'get_credits',
    // Broadcast main→renderer quando il saldo cambia (consumo, refill, ricompensa): la shell
    // aggiorna l'icona, la pagina il grafico.
    CREDITS_CHANGED: 'credits_changed',
    // Ricompensa crediti per un feedback inviato (+5 subito). { } → { ok, credits, balance }
    CREDITS_AWARD_FEEDBACK: 'credits_award_feedback',
    // Recap aggiornamento: le note delle versioni saltate dall'ultima vista.
    // Al primo avvio marca la versione come vista e non torna note: niente popup a sorpresa.
    GET_UPDATE_RECAP: 'get_update_recap',
    // L'utente ha chiuso il recap: salva app.getVersion() come ultima vista.
    MARK_UPDATE_SEEN: 'mark_update_seen',
    // Feedback passati a `done` mentre l'utente non guardava: la ricompensa per priorità si
    // accredita UNA volta sola per feedback, più l'elenco da ringraziare.
    GET_FEEDBACK_REWARDS: 'get_feedback_rewards',
    // Bacheca — voto funziona/non-funziona. Il main allega il SUO ID token (mai esposto al
    // renderer). Premia UNA SOLA VOLTA per feedback per utente, anche se l'utente cambia idea.
    BOARD_CAST_VOTE: 'board_cast_vote',
    // Ritiro del voto. NON revoca il premio già dato (è un ritiro, non una penalità) ma
    // rewardedVotes resta marcato, quindi un voto successivo non ripaga. { id } → { ok, votes }
    BOARD_CLEAR_VOTE: 'board_clear_vote',
    // Riapertura a pagamento: crea un NUOVO feedback collegato (`parentId`) e scala crediti come
    // anti-spam. `reopenRequests` sull'originale: portarlo fuori da «Risolti» resta al triage.
    BOARD_REOPEN: 'board_reopen',
    // Comandi proprietario (#210), riservati all'owner (auth.isAdmin()).
    // OWNER_LIST_USERS: { } → { ok, users:[{email,name,balance}] } | { ok:false, error }.
    OWNER_LIST_USERS: 'owner_list_users',
    // OWNER_GIFT_CREDITS: regala `amount` crediti all'utente con `email`.
    //   { amount, email } → { ok, email, amount, balance } | { ok:false, error }.
    OWNER_GIFT_CREDITS: 'owner_gift_credits',
    // Broadcast main→renderer: l'utente ha ricevuto crediti in regalo (#210.4). { amount } →
    // la home mostra un popup una volta sola.
    GIFT_NOTICE: 'gift_notice',
    // Crediti sul server e chiave personale. ORIGINE: tutti i WALLET_* sono riservati a filo://
    // e alla shell. WALLET_STATE: il portafoglio dell'INSTALLAZIONE, non dell'account Google.
    WALLET_STATE: 'wallet_state',
    // Riscatta un codice d'invito: il server crea la chiave personale e la consegna UNA volta,
    // il main la salva cifrata. { code } → { ok, status, message, credits?, … }
    WALLET_REDEEM: 'wallet_redeem',
    // Il portafoglio c'è sul server ma la chiave personale non è su questo computer: il server
    // ne emette un'altra, la vecchia si spegne e il saldo resta. { } → { ok, status, message }
    WALLET_REISSUE: 'wallet_reissue',
    // L'identità dell'installazione è stata annullata sul server e il portafoglio non si
    // raggiunge più: si ricomincia con un'identità nuova e un nuovo invito. { } → { ok, state }
    WALLET_RESET_IDENTITY: 'wallet_reset_identity',
    // Riservati all'owner, col token dell'account Google. WALLET_OWNER_OVERVIEW: { } → { ok,
    // overview } — per utente pseudonimo, saldo, consumo, chi l'ha invitato; totale vs tetto.
    WALLET_OWNER_OVERVIEW: 'wallet_owner_overview',
    // Alza il tetto di un utente. { pseudonym, credits, why } → { ok, result }
    WALLET_OWNER_GRANT: 'wallet_owner_grant',
    // WALLET_OWNER_INVITES: genera codici d'invito dell'owner. { count } → { ok, codes }
    WALLET_OWNER_INVITES: 'wallet_owner_invites',
    CAPTURE_VISIBLE_TAB: 'capture_visible_tab',
    // «Salva immagine come…» dal main: l'attributo `download` di un <a> vale solo per
    // same-origin/blob:/data:, altrove la scheda NAVIGAVA sull'immagine senza scaricare niente.
    DOWNLOAD_IMAGE: 'download_image',
    // «Salva video/audio come…»: stesso cammino di DOWNLOAD_IMAGE, cambia solo il tipo, che
    // decide nome di ripiego e header Accept. { url, kind:'video'|'audio' }
    DOWNLOAD_MEDIA: 'download_media',
    // «Salva file» su un link: fa partire il download NATIVO della scheda, così passa da
    // will-download e ha lo STESSO trattamento del clic (barra, cartella, avviso, cronologia).
    DOWNLOAD_LINK: 'download_link',
    // Download nativi della navigazione, RISERVATI alle superfici interne: la cronologia espone
    // i percorsi assoluti e i comandi aprono file, quindi da http(s) l'handler dice 'forbidden'.
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
    // Broadcast «la cronologia scaricamenti è cambiata», VOLUTAMENTE senza contenuto: raggiunge
    // anche le schede dei siti, e portare i dati esporrebbe i percorsi su disco.
    DOWNLOADS_UPDATED: 'downloads_updated',
    // Test provider: misura latenza al primo token e token al secondo
    // su un piccolo prompt fisso. Usato dalla pagina Opzioni.
    TEST_PROVIDER: 'test_provider',                 // { provider, apiKey, model? }
    // Test di un modello del registry predefinito con le chiavi predefinite. { nickname } lo
    // risolve nel registry; { provider, model } testa la riga com'è scritta, anche non salvata.
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
    // Lo stato a tutto schermo CHIESTO dalla pagina appena si monta: chi nasce a modalità già
    // accesa non sentirebbe mai l'annuncio. Aperto anche alle pagine web. → { ok, fullscreen }
    FULLSCREEN_STATE: 'fullscreen_state',
    // Un riquadro di Filo si è preso l'Esc: era suo, non della modalità, e il main annulla
    // l'uscita in attesa. Il silenzio significa «nessuno l'ha usato», e allora si esce.
    ESC_CONSUMATO: 'esc_consumato',
    // Il main consegna un Esc che il browser avrebbe mangiato: se lo schermo pieno è del SITO
    // il documento non lo vede, e ogni riquadro di Filo aperto sopra veniva scavalcato.
    ESC_INOLTRATO: 'esc_inoltrato',
    // Un riquadro ha aperto qualcosa di Filo sopra uno schermo pieno, ma l'uscita la può
    // chiedere solo il frame principale: lo dice al main, che gira la richiesta a chi può.
    ESC_CHIEDI_TASTO: 'esc_chiedi_tasto',
    OPEN_NEW_TAB: 'open_new_tab',
    OPEN_INCOGNITO: 'open_incognito',               // apre una nuova finestra incognito
    // L'agente «Aiuto» aziona i comandi rapidi della barra («close» è ESCLUSO di proposito): il
    // main inoltra alla shell, che clicca il bottone reale e riusa il comportamento esistente.
    SHELL_ACTION: 'shell_action',                   // { command }
    REPLACE_MISSPELLING: 'replace_misspelling',     // { suggestion }

    // «Vetro smerigliato» della tab attiva: il content script campiona il colore dominante in
    // cima al viewport, il main lo mette sullo snapshot e la shell tinge la tab attiva.
    TAB_DOMINANT_COLOR: 'tab_dominant_color',       // { color: 'rgb(r,g,b)' | null }

    // Colore IDENTITÀ del sito (theme-color → manifest → favicon → ripiego), calcolato una volta
    // e cachato per dominio; la shell lo applica attenuato alle tab INATTIVE.
    TAB_IDENTITY_COLOR: 'tab_identity_color',        // { color: 'rgb(r,g,b)' | null }

    // §2.1 — segnali di attività della tab riportati dal content script, per la
    // decisione di auto-archiviazione. Throttled. { lastInteractionAt?, scrollPct?, formDirty? }
    TAB_ACTIVITY: 'tab_activity',

    // §2.1 — pulizia/riordino su richiesta esplicita dell'utente (lo invoca
    // l'agente Filo dopo conferma). Esegue il triage su tutte le tab della finestra.
    RUN_TAB_TRIAGE: 'run_tab_triage',

    // Riordino cromatico ESPLICITO della striscia: riordina le tab per colore come alla
    // riapertura, ma senza archiviare né chiudere niente (a differenza di RUN_TAB_TRIAGE).
    REORDER_TABS: 'reorder_tabs',

    // Porta in primo piano una scheda già aperta (per id): serve ai riferimenti in chat quando
    // Filo ha aperto qualcosa in secondo piano, invece di aprire una seconda scheda uguale.
    FOCUS_TAB: 'focus_tab',                        // { id }

    // Aiuto: invio percorso completato a fine sessione (passa per la pipeline
    // di sanitizzazione 2-LLM in pathsCollector.js prima di toccare Firestore).
    SAVE_PATH: 'save_path',                        // { path: { domain, initialUrl, sanitizedSteps, rawUserMessages, success } }

    // «Se l'utente rispondesse, da qui partirebbe qualcosa?». Lo chiede il riquadrino «Ha
    // funzionato?» prima di comparire: risponde la stessa porta della raccolta, o divergono.
    PATH_COLLECTABLE: 'path_collectable',          // { url }

    // Invio feedback → Firestore/Storage. Passa dal main perché le CSP delle pagine ospiti
    // bloccano i fetch diretti dal preload.
    SUBMIT_FEEDBACK: 'submit_feedback',           // { text, url, title, userAgent, clientId, images: [{dataUrl}] }
    // Broadcast main→content per un toast di sistema (es. esito differito di un invio).
    // Lo mostra solo la scheda in primo piano. { text, duration? }
    SHOW_TOAST: 'show_toast',                      // { text, duration? }
    // F4 — Annulla un auto-feedback appena inviato (undo dal toast). Marca il
    // feedback come `ignored` così non compare nel triage. { id } → { ok }
    CANCEL_AUTO_FEEDBACK: 'cancel_auto_feedback', // { id }
    // Modalità annotazione: il box vive in un content script e da lì non può oscurare la barra
    // in alto (è della shell). Questo messaggio fa da ponte, così TUTTO Filo entra in penombra.
    FEEDBACK_ANNOTATE: 'feedback_annotate',       // { on: boolean }
    // La barra in alto vive nella shell e ha una sua tela: i due disegni vanno sincronizzati.
    // CLEAR_DRAW cancella anche i tratti sulla barra; DRAW_STATE dice al box che lì c'è disegno.
    FEEDBACK_CLEAR_DRAW: 'feedback_clear_draw',   // { } → { ok }
    FEEDBACK_DRAW_STATE: 'feedback_draw_state',   // broadcast → { topbar: bool }
    CAPTURE_FEEDBACK_TOPBAR: 'capture_feedback_topbar', // → { ok, dataUrl?, barHeight? }
    // Triage admin di un feedback. Instradato dal main, che allega il Firebase ID token come
    // Bearer e RIFIUTA se l'utente loggato non è admin. → { ok } | { ok:false, error }
    FEEDBACK_UPDATE: 'feedback_update',           // { id, status?, notes?, userNote?, priority?, archiveOverride?, mergePreapproved?: bool }
    // LETTURA dei feedback per l'owner: la collezione non è pubblica e l'ID token vive nel main,
    // quindi la pagina chiede e il main esegue col token. Solo filo://, solo admin.
    FEEDBACK_FETCH: 'feedback_fetch',
    // Decifratura dei campi feedback nel main (la chiave privata non lo lascia mai). Owner-only.
    // La forma `{ list:[…] }` è una sola IPC per le dashboard che caricano centinaia di righe.
    FEEDBACK_DECRYPT_FIELDS: 'feedback_decrypt_fields',
    // Decifratura di UN allegato immagine nel main: le immagini sono byte cifrati su Storage,
    // quindi il main scarica, decifra, indovina il MIME e torna un data URL. Owner-only.
    FEEDBACK_DECRYPT_IMAGE: 'feedback_decrypt_image',
    // Config «modelli predefiniti» condivisa (admin-only, propaga via Firestore). GET non
    // espone le chiavi vere, solo se ci sono; UPDATE scrive provider/models/registry/apiKeys.
    DEFAULTS_GET: 'defaults_get',                  // → { ok, config } | { ok:false, error }
    DEFAULTS_UPDATE: 'defaults_update',            // { config } → { ok, config } | { ok:false, error }
    // Modelli predefiniti EFFETTIVI (registry + modello per funzione), senza chiavi. Leggibili
    // da chiunque: Opzioni mostra i modelli che l'app userà DAVVERO, non quelli nel codice.
    DEFAULT_MODELS_PUBLIC: 'default_models_public',
    // Config «modelli di supporto» (admin-only): un campo per slot, valore = stringa catena, più
    // `judgeRegistry`. La chiave OpenRouter dei giudici è separata: GET dice solo se c'è.
    SUPPORT_MODELS_GET: 'support_models_get',      // → { ok, models } | { ok:false, error }
    SUPPORT_MODELS_UPDATE: 'support_models_update',// { models, judgeRegistry?, openrouterKey? } → { ok, models } | { ok:false, error }
    // Ri-valutazione owner dei feedback «non filtrati»: la dashboard passa gli id, il backend
    // riesegue SOLO i giudici mancanti e riscrive il pipeline. Owner-only.
    FEEDBACK_REEVALUATE: 'feedback_reevaluate',    // { feedbackIds:[...] } → { ok, reevaluated, results } | { ok:false, error }
    // Impostazioni Automazioni, owner-only. Due interruttori distinti: `enabled` decide chi
    // entra in coda da solo, `routinesEnabled` se le routine autonome lavorano.
    AUTOMATION_GET: 'automation_get',              // → { ok, enabled, autoApprove, proberWhenIdle, routinesEnabled } | { ok:false, error }
    AUTOMATION_SET: 'automation_set', // { enabled?, autoApprove?, proberWhenIdle?, routinesEnabled? } → { ok, … }
    // I tre bilanci dei giri di correzione (cap2 per i livelli 3 e 2, cap1 per gli 1, cap0 per
    // gli 0) e il testo della fase 2. Li applica il SERVER alla critica. Owner-only.
    AUTOMATION_CAPS_GET: 'automation_caps_get',    // → { ok, cap2, cap1, cap0, fixInstructions } | { ok:false, error }
    AUTOMATION_CAPS_SET: 'automation_caps_set', // { cap2?, cap1?, cap0?, fixInstructions? } → { ok, … } | { ok:false, error }
    // Log dei worker delle routine (config/automation, campo `workerLog`): ruolo e istante di
    // avvio degli ultimi spawn, scritti da scripts/dispatch.mjs. Owner-only, sola lettura.
    WORKER_LOG_GET: 'worker_log_get',              // → { ok, entries:[{role,startedAt,num}] } | { ok:false, error }
    // Registri del canale autenticato delle routine: i RIFIUTI (richiesta fuori dal biglietto =
    // qualcuno ha manipolato un lavoratore) e i CONFRONTI fra scelta su git e del server.
    ROUTINE_LOG_GET: 'routine_log_get',            // → { ok, rejections:[…], comparisons:[…] } | { ok:false, error }
    // Fusioni bloccate dai controlli, in attesa dell'owner: il server apre una richiesta invece
    // di respingere. ORIGINE solo filo://: un sito non deve saperlo né tentare di approvarla.
    MERGE_APPROVALS_GET: 'merge_approvals_get',        // → { ok, pending:[…], failed:[…], recent:[…], ttlMs } | { ok:false, error }
    MERGE_APPROVAL_APPROVE: 'merge_approval_approve', // { id } → { ok, result:'merged'|'conflict'|'stale', … } | { ok:false, error }
    MERGE_APPROVAL_DISCARD: 'merge_approval_discard',  // { id } → { ok, result:'discarded' } | { ok:false, error }
    // L'owner ha letto la bocciatura dell'audit e va avanti: non è un via libera cieco, il
    // cancello di fusione resta e parte subito dopo. Solo filo://, solo il proprietario.
    LIVELLO4_SALTA: 'livello4_salta', // { feedbackId } → { ok, esito:'fuso'|'bloccato'|'conflitto'|'ramo_assente' }
    // BROADCAST: l'elenco è cambiato, eccolo — così una pagina GIÀ APERTA se ne accorge. Non
    // esce da filo://: dentro ci sono nomi di rami e percorsi di file.
    MERGE_APPROVALS_CHANGED: 'merge_approvals_changed', // { pending:[…], failed:[…], recent:[…], ttlMs }
    WEB_SEARCH: 'web_search',                      // { query } → { ok, results: [{title,url,snippet}], provider }

    // Rilevamento siti pericolosi: il content chiede il verdetto per la URL corrente, con gli
    // indizi di pagina (campo password o pagamento). → { ok, level, message, registrable }
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

    // Geo-block, proposta inline: un contenuto bloccato in Italia su un tab con login attivo non
    // si riprova in silenzio, si propone — «In questa tab non sarai loggato», con Apri/No.
    GEO_PROPOSE: 'geo_propose',                     // → { url, country, countryLabel }
    // L'utente ha accettato la proposta inline: instrada la tab dal paese indicato.
    GEO_PROPOSE_ACCEPT: 'geo_propose_accept',       // { url, country } → { ok, country }
    // L'utente ha rifiutato/chiuso la proposta: non riproporla per questo dominio
    // nel tab.
    GEO_PROPOSE_DISMISS: 'geo_propose_dismiss',     // { url } → { ok }

    // === Gestione cookie / consenso (src/content/cookies.js) ===
    // Il content chiede la modalità: rifiutare i banner CMP e riscrivere gli embed YouTube.
    COOKIES_CONFIG: 'cookies_config',               // → { mode: 'manual'|'default'|'privacy' }
    // Broadcast main→content quando la modalità cambia (UPDATE_SETTINGS): il
    // content (dis)attiva il rifiuto CMP e la riscrittura embed senza reload.
    COOKIES_CONFIG_UPDATE: 'cookies_config_update', // → { mode }

    // Account «Accedi con Google» (src/main/auth/): tutto vive nel main, i token non sono mai
    // esposti alle pagine e la risposta porta solo il profilo pubblico.
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

    // Categorie
    GET_CATEGORIES: 'get_categories',
    RENAME_CATEGORY: 'rename_category',         // { id, name }
    DELETE_CATEGORY: 'delete_category',         // { id }
    MERGE_CATEGORIES: 'merge_categories',       // { fromId, toId }
    MOVE_PAGE_CATEGORY: 'move_page_category',   // { pageId, categoryId }

    // === Filo dashboard === Filo Chat: messaggio dell'utente all'agente conversazionale.
    // { userMessage, threadHistory } → { ok, text, actions, model, costEur }
    FILO_CHAT: 'filo_chat',
    // Filo State: assembla stato programmatico (tab aperte, tempo, processi).
    // Risposta: { ok, state: {...}, stateText: "..." }
    FILO_GET_STATE: 'filo_get_state',
    // Genera dashboard (messaggio centro + suggerimenti), con cache e cooldown. { force? }
    // → { ok, message, suggestions, cached, ts }
    FILO_GENERATE_DASHBOARD: 'filo_generate_dashboard',
    // CRUD memoria/contenuti dashboard
    FILO_GET_MEMORY: 'filo_get_memory',
    // Compattazione FORZATA della memoria senza aspettare la soglia: a fine intervista le
    // lezioni devono essere in memoria quando Filo genera la prima home. Solo filo://.
    FILO_COMPACT_MEMORY: 'filo_compact_memory',
    // Stato della micro-intervista di benvenuto (#524). Solo pagine filo://.
    // Risposta: { ok, onboarding: { done, ticked, thread, … }, welcome }
    FILO_GET_ONBOARDING: 'filo_get_onboarding',
    // Rilancia l'intervista da capo (pulsante in Preferenze): azzera spunte, conversazione e il
    // segno «già accolto». La precedente NON si perde, viene archiviata in `past`. Solo filo://.
    FILO_RESTART_ONBOARDING: 'filo_restart_onboarding',
    // Chiude l'intervista SENZA passare dal modello: è la via d'uscita che funziona anche a
    // modello muto (rete assente, provider giù, crediti finiti). Solo filo://.
    FILO_CLOSE_ONBOARDING: 'filo_close_onboarding',
    // L'utente ha letto la riga che la home mostra dopo un'accoglienza chiusa a metà: si spegne.
    // Solo filo://. → { ok, onboarding }
    FILO_ONBOARDING_NOTICE_SEEN: 'filo_onboarding_notice_seen',
    // Gli appunti sono file dell'editor: li scrive l'azione SALVA_APPUNTO, li legge l'editor.
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

    // Primo dispatch (non ancora confermato) di UNA azione, dall'agente «Aiuto»: passa dallo
    // stesso registro dei livelli di sicurezza della chat. { action } → { executed, kept, … }
    FILO_RUN_ACTION: 'filo_run_action',

    // Azione di PAGINA invocata dal menu dentro un riquadro: il main la rilancia nel frame
    // principale. ORIGINE senza gate di proposito: resta nella STESSA scheda, voce già lì.
    RUN_IN_TOP_FRAME: 'run_in_top_frame',

    // La traduzione passa parola ai riquadri incorporati: passa dal main perché è l'unico a
    // conoscere l'albero dei frame — una postMessage la saprebbe scrivere anche il sito.
    TRANSLATE_FRAMES: 'translate_frames',
    // Il riquadro riferisce a chi lo ospita: `ack` che si è fatto vivo, `end` quanto è rimasto
    // in lingua originale. Senza, l'avviso finale non saprebbe se una parte è rimasta fuori.
    FRAME_TRANSLATE_DONE: 'frame_translate_done',

    // Da background -> content (broadcast)
    SETTINGS_UPDATED: 'settings_updated',
    SHORTCUT_TRIGGERED: 'shortcut_triggered',     // { command }
    // Contropartita di RUN_IN_TOP_FRAME: arriva SOLO al frame principale della
    // scheda e gli fa eseguire l'azione di pagina chiesta da un riquadro. { iconId }
    TOP_FRAME_COMMAND: 'top_frame_command',
    // Un altro frame della stessa scheda ha aperto il suo menu: chiudi il tuo. Gli eventi del
    // mouse non attraversano il confine di un iframe, e i due resterebbero aperti insieme.
    CLOSE_OTHER_MENUS: 'close_other_menus',
    // Contropartita di TRANSLATE_FRAMES: arriva a ogni riquadro della scheda e
    // gli fa tradurre (o riportare all'originale) se stesso. { mode, runId }
    FRAME_TRANSLATE: 'frame_translate',
    // Contropartita di FRAME_TRANSLATE_DONE: arriva al SOLO frame principale e
    // gli porta il resoconto di un riquadro. { runId, phase, frames, applied, left }
    FRAME_TRANSLATE_REPORT: 'frame_translate_report',
    // Broadcast da background -> dashboard: lo stato live è cambiato
    // (nuovo timer, notifica, ecc.) e va re-renderizzato.
    FILO_LIVE_UPDATED: 'filo_live_updated',
    // Broadcast: il ricalcolo in background della home è pronto. La scheda aggiorna messaggio e
    // suggerimenti senza rifare la chiamata all'LLM. { message, suggestions, ts }
    FILO_DASHBOARD_UPDATED: 'filo_dashboard_updated',
    // L'intervista è finita e la PRIMA home personale è pronta: la chat lascia il posto alla
    // home, perché l'ultimo atto dell'accoglienza è il risultato, non un «fatto».
    FILO_ONBOARDING_DONE: 'filo_onboarding_done',
    // La conversazione è cambiata: le schede che hanno l'accoglienza a schermo ma non stanno
    // scrivendo si riallineano, così due schede aperte mostrano la stessa conversazione.
    FILO_ONBOARDING_UPDATED: 'filo_onboarding_updated',
    // Broadcast: una lettura è attiva in QUALCHE scheda, oppure no. Ogni scheda usa il flag per
    // mostrare «Interrompi lettura» anche se non è lei a leggere. { active: bool }
    TTS_GLOBAL_READING: 'tts_global_reading',
    // Broadcast da background -> content: ferma la tua lettura locale, se ne hai
    // una. Inviato a tutte le schede quando una di esse chiede lo stop globale.
    TTS_STOP: 'tts_stop',

    // Canale red-team: ponte verso le Cloud Function di filo-security, invocate dal main col
    // Firebase ID token dell'utente. SUBMIT: { attackText, description } → { status, … }
    REDTEAM_SUBMIT: 'redteam_submit',
    // REDTEAM_STATE: stato gamification dell'utente per la tab Statistiche.
    // { } → { signedIn, verified, isOwner, handle?, milestones?, recentAttempts?, … }
    REDTEAM_STATE: 'redteam_state',
    // REDTEAM_ATTEMPT: un tentativo (polling della rivelazione live). { attemptId } →
    // { attempt:{ title, verdicts, score, isValidAttack, status } } | { hidden } | { notFound }
    REDTEAM_ATTEMPT: 'redteam_attempt',
    // REDTEAM_LEADERBOARD: classifica (tutti i loggati). { } →
    //   { entries:[{ handle, leaderboardScore, bestPerJudge, totalAttempts, milestones }] }.
    REDTEAM_LEADERBOARD: 'redteam_leaderboard',
    // REDTEAM_REDEEM: riscatta un codice monouso. { code, handle } → { status:'ok', handle } |
    // { status:'invalid_code'|'code_used'|'invalid_handle'|'handle_taken'|'already_verified' }
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
