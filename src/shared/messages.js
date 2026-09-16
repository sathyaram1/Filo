// Protocollo messaggi tra content script, background e pagine.

(function (global) {
  'use strict';

  const MSG = {
    // Da content -> background
    AI_REQUEST: 'ai_request',                     // { action, payload }
    AI_REQUEST_STREAM_START: 'ai_request_stream', // streaming via port
    // Sintesi vocale via modello. Torna l'audio grezzo; senza provider/modello TTS torna
    // { ok:false } e il chiamante ripiega sulla voce del browser. { text, lang? } — la lingua
    // sceglie la voce, salvo una voce fissata in Preferenze.
    TTS_SYNTH: 'tts_synth',                        // → { ok, audioBase64, mimeType } | { ok:false, error }
    TTS_VOICES: 'tts_voices',                      // → { ok, model, catalog, required, groups, chosen } (voci del modello di lettura in uso)
    // Stato lettura condiviso fra le schede: chi legge segnala { reading: bool }, il main tiene
    // il conteggio globale e ribroadcast a TUTTE le schede, così anche una scheda diversa
    // mostra «Interrompi lettura».
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
    // Reimportazione del .zip di EXPORT_DATA in due passi: si LEGGE il file (anteprima di
    // quante sezioni e immagini contiene), poi si APPLICA dopo la conferma. Riservati
    // all'origine filo://: una pagina web non deve poter aprire un file dialog né riscrivere
    // lo storage, chiavi API comprese.
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
    // Chat unificata del Builder (§3-§4): NL → query Scryfall o carte cross-mazzo via LLM.
    // { deckId, text, history?, lastResults? } → { ok, reply, cardIds, cards, query, deck? }.
    // `lastResults` sono gli id dell'ultima CardList mostrata («valuta questi risultati», §6.1).
    DECKS_CHAT: 'decks_chat',
    // Parere LLM carta-vs-mazzo (§6). { deckId, cardIds, compute?, refresh? } →
    // { ok, opinions: { cardId → { text, versione, stale } } }.
    // compute=false: solo cache (mai LLM). refresh=true: ricalcola anche i freschi.
    DECKS_OPINION: 'decks_opinion',
    // Import/Export (§11): parser rigido testo↔carte, MAI l'LLM (quello vive nella chat).
    // PREVIEW risolve ogni nome via Scryfall fuzzy PRIMA di applicare — mai un import a scatola
    // chiusa — e APPLY scrive le carte confermate.
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
    // Recap aggiornamento: confronta la versione vista l'ultima volta con quella corrente e
    // torna le note delle versioni saltate. { } → { ok, current, lastSeen, notes:[{version,
    // date, features, fixes}] }. Al primissimo avvio la marca come vista e non torna note:
    // niente popup a sorpresa.
    GET_UPDATE_RECAP: 'get_update_recap',
    // L'utente ha chiuso il recap: salva app.getVersion() come ultima vista.
    MARK_UPDATE_SEEN: 'mark_update_seen',
    // Feedback passati a `done` da quando l'utente non guardava (C5): il main li cerca su
    // Firestore, accredita la ricompensa per priorità (50/100/200/300) UNA volta sola per
    // feedback e torna l'elenco da ringraziare.
    // { } → { ok, rewards:[{num,name,explanation,credits,priority}], totalCredits }
    GET_FEEDBACK_REWARDS: 'get_feedback_rewards',
    // Bacheca utente — voto funziona/non-funziona (DC2). Il main allega il SUO Firebase ID
    // token come Bearer (mai esposto al renderer) e scrive votes.<uid>. Premia +10 crediti UNA
    // SOLA VOLTA per feedback per utente (rewardedVotes in creditStore), anche se l'utente
    // cambia idea o rivota lo stesso valore: niente timeout, niente penalità.
    // { id, vote:'works'|'broken' } → { ok, votes, awarded, credits, balance } | { ok:false, error }
    // `votes` è il map aggiornato, per ridisegnare il conteggio reale.
    BOARD_CAST_VOTE: 'board_cast_vote',
    // Ritiro del voto (cancella votes.<uid>). NON revoca il premio già accreditato — è un
    // ritiro, non una penalità — ma rewardedVotes resta marcato, quindi un voto successivo
    // sullo stesso feedback non ripaga. { id } → { ok, votes } | { ok:false, error }.
    BOARD_CLEAR_VOTE: 'board_clear_vote',
    // Riapertura a pagamento (DC4): l'utente segnala che un fix è ancora rotto. Crea un NUOVO
    // feedback collegato all'originale (`parentId`), che nasce in `new` come ogni feedback
    // utente, e scala CREDIT.BOARD_REOPEN come anti-spam (rifiuta senza scrivere nulla se il
    // saldo non basta: mai saldo negativo). Scrive anche `reopenRequests.<uid>` SULL'ORIGINALE,
    // come segnale per il percorso fidato che deve portarlo fuori da «Risolti»: un utente
    // normale non può scrivere lo `status` di un doc che non ha creato lui, quindi quel passo
    // resta al triage. { id, text } → { ok, feedbackId, balance } | { ok:false, error }.
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
    // Crediti sul server e chiave personale (#598). ORIGINE: tutti i WALLET_* sono riservati
    // alle pagine filo:// e alla shell (leggono saldo e codici, riscattano, fanno emettere una
    // chiave); da una pagina web rispondono { ok:false, error:'forbidden' }.
    // WALLET_STATE: stato del portafoglio dell'INSTALLAZIONE (identità anonima Firebase, non
    // l'account Google): saldo letto dal server, pseudonimo, codici d'invito, se c'è la chiave
    // personale, se l'utente usa una chiave sua. { } → { ok, identity:{ok,error?},
    // hasPersonalKey, pseudonym, usingOwnKey, server:{…}|null, error? }
    WALLET_STATE: 'wallet_state',
    // Riscatta un codice d'invito: il server crea la chiave personale e la consegna UNA volta,
    // il main la salva cifrata. { code } → { ok, status, message, credits?, inviteCodes?, state? }
    WALLET_REDEEM: 'wallet_redeem',
    // Il portafoglio c'è sul server ma la chiave personale non è su questo computer: il server
    // ne emette un'altra (la vecchia si spegne, il saldo resta). { } → { ok, status, message, state? }
    WALLET_REISSUE: 'wallet_reissue',
    // L'identità dell'installazione è stata annullata sul server e il portafoglio non si
    // raggiunge più: si ricomincia con un'identità nuova e un nuovo invito. { } → { ok, state }
    WALLET_RESET_IDENTITY: 'wallet_reset_identity',
    // Riservati all'owner (auth.isAdmin()), col token dell'account Google.
    // WALLET_OWNER_OVERVIEW: { } → { ok, overview } (per utente: pseudonimo,
    //   saldo, consumo per giorno/azione, chi l'ha invitato; totale vs tetto).
    WALLET_OWNER_OVERVIEW: 'wallet_owner_overview',
    // WALLET_OWNER_GRANT: alza il tetto di un utente. { pseudonym, credits, why } → { ok, result }
    WALLET_OWNER_GRANT: 'wallet_owner_grant',
    // WALLET_OWNER_INVITES: genera codici d'invito dell'owner. { count } → { ok, codes }
    WALLET_OWNER_INVITES: 'wallet_owner_invites',
    CAPTURE_VISIBLE_TAB: 'capture_visible_tab',
    // «Salva immagine come…». Instradato dal main perché l'attributo `download` di un <a> è
    // onorato da Chromium SOLO per URL same-origin/blob:/data:: per un'immagine su un altro
    // dominio veniva ignorato e la scheda NAVIGAVA sull'immagine senza scaricare niente (#274).
    // { url } → { ok, path?, filename? } | { ok:false, cancelled?, error? }, a download concluso.
    DOWNLOAD_IMAGE: 'download_image',
    // «Salva video/audio come…». Stesso cammino di DOWNLOAD_IMAGE (download nel main con
    // Referer e cookie della scheda): cambia solo il tipo, che decide nome di ripiego e header
    // Accept. { url, kind:'video'|'audio' } → { ok, path?, filename? } | { ok:false, … }
    DOWNLOAD_MEDIA: 'download_media',
    // «Salva file» su un link (#410.2). NON scarica byte a mano: fa partire il download NATIVO
    // della scheda, così passa per l'intercettazione will-download e ottiene lo STESSO
    // trattamento del clic sul link — barra, cartella Download, avviso, cronologia (parità dei
    // cammini). { url } → { ok } | { ok:false, error }
    DOWNLOAD_LINK: 'download_link',
    // Download «nativi» della navigazione (#410.1): partono cliccando un link a un file, il
    // main ascolta will-download e li mostra nella barra. Diversi da DOWNLOAD_IMAGE/MEDIA, che
    // scaricano byte a mano su richiesta del menu. RISERVATI alle superfici interne (shell e
    // pagine filo://): la cronologia espone i percorsi ASSOLUTI su disco e i comandi possono
    // far APRIRE un file al sistema; da origine http(s) l'handler risponde 'forbidden'.
    // Elenco cronologia (attivi + conclusi, più recenti prima) → { ok, items }
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
    // Broadcast main→superfici: «la cronologia scaricamenti è cambiata». VOLUTAMENTE senza
    // contenuto (niente nomi né percorsi): la pagina filo://downloads lo riceve e rilegge la
    // lista dal canale gated. Il broadcast raggiunge anche le schede di siti esterni, e mandarci
    // i dati esporrebbe i percorsi ASSOLUTI su disco.
    DOWNLOADS_UPDATED: 'downloads_updated',
    // Test provider: misura latenza al primo token e token al secondo
    // su un piccolo prompt fisso. Usato dalla pagina Opzioni.
    TEST_PROVIDER: 'test_provider',                 // { provider, apiKey, model? }
    // Test di un modello del registry PREDEFINITO con le chiavi predefinite. { nickname }
    // risolve nel registry (lista read-only di Opzioni); { provider, model } testa la riga
    // com'è scritta, anche non salvata (editor admin, solo amministratori).
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
    // Lo stato a tutto schermo CHIESTO dalla pagina appena si monta, invece di aspettare solo
    // l'annuncio: una pagina che nasce a modalità già accesa può montarsi dopo l'annuncio e non
    // sentirlo più (#514: il menu offriva «Schermo intero» mentre ci si era già dentro).
    // Aperto anche alle pagine web: dice solo se la finestra che le ospita è a tutto schermo.
    // → { ok, fullscreen: bool }
    FULLSCREEN_STATE: 'fullscreen_state',
    // A tutto schermo l'Esc è arrivato alla pagina e se l'è preso un riquadro di Filo: quel
    // tasto era del riquadro, non della modalità, e il main annulla l'uscita che aveva messo in
    // attesa (#514). Chi non manda niente esce: il silenzio significa «nessuno l'ha usato».
    ESC_CONSUMATO: 'esc_consumato',
    // Il main consegna alla pagina un Esc che il browser le avrebbe mangiato: quando lo schermo
    // pieno è del SITO, il browser usa l'Esc per uscire e il documento non lo vede mai, così
    // ogni riquadro di Filo aperto sopra veniva scavalcato (#514). Il main se lo prende e lo
    // passa di qui: se un riquadro se l'è preso lo dice, altrimenti la pagina chiede l'uscita.
    ESC_INOLTRATO: 'esc_inoltrato',
    // Un riquadro incorporato ha aperto qualcosa di Filo sopra uno schermo pieno, ma l'uscita
    // la può chiedere solo il frame principale: lo dice al main, che gira la richiesta a chi può.
    ESC_CHIEDI_TASTO: 'esc_chiedi_tasto',
    OPEN_NEW_TAB: 'open_new_tab',
    OPEN_INCOGNITO: 'open_incognito',               // apre una nuova finestra incognito
    // L'agente «Aiuto» aziona i comandi rapidi della barra (home, settings, apps, account,
    // fullscreen, minimize; «close» è ESCLUSO di proposito). Il main inoltra alla shell, che
    // clicca il bottone reale e riusa il comportamento esistente. → { ok } | { ok:false }
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

    // Aiuto: «se l'utente rispondesse, da qui partirebbe qualcosa?». Lo chiede il riquadrino
    // «Ha funzionato?» prima di comparire, perché prometteva di condividere anche dove non si
    // raccoglie niente — pagine interne, server di prova, intranet, disco di rete (#584). La
    // risposta la dà la stessa porta che usa la raccolta, così le due non divergono.
    PATH_COLLECTABLE: 'path_collectable',          // { url }

    // Invio feedback → Firestore/Storage. Passa dal main perché le CSP delle pagine ospiti
    // bloccano i fetch diretti dal preload.
    SUBMIT_FEEDBACK: 'submit_feedback',           // { text, url, title, userAgent, clientId, images: [{dataUrl}] }
    // Broadcast main→content per mostrare un toast di sistema (es. esito
    // differito dell'invio di un feedback, #341). Lo mostra solo la scheda in
    // primo piano. { text, duration? }
    SHOW_TOAST: 'show_toast',                      // { text, duration? }
    // F4 — Annulla un auto-feedback appena inviato (undo dal toast). Marca il
    // feedback come `ignored` così non compare nel triage. { id } → { ok }
    CANCEL_AUTO_FEEDBACK: 'cancel_auto_feedback', // { id }
    // Modalità annotazione: il box vive in un content script sulla pagina e da lì non può
    // oscurare la barra in alto (renderizzata dalla shell). Questo messaggio fa da ponte, così
    // TUTTO Filo entra in penombra. → { ok }
    FEEDBACK_ANNOTATE: 'feedback_annotate',       // { on: boolean }
    // Disegno sull'intera app: la barra in alto vive nella shell, non nella pagina, quindi
    // serve una tela anche lì e i due disegni vanno sincronizzati.
    // FEEDBACK_CLEAR_DRAW: «Cancella disegno» cancella anche i tratti sulla barra;
    // FEEDBACK_DRAW_STATE: broadcast { topbar: bool }, così il box sa se c'è un disegno sulla
    // barra (per mostrare «Cancella disegno» e allegare lo scatto anche quando si è disegnato
    // SOLO lì); CAPTURE_FEEDBACK_TOPBAR: scatto annotato della sola barra, da impilare sopra.
    FEEDBACK_CLEAR_DRAW: 'feedback_clear_draw',   // { } → { ok }
    FEEDBACK_DRAW_STATE: 'feedback_draw_state',   // broadcast → { topbar: bool }
    CAPTURE_FEEDBACK_TOPBAR: 'capture_feedback_topbar', // → { ok, dataUrl?, barHeight? }
    // Triage admin di un feedback (cambio stato/note/priorità). Instradato dal
    // main, che allega il Firebase ID token come Bearer e RIFIUTA se l'utente
    // loggato non è admin. → { ok } | { ok:false, error }
    FEEDBACK_UPDATE: 'feedback_update',           // { id, status?, notes?, userNote?, priority?, archiveOverride?, mergePreapproved?: bool }
    // #583 — LETTURA dei feedback per le superfici dell'owner: la collezione non è più
    // pubblica, leggono solo l'admin e il server, e l'ID token vive nel main e non deve arrivare
    // in una pagina — quindi la pagina CHIEDE e il main esegue col token. Solo origini filo://,
    // solo admin. La risposta unisce a ogni feedback voti e riaperture della scheda pubblica.
    // { op:'list', pageSize?, fields?, timeoutMs? } → { ok, rows }
    // { op:'getMany', ids:[…], timeoutMs? } → { ok, rows }
    FEEDBACK_FETCH: 'feedback_fetch',
    // S1.3: decifratura dei campi feedback nel main (la chiave privata NON lo lascia mai).
    // Owner-only. { fields:{text?,url?,name?,title?,notes?,reviewComment?} } → { ok, fields } |
    // { list:[{…}] } → { ok, list } — il batch serve alle dashboard che caricano centinaia di
    // feedback: una sola IPC invece di N.
    FEEDBACK_DECRYPT_FIELDS: 'feedback_decrypt_fields',
    // S1.2: decifratura di UN allegato immagine nel main (la chiave privata non lo lascia).
    // Le immagini sono cifrate come byte opachi su Storage, quindi un <img src=URL> diretto
    // mostra un allegato rotto: il main scarica, decifra, indovina il MIME dai magic byte e
    // torna un data URL. Owner-only. { url } → { ok, dataUrl } | { ok:false, error }
    FEEDBACK_DECRYPT_IMAGE: 'feedback_decrypt_image',
    // Config «modelli predefiniti» condivisa (admin-only, propaga via Firestore). GET non
    // espone le chiavi vere, solo se ci sono; UPDATE scrive provider/models/registry/apiKeys.
    DEFAULTS_GET: 'defaults_get',                  // → { ok, config } | { ok:false, error }
    DEFAULTS_UPDATE: 'defaults_update',            // { config } → { ok, config } | { ok:false, error }
    // Modelli predefiniti EFFETTIVI (registry + modello per funzione), senza chiavi. Leggibile
    // da chiunque: Opzioni deve mostrare i modelli che l'app userà DAVVERO, non quelli scritti
    // nel codice, che la config condivisa può aver cambiato. → { ok, modelRegistry, models }
    DEFAULT_MODELS_PUBLIC: 'default_models_public',
    // Config «modelli di supporto» (config/supportModels, admin-only): un campo per slot
    // (sanitizer, judge1-3, judgeDynamic, judgeRedTeam, judgePriority), valore = stringa catena,
    // più `judgeRegistry` (nickname → modello, dedicato ai giudici). La chiave OpenRouter dei
    // giudici è separata e sta in config/judgeSecrets: GET ne torna solo il booleano
    // `openrouterKeyPresent`, UPDATE la scrive se passata. Letto anche dal backend (DD3).
    SUPPORT_MODELS_GET: 'support_models_get',      // → { ok, models } | { ok:false, error }
    SUPPORT_MODELS_UPDATE: 'support_models_update',// { models, judgeRegistry?, openrouterKey? } → { ok, models } | { ok:false, error }
    // Ri-valutazione owner dei feedback «non filtrati»: la dashboard passa gli id, il backend
    // riesegue SOLO i giudici mancanti e riscrive il pipeline. Owner-only.
    FEEDBACK_REEVALUATE: 'feedback_reevaluate',    // { feedbackIds:[...] } → { ok, reevaluated, results } | { ok:false, error }
    // Impostazioni della tab Automazioni, owner-only. Due interruttori distinti: `enabled`
    // (config/automation) decide chi entra in coda da solo, `routinesEnabled` (config/routines)
    // se le routine autonome lavorano. Insieme viaggiano `autoApprove` e `proberWhenIdle`.
    AUTOMATION_GET: 'automation_get',              // → { ok, enabled, autoApprove, proberWhenIdle, routinesEnabled } | { ok:false, error }
    AUTOMATION_SET: 'automation_set',              // { enabled?, autoApprove?, proberWhenIdle?, routinesEnabled? } → { ok, … } | { ok:false, error }
    // I tre bilanci dei giri di correzione (config/routines: cap2 per i livelli 3 e 2, cap1 per
    // gli 1, cap0 per gli 0 — #561) e il testo della fase 2 (`fixInstructions`, vuoto = quello
    // del server). A bilancio finito un 3/2 ferma la pratica e chiama l'owner, un 1 va nel
    // feedback derivato. Li applica il SERVER quando registra la critica. Owner-only.
    AUTOMATION_CAPS_GET: 'automation_caps_get',    // → { ok, cap2, cap1, cap0, fixInstructions } | { ok:false, error }
    AUTOMATION_CAPS_SET: 'automation_caps_set',    // { cap2?, cap1?, cap0?, fixInstructions? } → { ok, cap2, cap1, cap0, fixInstructions } | { ok:false, error }
    // Log dei worker delle routine (config/automation, campo `workerLog`): ruolo e istante di
    // avvio degli ultimi spawn, scritti da scripts/dispatch.mjs. Owner-only, sola lettura.
    WORKER_LOG_GET: 'worker_log_get',              // → { ok, entries:[{role,startedAt,num}] } | { ok:false, error }
    // Registri del canale autenticato delle routine (ROUTINE-AUTH-SPEC.md): i RIFIUTI (una
    // richiesta fuori dal perimetro del biglietto è il segnale che qualcuno ha manipolato un
    // lavoratore) e i CONFRONTI fra la scelta del cammino su git e quella del server. Vivono in
    // collezioni che nessun client può leggere: si passa dalla callable owner-only.
    ROUTINE_LOG_GET: 'routine_log_get',            // → { ok, rejections:[…], comparisons:[…] } | { ok:false, error }
    // Fusioni bloccate dai controlli di sicurezza, in attesa dell'owner (§10): il server non le
    // respinge e basta, apre una richiesta che l'owner approva DENTRO Filo, dove serve una
    // persona davanti allo schermo. Vivono in collezioni che nessun client può leggere: si passa
    // dalla callable owner-only. ORIGINE: solo pagine filo:// — un sito visitato non deve poter
    // sapere che c'è una fusione in attesa né tentare di approvarla.
    MERGE_APPROVALS_GET: 'merge_approvals_get',        // → { ok, pending:[…], failed:[…], recent:[…], ttlMs } | { ok:false, error }
    MERGE_APPROVAL_APPROVE: 'merge_approval_approve',  // { id } → { ok, result:'merged'|'conflict'|'stale', sha?, headSha?, realigned?:{from,to,mainSha}, newRequest?, newBlocks?, realignReason?, reason? } | { ok:false, error }
    MERGE_APPROVAL_DISCARD: 'merge_approval_discard',  // { id } → { ok, result:'discarded' } | { ok:false, error }
    // L'owner ha letto la bocciatura dell'audit (L4) e va avanti lo stesso. Non è un via libera
    // cieco: il cancello di fusione (L5) resta e parte subito dopo, e l'esito dice se il ramo è
    // entrato in main o se si è aperta una richiesta. Solo pagine filo://, solo il proprietario.
    LIVELLO4_SALTA: 'livello4_salta',  // { feedbackId } → { ok, esito:'fuso'|'bloccato'|'conflitto'|'ramo_assente', requestId? } | { ok:false, error }
    // BROADCAST (main → pagine): l'elenco è cambiato, eccolo. Lo manda il main quando
    // `npm run finish` suona il campanello o quando l'owner rientra nella finestra, perché una
    // pagina di gestione GIÀ APERTA se ne accorga: prima l'elenco si leggeva solo all'apertura e
    // l'avviso non compariva mai sotto gli occhi di chi lo aspettava. Porta il dato con sé (una
    // lettura per tutte le pagine) e va SOLO alle pagine filo://: dentro ci sono nomi di rami e
    // percorsi di file.
    MERGE_APPROVALS_CHANGED: 'merge_approvals_changed', // { pending:[…], failed:[…], recent:[…], ttlMs }
    WEB_SEARCH: 'web_search',                      // { query } → { ok, results: [{title,url,snippet}], provider }

    // Rilevamento siti pericolosi: il content chiede il verdetto per la URL corrente (più gli
    // indizi di pagina: campo password o pagamento) e il main risponde col livello e un
    // messaggio specifico. → { ok, level:'safe'|'sospetto'|'pericoloso', message:{title,body}|null,
    // registrable }
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

    // Geo-block, proposta inline (§5, #151). Broadcast main→content: un contenuto bloccato in
    // Italia su un tab con sessione di login attiva non si riprova in silenzio, si propone —
    // «Lo apro dagli USA? In questa tab non sarai loggato», con i bottoni Apri/No.
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
    // Compattazione FORZATA della memoria: svuota subito il buffer delle lezioni dentro
    // PROFILO/PREFERENZE senza aspettare la soglia. Serve a fine intervista di benvenuto (#524),
    // dove le lezioni appena raccolte devono essere già in memoria quando Filo genera la prima
    // home. Solo pagine filo://. → { ok, compacted }
    FILO_COMPACT_MEMORY: 'filo_compact_memory',
    // Stato della micro-intervista di benvenuto (#524). Solo pagine filo://.
    // Risposta: { ok, onboarding: { done, ticked, thread, … }, welcome }
    FILO_GET_ONBOARDING: 'filo_get_onboarding',
    // Rilancia l'intervista da capo (pulsante in Preferenze): azzera spunte, conversazione e il
    // segno «già accolto». La precedente NON si perde, viene archiviata in `past`. Solo filo://.
    FILO_RESTART_ONBOARDING: 'filo_restart_onboarding',
    // Chiude l'intervista SENZA passare dal modello: è «Salta l'accoglienza», la via d'uscita
    // che funziona anche a modello muto (rete assente, provider giù, crediti finiti).
    // Solo pagine filo://. → { ok, onboarding }
    FILO_CLOSE_ONBOARDING: 'filo_close_onboarding',
    // L'utente ha letto la riga che la home mostra dopo un'accoglienza chiusa a
    // metà («la rifacciamo quando vuoi»): si spegne. Solo pagine filo://.
    // Risposta: { ok, onboarding }
    FILO_ONBOARDING_NOTICE_SEEN: 'filo_onboarding_notice_seen',
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

    // Primo dispatch (non ancora confermato) di UNA azione, usato dall'agente «Aiuto» per
    // attivare le azioni tipizzate passando dallo stesso registro dei livelli di sicurezza della
    // chat. → { executed, kept, needsConfirm, describe }: se needsConfirm il client mostra il
    // popup e rimanda l'azione via FILO_CONFIRM_ACTION. { action }
    FILO_RUN_ACTION: 'filo_run_action',

    // #405 — un'azione di PAGINA invocata dal menu aperto dentro un riquadro incorporato. Il
    // riquadro conosce solo se stesso, ma tradurre, condividere, salvare o fotografare devono
    // valere per la pagina intera: il suo content script chiede al main di rilanciare il comando
    // nel frame principale. { iconId } oppure { surface }.
    // ORIGINE: chiamabile anche da una pagina web, di proposito e senza gate — non legge dati,
    // non tocca il disco, non aziona il sistema: inoltra a un frame DELLA STESSA SCHEDA una voce
    // di menu già raggiungibile, e porta solo un id del registro icone o il nome di un pannello.
    RUN_IN_TOP_FRAME: 'run_in_top_frame',

    // #407 — la traduzione passa parola ai riquadri incorporati: sono pagine dentro la pagina e
    // il frame principale non può toccarne il testo, ma il content script di Filo gira anche lì.
    // Il giro passa dal main perché è l'unico a conoscere l'albero dei frame: una postMessage la
    // saprebbe scrivere anche il sito, e comanderebbe la traduzione dentro un riquadro altrui.
    // { mode:'translate'|'restore', runId } — lo manda il SOLO frame principale.
    // ORIGINE: come RUN_IN_TOP_FRAME, chiamabile da una pagina web senza gate: inoltra ai frame
    // della stessa scheda e non porta dati arbitrari.
    TRANSLATE_FRAMES: 'translate_frames',
    // Il riquadro riferisce a chi lo ospita: prima che si è fatto vivo (`ack`, con quanti
    // riquadri ospita a sua volta), poi com'è finita (`end`, con quanto è rimasto in lingua
    // originale). Senza, l'avviso finale non saprebbe se dire «Pagina tradotta» o «una parte è
    // rimasta fuori». { runId, phase, frames, applied, left }
    FRAME_TRANSLATE_DONE: 'frame_translate_done',

    // Da background -> content (broadcast)
    SETTINGS_UPDATED: 'settings_updated',
    SHORTCUT_TRIGGERED: 'shortcut_triggered',     // { command }
    // Contropartita di RUN_IN_TOP_FRAME: arriva SOLO al frame principale della
    // scheda e gli fa eseguire l'azione di pagina chiesta da un riquadro. { iconId }
    TOP_FRAME_COMMAND: 'top_frame_command',
    // #405 — un altro frame della stessa scheda ha aperto il suo menu: chiudi il tuo. Gli
    // eventi del mouse non attraversano il confine di un iframe, quindi senza questo due menu
    // resterebbero aperti insieme.
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
    // Broadcast background→dashboard (#155): il ricalcolo in background della home è pronto.
    // La scheda aggiorna messaggio e suggerimenti senza rifare la chiamata all'LLM.
    // { message, suggestions, ts }
    FILO_DASHBOARD_UPDATED: 'filo_dashboard_updated',
    // Broadcast background→dashboard (#524): l'intervista è finita, le lezioni sono compattate
    // e la PRIMA home personale è pronta. La chat lascia il posto alla home: l'ultimo atto
    // dell'accoglienza è il risultato, non un «fatto». { message, suggestions, ts }
    FILO_ONBOARDING_DONE: 'filo_onboarding_done',
    // Broadcast background→dashboard (#524): la conversazione è cambiata (un turno, una
    // spunta). Le schede che hanno l'accoglienza a schermo ma non stanno scrivendo si
    // riallineano: due schede aperte insieme mostrano la stessa conversazione. { onboarding }
    FILO_ONBOARDING_UPDATED: 'filo_onboarding_updated',
    // Broadcast background→content: una lettura è attiva in QUALCHE scheda, oppure no. Ogni
    // scheda usa il flag per mostrare «Interrompi lettura» anche se non è lei a leggere.
    // { active: bool }
    TTS_GLOBAL_READING: 'tts_global_reading',
    // Broadcast da background -> content: ferma la tua lettura locale, se ne hai
    // una. Inviato a tutte le schede quando una di esse chiede lo stop globale.
    TTS_STOP: 'tts_stop',

    // Canale red-team (filo-redteam-ux-spec): ponte verso le Cloud Function di filo-security,
    // invocate dal main col Firebase ID token dell'utente loggato.
    // REDTEAM_SUBMIT: { attackText, description } → { status:'ok', attemptId, balance, cost } |
    // { status:'dormant' } | { status:'insufficient_credits', have, needed } | { status:'empty' }.
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
