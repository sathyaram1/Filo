// Stringhe utente (italiano). Centralizzate per facilitare future traduzioni.

(function (global) {
  'use strict';

  const STRINGS = {
    // Menu — base
    menu_back: 'Indietro',
    menu_forward: 'Avanti',
    menu_reload: 'Ricarica',
    menu_copy: 'Copia',
    menu_paste: 'Incolla',
    menu_cut: 'Taglia',
    menu_select_all: 'Seleziona tutto',

    // Menu — AI
    menu_translate_selection: 'Traduci',
    menu_show_original: 'Mostra originale',
    menu_resume_translation: 'Riprendi traduzione',
    // Traduzione finita, ma il sito ha aggiunto altro testo dopo (scorrimento
    // infinito, schermate che cambiano senza ricaricare).
    menu_translate_new_content: 'Traduci il testo nuovo',
    menu_explain: 'Spiegazione',
    menu_explain_deep: 'Approfondisci',
    menu_paste_history: 'Cronologia incolla',
    menu_paste_search: 'Cerca…',
    menu_paste_no_results: 'Nessun risultato',
    menu_paste_remove: 'Rimuovi dalla cronologia',
    menu_paste_clear: 'Svuota cronologia',
    menu_paste_clear_confirm_one: 'Vuoi svuotare la cronologia degli appunti? Sparisce l\'unica voce copiata finora, e non si può riavere.',
    menu_paste_clear_confirm_n: 'Vuoi svuotare la cronologia degli appunti? Spariscono tutte e %d le voci copiate finora, e non si possono riavere.',
    menu_paste_clear_confirm_hidden: 'La ricerca che hai scritto ne mostra %d: spariscono anche le altre.',
    menu_paste_removed: 'Rimossa',
    menu_explain_loading: 'Spiegazione…',

    // Menu — pagina
    menu_help: 'Aiuto',
    menu_save_for_later: 'Salva per dopo',
    menu_open_for_later: 'Aperti per dopo',
    menu_translate_page: 'Traduci la pagina',
    menu_fullscreen: 'Schermo intero',
    menu_exit_fullscreen: 'Esci da schermo intero',

    // Menu — link / immagine
    menu_open_in_new_tab: 'Apri in nuova tab',
    menu_copy_link: 'Copia URL',
    menu_save_file: 'Salva file',
    menu_save_link_for_later: 'Salva link per dopo',
    menu_copy_image: 'Copia immagine',
    menu_save_image_as: 'Salva immagine come…',
    menu_copy_image_link: 'Copia URL immagine',
    menu_search_image: 'Cerca immagine',
    menu_search_text: 'Cerca',

    // Menu — video / audio
    menu_media_play: 'Riproduci',
    menu_media_pause: 'Pausa',
    menu_media_mute: 'Disattiva audio',
    menu_media_unmute: 'Riattiva audio',
    menu_media_speed: 'Velocità',
    menu_media_speed_pick: 'Scegli la velocità',
    menu_media_speed_normal: 'normale',
    menu_media_loop: 'Ripeti in continuo',
    menu_media_loop_off: 'Non ripetere',
    menu_media_pip: 'Apri in finestra mobile',
    menu_media_pip_exit: 'Chiudi la finestra mobile',
    menu_media_show_controls: 'Mostra i controlli',
    menu_media_hide_controls: 'Nascondi i controlli',
    menu_copy_video_link: 'Copia URL video',
    menu_copy_audio_link: 'Copia URL audio',
    menu_save_video_as: 'Salva video come…',
    menu_save_audio_as: 'Salva audio come…',
    toast_video_saved: 'Video salvato',
    toast_audio_saved: 'Audio salvato',
    toast_video_save_failed: 'Non sono riuscito a salvare il video',
    toast_audio_save_failed: 'Non sono riuscito a salvare l\'audio',
    toast_media_stream_only: 'Questo contenuto arriva in streaming: non c\'è un file da salvare',
    toast_media_speed: 'Velocità %s',
    toast_media_loop_on: 'Si ripeterà in continuo',
    toast_media_loop_off: 'Ripetizione disattivata',
    toast_pip_failed: 'Finestra mobile non disponibile per questo video',
    menu_share_link: 'Condividi link',
    menu_explain_link: 'Spiega link',
    menu_explain_image: 'Spiega immagine',
    menu_edit_selection: 'Modifica',
    menu_read_aloud: 'Leggi',
    menu_stop_reading: 'Interrompi lettura',
    tts_not_supported: 'Lettura ad alta voce non supportata in questo browser',
    tts_model_fallback: 'Voce del modello non disponibile ora: leggo con la voce del browser.',
    tts_model_fallback_nokey: 'La voce naturale non è raggiungibile in questo momento. Per ora leggo con la voce del browser.',
    // %s = il motivo vero (nessun modello impostato per la lettura, o modello
    // inesistente). Dice cosa manca E che intanto la lettura non si ferma.
    tts_model_fallback_reason: '%s Per ora leggo con la voce del browser.',
    // %s = id del modello di lettura. Il modello pretende il nome di una voce
    // e Filo non ha un catalogo per lui: l'unica strada è scriverlo a mano.
    err_tts_voice_required: 'Il modello di lettura «%s» vuole il nome di una voce, e Filo non ne conosce nessuna per questo modello: scrivilo in Preferenze → Lettura ad alta voce.',
    // %s = id del modello, %s = nome scritto a mano che il modello ha rifiutato.
    err_tts_voice_unknown: 'Il modello di lettura «%s» non conosce la voce «%s»: controlla il nome in Preferenze → Lettura ad alta voce.',
    menu_dictate: 'Detta',
    menu_screenshot: 'Screenshot',
    menu_screenshot_crop: 'Screenshot di una parte',
    menu_transcribe: 'Trascrivi',
    region_select_hint: 'Trascina per selezionare una regione · Esc per annullare',
    toast_transcribing: 'Trascrivo il testo…',
    toast_transcribed: 'Testo trascritto e copiato',
    toast_transcribe_empty: 'Nessun testo trovato nella regione',
    toast_region_cancelled: 'Selezione annullata',
    menu_share: 'Condividi',
    menu_overflow: 'Altro…',
    menu_color_picker: 'Color picker',
    menu_close_tab: 'Chiudi pagina',
    menu_open_options: 'Opzioni Filo',
    menu_new_tab: 'Nuova scheda',
    menu_open_home: 'Home',
    menu_open_editor: 'Editor',
    menu_open_feedback: 'Feedback',
    menu_incognito: 'Nuova finestra incognito',
    menu_qr_code: 'QR code della pagina',
    qr_title: 'QR code',
    qr_subtitle: 'Inquadra con il telefono per aprire questa pagina',
    qr_download: 'Scarica PNG',
    qr_copy_link: 'Copia link',
    qr_link_copied: 'Link copiato',
    qr_error: 'Impossibile generare il QR code (link troppo lungo)',
    toast_color_copied: 'Colore copiato: ',
    err_color_picker_unsupported: 'Color picker non supportato in questo browser',
    menu_global_translate: 'Traduci',
    menu_dictate_listening: '🔴 Ti ascolto… clicca per fermare',
    menu_dictate_partial: 'Ti ascolto…',
    menu_dictate_model_select: 'Modello per dettatura',
    menu_dictate_not_supported: 'Dettatura non supportata in questo browser',
    menu_dictate_no_mic: 'Microfono non disponibile o negato',
    menu_dictate_model_set: 'Modello dettatura aggiornato',
    menu_dictate_transcribing: 'Trascrivo l\'audio…',
    menu_dictate_empty: 'Nessun audio comprensibile',
    menu_overflow_soon: 'Pannello completo in arrivo',
    menu_link_loading: 'Analizzo il link…',
    menu_link_suspicious: '⚠️ Link sospetto',

    // Edit box
    edit_box_title: 'Modifica testo',
    edit_box_original: 'Originale',
    edit_box_proposed: 'Proposta',
    edit_box_instruction_placeholder: 'Istruzione (es. "rendi più formale", "tono amichevole"…)',
    edit_box_shortcut_formal: 'Più formale',
    edit_box_shortcut_casual: 'Più informale',
    edit_box_shortcut_summarize: 'Riassumi',
    edit_box_shortcut_translate: 'Traduci in inglese',
    edit_box_shortcut_fix: 'Correggi errori',
    edit_box_replace: 'Sostituisci',
    edit_box_copy_new: 'Copia la nuova',
    edit_box_cancel: 'Annulla',
    edit_box_loading: 'Sto pensando…',
    edit_box_error: 'Errore nella generazione',
    edit_box_replaced: 'Testo sostituito',

    // Coming soon
    coming_soon: 'Prossimamente',
    feature_off_help: 'Attiva "Aiuto" nelle Opzioni → Funzionalità sperimentali',

    // Popup AI
    popup_explain_title: 'Spiegazione',
    popup_explain_deep_title: 'Approfondimento',
    popup_translate_title: 'Traduzione',
    popup_loading: 'Sto pensando…',
    popup_no_explanation: 'Nessuna spiegazione necessaria.',
    popup_close: 'Chiudi',
    popup_model: 'Modello',
    popup_estimated_cost: 'Costo stimato',
    popup_calc_local: 'Calcolatrice locale (nessun costo)',
    popup_calc_result: 'Risultato',
    popup_followup_placeholder: 'Domanda di follow-up… (Invio per inviare, Shift+Invio nuova riga)',
    popup_send: 'Invia',

    // Errori
    err_no_api_key: 'Accedi con un profilo per attivare Filo: è gratis e non serve nessuna chiave. In alternativa, se preferisci, imposta una tua chiave API nelle Opzioni.',
    err_provider_failed: 'Il provider AI ha fallito. Controlla la connessione e la API key.',
    err_limit_reached: 'Limite di spesa mensile raggiunto. Alza il limite nelle opzioni o aspetta il prossimo mese.',
    err_blocked_domain: 'Estensione disabilitata su questo dominio.',
    err_no_selection: 'Nessuna selezione di testo.',
    // Configurazione dei modelli: una funzione senza modello NON parte e lo dice
    // (niente ripieghi silenziosi su modelli scritti nel codice). %s = nome della
    // funzione, poi dove si imposta.
    err_no_model_for_action: 'Nessun modello impostato per «%s»: questa funzione resta ferma finché non ne scegli uno. %s',
    err_unknown_model_for_action: '«%s» usa un modello che non esiste (%s): forse è stato rinominato o eliminato. %s',
    err_open_weights_only_no_model:
      '«%s» è ferma: hai scelto solo modelli a pesi aperti e per questa funzione non ce n\'è uno equivalente (%s). Puoi assegnarle un modello a pesi aperti in Opzioni → Modelli per azione, oppure spegnere «Solo modelli a pesi aperti».',
    err_open_weights_only_provider_blocked:
      'Hai scelto solo modelli a pesi aperti: questo fornitore è l\'API di chi produce i modelli e resta spento. Spegni «Solo modelli a pesi aperti» per provarlo.',
    err_open_weights_only_model_blocked:
      'Hai scelto solo modelli a pesi aperti: «%s» non lo è, quindi la prova non parte. Spegni «Solo modelli a pesi aperti» per provarlo.',
    err_model_where_own: 'Lo imposti in Opzioni → Modelli per azione.',
    err_model_where_default: 'Stai usando i modelli predefiniti: apri Opzioni, togli «Usa modelli predefiniti» e scegli il modello per questa funzione.',

    // Toast
    toast_saved: 'Salvata in: %s',
    toast_saved_open: 'Apri la lista',
    toast_save_failed: 'Salvataggio non riuscito',
    toast_link_saved: 'Link salvato',
    toast_copied: 'Copiato negli appunti',
    // #437 — la sorgente di un'immagine/filmato o l'href di un link possono
    // essere qualsiasi cosa il sito ci abbia messo (un frammento di codice, un
    // data: lunghissimo, niente). Dirlo è meglio che riempire gli appunti con
    // una stringa che altrove non apre nulla.
    toast_not_an_address: 'Questo non è un indirizzo: non c\'è niente da copiare',
    toast_copied_saving: 'Copiato negli appunti, salvataggio in corso…',
    toast_translating_page: 'Traduzione pagina in corso…',
    toast_translating_page_progress: 'Traduzione pagina… %s/%s',
    toast_page_translated: 'Pagina tradotta',
    // Il sito ha continuato ad aggiungere testo anche mentre traducevamo, e a
    // un certo punto smettiamo di rincorrerlo: "Pagina tradotta" sarebbe di
    // nuovo falso, con le righe nuove in inglese sotto gli occhi.
    toast_page_translated_new_arrived: 'Pagina tradotta. Il sito ne ha aggiunta dell\'altra mentre lavoravo: dal tasto destro trovi «Traduci il testo nuovo».',
    // #439 — parti della pagina che NESSUNO script può leggere (i siti moderni
    // possono chiudere a chiave i propri componenti). Non si traducono, e dirlo
    // è l'unica cosa onesta: "Pagina tradotta" sarebbe falso.
    toast_page_translated_partial: 'Pagina tradotta solo in parte: alcuni componenti di questo sito sono chiusi e restano nella lingua originale.',
    toast_only_closed_components: 'Il testo di questa pagina vive dentro componenti chiusi del sito: non riesco a leggerlo, e resta nella lingua originale.',
    // #407 — un riquadro incorporato (post incorporato, blocco commenti, modulo
    // di iscrizione) che nessuno script può toccare: il sito lo chiude a chiave
    // con l'attributo `sandbox`. È un rettangolo intero che resta in inglese in
    // mezzo a una pagina italiana: dirlo è l'unica cosa onesta.
    toast_page_translated_partial_frame: 'Pagina tradotta, tranne un riquadro incorporato. Il sito non lascia leggere il testo lì dentro, e resta nella lingua originale.',
    // Traduzione interrotta a metà (#408): mai "Pagina tradotta" quando non lo
    // è. Dice quanto ne manca, perché si è fermata e come riprendere.
    toast_page_translate_stopped: 'Traduzione interrotta dopo %s blocchi su %s. %s Puoi riprenderla dal tasto destro senza rifare la parte già tradotta.',
    // Pagina più lunga di quanta ne entri in un giro solo: non è un guasto, è
    // un lavoro a tratti. Dire "Pagina tradotta" con la coda ancora in inglese
    // sarebbe la stessa bugia di una traduzione interrotta.
    toast_page_translate_batch: 'Pagina molto lunga: tradotti %s blocchi su %s. Riprendi dal tasto destro per continuare.',
    toast_page_translate_failed: 'Non sono riuscito a tradurre la pagina. %s',
    reason_translate_incomplete: 'Alcuni blocchi sono tornati vuoti dal modello.',
    toast_nothing_to_translate: 'Non ho trovato testo da tradurre in questa pagina',
    toast_original_restored: 'Originale ripristinato',
    // Fermata prima che cambiasse qualcosa sullo schermo: "Originale
    // ripristinato" parlerebbe di un ritorno che non c'è stato.
    toast_translation_cancelled: 'Traduzione annullata',
    toast_clipboard_empty: 'Cronologia appunti vuota',
    toast_open_weights_violated:
      'Hai scelto solo modelli a pesi aperti, ma questa risposta è arrivata da «%s», che è escluso. Segnalalo: la lista di esclusione va aggiornata.',
    toast_pasted_image: 'Immagine incollata',
    toast_image_saved: 'Immagine salvata',
    toast_image_save_failed: 'Non sono riuscito a salvare l\'immagine',
    toast_file_save_failed: 'Non sono riuscito a scaricare il file',
    toast_cannot_paste_image: 'Qui non si può incollare un\'immagine (campo di solo testo)',
    toast_paste_failed: 'Non riesco a incollare qui (rifocalizza il campo e riprova)',
    clipboard_image_pending: 'Descrizione…',
    // Una selezione di soli spazi (o a capo, o tabulazioni) si copia per
    // sbaglio: senza un'etichetta diventa una riga vuota che non si capisce.
    clipboard_only_spaces: 'Spazi vuoti (%d caratteri)',
    clipboard_empty_entry: 'Voce vuota',
    clipboard_image_no_model: 'Immagine (nessun modello per la descrizione)',

    // Categorie default
    category_default: 'Da vedere',

    // Options page
    options_title: 'Filo — Opzioni',
    options_use_default_models: 'Usa modelli predefiniti',
    options_use_default_models_desc:
      'Filo funziona subito con modelli e chiavi predefiniti, senza configurare nulla. Disattiva per usare le tue chiavi e scegliere i tuoi modelli.',
    options_open_weights_only: 'Solo modelli a pesi aperti',
    options_open_weights_only_desc:
      'Spegne tutti i modelli proprietari — Anthropic compresa — e lascia lavorare solo modelli a pesi aperti serviti da fornitori indipendenti. Vale anche con i modelli predefiniti. Le funzioni che partivano da un modello proprietario passano al suo equivalente aperto; quelle senza equivalente si fermano e lo dicono, invece di tornare di nascosto su un modello proprietario.',
    options_open_weights_switched: 'Cambiano modello %s funzioni, che passano a: %s',
    options_open_weights_unavailable: 'Si fermano (nessun equivalente a pesi aperti): %s',
    options_open_weights_test_blocked:
      'Non provabile: «Solo modelli a pesi aperti» è acceso e questo modello non è a pesi aperti (o passa dall\'API di chi lo produce).',
    options_open_weights_catalog_blocked:
      'elenco non chiesto: «Solo modelli a pesi aperti» è acceso e questo è il fornitore diretto di chi produce i modelli.',
    options_keys: 'Chiavi API',
    options_api_key: 'API key',
    options_models: 'Modelli per azione',
    options_chain_primary: 'modello principale',
    options_chain_fallback: 'fallback',
    options_chain_add: 'Aggiungi un modello di fallback',
    options_chain_remove: 'Rimuovi questo modello',
    options_other: 'Altro',
    options_back_to_models: '← Modelli',
    options_more_link: 'Altre opzioni →',
    options_costs: 'Costi e limiti',
    options_shortcuts: 'Scorciatoie da tastiera',
    options_blocklist: 'Domini esclusi',
    options_categories: 'Categorie',
    options_features: 'Funzionalità sperimentali (Fase 2)',
    options_save: 'Salva',
    options_saved: 'Salvato',
    options_theme: 'Tema',
    options_theme_system: 'Sistema',
    options_theme_light: 'Chiaro',
    options_theme_dark: 'Scuro',
    options_monthly_limit: 'Limite mensile (€)',
    options_current_spent: 'Speso questo mese',
    options_action_explain: 'Spiega (inline)',
    options_action_explain_deep: 'Approfondisci',
    options_action_translate_sel: 'Traduci selezione',
    options_action_translate_page: 'Traduci pagina',
    options_action_help: 'Aiuto',
    options_action_categorize: 'Categorizza',
    options_action_describe_image: 'Descrizione immagini (cronologia incolla)',
    options_action_transcribe_image: 'Trascrizione (OCR) di una regione dello schermo',
    options_action_transcribe_audio: 'Dettatura (trascrizione audio dal microfono)',
    options_action_tts: 'Lettura ad alta voce (sintesi vocale)',
    // Categorie dei modelli (etichette nel menu di scelta).
    caps_cat_text: 'Testo',
    caps_cat_multimodal: 'Testo + visione/audio',
    caps_cat_tts: 'Sintesi vocale',
    caps_cat_stt: 'Dettatura (ascolta)',
    caps_cat_image: 'Generazione immagini',
    caps_cat_video: 'Generazione video',
    caps_cat_embedding: 'Embedding',
    // Motivi di blocco quando un modello non è adatto alla funzione.
    caps_block_output_text: 'questa funzione richiede un modello che produca testo',
    caps_block_output_audio: 'questa funzione richiede un modello di sintesi vocale (audio)',
    caps_block_input_image: 'questa funzione richiede un modello che accetti immagini in input',
    caps_block_input_audio: 'questa funzione richiede un modello che accetti audio in input',
    caps_block_output_embedding: 'questa funzione richiede un modello di indicizzazione (produce vettori, non testo)',
    caps_incompatible: 'Modello non adatto: %s',
    options_test_provider: 'Prova',
    options_test_running: 'Test in corso…',
    options_test_result: 'TTFT %s ms · %s tok/s',
    options_test_failed: 'Test fallito: %s',
    options_test_no_key: 'Manca la API key',
    options_h_model_registry: 'Modelli',
    options_model_registry_desc:
      'Ogni modello ha un nickname, un provider e la stringa esatta per chiamarlo su quel provider. Le azioni qui sotto fanno riferimento al nickname. Per avere un fallback su un altro provider crea un secondo modello (es. lo stesso modello su OpenRouter) ed elenca entrambi i nickname nell\'azione, separati da virgola.',
    options_models_desc: 'Per ogni azione, scegli il modello da usare (per nickname). Con «+» puoi aggiungere altri modelli come fallback: il primo segmento è il modello principale, gli altri vengono provati in ordine se quello prima fallisce.',
    options_model_nickname: 'nickname',
    options_model_provider: 'provider',
    options_model_id: 'stringa modello',
    options_model_add: 'Aggiungi modello',
    options_model_remove: 'Rimuovi',
    options_model_test: 'Prova',
    options_model_untested: 'Non ancora testato — premi «Prova».',
    options_model_no_id: 'Inserisci la stringa del modello',
    options_model_nickname_required: 'Il nickname è obbligatorio',
    options_model_nickname_duplicate: 'Nickname duplicato: %s',
    options_model_row_not_saved: 'Salvato — una riga evidenziata sotto non è stata salvata',
    options_action_help_intent_guess: 'Aiuto — sintesi intento (anonimizzazione)',
    options_action_help_intent_judge: 'Aiuto — giudice intento (anonimizzazione)',
    options_action_tab_triage: 'Riordino/archiviazione automatica delle schede',
    options_action_tab_summary: 'Riassunto delle schede archiviate',
    options_action_tab_search: 'Ricerca semantica nell’archivio (re-rank)',
    options_action_filo_dashboard: 'Home — generazione della dashboard',
    options_action_filo_chat: 'Home — chat con Filo',
    options_action_decks_chat: 'Mazzi — chat di ricerca carte',
    options_action_decks_opinion: 'Mazzi — parere su una carta',
    options_action_decks_autotag: 'Mazzi — etichette automatiche',
    options_action_decks_search_filter: 'Mazzi — filtro dei risultati di ricerca',
    options_action_edit_text: 'Riscrittura del testo selezionato',
    options_action_explain_link: 'Spiegazione di un link',
    options_action_filo_lesson: 'Memoria di Filo — cosa ricordare',
    options_action_filo_compact: 'Memoria di Filo — riordino dei ricordi',
    options_action_safebrowse_judge: 'Rilevamento siti pericolosi — giudizio',
    options_action_geoblock_classify: 'Riconoscimento dei blocchi geografici',
    options_action_feedback_title: 'Titolo automatico dei feedback',
    options_action_editor_title: 'Editor — titolo automatico del documento',
    options_action_editor_summary: 'Editor — riassunto automatico del documento',
    options_action_editor_chat: 'Editor — chat col documento',
    options_action_manage_search: 'Gestione — ricerca fra i feedback',
    options_action_archive_embed: 'Indicizzazione delle schede archiviate',
    options_action_provider_test: 'Prova di un fornitore (pulsante «Prova»)',
    // Elenco (di sola lettura) degli altri punti in cui Filo usa un modello:
    // quelli che girano sui server di Filo e quelli che un modello non lo usano.
    options_h_model_usage: 'Dove altro Filo usa un modello',
    options_model_usage_desc:
      'Sopra ci sono le funzioni il cui modello scegli tu. Qui sotto ci sono tutti gli altri punti in cui Filo usa (o non usa) un modello, così l\'elenco è completo e niente resta nascosto.',
    options_model_usage_owner: 'Lo imposta chi gestisce Filo',
    options_model_usage_none: 'Non usa nessun modello',
    // Il campo diventa rosso quando il nickname non esiste; la spiegazione sta
    // nell'hover (aggiungere testo sposterebbe i pulsanti della pillola).
    options_chain_unknown_title: 'Questo modello non è fra quelli configurati qui sopra: la funzione non parte finché non ne scegli uno che esiste.',
    options_open_chrome_shortcuts: 'Modifica le scorciatoie nella pagina Chrome',
    options_feature_help: 'Aiuto (sidebar AI con visione)',
    options_feature_categorize: 'Categorizzazione automatica',
    options_categories_empty: 'Nessuna categoria. Salva qualche pagina con la categorizzazione attiva.',
    options_category_rename: 'Rinomina',
    options_category_delete: 'Elimina',
    options_category_delete_confirm: 'Eliminare la categoria "%s"? Le schede diventeranno non categorizzate.',
    options_category_pages: '%s schede',

    // Pagina admin "Modelli predefiniti" (config condivisa via Firestore)
    admin_defaults_title: 'Modelli predefiniti',
    admin_defaults_intro:
      'Questa configurazione è condivisa con TUTTI gli utenti di Filo: provider, modelli e chiavi predefiniti che vengono usati quando l\'utente lascia attivo "Usa modelli predefiniti". Le modifiche si propagano a tutte le installazioni.',
    admin_defaults_denied: 'Sezione riservata agli amministratori. Accedi con un account autorizzato dall\'icona account in alto.',
    admin_defaults_keys: 'Chiavi API predefinite',
    admin_defaults_keys_desc:
      'Le chiavi restano sul server e non sono mai esposte alle pagine: qui vedi solo se ciascuna è configurata. Lascia un campo vuoto per non modificarlo.',
    admin_defaults_key_present: 'configurata',
    admin_defaults_key_absent: 'non configurata',
    admin_defaults_safebrowse_key_desc:
      'Chiave gratuita di Google Safe Browsing per il rilevamento siti pericolosi: con questa chiave Filo ' +
      'controlla la blacklist ufficiale di Google (phishing e malware) per TUTTI gli account. È condivisa: ' +
      'la imposti una volta qui e vale per tutti. Senza chiave questo controllo viene saltato, gli altri restano attivi.',
    admin_defaults_reasoning: 'reasoning',
    admin_defaults_reasoning_desc:
      'Per ogni modello puoi forzare il livello di ragionamento, quando il modello lo supporta. «Auto» lascia decidere il modello (comportamento di prima); «Nessuno» chiede di non ragionare (risposte più rapide ed economiche); «Basso/Medio/Alto» chiedono uno sforzo di ragionamento crescente. I modelli che non ragionano ignorano l\'impostazione.',
    reasoning_auto: 'Auto',
    reasoning_off: 'Nessuno',
    reasoning_low: 'Basso',
    reasoning_medium: 'Medio',
    reasoning_high: 'Alto',
    // Fornitori esclusi (politica sui modelli, #421 / #518)
    admin_defaults_excluded: 'Fornitori esclusi',
    admin_defaults_excluded_desc:
      'I fornitori che non devono servire nessuna richiesta di Filo: chi produce i modelli (Filo accetta i modelli a pesi aperti solo da fornitori indipendenti) e chi si è dimostrato inaffidabile. Basta il nome base, «Google» copre anche «Google AI Studio» e «Google Vertex». Questa lista vale per tutti gli utenti e sostituisce quella scritta nel codice.',
    admin_defaults_excluded_name: 'Nome del fornitore',
    admin_defaults_excluded_add: 'Aggiungi fornitore',
    admin_defaults_excluded_remove: 'Rimuovi',
    admin_defaults_excluded_drift_title: 'Esclusioni del codice che questa lista non copre',
    admin_defaults_excluded_drift: 'Questa lista sostituisce quella scritta nel codice, e queste esclusioni non ci sono: %s. Finché mancano, quei fornitori possono servire le richieste.',
    admin_defaults_excluded_drift_fix: 'Rimettili nella lista',
    admin_defaults_save: 'Salva e propaga',
    admin_defaults_saving: 'Salvataggio…',
    admin_defaults_saved: 'Salvato e propagato a tutti gli utenti.',
    admin_defaults_save_fail: 'Salvataggio fallito: %s',

    // Sicurezza (pagina dedicata in filo://security/)
    security_title: 'Sicurezza',
    options_h_security: 'Sicurezza',
    options_security_protect_ip: 'Proteggi l\'IP locale (WebRTC)',
    options_security_protect_ip_desc:
      'Impedisce ai siti di leggere via WebRTC l\'IP della tua rete locale (LAN, VPN, schede virtuali). ' +
      'Riduce il fingerprinting pubblicitario e chiude un leak di IP reale quando usi una VPN. ' +
      'Le videochiamate normali (Meet, Zoom, Teams) continuano a funzionare. ' +
      'Effetto collaterale: alcuni servizi P2P che scoprono dispositivi sulla stessa rete locale ' +
      '(es. Snapdrop) potrebbero non vedere gli altri dispositivi.',
    options_security_block_popups: 'Blocca popup non richiesti',
    options_security_block_popups_desc:
      'Blocca le finestre che i siti aprono da soli (i classici popup pubblicitari). ' +
      'I link che apri tu cliccando con il tasto centrale o tenendo Ctrl (Cmd su Mac), o quelli con target="_blank", ' +
      'restano normalmente aperti. Quando un popup viene bloccato, una piccola etichetta nella barra ' +
      'in alto ti permette di aprirlo comunque se era legittimo.',
    options_security_adblock: 'Blocca pubblicità e tracker',
    options_security_adblock_desc:
      'Usa liste di blocco pubbliche e gratuite (StevenBlack, EasyList) per impedire ' +
      'il caricamento di pubblicità e tracker. Le liste si scaricano dalla rete, restano ' +
      'in cache sul tuo computer e si aggiornano da sole una volta a settimana. I siti ' +
      'che usi davvero (Google, YouTube, banche…) non vengono mai bloccati.',
    options_security_siteblock: 'Blocca l’apertura dei siti in blacklist',
    options_security_siteblock_desc:
      'Impedisce di APRIRE i siti in blacklist (non solo le loro pubblicità). Se provi ' +
      'ad aprire un sito bloccato compare una notifica con “Apri comunque”. ' +
      'Eccezioni: se arrivi da un motore di ricerca o lo apre Filo per te, l’apertura ' +
      'è permessa. Puoi aggiungere domini tuoi qui sotto (uno per riga).',
    options_security_siteblock_lists: 'Usa anche le liste pubbliche (pubblicità/tracker) come blacklist',
    options_security_siteblock_blacklist_label: 'Domini in blacklist (uno per riga)',
    options_security_siteblock_blacklist_invalid:
      'Queste righe non sono domini validi e non bloccheranno nulla (usa un dominio ' +
      'con estensione, es. facebook.com — niente IP o nomi senza punto): %s',
    options_security_p2p_box_title: 'Cosa succede ai servizi P2P se attivi la protezione IP',
    options_security_p2p_box_body:
      'Servizi tipo Snapdrop, ToffeeShare, alcuni giochi browser e alcune feature di scoperta dispositivi ' +
      'in rete locale usano l\'IP della tua LAN per trovare altri dispositivi connessi alla stessa rete WiFi. ' +
      'Con la protezione attiva quei servizi continuano a caricarsi ma "non vedono" gli altri dispositivi della tua rete. ' +
      'Le versioni che funzionano via Internet (server intermedio) restano operative. ' +
      'Se ti serve usare uno di questi servizi, disattiva temporaneamente la protezione qui sopra, ' +
      'usa il servizio, poi riattivala.',
    options_security_proxy_box_title: 'Tab aperte da un altro paese',
    options_security_proxy_box_body:
      'Quando apri una scheda "da un altro paese", il traffico di quella scheda passa per i server di un ' +
      'fornitore di rete terzo che ti presta un indirizzo IP locale del paese scelto: è l\'unico modo per ' +
      'farti apparire come se navigassi da lì. Filo non vede e non conserva quel traffico, ma il fornitore ' +
      'tecnicamente sì, come qualsiasi VPN. Vale solo per le schede che apri esplicitamente da un altro paese: ' +
      'tutte le altre restano dirette. Ogni scheda proxata ha un suo spazio cookie separato, così non mescola ' +
      'i tuoi accessi con quelli normali.',
    options_security_proxy_box_provider: 'Fornitore attualmente configurato: %s.',
    options_security_popup_blocked: 'Popup bloccato da %s',
    options_security_popup_open: 'Apri',
    options_security_popup_dismiss: 'Chiudi',
    // Rilevamento siti pericolosi
    options_security_safebrowse: 'Avvisa sui siti pericolosi',
    options_security_safebrowse_desc:
      'Riconosce i siti che fingono di essere un altro marchio (es. una finta pagina di login), ' +
      'i domini appena creati e le connessioni non sicure, e ti avvisa prima che tu inserisca password ' +
      'o dati di pagamento. I controlli di base sono gratuiti e attivi sempre; non bloccano mai la ' +
      'navigazione, ti mostrano solo un avviso che puoi ignorare.',
    options_security_safebrowse_network: 'Controlli di rete (età del dominio e del certificato)',
    options_security_safebrowse_network_desc:
      'Interroga servizi pubblici per sapere da quanto tempo esiste il dominio e il suo certificato: ' +
      'un sito "di un marchio noto" creato pochi giorni fa è un forte segnale di truffa. Non richiede ' +
      'alcuna chiave. Disattivalo se non vuoi che Filo faccia queste richieste esterne.',
    options_security_safebrowse_llm: 'Giudizio AI sui casi sospetti',
    options_security_safebrowse_llm_desc:
      'Solo quando un sito resta dubbio, un modello AI valuta i soli indizi di identità del dominio ' +
      '(mai il contenuto della pagina) per decidere se avvisarti. Usa i modelli e le chiavi che hai già ' +
      'configurato.',
    options_security_safebrowse_sandbox: 'Apri i link sospetti in una finestra isolata',
    options_security_safebrowse_sandbox_desc:
      'Per i link accorciati o con molti redirect, Filo li apre prima in una finestra nascosta e senza ' +
      'i tuoi dati, segue dove portano davvero e blocca i download automatici, così può avvisarti sulla ' +
      'destinazione reale.',
    options_security_safebrowse_key_managed:
      'Il controllo della blacklist ufficiale di Google (phishing e malware) usa una chiave condivisa, ' +
      'gestita centralmente dall\'amministratore in "Modelli predefiniti": è già attiva per tutti gli ' +
      'account, non devi configurare nulla qui.',
    // F4 — Feedback autonomo
    options_security_auto_feedback: 'Segnalazione automatica dei problemi',
    options_security_auto_feedback_desc:
      'Quando Filo non riesce a fare una cosa che gli chiedi, oppure rileva un problema, ' +
      'lo segnala automaticamente a chi sviluppa Filo — senza rivelare URL o testo delle ' +
      'tue conversazioni. La segnalazione è anonima e generica. Attivando questa opzione ' +
      'ricevi 10 crediti extra al giorno.',
    // Gestione cookie / consenso
    options_cookies_title: 'Cookie e banner di consenso',
    options_cookies_desc:
      'Filo può occuparsi dei cookie e dei banner di consenso al posto tuo. Scegli quanto vuoi che sia ' +
      'aggressivo: per quasi tutti va benissimo "Automatico".',
    options_cookies_mode_manual: 'Manuale',
    options_cookies_mode_manual_desc:
      'Filo non tocca nulla: i banner dei cookie compaiono come su qualsiasi browser e decidi tu, banner per banner.',
    options_cookies_mode_default: 'Automatico (consigliato)',
    options_cookies_mode_default_desc:
      'Filo blocca a monte i tracker noti (Google Analytics, reti pubblicitarie, pixel dei social): lo script non ' +
      'si carica nemmeno. Rifiuta da solo i banner cookie che riconosce, dice ai siti che non vuoi essere profilato ' +
      'e carica i video YouTube senza cookie. I cookie utili a te (login, preferenze, le tue scelte sui siti) ' +
      'restano: non perdi quello che hai impostato.',
    options_cookies_mode_privacy: 'Privacy massima',
    options_cookies_mode_privacy_desc:
      'Come l\'Automatico, ma ogni sito vive in uno spazio separato e usa-e-getta: i siti non possono mettersi ' +
      'd\'accordo per riconoscerti e niente sopravvive alla chiusura di Filo, nemmeno i tuoi accessi — tranne i ' +
      '"siti fidati" qui sotto. Massima riservatezza.',
    options_cookies_whitelist_title: 'Siti fidati: resta connesso',
    options_cookies_whitelist_desc:
      'In "Privacy massima" ogni sito è isolato e usa-e-getta. I siti che aggiungi qui fanno eccezione: vivono in ' +
      'uno spazio isolato ma persistente, così resti connesso. Aggiungi il sito (es. gmail.com) e premi Invio.',
    options_cookies_whitelist_placeholder: 'es. gmail.com',
    options_cookies_whitelist_add: 'Aggiungi',
    options_cookies_whitelist_remove: 'Rimuovi',
    options_cookies_whitelist_empty: 'Nessun sito fidato: in "Privacy massima" dovrai rifare il login a ogni avvio.',
    options_cookies_whitelist_invalid: 'Non sembra un dominio valido. Usa un dominio con estensione, es. gmail.com (niente IP o nomi senza punto).',
    options_cookies_whitelist_dup: '"%s" è già nell\'elenco dei siti fidati.',
    options_cookies_trusted_note_other:
      'I siti fidati hanno effetto solo in "Privacy massima". In "Automatico" i tuoi login restano comunque salvati, ' +
      'quindi qui non serve aggiungere nulla.',
    // Protezione anti-fingerprinting
    options_fp_title: 'Protezione fingerprinting',
    options_fp_desc:
      'Anche senza cookie, i siti possono riconoscere il tuo browser combinando segnali tecnici ' +
      '(disegno su canvas, scheda grafica, audio). Filo aggiunge a questi segnali un disturbo minimo, ' +
      'invisibile a te ma diverso per ogni sito, così non possono metterti insieme un\'impronta unica.',
    options_fp_mode_off: 'Off',
    options_fp_mode_off_desc:
      'Nessuna protezione: i siti possono identificare il tuo browser.',
    options_fp_mode_default: 'Automatico (consigliato)',
    options_fp_mode_default_desc:
      'I siti non possono seguirti nel tempo né riconoscerti da un sito all\'altro. Nessun impatto sulla ' +
      'navigazione: banche, Cloudflare e CAPTCHA continuano a funzionare normalmente.',
    options_fp_mode_privacy: 'Privacy massima',
    options_fp_mode_privacy_desc:
      'Come l\'Automatico, ma cambi "impronta" a ogni avvio di Filo: i siti non possono riconoscerti ' +
      'nemmeno fra una sessione e l\'altra. In rari casi qualche CAPTCHA in più.',
    // Cronologia appunti nella pagina Sicurezza (#256). Il menu del tasto destro
    // la mostra solo dentro un campo di testo: chi ha appena copiato una password
    // leggendo un articolo non ha nessun campo da cliccare. Qui è sempre
    // raggiungibile, con le stesse due azioni del menu (togli una voce, svuota).
    security_clipboard_title: 'Cronologia appunti',
    security_clipboard_desc:
      'Quello che hai copiato di recente: Filo lo tiene da parte per riproportelo ' +
      'quando incolli. Se ci è finita una password o un testo privato, toglilo da qui.',
    security_clipboard_empty: 'Non c\'è niente: nessun testo o immagine copiato di recente.',
    security_clipboard_image: 'Immagine',
    security_clipboard_search: 'Cerca fra le voci copiate…',
    security_clipboard_no_results: 'Nessuna voce copiata corrisponde.',
    security_clipboard_remove: 'Rimuovi',
    security_clipboard_remove_title: 'Rimuovi questa voce dalla cronologia',
    security_clipboard_removed: 'Voce rimossa',
    security_clipboard_gone: 'Rimossa',
    security_clipboard_copy_title: 'Rimetti questa voce negli appunti',
    security_clipboard_copied: 'Rimessa negli appunti',
    security_clipboard_pending: 'Hai copiato altre %d cose: allontana il puntatore dalla lista e compaiono.',
    security_clipboard_pending_one: 'Hai copiato un\'altra cosa: allontana il puntatore dalla lista e compare.',
    security_clipboard_cleared: 'Cronologia svuotata',
    security_clipboard_fail: 'Non è riuscito',
    security_export_title: 'Esporta dati Filo',
    security_export_label: 'Esporta dati',
    security_export_desc:
      'Salva tutti i tuoi dati di Filo (memorie degli agenti, pagine salvate, ' +
      'cronologia incolla, costi e impostazioni) in un file .zip che contiene un ' +
      'data.json e le immagini copiate come file separati. Utile come backup o per ' +
      'trasferire i dati su un altro computer.',
    security_export_btn: 'Esporta dati (.zip)',
    security_export_done: 'Dati esportati',
    security_export_fail: 'Esportazione non riuscita',
    security_import_title: 'Importa dati Filo',
    security_import_btn: 'Importa dati (.zip)',
    security_import_desc:
      'Ricarica un .zip esportato da Filo: rimette al loro posto memorie, pagine ' +
      'salvate, cronologia, immagini e impostazioni. Quello che hai già non viene ' +
      'cancellato — le liste si uniscono e, dove c\'è un conflitto, vince il backup.',
    security_import_confirm_title: 'Importa dati da backup',
    // %1 = nome file, %2 = " (del …)" o vuoto, %3/%4 = conteggi già declinati
    security_import_confirm_text:
      'Da "%1"%2: %3 e %4.\n\n' +
      'Nulla di ciò che hai ora viene cancellato: le liste (pagine salvate, ' +
      'cronologia, appunti) si uniscono senza duplicati e le sezioni che qui non ' +
      'esistono vengono aggiunte. Dove lo stesso dato esiste in entrambi, vince ' +
      'quello del backup. Le impostazioni del backup diventano attive subito.',
    security_import_confirm_ok: 'Importa',
    security_import_done: 'Dati importati',
    security_import_invalid: 'Non è un archivio esportato da Filo',
    security_import_fail: 'Importazione non riuscita',

    // Home
    home_title: 'Aperti per dopo',
    home_search_placeholder: 'Cerca per titolo o URL…',
    home_empty: 'Nessuna scheda salvata. Click destro su una pagina → "Salva per dopo".',
    home_no_results: 'Nessun risultato per la ricerca.',
    home_remove: 'Rimuovi',

    // History
    history_title: 'Cronologia AI',
    history_search_placeholder: 'Cerca…',
    history_filter_all: 'Tutte',
    history_clear: 'Cancella tutto',
    history_remove: 'Rimuovi',
    history_remove_title: 'Rimuovi questa voce dalla cronologia',
    // Quanta parte del testo mandato al modello è stata riusata da una richiesta
    // precedente invece che rielaborata da capo (costa meno e risponde prima).
    history_reuse: 'riuso %s%',
    history_reuse_title: '%s token su %s riusati da una richiesta precedente invece di essere rielaborati: costano meno e la risposta arriva prima.',
    history_reuse_none_title: 'Nessuna parte di questa richiesta (%s token) è stata riusata da una richiesta precedente: è stata rielaborata tutta.',
    history_policy_violation: '⚠ fornitore escluso',
    // Tempi del turno (idee «Latenza della chat»): quando è arrivato il primo
    // pezzo di ragionamento, la prima parola, e quando è finito.
    history_timing: 'ragiona %s · scrive %s · fine %s',
    history_timing_title: 'Dalla partenza della richiesta: primo pezzo di ragionamento, prima parola (o prima azione), fine della risposta.',
    history_clear_confirm: 'Cancellare definitivamente tutta la cronologia AI?',
    history_empty: 'Nessuna interazione AI registrata.',
    history_no_results: 'Nessun risultato per la ricerca.',
    history_no_results_filter: 'Nessuna interazione per il filtro selezionato.',

    // Spellcheck
    spell_correct: 'Correggi',
    spell_add_dict: 'Aggiungi al dizionario',
    spell_autocorrect: 'Correggi automaticamente',
    spell_manage: 'Gestisci correttore',
    spell_resolve: 'Risolvi',
    spell_semantic_issue: 'Possibile errore',
    spell_loading: 'Cerco una correzione…',
    spell_no_suggestion: 'Nessuna correzione disponibile.',
    spell_action_semantic_label: 'Correttore contestuale (zigzag blu)',
    spell_action_word_label: 'Suggerimento ortografico (zigzag rosso, on demand)',
    spell_feature_label: 'Correttore AI (zigzag blu per errori contestuali)',

    // Pagina Gestisci correttore
    spell_page_title: 'Filo — Correttore',
    spell_page_heading: 'Correttore',
    spell_page_autocorrect_h: 'Correzioni automatiche',
    spell_page_autocorrect_desc: 'Quando scrivi una di queste parole seguita da uno spazio, viene sostituita con la correzione.',
    spell_page_autocorrect_empty: 'Nessuna correzione automatica.',
    spell_page_dict_h: 'Dizionario personale',
    spell_page_dict_desc: 'Parole aggiunte al dizionario: il correttore non le segnalerà più come errori.',
    spell_page_dict_empty: 'Dizionario vuoto.',
    spell_page_col_word: 'Parola scritta',
    spell_page_col_correction: 'Correzione',
    spell_page_col_actions: '',
    spell_page_add: 'Aggiungi',
    spell_page_remove: 'Rimuovi',
    spell_page_placeholder_word: 'parola sbagliata',
    spell_page_placeholder_correction: 'correzione',
    spell_page_placeholder_dict_word: 'parola',
    spell_page_back: '← Opzioni',
    spell_page_conflict: '"%s" esiste già — modifica annullata.',
    spell_page_empty: 'Un campo vuoto non salva la correzione. Per toglierla usa «Rimuovi».',
    spell_page_dict_conflict: '"%s" è già nel dizionario.',
    toast_added_to_dict: 'Aggiunta al dizionario',
    toast_autocorrect_saved: 'Correzione automatica attiva',
  };

  function t(key, ...args) {
    let s = STRINGS[key];
    if (s === undefined) return key;
    for (const a of args) s = s.replace('%s', String(a));
    return s;
  }

  global.SN_I18N = { t, STRINGS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
