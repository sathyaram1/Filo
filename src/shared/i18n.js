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
    menu_show_original: 'Mostra originale',
    menu_resume_translation: 'Riprendi traduzione',
    // Traduzione finita, ma il sito ha aggiunto altro testo dopo (scorrimento
    // infinito, schermate che cambiano senza ricaricare).
    menu_translate_new_content: 'Traduci il testo nuovo',
    // #711 — l'hover della riga di origine: dice il CONFINE della lettura, cioè
    // perché l'assenza di quella riga non vuol dire niente.
    menu_origin_hint: 'Filo legge solo le etichette che il file si porta dietro. Uno screenshot le cancella, un social pure, e molti generatori non le scrivono affatto.',
    menu_image_unreadable: 'Filo non è riuscito a scaricare questa immagine.',
    menu_origin_hint_unverified: 'Filo non ha ancora scaricato l’elenco ufficiale dei firmatari riconosciuti, quindi per ora sa solo che la firma è valida. Appena lo scarica, lo verifica.',
    // #946.1 — chi ha firmato sta solo nell'elenco provvisorio, che vale per le firme di prima del suo congelamento.
    menu_origin_hint_interim: 'Prima dell’elenco ufficiale il C2PA usava un elenco provvisorio, poi congelato. Filo lo usa solo per le firme fatte prima del congelamento.',
    // #889 — la riga viene da un marchio nei pixel, non da un'etichetta del file.
    menu_origin_hint_mark: 'Il programma che ha generato l’immagine ha scritto questo marchio nei pixel. Un ritaglio o un ridimensionamento lo cancellano, e molti generatori non lo mettono.',
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
    // #589.11 — il clic su una voce che il sito copriva non parte.
    menu_click_covered: 'Il menu era coperto: clic ignorato',
    menu_explain_loading: 'Spiegazione…',

    // Menu — pagina
    menu_help: 'Aiuto',
    menu_save_for_later: 'Salva per dopo',
    menu_open_for_later: 'Aperti per dopo',
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
    menu_redeem_invite: 'Riscatta l’invito',
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
    // %s = id del modello, %s = chi lo serve («OpenAI», «OpenAI e Azure»).
    // Voce e dettatura: nessun host ammesso, la richiesta non parte (#713).
    err_audio_no_allowed_host: 'Il modello «%s» lo serve solo %s, che Filo esclude. Non ho mandato niente: scegli un altro modello.',
    err_audio_no_allowed_host_many: 'Il modello «%s» lo servono solo %s, che Filo esclude. Non ho mandato niente: scegli un altro modello.',
    // Host misti o ignoti (#1141): sugli endpoint audio il router sceglie per prezzo, anche l'host escluso.
    err_audio_mixed_host: 'Il modello «%s» lo serve anche %s, che Filo esclude, e con l\'audio non posso impedire che tocchi a lui. Non ho mandato niente: scegli un altro modello.',
    err_audio_mixed_host_many: 'Il modello «%s» lo servono anche %s, che Filo esclude, e con l\'audio non posso impedire che tocchi a loro. Non ho mandato niente: scegli un altro modello.',
    err_audio_hosts_unknown: 'Non so chi serve il modello «%s»: potrebbe essere un fornitore che Filo esclude. Non ho mandato niente: riprova fra poco o scegli un altro modello.',
    // Lo stesso verdetto mentre si sceglie il modello (Opzioni, «Detta» dal tasto destro). %s = modello, funzione, host.
    audio_host_fn_tts: 'la lettura ad alta voce',
    audio_host_fn_stt: 'la dettatura',
    audio_host_warn_crediti: 'Con «%s» %s non parte coi crediti di Filo: per usarlo metti una tua chiave OpenRouter nella pagina Crediti.',
    audio_host_warn_excluded: 'Con «%s» %s non parte: lo serve solo %s, che Filo esclude.',
    audio_host_warn_excluded_many: 'Con «%s» %s non parte: lo servono solo %s, che Filo esclude.',
    audio_host_warn_mixed: 'Con «%s» %s non parte: lo serve anche %s, che Filo esclude.',
    audio_host_warn_mixed_many: 'Con «%s» %s non parte: lo servono anche %s, che Filo esclude.',
    // Coi crediti di Filo l'audio parte solo se tutti gli host dichiarano la ritenzione zero (#831).
    err_audio_zdr_host: 'Il modello «%s» lo serve solo %s, che non si impegna a non conservare quello che gli mandi, e coi crediti di Filo è una condizione. Non ho mandato niente: scegli un altro modello.',
    err_audio_zdr_host_many: 'Il modello «%s» lo servono solo %s, che non si impegnano a non conservare quello che gli mandi, e coi crediti di Filo è una condizione. Non ho mandato niente: scegli un altro modello.',
    err_audio_zdr_mixed: 'Il modello «%s» lo serve anche %s, che non si impegna a non conservare quello che gli mandi, e con l\'audio non posso impedire che tocchi a lui. Coi crediti di Filo è una condizione: non ho mandato niente, scegli un altro modello.',
    err_audio_zdr_mixed_many: 'Il modello «%s» lo servono anche %s, che non si impegnano a non conservare quello che gli mandi, e con l\'audio non posso impedire che tocchi a loro. Coi crediti di Filo è una condizione: non ho mandato niente, scegli un altro modello.',
    err_audio_zdr_unknown: 'Non so quali fornitori del modello «%s» si impegnano a non conservare quello che gli mandi, e coi crediti di Filo è una condizione. Non ho mandato niente: riprova fra poco o scegli un altro modello.',
    audio_host_warn_zdr: 'Con «%s» %s non parte coi crediti di Filo: lo serve solo %s, che non si impegna a non conservare i dati.',
    audio_host_warn_zdr_many: 'Con «%s» %s non parte coi crediti di Filo: lo servono solo %s, che non si impegnano a non conservare i dati.',
    audio_host_warn_zdrmixed: 'Con «%s» %s non parte coi crediti di Filo: lo serve anche %s, che non si impegna a non conservare i dati.',
    audio_host_warn_zdrmixed_many: 'Con «%s» %s non parte coi crediti di Filo: lo servono anche %s, che non si impegnano a non conservare i dati.',
    audio_host_warn_zdrunknown: 'Con «%s» %s non parte coi crediti di Filo finché non so quali fornitori non conservano i dati, e ora non riesco a saperlo.',
    audio_host_warn_unknown:'Con «%s» %s non parte finché non so chi lo serve, e ora non riesco a saperlo.',
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
    menu_dictate_model_set: 'Modello dettatura aggiornato',
    menu_dictate_transcribing: 'Trascrivo l\'audio…',

    // Il microfono (src/shared/ascolto.js) e il suo tasto nelle chat (voceChat.js). Ogni guasto dice cosa fare.
    voce_parla: 'Parla',
    voce_ferma: 'Ferma',
    voce_trascrivo: 'Trascrivo…',
    voce_annulla_invio: 'Annulla l\'invio',
    voce_invia_da_solo: 'Invia da solo',
    voce_lascia_testo: 'Lascia il testo da correggere',
    voce_err_mic_negato: 'Filo non ha il permesso di usare il microfono: consentilo %s, poi riprova.',
    voce_dove_mac: 'in Impostazioni di Sistema → Privacy e sicurezza → Microfono',
    voce_dove_windows: 'in Impostazioni → Privacy e sicurezza → Microfono',
    voce_dove_linux: 'nelle impostazioni audio del sistema',
    voce_err_mic_assente: 'Non trovo un microfono: collegane uno e riprova.',
    voce_err_mic_occupato: 'Il microfono non risponde: forse lo sta usando un\'altra app. Chiudila e riprova.',
    voce_err_trascrizione: 'Non sono riuscito a trascrivere quello che hai detto: %s',
    voce_riprova: 'riprova tra poco.',
    voce_vuoto: 'Non ho capito quello che hai detto: riprova parlando un po\' più vicino al microfono.',
    voce_err_muto: 'Non ho sentito niente: premi il microfono e parla, o controlla che sia acceso quello giusto.',
    menu_overflow_soon: 'Pannello completo in arrivo',
    menu_link_loading: 'Analizzo il link…',
    // #1307 — al posto della spiegazione, per un sito che Filo non contatta.
    menu_link_blocked: 'Porta a %s, che è nella tua lista dei siti bloccati. Filo non l’ha contattato.',
    menu_link_blocked_lists: 'Porta a %s, uno dei siti di pubblicità e tracciamento che Filo blocca. Filo non l’ha contattato.',

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
    edit_box_replaced: 'Testo sostituito',

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
    popup_followup_placeholder: 'Chiedi altro…',
    popup_send: 'Invia',
    popup_copy: 'Copia',
    popup_copied: 'Copiato',
    popup_copy_failed: 'Non copiato',

    // Errori
    err_no_api_key: 'Per attivare Filo serve un codice d\'invito: riscattalo nella pagina Crediti. In alternativa, lì puoi mettere una tua chiave OpenRouter.',
    err_provider_failed: 'Il provider AI ha fallito. Controlla la connessione e la API key.',
    err_limit_reached: 'Limite di spesa mensile raggiunto. Alza il limite nelle opzioni o aspetta il prossimo mese.',
    err_blocked_domain: 'Filo è spento su questo sito.',
    err_no_selection: 'Nessuna selezione di testo.',
    err_secret_selection: 'Filo non manda al modello password e dati della carta.',
    help_disabled: 'L\'Aiuto è spento. Lo riaccendi in Preferenze, o chiedendolo a Filo.',
    // L'icona Aiuto della barra laterale (#1432): la risposta da leggere, e perché è spenta.
    aiuto_leggi_risposta: 'Leggi la risposta',
    aiuto_spento_barra: 'Aiuto spento in Preferenze',
    aiuto_spento_sito: 'Filo è spento su questo sito',
    aiuto_spento_pagina: 'Qui l\'Aiuto non c\'è',
    // Configurazione dei modelli: una funzione senza modello NON parte e lo dice
    // (niente ripieghi silenziosi su modelli scritti nel codice). %s = nome della
    // funzione, poi dove si imposta.
    err_no_model_for_action: 'Nessun modello impostato per «%s»: questa funzione resta ferma finché non ne scegli uno. %s',
    err_unknown_model_for_action: '«%s» usa un modello che non esiste (%s): forse è stato rinominato o eliminato. %s',
    err_open_weights_only_no_model:
      '«%s» è ferma: hai scelto solo modelli a pesi aperti e per questa funzione non ce n\'è uno equivalente (%s). Puoi assegnarle un modello a pesi aperti in Opzioni → Modelli per azione, oppure spegnere «Solo modelli a pesi aperti».',
    // Le funzioni di chi gestisce Filo non stanno nelle Opzioni: il modello si cambia in Gestione (#1118).
    err_open_weights_only_no_model_owner:
      '«%s» è ferma: hai scelto solo modelli a pesi aperti e per questa funzione non ce n\'è uno equivalente (%s). Puoi assegnarle un modello a pesi aperti in Gestione → Automazioni, fra i Modelli di supporto, oppure spegnere «Solo modelli a pesi aperti».',
    err_open_weights_only_provider_blocked:
      'Hai scelto solo modelli a pesi aperti: questo fornitore è l\'API di chi produce i modelli e resta spento. Spegni «Solo modelli a pesi aperti» per provarlo.',
    err_open_weights_only_model_blocked:
      'Hai scelto solo modelli a pesi aperti: «%s» non lo è, quindi la prova non parte. Spegni «Solo modelli a pesi aperti» per provarlo.',
    err_model_where_own: 'Lo imposti in Opzioni → Modelli per azione.',
    err_model_where_default: 'Stai usando i modelli predefiniti: apri Opzioni, togli «Usa modelli predefiniti» e scegli il modello per questa funzione.',
    err_model_where_owner: 'Lo imposti in Gestione → Automazioni, fra i Modelli di supporto.',

    toast_saved: 'Salvata in: %s',
    toast_saved_open: 'Apri la lista',
    toast_save_failed: 'Salvataggio non riuscito',
    toast_link_saved: 'Link salvato',
    toast_copied: 'Copiato negli appunti',
    // #437 — src di un'immagine o href di un link possono essere qualsiasi cosa: dirlo è meglio
    // che riempire gli appunti con una stringa che altrove non apre niente.
    toast_not_an_address: 'Questo non è un indirizzo: non c\'è niente da copiare',
    toast_copied_saving: 'Copiato negli appunti, salvataggio in corso…',
    toast_translating_page: 'Traduzione pagina in corso…',
    toast_translating_page_progress: 'Traduzione pagina… %s/%s',
    toast_page_translated: 'Pagina tradotta',
    // Il sito aggiunge testo mentre traduciamo, e a un certo punto si smette di rincorrerlo.
    // Qui sotto si dice sempre cosa è rimasto in inglese: «Pagina tradotta» sarebbe falso.
    toast_page_translated_new_arrived: 'Pagina tradotta. Il sito ne ha aggiunta dell\'altra mentre lavoravo: dal tasto destro trovi «Traduci il testo nuovo».',
    // #439 — parti della pagina che nessuno script può leggere (componenti chiusi a chiave).
    toast_page_translated_partial: 'Pagina tradotta solo in parte: alcuni componenti di questo sito sono chiusi e restano nella lingua originale.',
    toast_only_closed_components: 'Il testo di questa pagina vive dentro componenti chiusi del sito: non riesco a leggerlo, e resta nella lingua originale.',
    // #407 — un riquadro incorporato che il sito chiude con `sandbox`: un rettangolo intero
    // che resta in inglese in mezzo a una pagina italiana.
    toast_page_translated_partial_frame: 'Pagina tradotta, tranne un riquadro incorporato. Il sito non lascia leggere il testo lì dentro, e resta nella lingua originale.',
    // Traduzione interrotta a metà (#408): quanto manca, perché si è fermata, come riprendere.
    toast_page_translate_stopped: 'Traduzione interrotta dopo %s blocchi su %s. %s Puoi riprenderla dal tasto destro senza rifare la parte già tradotta.',
    // Più lunga di quanta ne entri in un giro solo: non è un guasto, è un lavoro a tratti.
    toast_page_translate_batch: 'Pagina molto lunga: tradotti %s blocchi su %s. Riprendi dal tasto destro per continuare.',
    toast_page_translate_failed: 'Non sono riuscito a tradurre la pagina. %s',
    reason_translate_incomplete: 'Alcuni blocchi sono tornati vuoti dal modello.',
    toast_nothing_to_translate: 'Non ho trovato testo da tradurre in questa pagina',
    toast_original_restored: 'Originale ripristinato',
    // Fermata prima che cambiasse qualcosa sullo schermo: «Originale ripristinato» parlerebbe
    // di un ritorno che non c'è stato.
    toast_translation_cancelled: 'Traduzione annullata',
    toast_clipboard_empty: 'Cronologia appunti vuota',
    toast_open_weights_violated:
      'Hai scelto solo modelli a pesi aperti, ma questa risposta è arrivata da «%s», che Filo esclude. Segnalalo, così lo teniamo fuori.',
    toast_served_excluded:
      'Questa risposta è arrivata da «%s», un fornitore che Filo esclude. Segnalalo, così lo teniamo fuori.',
    toast_served_not_producer:
      'Questa risposta è arrivata da «%s», ma Filo questo modello lo prende solo da %s. Segnalalo, così lo teniamo fuori.',
    toast_segnala: 'Segnala',
    // La segnalazione già scritta che il tasto «Segnala» dell'avviso apre in «Invia feedback»: funzione, modello, host.
    segnala_fuori_politica: 'Una risposta di «%s» col modello %s è arrivata da «%s», che Filo non ammette per questa richiesta.',
    // Il tetto per scheda sulle chiamate automatiche (#1070): il numero è quello del tetto.
    toast_tetto_spiegazioni:
      'Da questa pagina sono partite più di %s spiegazioni automatiche in un minuto. Le fermo per un minuto, col tasto destro funzionano sempre.',
    toast_tetto_correttore:
      'Da questa pagina sono partiti più di %s controlli del correttore in un minuto. Li fermo per un minuto, col tasto destro le correzioni funzionano sempre.',
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
    clipboard_image_delicata: 'Immagine da una pagina delicata',
    clipboard_image_senza_descrizione: 'Immagine',
    clipboard_image_non_descritta: 'Immagine (descrizione non arrivata)',

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
    options_own_key_all_providers: 'Con la mia chiave, usa anche i fornitori esclusi',
    options_own_key_all_providers_desc:
      'Le richieste pagate con la tua chiave OpenRouter possono andare anche ai fornitori che Filo esclude, come Google o xAI. Così funzionano anche Gemini e Grok. Se OpenRouter rifiuta la tua chiave e Filo passa ai suoi crediti, l\'esclusione torna a valere.',
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
    options_blocklist: 'Siti dove Filo è spento',
    options_blocklist_desc: 'Lì Filo non mette il suo menu del tasto destro, il correttore né le sue azioni sulla pagina. Un sito per riga.',
    options_blocklist_invalid: 'Queste righe non sono siti e non spengono Filo da nessuna parte (scrivi il sito con la sua estensione, es. docs.google.com): %s',
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
    options_cost_warn_ratio: 'Avviso sui modelli costosi: oltre quante volte il costo del predefinito (0 = mai)',
    options_action_explain: 'Spiega (inline)',
    options_action_explain_deep: 'Approfondisci',
    options_action_translate_sel: 'Traduci selezione',
    options_action_translate_page: 'Traduci pagina',
    options_action_help: 'Aiuto',
    options_action_categorize: 'Categorizza',
    options_action_describe_image: 'Descrizione immagini (cronologia incolla, finestre guardate dalla chat)',
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
    options_action_filo_chat_triage: 'Home — titolo e tipo di una chat finita',
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
    options_action_archive_embed: 'Indicizzazione delle schede archiviate',
    options_action_provider_test: 'Prova di un fornitore (pulsante «Prova»)',
    options_action_file_name: 'Nome sensato ai file (legge l\'inizio del file o una miniatura)',
    options_action_embed_cookie_check: 'Contenuti incorporati rotti dai cookie (guarda il riquadro)',
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
    options_category_name_taken: 'C\'è già «%s»: Rinomina le unisce',

    // Gestione → Impostazioni predefinite → "Modelli predefiniti" (config condivisa via Firestore)
    admin_defaults_intro:
      'Questa configurazione è condivisa con TUTTI gli utenti di Filo: provider, modelli e chiavi predefiniti che vengono usati quando l\'utente lascia attivo "Usa modelli predefiniti". Provider e modelli arrivano subito a tutte le installazioni. Le chiavi no. Nessuna installazione le legge da qui: le incastona la prossima versione pubblicata, e l\'aggiornamento le consegna.',
    admin_defaults_denied: 'Sezione riservata agli amministratori. Accedi con un account autorizzato dall\'icona account in alto.',
    admin_defaults_keys: 'Chiavi API predefinite',
    admin_defaults_keys_desc:
      'Le chiavi restano sul server e non sono mai esposte alle pagine: qui vedi solo se ciascuna è configurata. Lascia un campo vuoto per non modificarlo. Una chiave nuova entra in funzione con la prossima versione pubblicata. Questo elenco lo leggi solo tu; alle installazioni le chiavi arrivano dentro l\'aggiornamento.',
    admin_defaults_key_present: 'configurata',
    admin_defaults_key_absent: 'non configurata',
    admin_defaults_safebrowse_key_desc:
      'Chiave gratuita di Google Safe Browsing per il rilevamento siti pericolosi: con questa chiave Filo ' +
      'controlla la blacklist ufficiale di Google (phishing e malware) per TUTTI, anche per chi non ha fatto l\'accesso. ' +
      'È condivisa: la imposti una volta qui e viaggia con la prossima versione pubblicata. ' +
      'Senza chiave questo controllo viene saltato, gli altri restano attivi.',
    admin_defaults_reasoning: 'reasoning',
    admin_defaults_reasoning_desc:
      'Per ogni modello puoi forzare il livello di ragionamento, quando il modello lo supporta. «Auto» lascia decidere il modello (comportamento di prima); «Nessuno» chiede di non ragionare (risposte più rapide ed economiche); «Basso/Medio/Alto» chiedono uno sforzo di ragionamento crescente. I modelli che non ragionano ignorano l\'impostazione.',
    reasoning_auto: 'Auto',
    reasoning_off: 'Nessuno',
    reasoning_low: 'Basso',
    reasoning_medium: 'Medio',
    reasoning_high: 'Alto',
    admin_defaults_sort: 'host',
    admin_defaults_sort_desc:
      'Come OpenRouter sceglie l\'host di questo modello. «Automatico» segue la scelta generale qui sotto. I fornitori esclusi restano esclusi.',
    admin_defaults_sort_general: 'Scelta generale degli host',
    admin_defaults_sort_general_desc:
      'Vale per i modelli lasciati su «Automatico». Di serie Filo non chiede nessun ordine e l\'host lo sceglie OpenRouter.',
    provider_sort_general_auto: 'Lo sceglie OpenRouter',
    options_host_order: 'Host dei modelli',
    options_host_order_desc:
      'Lo stesso modello lo servono più host: i più veloci rispondono prima, i più economici costano meno. Vale per tutti i modelli, anche per quelli predefiniti. I fornitori esclusi restano esclusi.',
    options_host_order_filo: 'Li sceglie Filo',
    provider_sort_auto: 'Automatico',
    provider_sort_throughput: 'Più veloce',
    provider_sort_latency: 'Risposta più pronta',
    provider_sort_price: 'Più economico',
    // Fornitori esclusi (politica sui modelli, #421 / #518)
    admin_defaults_excluded: 'Fornitori esclusi',
    admin_defaults_excluded_desc:
      'I fornitori che non devono servire nessuna richiesta di Filo: chi produce i modelli (Filo accetta i modelli a pesi aperti solo da fornitori indipendenti) e chi si è dimostrato inaffidabile. Basta il nome base, «Google» copre anche «Google AI Studio» e «Google Vertex». Questa lista vale per tutti gli utenti e sostituisce quella scritta nel codice.',
    admin_defaults_excluded_name: 'Nome del fornitore',
    admin_defaults_excluded_add: 'Aggiungi fornitore',
    admin_defaults_excluded_remove: 'Rimuovi',
    admin_defaults_excluded_kind: 'Motivo',
    admin_defaults_excluded_kind_none: 'Non scritto',
    admin_defaults_excluded_kind_producer: 'Produce i modelli',
    admin_defaults_excluded_kind_unreliable: 'Serve male',
    admin_defaults_excluded_note: 'Nota (quando, cosa è successo)',
    // Pagine delicate (#1004)
    admin_defaults_delicate: 'Pagine delicate',
    admin_defaults_delicate_desc:
      'I siti di posta, banche, sanità e pubblica amministrazione da cui le funzioni automatiche non mandano niente ai modelli. Uno per riga; un dominio vale anche per i suoi sottodomini. Vale per tutti gli utenti: una categoria salvata qui sostituisce quella scritta nel codice, una lasciata com\'è segue il codice.',
    admin_defaults_delicate_posta: 'Posta',
    admin_defaults_delicate_banche: 'Banche',
    admin_defaults_delicate_sanita: 'Sanità',
    admin_defaults_delicate_pa: 'Pubblica amministrazione',
    // Quanto filo ha davanti la chat (#868)
    admin_defaults_contesto: 'Quanto ricorda la chat',
    admin_defaults_contesto_desc:
      'Gli ultimi giorni di conversazioni, di tutte le schede, entrano in ogni messaggio fino al minore dei due tetti. Vale per chi non li ha cambiati in Preferenze; un campo vuoto segue il codice.',
    admin_defaults_contesto_giorni: 'Giorni',
    admin_defaults_contesto_token: 'Tetto in token',
    admin_defaults_contesto_cache: 'Durata della cache',
    admin_defaults_contesto_cache_5m: '5 minuti',
    admin_defaults_contesto_cache_1h: 'un\'ora',
    admin_defaults_contesto_cache_serie: 'Come il codice (%s)',
    admin_defaults_contesto_cache_codice: 'Come il codice',
    // Quanto può essere lunga una risposta dei modelli (#1097.3)
    admin_defaults_lunghezza: 'Quanto può essere lunga una risposta',
    admin_defaults_lunghezza_desc:
      'Il tetto in token di ogni risposta, per famiglia di funzioni: ferma il modello che si incarta, e una risposta che lo tocca si vede interrotta. Un fornitore che non regge il tetto viene scartato. Vale per chi non l\'ha cambiato in Preferenze; un campo vuoto segue il codice.',
    admin_defaults_lunghezza_conversazioni: 'Chat e conversazioni',
    admin_defaults_lunghezza_testi: 'Traduzioni, riscritture, riassunti',
    admin_defaults_lunghezza_brevi: 'Risposte brevi',
    admin_defaults_excluded_unknown: 'Nessun fornitore di OpenRouter si chiama così: questa voce non esclude nessuno.',
    admin_defaults_excluded_guess: 'Forse «%s»?',
    admin_defaults_excluded_drift_title: 'Esclusioni del codice che questa lista non copre',
    admin_defaults_excluded_drift: 'Questa lista sostituisce quella scritta nel codice, e queste esclusioni non ci sono: %s. Finché mancano, quei fornitori possono servire le richieste.',
    admin_defaults_excluded_drift_fix: 'Rimettili nella lista',
    admin_defaults_producer_not_excluded: '%s produce questo modello e non è fra i fornitori esclusi: le richieste possono arrivare a lui.',
    admin_defaults_producer_exclude: 'Escludi %s',
    admin_defaults_open_weights_title: 'Per chi accende «Solo modelli a pesi aperti»',
    admin_defaults_open_weights_to: 'Passano a %s: %s',
    admin_defaults_open_weights_none_stop: 'Nessuna funzione si ferma.',
    admin_defaults_open_weights_all_open:
      'Con «Solo modelli a pesi aperti» acceso non cambia niente. Tutte le funzioni partono già da modelli a pesi aperti.',
    admin_defaults_save: 'Salva e propaga',
    admin_defaults_saving: 'Salvataggio…',
    admin_defaults_saved: 'Salvato e propagato a tutti gli utenti.',
    admin_defaults_saved_partial:
      'Salvato — una riga evidenziata sotto non è stata propagata.',
    admin_defaults_unsaved: 'Modifiche non ancora propagate.',
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
      'Usa liste di blocco pubbliche e gratuite (StevenBlack, EasyList e le sue liste per i siti ' +
      'italiani e francesi): pubblicità e tracker non si caricano, e i riquadri della pubblicità ' +
      'che restano nella pagina spariscono. Le liste si scaricano dalla rete, restano ' +
      'in cache sul tuo computer e si aggiornano da sole una volta a settimana. I siti ' +
      'che usi davvero (Google, YouTube, banche…) non vengono mai bloccati.',
    options_security_adskip: 'Salta le pubblicità dei video',
    options_security_adskip_desc:
      'Quando un video, per esempio su YouTube, mostra una pubblicità col pulsante «Salta», ' +
      'Filo lo preme appena compare. Quelle che non si possono saltare restano come sono.',
    options_security_siteblock: 'Blocca l’apertura dei siti in blacklist',
    options_security_siteblock_desc:
      'Impedisce di APRIRE i siti in blacklist (non solo le loro pubblicità), anche dai ' +
      'risultati di una ricerca e quando è Filo ad aprirli. Se provi ad aprire un sito ' +
      'bloccato compare una notifica con “Apri comunque”. Puoi aggiungere domini tuoi ' +
      'qui sotto (uno per riga).',
    options_security_siteblock_lists: 'Usa anche le liste pubbliche (pubblicità/tracker) come blacklist',
    options_security_siteblock_blacklist_label: 'Domini in blacklist (uno per riga)',
    options_security_siteblock_blacklist_invalid:
      'Queste righe non sono domini validi e non bloccheranno nulla (usa un dominio ' +
      'con estensione, es. facebook.com — niente IP o nomi senza punto): %s',
    options_security_downloads: 'Chiedi prima di scaricare un programma',
    options_security_downloads_desc:
      'I file che il computer ESEGUE (.exe, .msi, .bat, .dmg, .iso, .pkg, .sh, .jar…) ' +
      'non entrano nella cartella Download senza il tuo sì. Filo ti dice da quale ' +
      'sito arrivano e aspetta. Anche “Apri file” su un programma chiede conferma, ' +
      'perché aprirlo vuol dire eseguirlo. Tutti gli altri file scendono come sempre.',
    options_security_downloads_trusted_label:
      'Siti di cui ti fidi, uno per riga. Da questi i programmi scendono senza chiedere',
    options_security_downloads_trusted_invalid:
      'Queste righe non sono domini validi e verranno ignorate (usa un dominio ' +
      'con estensione, es. mozilla.org): %s',
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
    // Ogni frase qui sotto descrive il rilevatore com'è oggi: tests/unit/safebrowseSpiegazione.test.mjs.
    options_security_safebrowse_desc:
      'Ti avvisa quando un sito imita un marchio noto, è nella lista nera di Google per phishing o malware, ' +
      'ha un certificato che non torna o ti chiede la password su una connessione non protetta. L\'avviso ' +
      'copre la pagina finché non scegli. Su un sito sospetto premi «Continua», su uno pericoloso scrivi ' +
      '«confermo». La scelta vale per quel sito in quella scheda, finché resta aperta. Spento, Filo non ' +
      'chiede più niente fuori dal computer, ma ti avvisa ancora sui sosia e sulle password chieste senza ' +
      'connessione protetta, che riconosce da solo.',
    options_security_safebrowse_network: 'Controlli di rete (età del dominio e del certificato)',
    options_security_safebrowse_network_desc:
      'Quando un sito ha già un indizio sospetto, Filo chiede a due registri pubblici (rdap.org e crt.sh) ' +
      'da quanto esistono il dominio e il suo certificato. Manda solo il nome del sito. Un sito "di un ' +
      'marchio noto" nato pochi giorni fa è un forte segnale di truffa. Non serve nessuna chiave. ' +
      'Disattivalo se non vuoi che Filo faccia queste richieste.',
    options_security_safebrowse_llm: 'Giudizio AI sui casi sospetti',
    options_security_safebrowse_llm_desc:
      'Solo quando un sito resta dubbio, un modello AI guarda i dati del suo indirizzo (il nome, il marchio ' +
      'a cui somiglia, l\'età, il certificato, se la pagina chiede una password), mai il contenuto della ' +
      'pagina. Può solo renderlo sospetto, mai dichiararlo sicuro o pericoloso, e in incognito non parte. ' +
      'Usa il modello scelto in Modelli alla voce «Rilevamento siti pericolosi — giudizio».',
    options_security_safebrowse_sandbox: 'Scopri in una finestra isolata dove portano i link accorciati',
    options_security_safebrowse_sandbox_desc:
      'Quando tieni fermo il puntatore per mezzo secondo su un link accorciato (bit.ly e simili) o su un ' +
      'rimando noto, o ci arrivi col tasto Tab, Filo controlla dove porta prima che tu clicchi. Cerca il ' +
      'link e la sua destinazione nella lista nera di Google e, se la destinazione non è scritta nel link, ' +
      'lo apre in una finestra nascosta e senza i tuoi dati. La finestra si chiude appena il rimando rivela ' +
      'la destinazione, così il sito d\'arrivo non riceve visite prima del tuo clic. Una finestra alla ' +
      'volta, mai in incognito, mai su una pagina che hai già aperto. Spento, resta solo la lista nera. ' +
      'Sugli altri link, e col dito su uno schermo touch, prima del clic non parte niente.',
    options_security_safebrowse_key_managed:
      'Per la lista nera di Google (phishing e malware) Filo usa una chiave che arriva col programma. ' +
      'Funziona per tutti, anche senza aver fatto l\'accesso, e non devi configurare niente. A Google ' +
      'arriva solo un pezzo dell\'impronta degli indirizzi che apri, mai gli indirizzi.',
    // #1004 — pagine delicate
    options_security_delicate: 'Non mandare ai modelli le pagine delicate',
    options_security_delicate_desc:
      'Posta, banca, sanità, pubblica amministrazione e le pagine dove hai visto un campo password o carta. ' +
      'Quando chiudi queste schede o Filo le riordina, ne tiene solo titolo e indirizzo e non manda il testo a ' +
      'nessun modello. La chat ne vede solo il nome del sito, i loro screenshot e le immagini copiate da lì non ' +
      'vanno al modello delle immagini, nemmeno incollati altrove, e la spiegazione di quello che selezioni parte ' +
      'solo dal tasto destro. Il correttore resta acceso: manda al modello quello che scrivi, non la pagina.',
    options_security_delicate_sites_label:
      'Altri siti delicati, uno per riga',
    options_security_delicate_sites_invalid:
      'Queste righe non sono domini validi e verranno ignorate (usa un dominio ' +
      'con estensione, es. studiorossi.it): %s',
    options_security_delicate_campi_title: 'Siti dove Filo ha visto un campo password o carta',
    options_security_delicate_campi_togli: 'Non è delicato',
    options_security_delicate_campi_tolto: 'non delicato per te',
    options_security_delicate_campi_rimetti: 'Torna delicato',
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
      'si carica nemmeno. Rifiuta da solo i banner dei cookie, nasconde quelli che non hanno un «rifiuta», dice ai siti che non vuoi essere profilato ' +
      'e carica i video YouTube senza cookie. I cookie dei contenuti incorporati di siti dove non sei entrato durano ' +
      'solo la visita. I cookie utili a te (accessi, preferenze, le tue scelte sui siti) ' +
      'restano: non perdi quello che hai impostato.',
    options_cookies_mode_privacy: 'Privacy massima',
    options_cookies_mode_privacy_desc:
      'Come l\'Automatico, ma ogni sito vive in uno spazio separato e usa-e-getta, così i siti non possono mettersi ' +
      'd\'accordo per riconoscerti. Qualche minuto dopo che chiudi l\'ultima scheda di un sito, Filo butta via tutto ' +
      'quello che il sito aveva salvato, accessi compresi. Fanno eccezione i "siti fidati" qui sotto.',
    options_cookies_whitelist_title: 'Siti fidati: resta connesso',
    options_cookies_whitelist_desc:
      'I siti che aggiungi qui restano connessi: in "Privacy massima" vivono in uno spazio isolato ma persistente, ' +
      'e in "Automatico" tengono i loro cookie anche quando un loro contenuto compare dentro un\'altra pagina. ' +
      'Scrivi il sito o incolla l\'indirizzo di una sua pagina (es. google.com per Gmail) e premi Invio; se poi ' +
      'lo togli, in "Privacy massima" Filo butta via ' +
      'quello che aveva salvato.',
    options_cookies_whitelist_placeholder: 'es. google.com',
    options_cookies_whitelist_add: 'Aggiungi',
    options_cookies_whitelist_remove: 'Rimuovi',
    options_cookies_whitelist_empty: 'Nessun sito fidato. In "Privacy massima" rifai l\'accesso ogni volta che torni su un sito che avevi chiuso.',
    options_cookies_whitelist_invalid: 'Non sembra un dominio valido. Usa un dominio con estensione, es. google.com (niente IP o nomi senza punto).',
    options_cookies_whitelist_dup: '"%s" è già nell\'elenco dei siti fidati.',
    options_cookies_trusted_note_other:
      'In "Automatico" i tuoi accessi restano salvati comunque. Qui serve aggiungere un sito solo se ne vedi i ' +
      'contenuti dentro altre pagine e vuoi che restino connessi prima che tu ci sia entrato da Filo.',
    options_cookies_accessi_title: 'Siti dove sei entrato',
    options_cookies_accessi_desc:
      'Quando un contenuto di questi siti compare dentro un\'altra pagina (un post, un video, una mappa), i suoi '
      + 'cookie restano, così non esci dai siti dove hai fatto l\'accesso. Degli altri siti, i cookie messi da un '
      + 'contenuto incorporato durano solo la visita.',
    options_cookies_accessi_remove: 'Togli',
    options_cookies_riquadri_title: 'Contenuti incorporati con i cookie riattivati',
    options_cookies_riquadri_desc: 'Post, video e mappe di questi servizi, dentro le pagine di altri siti, tengono i loro cookie.',
    options_cookies_riquadri_remove: 'Togli',
    options_cookies_riquadri_modello: 'Riconosci con un modello i contenuti incorporati rotti',
    options_cookies_riquadri_modello_desc:
      'Se un post, un video o una mappa di un altro sito resta vuoto e Filo non lo conosce, a un modello va la foto ' +
      'del solo riquadro. Spento, quel riquadro lo riattivi col tasto destro.',
    riquadro_cookie_domanda: 'Attivo i cookie di %s per questo contenuto?',
    riquadro_cookie_si: 'Sì',
    riquadro_cookie_no: 'No',
    riquadro_cookie_conferma: 'I contenuti di %s dentro le pagine di altri siti terranno i loro cookie, e questo si ricarica. '
      + 'Li togli dal tasto destro sul contenuto.',
    riquadro_cookie_attiva: 'Attiva',
    riquadro_cookie_fatto: 'Cookie di %s attivi: ricarico il contenuto',
    riquadro_cookie_menu_attiva: 'Attiva i cookie di %s qui',
    riquadro_cookie_menu_togli: 'Togli i cookie riattivati di %s',
    // #975 — il menu che un sito si disegna da sé. Il nome viene dalla pagina: si sostituisce con una funzione.
    menu_del_sito: 'Menu di %s',
    menu_del_sito_scelta: 'Cosa apre il tasto destro qui',
    menu_del_sito_sempre: 'Aprilo subito col tasto destro',
    menu_del_sito_torna_filo: 'Col tasto destro apri il menu di Filo',
    menu_del_sito_proposta: 'Su %s scegli spesso il menu del sito. Te lo apro subito col tasto destro? Quello di Filo resta a %s + tasto destro.',
    menu_del_sito_si: 'Sì',
    menu_del_sito_no: 'No',
    menu_del_sito_fatto: 'Su %s il tasto destro apre il menu del sito; quello di Filo resta a %s + tasto destro.',
    menu_del_sito_annulla: 'Annulla',
    menu_del_sito_tolto: 'Su %s il tasto destro apre di nuovo il menu di Filo.',
    menu_spegni_filo: 'Spegni Filo su questo sito',
    menu_riaccendi_filo: 'Riaccendi Filo su questo sito',
    filo_spento_fatto: 'Filo è spento su %s.',
    filo_riacceso_fatto: 'Filo è di nuovo acceso su %s.',
    filo_spento_annulla: 'Annulla',
    options_cookies_banners_title: 'Qui i banner dei cookie li vedi',
    options_cookies_banners_remove: 'Rifiuta in automatico',
    options_cookies_done_title: 'Qui Filo li ha rifiutati o nascosti',
    options_cookies_done_rejected: 'cookie rifiutati',
    options_cookies_done_hidden: 'banner nascosto',
    options_cookies_done_show: 'Mostra il banner',
    // Risposte date ai permessi dei siti (#591, giro 20)
    options_site_perms_title: 'Permessi dei siti',
    options_site_perms_empty: 'Nessuna risposta data a un sito.',
    options_site_perms_remove: 'Togli',
    options_site_perms_yes: 'consentito',
    options_site_perms_no: 'negato',
    options_site_perms_part_audio: 'Microfono',
    options_site_perms_part_video: 'Fotocamera',
    options_site_perms_part_appunti: 'Appunti',
    options_site_perms_part_posizione: 'Posizione',
    options_site_perms_part_notifiche: 'Notifiche',
    options_site_perms_part_schermi: 'Schermi',
    options_site_perms_part_presenza: 'Presenza al computer',
    options_site_perms_part_strumenti: 'Strumenti musicali',
    options_site_perms_part_rete: 'Rete locale',
    options_site_perms_part_file: 'Modifica dei file',
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
      'Salva tutti i tuoi dati di Filo (memorie degli agenti, chat con Filo, pagine ' +
      'visitate, pagine salvate, cronologia incolla, costi e impostazioni) in un file ' +
      '.zip che contiene un data.json, il filo delle chat e delle pagine visitate e le ' +
      'immagini copiate come file separati. Utile come backup o per trasferire i dati ' +
      'su un altro computer.',
    security_export_keys_label: 'Includi le chiavi',
    security_export_keys_desc: 'Chi ha il file può usare le tue chiavi API. Trattalo come una password.',
    security_export_btn: 'Esporta dati (.zip)',
    security_export_done: 'Dati esportati',
    security_export_fail: 'Esportazione non riuscita',
    security_import_title: 'Importa dati Filo',
    security_import_btn: 'Importa dati (.zip)',
    // Non promette quello che la fusione non mantiene: il dettaglio lo dice la conferma, col file davanti (#1256).
    security_import_desc:
      'Ricarica un .zip esportato da Filo: rimette al loro posto memorie, chat con ' +
      'Filo, pagine visitate, pagine salvate, cronologia, immagini e impostazioni, ' +
      'unendoli a quello che hai. Prima di importare Filo ti dice cosa entra e cosa cambia.',
    security_visite_title: 'Pagine visitate',
    security_visite_desc: 'Filo ricorda le pagine che apri nelle schede, sul tuo computer. Quelle aperte in incognito no.',
    security_visite_ora: 'Cancella l’ultima ora',
    security_visite_oggi: 'Cancella oggi',
    security_visite_tutto: 'Cancella tutto',
    security_visite_confirm_title: 'Cancellare le pagine visitate?',
    // %1 = "la pagina visitata" / "le N pagine visitate", %2 = "nell’ultima ora" / "oggi" / "da sempre"
    security_visite_confirm_text: 'Filo dimentica %1 %2. Le chat e le schede chiuse restano.',
    security_visite_confirm_ok: 'Cancella',
    security_visite_nessuna: 'Nessuna pagina da cancellare',
    security_visite_fail: 'Cancellazione non riuscita',
    security_import_confirm_title: 'Importa dati da backup',
    // %1 = nome file (nel popup va nel suo riquadro: la riga sta da sola), %2 = " (del …)" o vuoto,
    // %3/%4 = conteggi già declinati, %5 = chat e pagine del filo o vuoto, %6 = security_import_nulla_perso o _escono_mie
    security_import_confirm_text:
      'Dal file%2:\n"%1"\n%3 e %4%5.\n\n' +
      '%6le liste (chat, pagine visitate, pagine salvate, ' +
      'cronologia, appunti, download) si uniscono senza duplicati e le sezioni che qui non ' +
      'esistono vengono aggiunte. Dove lo stesso dato esiste in entrambi, vince ' +
      'quello del backup. Le impostazioni del backup diventano attive subito, ma il ' +
      'limite di spesa mensile non si allarga e resta il più stretto dei due. ' +
      'Della spesa resta, mese per mese, la più alta fra adesso e il backup. ' +
      'I crediti e le schede aperte restano quelli di adesso.',
    // Righe in fondo alla conferma, solo quando servono. %1 = numero
    security_import_images_lost: 'Immagini che non si leggono: %1. Al loro posto non ci sarà niente.',
    security_import_filo_lost: 'Le chat e le pagine visitate del backup non si leggono.',
    security_import_voci_perse: 'File dentro l’archivio che non si leggono: %1. Quello che contengono non arriva.',
    // %1 = quante restano fuori, %2 = il tetto
    security_import_pages_out: 'Pagine salvate che non entrano: %1. L’elenco ne tiene %2, le più recenti.',
    security_import_pages_out_mine: 'Fra queste, pagine che hai salvato adesso: %1. Dopo l’importazione non ci saranno più.',
    security_import_appunti_out: 'Appunti copiati che non entrano: %1. L’elenco ne tiene %2, i più recenti.',
    security_import_appunti_out_mine: 'Fra questi, appunti che hai adesso: %1. Dopo l’importazione non ci saranno più.',
    security_import_download_out: 'Download che non entrano nell’elenco: %1. L’elenco ne tiene %2, i più recenti.',
    security_import_download_out_mine: 'Fra questi, download che hai adesso nell’elenco: %1. Escono dall’elenco, ma i file restano sul computer.',
    // %1 = il limite di adesso, %2 = quello del backup, %3 = il bottone che lo mette
    security_import_tetto_backup: 'Il limite di spesa mensile resta %1. Nel backup era %2. Per usare quello, scegli «%3».',
    security_import_tetto_senza: 'Il limite di spesa mensile resta %1. Nel backup non c’era un limite. Per toglierlo, scegli «%3».',
    // %1 = il limite di adesso, %2 = quello del backup, più stretto, che entra
    security_import_tetto_sceso: 'Il limite di spesa mensile scende da %1 a %2, quello del backup.',
    security_import_tetto_sceso_senza: 'Il limite di spesa mensile diventa %2, quello del backup: adesso non hai un limite.',
    security_import_tetto_btn: 'Importa col limite del backup',
    security_import_tetto_btn_senza: 'Importa e togli il limite',
    security_import_senza_chiavi: 'Le chiavi API non sono nell’archivio. Quelle salvate qui restano come sono.',
    security_import_proxy_senza_credenziali: 'Il proxy arriva senza utente e password: per usarlo, scrivi di nuovo a Filo il suo indirizzo intero.',
    security_import_nulla_perso: 'Nulla di ciò che hai ora viene cancellato: ',
    // %1 = "le pagine salvate più vecchie", "gli appunti copiati più vecchi"… già uniti
    security_import_escono_mie: 'Di ciò che hai ora escono solo %1, coi numeri qui sotto: ',
    security_import_escono_pagine: 'le pagine salvate più vecchie',
    security_import_escono_appunti: 'gli appunti copiati più vecchi',
    security_import_escono_download: 'le voci più vecchie dell’elenco dei download',
    security_import_confirm_ok: 'Importa',
    security_import_done: 'Dati importati',
    security_import_invalid: 'Non è un archivio esportato da Filo',
    security_import_damaged: 'L’archivio è rovinato e Filo non ne legge i dati',
    security_import_compressed: 'L’archivio è compresso in un formato che Filo non legge (bzip2 o LZMA): ricomprimilo come zip normale e riprova',
    security_import_encrypted: 'L’archivio è protetto da una password: scompattalo, ricomprimilo senza password e riprova',
    security_import_fail: 'Importazione non riuscita',
    security_wipe_btn: 'Cancella tutti i dati di Filo',
    security_wipe_desc: 'Toglie da questo computer tutto quello che Filo sa di te. Dopo, Filo riparte come appena installato.',
    security_wipe_export_text:
      'Prima esporta i tuoi dati. Dopo la cancellazione non si recuperano, ma con l’archivio li rimetti ' +
      'dentro quando vuoi, anche su un altro computer.',
    security_wipe_export_done: 'Archivio salvato',
    security_wipe_list_title: 'Cosa sparisce',
    security_wipe_list:
      'Memorie, conversazioni e il loro archivio, cronologia AI, appunti e file dell’editor, pagine salvate, ' +
      'pagine visitate, schede aperte e archiviate, download registrati, cronologia degli appunti copiati, ' +
      'timer e notifiche, dizionario personale, impostazioni, cookie e dati dei siti, chiavi e accessi salvati, ' +
      'la copia delle segnalazioni che hai mandato. I file che hai scaricato e i tuoi documenti restano dove sono. ' +
      'Filo si chiude e si riapre vuoto, come appena installato.',
    security_wipe_server:
      'I feedback che hai già mandato restano sul server di Filo. Per toglierli scrivi a chi sviluppa Filo, ' +
      'anche con un feedback, e li cancella a mano. L’archivio esportato tiene l’elenco di quelli che hai mandato.',
    security_wipe_identity_label: 'Cancella anche l’identità dei crediti',
    security_wipe_identity_desc:
      'Se non la spunti resta, e con lei i crediti che hai sul server. Se la cancelli, quei crediti non si raggiungono più.',
    security_wipe_word_label: 'Scrivi «conferma» per cancellare. Non si torna indietro.',
    security_wipe_cancel: 'Annulla',
    security_wipe_go: 'Cancella tutto e riavvia',
    security_wipe_go_spento: 'Scrivi «conferma» nel campo qui sopra',
    security_wipe_in_corso: 'Cancello e riavvio Filo…',
    security_wipe_fail: 'Non sono riuscito a cominciare, e non ho cancellato niente. Riprova.',

    home_title: 'Aperti per dopo',
    home_search_placeholder: 'Cerca per titolo o URL…',
    home_empty: 'Nessuna scheda salvata. Click destro su una pagina → "Salva per dopo".',
    home_no_results: 'Nessun risultato per la ricerca.',
    home_remove: 'Rimuovi',
    home_menu_open: 'Apri',
    home_menu_open_keep: 'Apri e tienila in lista',
    home_menu_copy_link: 'Copia link',
    home_menu_move: 'Sposta in…',
    home_menu_new_category: 'Nuova categoria…',
    home_new_category_placeholder: 'Nome della nuova categoria',
    home_removed: '«%s» rimossa.',
    home_undo: 'Annulla',
    home_link_copied: 'Link copiato',
    home_link_copy_failed: 'Il link non si è copiato: riprova.',
    home_moved: 'Spostata in «%s»',
    home_move_failed: 'Non si è spostata: nel frattempo l’elenco è cambiato. Riprova da qui.',

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
    history_cache_written: '%s token messi da parte per le richieste che seguono.',
    history_policy_violation: '⚠ fornitore non ammesso',
    history_policy_violation_title: 'Filo non ammette questo fornitore per questa richiesta. La risposta non doveva arrivare da lì.',
    // Tempi del turno (idee «Latenza della chat»): quando è arrivato il primo
    // pezzo di ragionamento, la prima parola, e quando è finito.
    history_timing: 'ragiona %s · scrive %s · fine %s',
    history_timing_title: 'Dalla partenza della richiesta: primo pezzo di ragionamento, prima parola (o prima azione), fine della risposta.',
    history_timing_prep: 'prepara %s · ',
    history_timing_prep_title: 'Prima della richiesta il turno ha aspettato %s, di cui stato del computer %s e saldo %s.',
    history_clear_confirm: 'Cancellare definitivamente tutta la cronologia AI?',
    history_empty: 'Nessuna interazione AI registrata.',
    history_no_results: 'Nessun risultato per la ricerca.',
    history_no_results_filter: 'Nessuna interazione per il filtro selezionato.',

    // Il correttore (#1446)
    spell_add_dict: 'Aggiungi al dizionario',
    spell_autocorrect: 'Correggi automaticamente',
    spell_manage: 'Gestisci correttore',
    spell_annulla_correzione: 'Annulla correzione',
    spell_action_semantic_label: 'Errori del correttore (controllo rapido)',
    spell_action_coerenza_label: 'Suggerimenti del correttore (controllo ragionato)',
    spell_switch_errori: 'Errori',
    spell_switch_errori_desc: 'Quello che Filo sa sbagliato: parole che non esistono, una parola al posto di un\'altra, grammatica, fatti sbagliati. Spento, sparisce anche la sottolineatura del browser.',
    spell_switch_suggerimenti: 'Suggerimenti',
    spell_switch_suggerimenti_desc: 'Quello che decidi tu: frasi poco chiare, date e giorni che non tornano, cose diverse da quelle già dette nella pagina.',
    spell_switch_automatica: 'Correzione automatica',
    spell_switch_automatica_desc: 'Quando finisci una parola: «perchè» diventa «perché», «marco» diventa «Marco». La scorciatoia di annulla subito dopo, o il tasto destro sulla parola, la riportano com\'era.',
    spell_ripetuta: '«%s» ripetuto',
    spell_fisso: 'Si scrive «%s».',
    spell_perche_dizionario: 'non è nel dizionario',
    spell_perche_chiesta: 'chiesta col tasto destro',
    spell_errore_forse: 'Il dizionario non conosce questa parola.',
    spell_errore_generico: 'Da correggere.',
    spell_togli: 'Togli «%s»',
    spell_correggi_tutti: 'Correggi tutti gli errori (%s)',
    spell_ocra_ignora: 'Ignora',
    spell_ocra_prima: 'prima: «%s»',
    spell_ocra_controlla: 'Controlla qui',
    spell_ocra_data: '%s è %s.',
    spell_ocra_relativa: '%s è %s.',
    spell_ocra_inesistente: '%s non esiste: %s ha %s giorni.',
    // I segnaposti (#1448)
    spell_switch_segnaposti: 'Segnaposto',
    spell_switch_segnaposti_desc: 'Scrivi delle x al posto di un dato che non ricordi («nel 14xx», «un p/e di xx») e Filo lo trova: il valore compare sopra le x, un clic lo mette.',
    spell_segnaposto_forse: 'Forse un dato da trovare.',
    spell_segnaposto_cerco: 'Cerco il dato…',
    spell_segnaposto_nessuno: 'Non ho trovato questo dato.',
    spell_segnaposto_errore: 'La ricerca non è riuscita.',
    spell_segnaposto_riprova: 'Cerca di nuovo',
    spell_segnaposto_delicata: 'Su questa pagina non cerco da solo.',
    spell_segnaposto_cerca: 'Cerca il dato',
    spell_segnaposto_bloccata: 'Non cerco: la ricerca porterebbe fuori un dato riservato.',
    spell_segnaposto_apri_fonte: 'Apri la fonte',
    spell_segnaposto_fonte: 'Fonte: %s',
    spell_segnaposto_metti: 'Metti %s',

    // Pagina Gestisci correttore
    spell_page_title: 'Filo — Correttore',
    spell_page_heading: 'Correttore',
    spell_page_autocorrect_h: 'Correzioni automatiche',
    spell_page_autocorrect_desc: 'Quando finisci di scrivere una di queste parole, Filo la sostituisce con la correzione. Qui arrivano anche le correzioni che scegli più volte per la stessa parola.',
    spell_page_autocorrect_empty: 'Nessuna correzione automatica.',
    spell_page_dict_h: 'Parole imparate',
    spell_page_dict_desc: 'Il correttore non le segna: quelle che aggiungi, che ignori o che scrivi più volte uguali. Se una ha la maiuscola, Filo gliela mette anche quando la scrivi minuscola.',
    spell_page_dict_empty: 'Nessuna parola imparata.',
    spell_page_rifiutate_h: 'Da non correggere da sé',
    spell_page_rifiutate_desc: 'Parole di cui hai annullato la correzione automatica: Filo le lascia come le scrivi.',
    spell_page_rifiutate_empty: 'Nessuna parola.',
    spell_page_una_parola: 'Una parola sola, senza spazi.',
    spell_page_word_empty: 'Una parola vuota non si salva. Per toglierla usa «Rimuovi».',
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
    spell_page_dict_conflict: '"%s" c\'è già.',
    toast_added_to_dict: 'Aggiunta al dizionario',
    toast_autocorrect_saved: 'Correzione automatica attiva',

    // La pillola sopra una pagina che si è presa lo schermo pieno (#1526): %s è l'host, mai il titolo della pagina.
    schermo_pieno_sito: '%s è a schermo intero',
    schermo_pieno_riquadro: '%s, dentro %s, è a schermo intero',
    schermo_pieno_esci: '%s per uscire',
    // Al posto dell'host quando l'indirizzo non ne ha uno.
    schermo_pieno_file: 'un file del computer',
    schermo_pieno_senza_indirizzo: 'una pagina senza indirizzo',
    schermo_pieno_filo: 'una pagina di Filo',
    schermo_pieno_menu_esci: 'Esci dallo schermo intero',
    schermo_pieno_menu_regola: 'Quanto resta questo avviso…',
  };

  function t(key, ...args) {
    let s = STRINGS[key];
    if (s === undefined) return key;
    // In un solo passaggio e con una funzione: un argomento scritto da qualcuno (un nickname) che contiene «%s» o
    // «$&» non deve finire riscritto dal segnaposto dopo.
    let i = 0;
    return s.replace(/%s/g, (m) => (i < args.length ? String(args[i++]) : m));
  }

  global.SN_I18N = { t, STRINGS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
