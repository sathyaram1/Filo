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
    REGISTRA_TASTI: 'registra_tasti',             // { attivo } → i tasti premuti arrivano alla pagina (Preferenze, #842)
    EXPORT_DATA: 'export_data',                   // → salva tutti i dati come .zip
    // Reimportazione del .zip di EXPORT_DATA, in due passi: prima si sceglie e
    // si LEGGE il file (anteprima con quante sezioni/immagini contiene), poi si
    // APPLICA dopo la conferma dell'utente. Come EXPORT_DATA sono riservati
    // all'origine filo://: una pagina web non deve poter aprire un file dialog
    // né riscrivere lo storage (comprese le chiavi API).
    IMPORT_DATA_PREVIEW: 'import_data_preview',   // → { ok, fileName, exportedAt, sections, images, immaginiPerse, filoPerso, vociPerse, pagineFuori, appuntiFuori, downloadFuori, tettoSpesa, token }
    IMPORT_DATA_APPLY: 'import_data_apply',       // { token, tettoDelBackup } → { ok, added, updated, images }
    // Segnale senza contenuto alle pagine filo:// a importazione finita: chi mostra una lista la rilegge (#1256).
    DATI_IMPORTATI: 'dati_importati',
    // Solo dalla pagina Sicurezza (#850): Filo si chiude e al riavvio svuota la cartella dei dati.
    CANCELLA_TUTTI_I_DATI: 'cancella_tutti_i_dati',             // { parola: 'conferma', ancheIdentita } → { ok } | { ok:false, error }
    CANCELLA_TUTTI_I_DATI_STATO: 'cancella_tutti_i_dati_stato', // → { ok, identita, inCorso }
    GET_HISTORY: 'get_history',
    APPEND_HISTORY: 'append_history',             // { entry }
    REMOVE_HISTORY_ENTRY: 'remove_history_entry', // { id }
    CLEAR_HISTORY: 'clear_history',
    GET_SAVED_PAGES: 'get_saved_pages',
    REMOVE_SAVED_PAGE: 'remove_saved_page',       // { id }
    RESTORE_SAVED_PAGE: 'restore_saved_page',     // { id } — l'«Annulla» di una rimozione: la voce la tiene il main
    CONSUME_SAVED_PAGE: 'consume_saved_page',     // { id }
    APRI_PAGINA_SALVATA: 'apri_pagina_salvata',   // { id, tieni } — dalla chat: apre con l'indirizzo in elenco e la toglie (#845)
    SET_SAVED_PAGE_THUMB: 'set_saved_page_thumb', // { id } — il main fotografa la scheda di chi chiede e ne fa la miniatura

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
    // §5 — le schede archiviate da proporre per la cancellazione: solo le
    // pertinenti, tutte. { query, richiesta } → { ok, results } | { ok: false, error }
    ARCHIVIO_DA_CANCELLARE: 'archivio_da_cancellare',
    // Main → la pagina che ha chiesto: { richiesta, fatte, totali } schede giudicate.
    ARCHIVIO_DA_CANCELLARE_AVANZAMENTO: 'archivio_da_cancellare_avanzamento',
    // §5 — cancellazione PERMANENTE di più tab archiviate (dopo conferma). { ids }
    DELETE_ARCHIVED_TABS: 'delete_archived_tabs',
    // #848 — l'icona di un sito per la home e la chat, senza servizi di terzi. { url } → { ok, dato } (data:image/… o '')
    ICONA_SITO: 'icona_sito',
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
    // cross-mazzo via LLM. { deckId, text, history?, lastResults?, reasoningReqId? } →
    // { ok, reply, cardIds, cards, query, deck?, clearChat? } | { ok:false, stopped:true }. `lastResults` sono gli id
    // dell'ultima CardList mostrata (per "valuta questi risultati", §6.1); `clearChat`: l'utente ha
    // chiesto a parole di svuotare la chat, la pagina chiede conferma.
    DECKS_CHAT: 'decks_chat',
    // «Ferma» sulla chat dei mazzi (#792): { reqId } (il reasoningReqId del turno) → { ok, fermato }. Solo dalle
    // superfici di Filo e solo dalla scheda che ha avviato il turno.
    DECKS_CHAT_STOP: 'decks_chat_stop',
    // La chat salvata di un mazzo (§3.2), solo dalle pagine filo://. EDIT applica UNA modifica alla chat salvata
    // (SN_DECK_CHAT.applyEdit: op 'append' | 'fill' | 'drop' | 'names') e rifiuta un mazzo che non esiste più, una
    // chat oltre il tetto (error 'too_many', max) o un turno che non c'è più (error 'gone').
    DECKS_CHAT_GET: 'decks_chat_get',     // { deckId } → { ok, messages }
    DECKS_CHAT_EDIT: 'decks_chat_edit',   // { deckId, op, messages?|turn+message?|turn+userText?|turn+nameIds?, clientId } → { ok } | { ok:false, error, max? }
    DECKS_CHAT_CLEAR: 'decks_chat_clear', // { deckId, clientId } → { ok }
    // Broadcast alle pagine filo:// dopo EDIT/CLEAR: le altre schede sullo stesso mazzo si rileggono la chat.
    DECKS_CHAT_CHANGED: 'decks_chat_changed', // { deckId, clientId }
    // Parere LLM carta-vs-mazzo (§6). { deckId, cardIds, compute?, refresh? } →
    // { ok, opinions: { cardId → { text, versione, stale } } }.
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
    SCRYFALL_CARDS: 'scryfall_cards',     // { ids, freshPrices?, cacheOnly? } → mappa id → carta
    SCRYFALL_SYMBOLS: 'scryfall_symbols', // {} → mappa '{U}' → svg_uri
    SCRYFALL_PRINTS: 'scryfall_prints',   // { name } → { ok, prints } (n. stampe, cache permanente)
    GET_COSTS: 'get_costs',
    // Le stime di costo dei modelli (#819): {} → { ok, contesto } (listino, saldo, tariffa, token medi, predefiniti).
    STIMA_COSTO_MODELLI: 'stima_costo_modelli',
    // Crediti (gamification): saldo + consumo aggregato per tipo d'uso, per la
    // pagina Crediti del profilo. NON espone mai il costo in €. Vedi creditStore.
    GET_CREDITS: 'get_credits',
    // Broadcast main→renderer quando il saldo cambia (consumo, refill, ricompensa): la shell
    // aggiorna l'icona, la pagina il grafico.
    CREDITS_CHANGED: 'credits_changed',
    // La riga «ho usato i crediti di Filo» è a schermo (#662): l'avviso che la
    // ripeterebbe non parte. Da ogni superficie, siti compresi. { } → { ok }.
    KEY_FALLBACK_SHOWN: 'key_fallback_shown',
    // Ricompensa crediti per un feedback inviato (+5 subito). { } → { ok, credits, balance }.
    // Con un portafoglio (#816) non accredita: { ok, wallet: true, credits: 0, inArrivo, senzaPremio }.
    CREDITS_AWARD_FEEDBACK: 'credits_award_feedback',
    // Recap aggiornamento: le note delle versioni saltate dall'ultima vista.
    // Al primo avvio marca la versione come vista e non torna note: niente popup a sorpresa.
    GET_UPDATE_RECAP: 'get_update_recap',
    // L'utente ha chiuso il recap: salva app.getVersion() come ultima vista, con la fotografia delle sue novità.
    MARK_UPDATE_SEEN: 'mark_update_seen',
    // Feedback dell'utente passati a `done` da quando non guardava (C5): il main
    // cerca su Firestore i feedback inviati da questo client, accredita la
    // ricompensa per priorità (50/100/200/300) una volta sola per feedback, e
    // ritorna l'elenco da ringraziare. { } → { ok, rewards:[{num,name,explanation,
    // status:'done'|'closed',credits}], totalCredits }. Con un portafoglio (#816)
    // la cifra è il movimento del server (0 = chiusa senza premio) e il conteggio
    // locale non si muove. La home mostra un popup e anima i crediti ricevuti.
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
    // #986 — la copia locale delle segnalazioni mandate da questo computer. Testi scritti dall'utente: solo dalle
    // superfici di Filo (soloFilo), mai da un sito. {} → { ok, voci } (in incognito { ok, voci: [], incognito: true })
    SEGNALAZIONI_MIE_LIST: 'segnalazioni_mie_list',
    // { id } → { ok, voci }: la voce esce dall'elenco e dal disco; la segnalazione mandata resta dov'è.
    SEGNALAZIONI_MIE_TOGLI: 'segnalazioni_mie_togli',
    // Segnale BROADCAST main→pagine filo:// (mai incognito): l'elenco è cambiato. Senza dati: si rilegge con LIST.
    SEGNALAZIONI_MIE_CAMBIATE: 'segnalazioni_mie_cambiate',
    // Broadcast main→renderer: l'utente corrente ha ricevuto crediti in regalo
    // (#210.4). { amount } → la home mostra un popup una volta sola.
    GIFT_NOTICE: 'gift_notice',
    // La home che vuole raccontare il regalo lo prende (#664): alla domanda
    //   dopo non c'è più, così una home sola lo mostra. { } → { ok, amount }
    GIFT_NOTICE_CLAIM: 'gift_notice_claim',
    // === Crediti sul server e chiave personale (#598) =======================
    // ORIGINE: tutti i WALLET_* sono riservati alle pagine filo:// e alla
    // shell (leggono saldo e codici, riscattano, fanno emettere una chiave):
    // da una pagina web rispondono { ok:false, error:'forbidden' }.
    // WALLET_STATE: stato del portafoglio dell'INSTALLAZIONE (identità anonima
    //   Firebase, non l'account Google): saldo letto dal server (tetto della
    //   chiave OpenRouter personale meno consumo), pseudonimo, codici d'invito
    //   propri, se c'è la chiave personale, se l'utente usa una chiave sua.
    //   { } → { ok, identity:{ok,error?}, hasPersonalKey, pseudonym, usingOwnKey,
    //   server:{ hasWallet, balance:{credits,…}, invites:[…], dailyCredits,
    //   canInvite, invitesLocked:'need_google'|'google_used'|null, … }|null, error? }
    WALLET_STATE: 'wallet_state',
    // WALLET_SALDO_PREPARA (#1353): chi scrive nella chat della home manderà presto un turno: il main rilegge il
    //   saldo in sottofondo se l'ultima lettura ha più di un minuto. Non aspetta la lettura. { } → { ok }
    WALLET_SALDO_PREPARA: 'wallet_saldo_prepara',
    // WALLET_REDEEM: riscatta un codice d'invito. Il server crea la chiave
    //   personale e la consegna UNA volta: il main la salva cifrata.
    //   { code } → { ok, status, message, credits?, inviteCodes?, invitesLocked?, state? }
    WALLET_REDEEM: 'wallet_redeem',
    // Il portafoglio c'è sul server ma la chiave personale non è su questo computer: il server
    // ne emette un'altra, la vecchia si spegne e il saldo resta. { } → { ok, status, message }
    WALLET_REISSUE: 'wallet_reissue',
    // WALLET_RESET_IDENTITY: l'identità dell'installazione è annullata sul
    //   server o illeggibile qui (il portafoglio legato a essa non si
    //   raggiunge): l'utente sceglie di ricominciare con un'identità nuova e
    //   un nuovo invito. I file di prima restano accanto.
    //   { confermato: true } → { ok, state } | { ok:false, status:'needs_confirm'|'identity_ok'|'not_reachable' }
    WALLET_RESET_IDENTITY: 'wallet_reset_identity',
    // WALLET_OWN_KEY_INFO (#629): spesa e residuo che OpenRouter dichiara per
    //   la chiave OpenRouter scritta dall'utente (la pagina Crediti li mostra;
    //   la chiave resta nel main). { } → { ok, limit|null, usage,
    //   limit_remaining|null, line } oppure { ok:false, status, message }
    WALLET_OWN_KEY_INFO: 'wallet_own_key_info',
    // === L'avviso prima che i crediti finiscano (#818) =======================
    // ORIGINE: solo pagine filo:// e la shell (come i WALLET_*).
    // CREDITS_WARNING: spinta del main alle pagine filo:// quando scatta l'avviso. { id }
    //   La home con una conversazione aperta lo prende con CREDITS_WARNING_CLAIM; se nessuna lo prende, diventa una
    //   notifica nella cornice che apre la pagina Crediti.
    CREDITS_WARNING: 'credits_warning',
    // CREDITS_WARNING_CLAIM: { id } → { ok, avviso:{ id, testo, rimedi:[…] } } solo alla prima che lo chiede.
    CREDITS_WARNING_CLAIM: 'credits_warning_claim',
    // CREDITS_WARNING_STATE: l'avviso com'è adesso, per la pagina Crediti. { } → { ok, mostra, avviso|null }
    CREDITS_WARNING_STATE: 'credits_warning_state',
    // CREDITS_REMEDY_APPLY / _UNDO: un rimedio con un clic, e com'era con un altro. Il main ricalcola il rimedio da
    //   sé: dalla pagina arriva solo l'id. { id: 'modello'|'automatiche' } → { ok, frase, avviso }
    CREDITS_REMEDY_APPLY: 'credits_remedy_apply',
    CREDITS_REMEDY_UNDO: 'credits_remedy_undo',
    // SPIEGAZIONE_ANTICIPATA_USATA: la spiegazione preparata alla selezione è stata aperta col tasto destro. Anche dai
    //   siti (content script): serve solo a non contarla fra quelle che spegnere farebbe risparmiare. { } → { ok }
    SPIEGAZIONE_ANTICIPATA_USATA: 'spiegazione_anticipata_usata',
    // WALLET_NOTICE_SEEN (#651): l'avviso di benvenuto («Sei entrato con un
    //   invito: hai N crediti») è stato mostrato da una superficie. Lo dicono
    //   la home e la pagina Crediti, ognuna per sé: chi l'ha già visto in
    //   home non se lo ritrova addosso a ogni apertura di Crediti, e
    //   viceversa. { where: 'home'|'credits' } → { ok }
    WALLET_NOTICE_SEEN: 'wallet_notice_seen',
    // WALLET_NOTICE_PENDING (#651): l'avviso di benvenuto che questa
    //   superficie non ha ancora mostrato. L'avviso si SPINGE appena il
    //   riscatto è andato, ma al primo avvio quella spinta parte mentre la
    //   home si sta ancora aprendo e non la sente nessuno: chi apre chiede
    //   anche se c'era qualcosa da dire. Si legge da quello che è scritto in
    //   locale, senza toccare il server. Con `claim` chi chiede lo prende, e
    //   alla domanda dopo non c'è più (#664: una home sola lo racconta).
    //   { where: 'home'|'credits', claim? } → { ok, notice: { kind, text } | null }
    WALLET_NOTICE_PENDING: 'wallet_notice_pending',
    // WALLET_INVITE_OPEN (#664): un collegamento d'invito portato dentro Filo
    //   da un gesto vero dell'utente in una pagina (clic, tasto destro). Si
    //   riscatta e si apre Crediti, come dal collegamento arrivato da fuori.
    //   Il preload delle pagine lo manda col valore letterale.
    //   { link } → { ok }
    WALLET_INVITE_OPEN: 'wallet_invite_open',
    // Riservati all'owner (auth.isAdmin()), col token dell'account Google.
    // WALLET_OWNER_OVERVIEW: { } → { ok, overview } (per utente: pseudonimo,
    //   saldo, consumo per giorno/azione, chi l'ha invitato; totale vs tetto).
    //   `overview.account` (#820) è il conto OpenRouter di Filo, che il server legge con la sua chiave di gestione
    //   (GET /api/v1/credits): { totalCreditsUsd, totalUsageUsd, readAt } (caricato e speso), o { error } se
    //   OpenRouter non ha risposto. Senza il campo la pagina dice che il conto non è letto.
    WALLET_OWNER_OVERVIEW: 'wallet_owner_overview',
    // WALLET_OWNER_ALARM_PENDING (#820): gli allarmi del conto OpenRouter da dire all'owner all'avvio, una volta
    //   finché la situazione resta quella. Chi non è owner non fa partire nessuna lettura. La risposta arriva quando
    //   gli avvisi della home nati dalla stessa lettura (#855) sono già fra le notifiche.
    //   { } → { ok, alarm: { title, text } | null }
    WALLET_OWNER_ALARM_PENDING: 'wallet_owner_alarm_pending',
    // WALLET_OWNER_GRANT: alza il tetto di un utente. { pseudonym, credits, why } → { ok, result }
    WALLET_OWNER_GRANT: 'wallet_owner_grant',
    // CONTATORI_INSTALLAZIONI (#969): quante copie di Filo hanno spedito i contatori giornalieri di ieri e del mese in
    //   corso, cioè gli pseudonimi distinti. Solo pagine di Filo e solo owner, col token dell'account Google.
    //   { } → { ok, installazioni: { ieri: { giorno, n, completo }, mese: { mese, n, completo } } }
    CONTATORI_INSTALLAZIONI: 'contatori_installazioni',
    // CONTATORI_USO (#969): la persona ha visto la risposta di una chiamata partita prima che la chiedesse (una
    //   spiegazione preparata alla selezione, la correzione di una parola già pronta): l'uso lo conta chi la mostra.
    //   `anticipata`: la risposta era stata preparata in anticipo, e questa è la sua apertura (#1461).
    //   { action, attesaMs, anticipata } → { ok }
    CONTATORI_USO: 'contatori_uso',
    // CONTATORI_EVENTO (#1461): un gesto contato dove la persona lo fa (un'azione misurata, un'icona, una ricerca in un
    //   pannello, una proposta del correttore, un annullo in pagina, una risposta chiesta, un avviso d'errore, una
    //   scelta dell'intervista). Solo nomi da elenchi chiusi e numeri; il main rifiuta il resto.
    //   { misura, ... } → { ok }
    CONTATORI_EVENTO: 'contatori_evento',
    // WALLET_OWNER_INVITES: genera codici d'invito dell'owner. { count } → { ok, codes }
    WALLET_OWNER_INVITES: 'wallet_owner_invites',
    // WALLET_OWNER_KNOBS_SET (#652): cambia le manopole dei crediti in
    //   config/credits (crediti a chi entra, quota del giorno, inviti, tetto,
    //   premi). Tocca SOLO i campi ricevuti, rifiuta i numeri storti PRIMA di
    //   scrivere e rilegge dal server. { patch } → { ok, knobs } | { ok:false, error }
    WALLET_OWNER_KNOBS_SET: 'wallet_owner_knobs_set',
    // WALLET_OWNER_USER_DETAIL (#652): la scheda di UNA persona — movimenti,
    //   suoi inviti con chi è entrato, ultime chiamate con modello, chi ha
    //   servito e costo. { pseudonym } → { ok, detail } (detail.found false se
    //   lo pseudonimo non esiste).
    WALLET_OWNER_USER_DETAIL: 'wallet_owner_user_detail',
    // Le due foto (pagina e barra) vanno solo alla pagina in vista, che inquadra sé stessa: services/fotoDellaPagina.js.
    CAPTURE_VISIBLE_TAB: 'capture_visible_tab', // { leggera? } → { ok, dataUrl? }; leggera: JPEG ai pixel che si vedono
    // "Salva immagine come…" dal menu contestuale. Instradato dal main
    // (session download + will-download) perché l'attributo `download` di un
    // <a> lato pagina è onorato da Chromium SOLO per URL same-origin/blob:/
    // data:: per un'immagine su un altro dominio (la stragrande maggioranza)
    // veniva ignorato e la scheda NAVIGAVA sull'immagine senza scaricare nulla
    // (#274). { url } → { ok, path?, filename? } | { ok:false, cancelled?, error? }
    // (la risposta arriva a download concluso/annullato).
    DOWNLOAD_IMAGE: 'download_image',
    // #711 — che cosa DICHIARA un'immagine sulla propria origine (credenziali
    // C2PA firmate, etichetta IPTC/XMP, parametri di generazione nei PNG).
    // Letto in locale, niente modelli; la sola rete è l'elenco ufficiale dei
    // firmatari, che il main rinfresca per conto suo. Aperto anche ai content
    // script: la risposta parla SOLO dei byte che la pagina ha appena mandato.
    // { dataUrl } → { ok, frase, forte, origine, prova, dichiarante, firmatario, avvisi }
    IMAGE_PROVENANCE: 'image_provenance',
    // #946 — i byte originali di un'immagine di un'altra origine (le foto stanno quasi
    // sempre su un CDN), che lo script di pagina non può leggere. Scaricati nel main
    // come «Salva immagine come…», con Referer e cookie della scheda. Restituisce solo immagini.
    // { url } → { ok, dataUrl } | { ok:false, error, tooBig?, notImage? }
    IMAGE_BYTES: 'image_bytes',
    // #1307 — se Filo non contatterebbe il sito di un link (sospetto, o in lista), senza contattarlo.
    // { url } → { bloccato?: 'blacklist'|'lists', host?, sospetto? } | {}
    LINK_FERMATO: 'link_fermato',
    // #946 — «Copia immagine» appena scritta negli appunti: gli appunti la ricodificano
    // e ne perdono le etichette, quindi il main ricorda l'esito letto sull'originale
    // per i pixel della copia, e la chat lo ritrova quando la si incolla.
    // { originale, copia } (data URL) → { ok, ricordata }
    IMAGE_COPIED: 'image_copied',
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
    // { url, diFilo, parole } → { ok } | { ok:false, error, frase }. `diFilo`: il collegamento l'ha scritto un modello
    // di Filo, e lo scaricamento passa dalla porta delle uscite (#810).
    DOWNLOAD_LINK: 'download_link',
    // Download nativi della navigazione, RISERVATI alle superfici interne: la cronologia espone
    // i percorsi assoluti e i comandi aprono file, quindi da http(s) l'handler dice 'forbidden'.
    DOWNLOADS_LIST: 'downloads_list',
    // Svuota la cronologia dei download CONCLUSI (gli attivi restano). → { ok, items }
    DOWNLOADS_CLEAR: 'downloads_clear',
    // Rimuove UNA voce dalla cronologia. { id } → { ok, items }
    DOWNLOAD_REMOVE: 'download_remove',
    // Apre il file scaricato col programma di sistema. Su un PROGRAMMA (#588)
    // risponde { ok:false, needsConfirm:true, text } finché non arriva
    // { id, confirmed:true }: aprirlo lo esegue, e chi lo fa deve saperlo.
    // { id, confirmed? } → { ok } | { ok:false, error }
    DOWNLOAD_OPEN_FILE: 'download_open_file',
    // #588 — risposta alla conferma di uno scaricamento in attesa (un programma
    // fermo fuori dalla cartella Download). { id, allow } → { ok, items }
    DOWNLOAD_CONFIRM: 'download_confirm',
    // Mostra il file nella cartella (evidenziato). { id } → { ok } | { ok:false, error }
    DOWNLOAD_OPEN_FOLDER: 'download_open_folder',
    // Comandi sul download in corso. { id } → { ok }
    DOWNLOAD_CANCEL: 'download_cancel',
    DOWNLOAD_PAUSE: 'download_pause',
    DOWNLOAD_RESUME: 'download_resume',
    // #950 — rimette il nome con cui lo scaricamento era arrivato. { id } → { ok, nome } | { ok:false, frase }
    DOWNLOAD_RIMETTI_NOME: 'download_rimetti_nome',
    // #950 — nome sensato a un file dell'utente. Toccano il disco e rispondono con percorsi assoluti: solo dalle
    // superfici di Filo (soloFilo), mai da un sito. Il percorso arriva intero, o come { downloadId }.
    // {} → { disponibile } (c'è un modello: la voce del menu compare solo allora)
    FILE_NOME_STATO: 'file_nome_stato',
    // { percorso | downloadId } → { ok, percorso, nome, base, ext, proposta } | { ok:false, errore, frase, nome, base, ext }
    FILE_NOME_PROPONI: 'file_nome_proponi',
    // { percorso | downloadId, nome } → { ok, da, a, nome, prima } | { ok:false, errore, frase }
    FILE_RINOMINA: 'file_rinomina',
    // { coppie: [{ attuale, prima }] } → { ok, esiti }
    FILE_RIMETTI_NOMI: 'file_rimetti_nomi',
    // #947 — il bottone di un file in chat: aprirlo col programma del sistema (solo documenti e immagini: un programma
    // aperto è un programma eseguito) e mostrarlo nella sua cartella. Toccano il sistema: solo da Filo (soloFilo).
    // { percorso } → { ok } | { ok:false, errore, frase }
    FILE_APRI: 'file_apri',
    FILE_MOSTRA_CARTELLA: 'file_mostra_cartella',
    // #947 — l'indice dei documenti per la pagina Preferenze: quanti documenti, quali cartelle, se sta leggendo; e la
    // finestra del sistema per scegliere una cartella da aggiungere. Percorsi assoluti: solo da Filo (soloFilo).
    // {} → { ok, documenti, conTesto, scansioni, senzaTesto, cartelle: [{ nome, percorso, esiste }], aggiornato, inCorso }
    DOCUMENTI_STATO: 'documenti_stato',
    // {} → { ok, percorso } | { ok:false } (annullata)
    DOCUMENTI_SCEGLI_CARTELLA: 'documenti_scegli_cartella',
    // #947.3 — toglie dall'indice una cartella cercata per l'occasione (Preferenze). Solo da Filo.
    // { percorso } → { ok, tolta, documenti }
    DOCUMENTI_DIMENTICA: 'documenti_dimentica',
    // #947.3 — l'Aiuto di una scheda cerca fra i documenti. APERTI AI SITI, perché l'Aiuto vive nella pagina: su un sito
    // la ricerca parte solo dopo il sì nella vista di Filo sopra la scheda (confermeSopraPagina), e alla pagina tornano
    // nomi, cartelle dette coi nomi di Filo e chiavi a caso, mai percorsi. Le chiavi valgono solo per la scheda che ha
    // cercato. Regole: patterns/una-conferma-su-un-sito-sta-fuori-dal-suo-documento.md
    // { cosa, cartella? } → { ok, cercato, candidati: [{ n, nome, dove, tipo, data, chiave }], indice, fermata } | { ok:false, annullata }
    AIUTO_CERCA_DOCUMENTI: 'aiuto_cerca_documenti',
    // {} → { ok }: ferma la lettura dei documenti nuovi; la ricerca risponde con quelli già letti.
    AIUTO_DOCUMENTI_FERMA: 'aiuto_documenti_ferma',
    // main → la pagina che cerca: { fatti, totali } mentre l'indice legge i documenti nuovi (niente nomi).
    AIUTO_DOCUMENTI_AVANZAMENTO: 'aiuto_documenti_avanzamento',
    // { chiave } → { ok } | { ok:false, frase }: apre il documento, lo mostra nella cartella, o ne avvia il trascinamento
    // vero (un file che la pagina riceve al rilascio, come da una cartella).
    AIUTO_APRI_FILE: 'aiuto_apri_file',
    AIUTO_MOSTRA_FILE: 'aiuto_mostra_file',
    AIUTO_TRASCINA_FILE: 'aiuto_trascina_file',
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
    // Voce o dettatura partirebbero col modello scelto? (#1141) { action, nickname } da chiunque (la scelta di
    // «Detta» vive nei siti); { action, provider, model } solo da filo://. → { verdict, hosts?, warning? }
    AUDIO_HOST_CHECK: 'audio_host_check',
    // Test di un modello del registry PREDEFINITO con le chiavi predefinite.
    // { nickname } → risolve nel registry predefinito (lista read-only Opzioni);
    // { provider, model } → testa la riga così com'è scritta, anche non ancora
    // salvata (editor admin, solo amministratori).
    TEST_DEFAULT_MODEL: 'test_default_model',
    // Catalogo modelli di un provider recuperato dal main con le chiavi
    // predefinite (solo admin). { provider } → { ok, items: [{ id, label }] }
    DEFAULT_MODELS_LIST: 'default_models_list',
    // Fornitori dello smistatore (solo admin): → { ok, items: [{ name, slug }] }
    DEFAULT_PROVIDERS_LIST: 'default_providers_list',

    OPEN_HOME: 'open_home',
    GO_HOME: 'go_home',                             // naviga la scheda corrente alla home (filo://newtab/)
    OPEN_HISTORY: 'open_history',
    OPEN_OPTIONS: 'open_options',
    OPEN_SPELLCHECK_PAGE: 'open_spellcheck_page',
    // #1447 — un passo di quello che il correttore impara, o del dizionario personale (src/main/services/correttoreImpara.js).
    // Dai content script dei siti, che sono quelli che vedono scrivere, solo i passi che imparano; gli altri da filo://.
    CORRETTORE_IMPARA: 'correttore_impara',
    CLOSE_TAB: 'close_tab',
    CLOSE_ALL_TABS: 'close_all_tabs',               // chiude tutte le tab → 1 newtab
    OPEN_URL: 'open_url',                           // { url }
    APRI_COMUNQUE: 'apri_comunque',                 // { url } — sito della lista dei siti bloccati: pagine filo://, o l'assistente per una sua apertura fermata (#590)
    APERTURA_FERMATA: 'apertura_fermata',           // main → assistente sulla pagina: { callId, host, reason, url } (#590)
    QUIT_APP: 'quit_app',
    // #1039 — «Riavvia e aggiorna»: chiude Filo e lancia l'installatore, quindi solo dalle superfici di Filo (soloFilo).
    AGGIORNAMENTO_INSTALLA: 'aggiornamento_installa', // → { ok } | { ok:false, frase }
    NAV_BACK: 'nav_back',
    NAV_FORWARD: 'nav_forward',
    NAV_RELOAD: 'nav_reload',
    NAV_STATE: 'nav_state',                         // → { ok, canBack, canFwd }
    // Barra laterale (#871): aperti anche ai content script dei siti, perché dicono e
    // spostano solo dove stanno le icone di Filo. La disposizione la scrive il main, uno solo.
    ICON_LAYOUT_GET: 'icon_layout_get',             // → { ok, layout }
    ICON_LAYOUT_DROP: 'icon_layout_drop',           // { id, target, beforeId } → { ok, layout }
    ICON_LAYOUT_CHANGED: 'icon_layout_changed',     // spinta → { layout }
    CORRETTORE_MEMORIE: 'correttore_memorie',       // spinta → { memorie: { sn_personal_dict?, sn_autocorrect?, rifiutate? } } (#1447)
    BARRA_TRASCINA: 'barra_trascina',               // { fase: inizio|sopra|posa|fine, id, x, y } → { ok, larghezza }
    BARRA_FUORI: 'barra_fuori',                     // spinta alla scheda davanti → { fase: muovi|rilascia|annulla, id, x, y }
    BARRA_ETICHETTE_CHIEDI: 'barra_etichette_chiedi', // spinta alla scheda davanti → { ids }: come si chiamano adesso le sue azioni nella barra
    BARRA_ETICHETTE: 'barra_etichette',             // dalla scheda davanti { voci: [{ id, etichetta, icona }] } → { ok }
    // Aperti ai siti (#1432): ci scrive il content script dell'Aiuto, e toccano solo la scheda che li manda.
    AIUTO_STATO: 'aiuto_stato',                     // { pannello: chiuso|ridotto|aperto, voce, spento: ''|aiuto|sito|pagina } → { ok }
    RISPOSTA_IN_ATTESA: 'risposta_in_attesa',       // { fonte: aiuto|app, attesa } → { ok }: la striscia della barra si accende
    // main → la sola scheda davanti (#1623): le immagini lasciate sulla fila delle schede o sulla barra laterale.
    // { dove: casa|aiuto, immagini: [{ dataUrl, nome, percorso }], file: [percorso], grandi }: la home prende le sue,
    // l'Aiuto le altre; `grandi` sono quelle oltre il tetto che non entrano.
    CHAT_ALLEGA: 'chat_allega',
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

    // §1.2 — colore IDENTITÀ del sito (theme-color → manifest → favicon →
    // fallback), calcolato una volta dal content script e cachato per dominio dal
    // main; la shell lo mescola col fondo della barra nelle tab INATTIVE.
    TAB_IDENTITY_COLOR: 'tab_identity_color',        // { color: 'rgb(r,g,b)' | null }

    // La scheda è sotto gli occhi di qualcuno (attiva, finestra né nascosta né
    // ridotta a icona)? In una WebContentsView `document.hidden` resta falso
    // anche in secondo piano, quindi chi legge dalla rete a intervalli lo
    // chiede qui. Il main lo spinge anche da sé, a ogni cambio, come broadcast
    // TAB_IN_VISTA (solo alle pagine filo://).
    TAB_IN_VISTA_GET: 'tab_in_vista_get',            // {} → { ok, inVista }
    TAB_IN_VISTA: 'tab_in_vista',                    // broadcast { inVista }
    // Una pagina filo:// ha caselle scritte e non ancora spedite (SN_CASELLE): chiudere la sua scheda aspetta che spedisca.
    CASELLE_IN_SOSPESO: 'caselle_in_sospeso',        // { inSospeso } → { ok }
    // Incolla di Filo: gli appunti li legge il main, la pagina non riceve il permesso (#586).
    APPUNTI_DI_FILO: 'appunti_di_filo',              // {} → { ok, testo, immagine (data URL png) }
    // Il menu del tasto destro nello strato sopra la scheda (#1054): il content script lo descrive, lo strato lo disegna.
    STRATO_MENU_APRI: 'strato_menu_apri',            // { id, menu: { items, keepOnScroll } } → { ok }
    STRATO_MENU_AGGIORNA: 'strato_menu_aggiorna',    // { id, cosa: riga|griglia|griglia-apri|correzione|inline, … }
    STRATO_MENU_CHIUDI: 'strato_menu_chiudi',        // { id }
    STRATO_MENU_ESEGUI: 'strato_menu_esegui',        // main → content script { id, n, args, chiude } | { id, inline, cammino }
    STRATO_MENU_INCOLLA: 'strato_menu_incolla',      // main → content script { id, testo, immagine } | { id, voce }
    STRATO_MENU_CHIUSO: 'strato_menu_chiuso',        // main → content script { id }
    // Le risposte ai permessi dei siti che restano fra un avvio e l'altro: la pagina Sicurezza le elenca e le toglie.
    PERMESSI_SITI_GET: 'permessi_siti_get',          // {} → { ok, scelte: [{ origine, parte, si, sotto, dominio }] }
    PERMESSI_SITI_TOGLI: 'permessi_siti_togli',      // { origine, parte } → { ok }
    PERMESSI_SITI_CAMBIATI: 'permessi_siti_cambiati', // main → pagine di Filo: la chat ha tolto una risposta ricordata

    // §2.1 — segnali di attività della tab riportati dal content script, per la
    // decisione di auto-archiviazione. Throttled. { lastInteractionAt?, scrollPct?, formDirty?, impronte? }
    TAB_ACTIVITY: 'tab_activity',
    // Main → ogni frame: «rimanda adesso se hai testo da inviare» (la pulizia sta
    // per decidere, #824). { impronte: del documento di prima } → TAB_ACTIVITY con formDirty.
    FORM_RECHECK: 'form_recheck',
    // Main → frame dello stesso sito: una richiesta della scheda ha portato fuori questo testo
    // (senza spazi, in più forme). Le righe dell'utente che ci stanno dentro sono partite. { testo }
    FORM_SENT: 'form_sent',

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
    SHOW_TOAST: 'show_toast',                      // { text, duration?, rimedio?, segnala? (testo già scritto per «Invia feedback») }
    // F4 — l'avviso della segnalazione automatica (#784.6): la segnalazione aspetta che si chiuda. «Annulla» la ferma
    // (partita, la ritira solo l'owner; `frase` dice perché no); chiuso senza Annulla, parte. Solo dalle superfici di
    // Filo e solo per un `id` che questo Filo ha messo nell'avviso (#784.3). { id } → { ok, frase? }
    CANCEL_AUTO_FEEDBACK: 'cancel_auto_feedback', // { id }
    AUTO_FEEDBACK_PARTI: 'auto_feedback_parti',   // { id }
    // Entra/esce dalla "modalità annotazione" del box feedback: il box vive in
    // un content script sulla pagina (WebContentsView) e da lì non può oscurare
    // la barra in alto di Filo (renderizzata dalla shell). Questo messaggio fa
    // da ponte: il main lo inoltra alla shell, che mostra/nasconde un velo
    // d'ombra sopra la sua barra così TUTTO Filo entra in penombra. → { ok }
    FEEDBACK_ANNOTATE: 'feedback_annotate',       // { on: boolean }
    // La barra in alto vive nella shell e ha una sua tela: i due disegni vanno sincronizzati.
    // CLEAR_DRAW cancella anche i tratti sulla barra; DRAW_STATE dice al box che lì c'è disegno.
    FEEDBACK_CLEAR_DRAW: 'feedback_clear_draw',   // { } → { ok }
    FEEDBACK_DRAW_STATE: 'feedback_draw_state',   // broadcast → { topbar: bool }
    CAPTURE_FEEDBACK_TOPBAR: 'capture_feedback_topbar', // → { ok, dataUrl?, barHeight? }
    // Triage admin di un feedback (cambio stato/note/priorità). Instradato dal
    // main, che allega il Firebase ID token come Bearer e RIFIUTA se l'utente
    // loggato non è admin. → { ok } | { ok:false, error }
    FEEDBACK_UPDATE: 'feedback_update',           // { id, status?, notes?, userNote?, priority?, archiveOverride?, localOnly?: bool, localApproval?: true, waitsFor?: '#12, #13' ('' le toglie), waitsTieni?: [id] (già scritte, tenute come sono) }
    // #583 — LETTURA dei feedback per le superfici dell'owner. La collezione
    // non è più pubblica: leggono solo l'admin e il server. L'ID token vive nel
    // main e non deve arrivare in una pagina, quindi la pagina CHIEDE la
    // lettura e il main la esegue col token. Solo origini filo://, solo admin.
    // La risposta unisce a ogni feedback i voti e le riaperture della scheda
    // pubblica, che è dove quei due campi vengono scritti oggi.
    //   { op: 'list', pageSize?, fields?, timeoutMs? }  → { ok, rows }
    //   { op: 'getMany', ids: [...], timeoutMs? }       → { ok, rows }
    //   { op: 'listAll', timeoutMs? }                   → { ok, rows, complete }
    //   → { ok:false, error } se non sei admin o la lettura fallisce.
    // `list` è una FINESTRA sui più recenti; `listAll` è l'INSIEME, paginato
    // col cursore dal main (una pagina non può: le credenziali stanno di là).
    // Lo chiede la scheda delle statistiche (#496), che fa domande sul totale,
    // e `complete: false` dice che il freno sulle pagine è scattato — un
    // troncamento che non si dichiara passa per un totale.
    FEEDBACK_FETCH: 'feedback_fetch',
    // #676 — il giro dei cambiati della Gestione: uno nel main per tutte le
    // pagine, e gira solo quando una Gestione IN VISTA lo chiede. Solo filo://, solo admin.
    //   { watch?:[id], giro?:bool, force?:bool, off?:bool }
    //     → { ok, subscribed, scartati?, giro?: esito }
    FEEDBACK_LIVE_SUBSCRIBE: 'feedback_live_subscribe',
    // L'esito di un giro alle ALTRE pagine iscritte:
    //   { kind:'changed', rows } | { kind:'reconcile', versions, complete }, + avvisi?
    FEEDBACK_LIVE_CHANGED: 'feedback_live_changed',
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
    // Il classificatore della ricerca fra i feedback (#1118), riservato a chi li gestisce. Il giro gira nel main:
    // { op:'start', query, candidates:[{id,title,text}] } → { ok, jobId, total } | { ok:false, code, error };
    // { op:'status', jobId } → { ok, done, total, hits:[{id,p}], finished, skipped, error, code };
    // { op:'stop', jobId } → { ok }.
    MANAGE_SEARCH_CLASSIFY: 'manage_search_classify',
    // Ri-valutazione owner dei feedback "non filtrati" (panel parziale): la
    // dashboard passa gli id dei feedback bianchi; il backend ri-esegue SOLO i
    // giudici mancanti e riscrive il pipeline. Owner-only.
    FEEDBACK_REEVALUATE: 'feedback_reevaluate',    // { feedbackIds:[...] } → { ok, reevaluated, results } | { ok:false, error }
    // Impostazioni della tab Automazioni. Owner-only. Due interruttori distinti:
    //   `enabled` (doc config/automation) → chi entra in coda da solo (filo-security
    //     DESIGN §2);
    //   `routinesEnabled` (doc config/routines) → se le routine autonome lavorano.
    // Insieme viaggiano `autoApprove` e `lavoriServer`.
    AUTOMATION_GET: 'automation_get',              // → { ok, enabled, autoApprove, routinesEnabled, lavoriServer } | { ok:false, error }
    AUTOMATION_SET: 'automation_set',              // { enabled?, autoApprove?, routinesEnabled?, lavoriServer? } → { ok, … } | { ok:false, error }
    // I bilanci dei giri di correzione, uno per livello (doc config/routines,
    // campi `cap3`, `cap2`, `cap1`, `cap0` — feedback #561) e il testo della
    // fase 2 (`fixInstructions`, vuoto = quello del server):
    //   cap3  giri per i rilievi di livello 3 (a bilancio finito la pratica si
    //         ferma e chiama l'owner);
    //   cap2  giri per i rilievi di livello 2 (a bilancio finito escono come
    //         feedback a priorità 2, il lavoro non si ferma);
    //   cap1  giri per i rilievi di livello 1 (a bilancio finito vanno nel
    //         feedback derivato);
    //   cap0  giri per i soli rilievi di livello 0.
    // Li applica il SERVER quando registra la critica. Owner-only.
    AUTOMATION_CAPS_GET: 'automation_caps_get',    // → { ok, cap3, cap2, cap1, cap0, fixInstructions, giroStretto } | { ok:false, error }
    AUTOMATION_CAPS_SET: 'automation_caps_set',    // { cap3?, cap2?, cap1?, cap0?, fixInstructions?, giroStretto? } → come GET | { ok:false, error }
    // Come partono le sessioni delle routine (doc config/routines):
    //   maxSessions      quante sessioni lavorano insieme (intero 1–20;
    //                    campo assente = 1);
    //   priorityAccount  da quale account si parte sempre finché regge:
    //                    'A', 'B', oppure '' = si alternano (campo assente);
    //   accountAOff / accountBOff  account escluso: da lì non parte nessuna
    //                    sessione nuova (campo assente = in uso).
    // Le legge il SERVER quando accende le sessioni. Owner-only.
    AUTOMATION_SESSIONS_GET: 'automation_sessions_get', // → { ok, maxSessions, priorityAccount, accountAOff, accountBOff } | { ok:false, error }
    AUTOMATION_SESSIONS_SET: 'automation_sessions_set', // { maxSessions?, priorityAccount?, accountAOff?, accountBOff? } → come sopra | { ok:false, error }
    // I numeri dell'owner sui crediti delle routine (ownerCrediti sul server, regole in src/shared/routineCrediti.js):
    // riserva di A, tetto di B, taratura, rinnovi; `null` toglie un numero. Lo stato dice per account percentuale,
    // limite, passo del giorno e rinnovo. Owner-only.
    // `freni`: 'attivi', o 'numeri_assenti' (senza riserva di A né tetto di B i crediti non frenano niente).
    ROUTINE_CREDITI_GET: 'routine_crediti_get', // → { ok, numeri, accounts: { A, B }, freni } | { ok:false, error }
    ROUTINE_CREDITI_SET: 'routine_crediti_set', // { riservaA?, tettoB?, usdPer100?, rinnovoA?, rinnovoB? } → { ok, numeri, accounts?, freni? } | { ok:false, error }
    // Le pause in corso di A, B e della routine server, col motivo del rifiuto (#996): sola lettura, dal server
    // (routineLog op:'pause'). Owner-only, solo pagine di Filo.
    AUTOMATION_PAUSE_GET: 'automation_pause_get', // → { ok, pause: { A?, B?, serverA?, serverB? }, oraMs } | { ok:false, error }
    // Modello e sforzo del worker per fase (doc config/routines, campo
    // `roleModels` = { ruolo: { model?, effort? } }; regole in
    // src/shared/routineModelli.js). Una scrittura tocca UNA foglia; valore
    // vuoto = vale la definizione dell'agente. Le legge il SERVER quando
    // consegna un biglietto. Owner-only.
    AUTOMATION_ROLE_MODELS_GET: 'automation_role_models_get', // → { ok, roleModels } | { ok:false, error }
    AUTOMATION_ROLE_MODELS_SET: 'automation_role_models_set', // { ruolo, campo, valore } → { ok, letto, scritto, roleModels? } | { ok:false, error }
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
    ROUTINE_LOG_GET: 'routine_log_get',            // → { ok, rejections:[…], comparisons:[…], proveFusione:{ righe, riepilogo }|null } | { ok:false, error }
    // Fusioni bloccate dai controlli di sicurezza del server, in attesa
    // dell'owner (SPEC-RIDISEGNO-MAX.md §10): il server apre una richiesta che
    // aspetta il suo sì in Gestione (un lavoro locale provato non la apre: #908).
    // Vivono in una collezione che nessun client può leggere: si passa dalla
    // callable owner-only del backend di sicurezza.
    //
    // ORIGINE: solo pagine `filo://`. Un sito visitato non deve poter né sapere
    // che c'è una fusione in attesa (dice cosa sta facendo l'owner) né tentare
    // di approvarla o scartarla.
    MERGE_APPROVALS_GET: 'merge_approvals_get',        // → { ok, pending:[…], failed:[…], recent:[…], ttlMs } | { ok:false, error }
    MERGE_APPROVAL_APPROVE: 'merge_approval_approve', // { id } → { ok, result:'merged'|'conflict'|'stale', … } | { ok:false, error }
    MERGE_APPROVAL_DISCARD: 'merge_approval_discard',  // { id } → { ok, result:'discarded' } | { ok:false, error }
    // L'owner ha letto la bocciatura dell'audit di sicurezza (L4) e decide di
    // andare avanti lo stesso. Non è un via libera cieco: il cancello di
    // fusione (L5) resta, e parte subito dopo — l'esito dice se il ramo è
    // entrato in main o se si è aperta una richiesta da approvare.
    // Stessa origine e stesso cancello delle approvazioni di fusione: solo
    // pagine `filo://`, solo il proprietario.
    LIVELLO4_SALTA: 'livello4_salta',  // { feedbackId } → { ok, esito:'fuso'|'bloccato'|'conflitto'|'ramo_assente'|'attesa_server'|'server_al_pc'|'rimandato'|'all_owner', requestId? } | { ok:false, error }
    // Il segno di mittente pericoloso di chi ha mandato quel feedback (#922), dalla callable ownerSenderFlag.
    // `clear` toglie il segno solo con la frase della conferma, che la pagina manda dopo il sì dell'owner.
    // Solo pagine `filo://`, solo il proprietario.
    FEEDBACK_SENDER_FLAG: 'feedback_sender_flag', // { feedbackId, action:'read'|'clear', conferma? } → { ok, flagged, reason, flaggedAt, clearedAt } | { ok:false, error }
    // Le domande all'owner (#1149, SPEC-DOMANDE.md §3), dalla callable ownerDomande: le azioni le applica il server,
    // che decide anche chi ha scritto ogni turno. Solo pagine `filo://`, solo il proprietario.
    DOMANDE_ELENCO: 'domande_elenco',       // { dopo?:<ms>, tutte?:bool } → { ok, domande:[…], riferimenti:{}, adesso } | { ok:false, error }
    DOMANDA_MOSTRA: 'domanda_mostra',       // { id:'D-n' } → { ok, domanda, riferimenti } | { ok:false, error }
    DOMANDA_RISPONDI: 'domanda_rispondi',   // { id, scelta?:<indice>, testo? } → { ok, domanda, esito } | { ok:false, error }
    DOMANDE_CONSIGLIO: 'domande_consiglio', // { ids:['D-n'…] } → { ok, esiti:[{ id, ok, etichetta?, errore? }] } | { ok:false, error }
    DOMANDA_ARCHIVIA: 'domanda_archivia',   // { id } → { ok, domanda } (chiusa senza azioni) | { ok:false, error }
    DOMANDA_RIAPRI: 'domanda_riapri',       // { id } → { ok, domanda } (solo un'archiviata senza azioni) | { ok:false, error }
    // «Segna fidato» (#1148, SPEC-DOMANDE.md §1.5): la fiducia la scrive solo il server (callable ownerFiducia).
    // Solo pagine `filo://`, solo il proprietario. Callable non ancora pubblicata → errore che lo dice.
    FIDUCIA_SEGNA: 'fiducia_segna', // { feedbackId, fidato?: false per toglierla } → { ok, fiducia } | { ok:false, error }
    // BROADCAST (main → pagine): l'elenco è cambiato, eccolo. Non è un
    // handler: nessuno lo "chiama", lo manda il main quando `npm run finish`
    // suona il campanello (services/mergeApprovalSignal.js) o quando l'owner
    // rientra nella finestra. Serve perché una pagina di gestione GIÀ APERTA se
    // ne accorga: prima l'elenco si leggeva solo all'apertura, e l'avviso di cui
    // parla il terminale non compariva mai sotto gli occhi di chi lo stava
    // aspettando. Porta il dato con sé (una lettura sola per tutte le pagine
    // aperte, invece di una per pagina) e va SOLO alle pagine filo://: dentro
    // ci sono nomi di rami e percorsi di file.
    MERGE_APPROVALS_CHANGED: 'merge_approvals_changed', // { pending:[…], failed:[…], recent:[…], ttlMs }
    WEB_SEARCH: 'web_search',                      // { query } → { ok, results: [{title,url,snippet}], provider }

    // === Rilevamento siti pericolosi (src/main/services/safebrowse/) ===
    // Il content script manda la URL corrente e gli indizi (campo password/pagamento); il main mostra l'avviso in una
    // vista sopra la scheda, i cui pulsanti non passano da questo canale, che i siti raggiungono (#813.5).
    // → { ok, level:'safe'|'sospetto'|'pericoloso', message:{title,body}|null, registrable }
    SAFEBROWSE_GET: 'safebrowse_get',              // { url, hasPassword?, hasPayment?, insecureForm? }
    // #965 — i link che la pagina mostra, ai soli controlli locali: il verdetto resta nel main, per il clic. Aperto ai
    // siti di proposito (lo manda il content script della pagina); la pagina non ne riceve i verdetti, solo il conto.
    // Oltre LOTTO_MAX link → { ok:false, error:'troppi', max }; un esame già in coda → { ok:false, error:'occupato' }.
    SAFEBROWSE_LINKS: 'safebrowse_links',          // { urls: string[] } → { ok, esaminati }
    // #1004 — la pagina, o un suo riquadro (il modulo di pagamento di un altro sito), mostra un campo password o carta:
    // il sito della scheda diventa delicato. Il sito lo dà il main, dalla scheda.
    CAMPI_DELICATI: 'campi_delicati', // { hasPassword, hasPayment } (campi a schermo) → { ok }
    // Solo pagine filo:// (Sicurezza): i siti segnati per un campo password o carta, e quelli che l'utente ne ha tolto.
    PAGINE_DELICATE_CAMPI: 'pagine_delicate_campi', // {} → { ok, siti: [{ sito, tolto }] }
    // La pagina principale di una scheda ha una password scritta dall'utente (#758): una scrittura verso il sito che
    // segue è l'invio di un accesso, e il sito entra fra quelli dove sei entrato.
    ACCESSO_CREDENZIALI: 'accesso_credenziali',    // {} → { ok }
    // La home aperta dal tasto destro sull'avviso chiede cosa le ha lasciato il main: la domanda a Filo sul sito o la
    // segnalazione del falso allarme, una volta sola. Solo pagine filo://. → { ok, richiesta: { tipo, testo } | null }
    CASA_RICHIESTA: 'casa_richiesta',

    // Geo-block, proposta inline: un contenuto bloccato in Italia su un tab con login attivo non
    // si riprova in silenzio, si propone — «In questa tab non sarai loggato», con Apri/No.
    GEO_PROPOSE: 'geo_propose',                     // → { url, country, countryLabel }
    // Cosa fanno le due risposte alla proposta: regola in src/main/tabs/tabGeoBlock.js.
    GEO_PROPOSE_ACCEPT: 'geo_propose_accept',       // { url, country } → { ok, country }
    GEO_PROPOSE_DISMISS: 'geo_propose_dismiss',     // { url } → { ok }

    // === Gestione cookie / consenso (src/content/cookies.js) ===
    // { url, frame: 'top'|'sub' } → { mode, off (su questo sito l'utente vuole i banner), index (rilevatori
    // Consent-O-Matic), cosmetic (solo 'top': regole EasyList Cookie del sito), seen ('hidden' se sul sito
    // Filo ha già nascosto un banner senza «rifiuta») }.
    COOKIES_CONFIG: 'cookies_config',
    // Broadcast main→content quando la modalità o i siti coi banner cambiano: il content rilegge la config.
    COOKIES_CONFIG_UPDATE: 'cookies_config_update', // → { mode }
    // Aperti alle pagine web di proposito: li chiede il content script di ogni sito, e non portano dati
    // dell'utente. La regola Consent-O-Matic è pubblica; l'esito vale solo per la scheda di chi lo manda.
    COOKIES_RULE: 'cookies_rule',                   // { name } → { ok, rule }
    COOKIES_OUTCOME: 'cookies_outcome',             // { outcome: 'rejected'|'hidden'|'unconfirmed'|'answer', cookies?, storage? } → { ok }
    COOKIES_BANNER_TOKENS: 'cookies_banner_tokens', // { ids, classes } → { ok, selectors } (quelli della lista)
    // Da qualunque frame della scheda: l'utente ha mandato una password scritta da lui. Decide il main se l'accesso è
    // riuscito e se proporre «Resta connesso» (tabs/tabRestaConnesso.js); vale per il sito della scheda.
    COOKIES_ACCESSO: 'cookies_accesso',             // {} → { ok }
    // Un riquadro con un banner che non ha «rifiuta» lo dice al main, che passa alla pagina l'indirizzo del riquadro
    // suo figlio da nascondere: fra frame si passa dal main, una postMessage la saprebbe scrivere anche il sito.
    COOKIES_FRAME_BANNER: 'cookies_frame_banner',   // (riquadro) {} → { ok }
    COOKIES_HIDE_FRAME: 'cookies_hide_frame',       // main → pagina { url, origin }
    // #760 — riquadro di terzi rotto dai cookie che Filo rifiuta. Il riquadro dice cosa mostra; il servizio e la
    // pagina li ricava il main dal mittente, mai dal messaggio. La proposta la disegna la pagina, la risposta la
    // valida il main sul gettone che ha dato lui.
    RIQUADRO_COOKIE_SEGNALA: 'riquadro_cookie_segnala', // (riquadro) { testo, parole, media, password, larghezza, altezza } → { ok }
    RIQUADRO_COOKIE_STATO: 'riquadro_cookie_stato',     // (riquadro) {} → { ok, nome, consentito, proponibile }
    RIQUADRO_COOKIE_CAMBIA: 'riquadro_cookie_cambia',   // (riquadro, tasto destro) { attiva } → { ok }
    RIQUADRO_COOKIE_PROPONI: 'riquadro_cookie_proponi', // main → pagina { token, nome, url, origin }
    RIQUADRO_COOKIE_RITIRA: 'riquadro_cookie_ritira',   // main → pagina { token }
    RIQUADRO_COOKIE_AGGIORNA: 'riquadro_cookie_aggiorna', // main → riquadri: l'elenco o la modalità sono cambiati
    RIQUADRO_COOKIE_RISPOSTA: 'riquadro_cookie_risposta', // (pagina) { token, si } → { ok }
    // Solo pagine filo:// (Sicurezza): cosa Filo ha fatto coi banner, sito per sito, nel profilo della finestra.
    COOKIES_SITES: 'cookies_sites',                 // {} → { ok, sites: [{ site, rejected, hidden, at }] }
    // Solo pagine filo:// (Sicurezza): «Apri da un altro paese» ha un fornitore? E con quale host.
    PROXY_STATUS: 'proxy_status',                   // {} → { ok, configured, providerHost }

    // === Pubblicità dei video da saltare (#737, src/content/adSkip.js) ===
    // Aperti alle pagine web di proposito: li chiede il content script di ogni frame, e non portano dati dell'utente.
    // `clicVero` dice se questo frame può chiedere il clic vero: il frame principale di una scheda su YouTube, o il
    // lettore di YouTube incorporato (lì il clic parte quando ogni frame sopra di lui ha confermato il punto).
    AD_SKIP_CONFIG: 'ad_skip_config',               // {} → { ok, enabled, clicVero }
    // Il «Salta» premuto dal main con un clic vero nel punto dato (px CSS del frame); il main ricontrolla
    // interruttore, frame e sito, e ne dà uno ogni 800 ms per scheda. Dal lettore incorporato porta anche il suo tag.
    AD_SKIP_CLICK: 'ad_skip_click',                 // { x, y, tag? } → { ok, code? }
    // Main→un solo frame sopra il lettore: dove cade nella tua vista il punto (x, y) del riquadro figlio con quel tag
    // e quell'origine? Il content script risponde con AD_SKIP_HERE.
    AD_SKIP_WHERE: 'ad_skip_where',                 // { id, tag, origine, x, y }
    AD_SKIP_HERE: 'ad_skip_here',                   // { id, x, y, tag } | { id, code } → { ok }
    // Broadcast main→content quando l'interruttore cambia: il content rilegge la config.
    AD_SKIP_CONFIG_UPDATE: 'ad_skip_config_update',

    // === L'email dell'account proposta nei campi di accesso (#1124, src/content/propostaEmail.js) ===
    // Aperto ai siti di proposito: lo manda il content script del frame dove l'utente è entrato in un campo email o
    // nome utente. Porta il campo (misure in px CSS della scheda, valore) e non riceve mai l'email: la proposta la
    // disegna il main in una vista sopra la scheda (src/main/propostaEmail.js). `segui:false` = qui non si propone.
    // Dentro un riquadro di un'altra origine `ancora` è il segno mandato al documento sopra, che risponde con 'riquadro'.
    PROPOSTA_EMAIL: 'proposta_email',               // { fase:'campo', campo, motivo, x, y, w, h, valore, digitato, ancora } | { fase:'via', campo } | { fase:'riquadro', ancora, x, y, s, su } → { ok, segui }
    // Main→il solo frame del campo, dopo la scelta dell'utente (clic o Invio sulla proposta): l'unico momento in cui
    // l'email arriva alla pagina.
    PROPOSTA_EMAIL_RIEMPI: 'proposta_email_riempi', // { campo, email }

    // === Il menu che un sito si disegna da sé (#975, src/preload/menu-del-sito.js) ===
    // Aperti ai siti di proposito: li manda il content script dal menu di Filo, e il sito lo ricava il main dal
    // frame che parla, mai dal messaggio. Da una superficie di Filo (Preferenze, l'avviso della proposta) `sito`
    // dice quale.
    MENU_DEL_SITO_SCELTO: 'menu_del_sito_scelto',   // (sito) {} → { ok, proposto }: «Menu di <sito>» ha aperto il suo menu
    MENU_DEL_SITO_IMPOSTA: 'menu_del_sito_imposta', // { attivo, sito? (solo da Filo), avvisa? } → { ok, sito, siti }
    // Filo spento o riacceso su un sito dal tasto destro (#843): da un sito vale per la sua scheda, che ricava il main.
    FILO_SPENTO_IMPOSTA: 'filo_spento_imposta', // { spento, siti? (solo da Filo), avvisa? } → { ok, sito, siti, cambiati }

    // === Account "Accedi con Google" (vedi src/main/auth/) ===
    // Login/logout/stato. Tutto vive nel main process: i token non sono mai
    // esposti alle pagine. La risposta porta solo il profilo pubblico.
    AUTH_SIGNIN: 'auth_signin',                    // → { ok, profile, isAdmin, remembered }; a un sito solo { ok, signedIn, isAdmin } | { ok: false, code, error: frase per l'utente }
    AUTH_SIGNOUT: 'auth_signout',                  // → { ok }
    AUTH_STATUS: 'auth_status',                    // { senzaRete? } → { ok, signedIn, isAdmin, profile|null, uid (non con senzaRete), remembered, googleNelleSchede }; a un sito solo { ok, signedIn, isAdmin }
    AUTH_COLLEGA_GOOGLE: 'auth_collega_google',    // solo da Filo: apre l'accesso web a Google in una scheda (#1123) → { ok } | { ok: false, error }
    AUTH_CHANGED: 'auth_changed',                  // broadcast alle sole pagine di Filo → { signedIn, isAdmin, profile|null, remembered }

    // Clipboard history (per il menu "Incolla"). Chi legge e chi scrive da un sito: services/appuntiDaiSiti.js. L'elenco
    // lo dà solo GET; le scritture rispondono { ok } e basta.
    GET_CLIPBOARD_HISTORY: 'get_clipboard_history',
    PUSH_CLIPBOARD_ENTRY: 'push_clipboard_entry',     // { entry }
    COPY_TEXT_TO_CLIPBOARD: 'copy_text_to_clipboard', // { text } → { ok }: appunti di sistema e cronologia, dal «Copia» delle risposte (#846); cancello di PUSH
    UPDATE_CLIPBOARD_DESCRIPTION: 'update_clipboard_description', // { dataUrl, description }
    REMOVE_CLIPBOARD_ENTRY: 'remove_clipboard_entry', // { entry }
    CLEAR_CLIPBOARD_HISTORY: 'clear_clipboard_history',
    // Broadcast alle sole pagine filo:// quando la cronologia appunti cambia
    // (copia nuova, voce tolta, svuotamento, descrizione di un'immagine
    // arrivata). Non porta le voci con sé: chi lo riceve rilegge la cronologia
    // con GET_CLIPBOARD_HISTORY. Così una scheda ferma sulla pagina della
    // sicurezza non mostra più una lista vecchia, e nessun elenco di ciò che
    // l'utente ha copiato viaggia verso schede che non l'hanno chiesto.
    CLIPBOARD_HISTORY_UPDATED: 'clipboard_history_updated',

    GET_CATEGORIES: 'get_categories',
    RENAME_CATEGORY: 'rename_category',         // { id, name, unisci? } — unisci:false non fonde con un'omonima
    DELETE_CATEGORY: 'delete_category',         // { id }
    MERGE_CATEGORIES: 'merge_categories',       // { fromId, toId }
    MOVE_PAGE_CATEGORY: 'move_page_category',   // { pageId, categoryId } o { pageId, nome } per una categoria nuova

    // === Filo dashboard ===
    // Filo Chat: invio messaggio utente all'agente conversazionale
    // { userMessage, threadHistory: [{role, text, actions?}] }
    // Risposta: { ok, text, actions: [...], model, costEur }
    // Solo dalle pagine di Filo: la risposta porta quello che Filo ha letto (pagine, documenti, comandi).
    FILO_CHAT: 'filo_chat',
    // Ferma il turno di chat in corso (#578): { reqId } è il `reasoningReqId` del turno. Solo pagine di Filo, e solo
    // la scheda che l'ha avviato. Le azioni già partite finiscono, nessuna nuova parte. → { ok, fermato }
    FILO_CHAT_STOP: 'filo_chat_stop',
    // Un seguito scritto mentre il turno lavora (#1296): { reqId, id, testo } lo affida al turno, che lo legge al passo
    // dopo → { ok, accolto }; { reqId, id, togli: true } lo ritira se il modello non l'ha ancora letto → { ok, tolto, letto }.
    // Solo pagine di Filo, solo la scheda del turno.
    FILO_CHAT_SEGUITO: 'filo_chat_seguito',
    // Filo State: assembla stato programmatico (tab aperte, tempo, processi).
    // Risposta: { ok, state: {...}, stateText: "..." }
    FILO_GET_STATE: 'filo_get_state',
    // Batteria, rete (col nome del Wi-Fi) e Bluetooth (coi nomi dei dispositivi): dati del computer, solo alle
    // pagine di Filo. La richiesta tiene sveglio il lettore per 90 s: la home la ripete mentre è in vista.
    // → { ok, stato: { batteria, rete, bluetooth, letto } | null }
    SISTEMA_STATO: 'sistema_stato',
    // main → pagine filo:// quando una lettura cambia. { stato }
    SISTEMA_AGGIORNATO: 'sistema_aggiornato',
    // Volume, Bluetooth e Wi-Fi a comando (#874), solo dalle pagine di Filo: aziona il sistema operativo, e a un sito
    // non si dà. La stessa porta dell'azione della chat. { richiesta: { cosa: 'volume'|'bluetooth'|'wifi', … } }
    // → { ok, cosa, … } oppure { ok: false, errore, frase, dove?, apri? }
    SISTEMA_COMANDA: 'sistema_comanda',
    // Apre la pagina delle impostazioni del sistema dove si concede un permesso mancante. { chiave } (una di
    // IMPOSTAZIONI in src/main/services/comandiSistema.js: l'indirizzo non arriva mai da chi chiede) → { ok }
    SISTEMA_APRI_IMPOSTAZIONI: 'sistema_apri_impostazioni',
    // Genera dashboard (messaggio centro + suggerimenti). Usa cache con cooldown.
    // { force?: boolean }
    // Risposta: { ok, message, suggestions, cached, ts }
    FILO_GENERATE_DASHBOARD: 'filo_generate_dashboard',
    // === Archivio delle chat con Filo (#525) ===
    // Ogni chat si salva per intero, turno per turno, mentre la si fa (il
    // salvataggio lo fa il main dentro FILO_CHAT, che riceve `chatId`). Questi
    // messaggi servono a CONSULTARLO: la pagina Cronologia e l'agente stesso.
    // Sono conversazioni private dell'utente: rispondono solo alle pagine
    // filo://, mai ai content script dei siti.
    // Elenco senza i messaggi (titolo, date, tipo, estratto). Risposta: { ok, chats }
    FILO_CHATS_LIST: 'filo_chats_list',
    // Una chat INTERA, per riaprirla e continuare a scrivere. { id } → { ok, chat }
    FILO_CHAT_GET: 'filo_chat_get',
    // Chiusura di una chat (ritorno alla home, chat nuova, chiusura dell'app):
    // fissa la data di chiusura e fa partire la classificazione (titolo +
    // conversazione/comando). `fine`: chiusa apposta dall'utente, una scheda nuova non la continua. { id, fine? } → { ok }
    FILO_CHAT_CLOSE: 'filo_chat_close',
    // Cancellazione manuale di una chat, dopo la conferma. { id } → { ok, chats }
    FILO_CHAT_DELETE: 'filo_chat_delete',
    // #1295 — nascondere una chat (si disfa) o rimetterla nel filo. { id, nascosta: bool } → { ok }
    FILO_CHAT_NASCONDI: 'filo_chat_nascondi',
    // Ricerca per testo dentro tutte le chat. { query, kind?, limit? }
    // Risposta: { ok, chats } (voci d'elenco, con il frammento che combacia).
    FILO_CHATS_SEARCH: 'filo_chats_search',
    // ANNUNCIO (dal main a tutte le schede): l'elenco delle chat è cambiato —
    // una si è chiusa e ha preso titolo e tipo, oppure è stata cancellata.
    // La Cronologia aperta si riallinea invece di restare ferma a com'era
    // quando l'hanno aperta. Con `cancellata: <id>` dice anche QUALE è stata
    // cancellata: la scheda che quella conversazione la sta ancora vivendo
    // smette di scriverci dentro, invece di farla rinascere al messaggio dopo.
    // `nascosta: <id>` e `rimessa: <id>` (#1295): la home la toglie dalla vista o la rimette al suo posto.
    FILO_CHATS_UPDATED: 'filo_chats_updated',
    // #866 — le pagine visitate che il filo ricorda, dalla pagina Sicurezza. Solo pagine filo://: è la cronologia
    // dell'utente. { periodo: 'ultima_ora'|'oggi'|'tutto' } → { ok, n } (quante sono / quante ne ha tolte).
    FILO_PAGINE_CONTA: 'filo_pagine_conta',
    FILO_PAGINE_CANCELLA: 'filo_pagine_cancella',
    // #974 — le conversazioni dell'Editor, dei Mazzi e dell'Aiuto entrano nel filo come righe ripiegate.
    // Un messaggio appena mostrato nella chat di un'app: { app, rif, soggetto, dove?, messaggi: [{ role, text }] }.
    // Anche dai siti, ma solo l'Aiuto: lì app, soggetto (il sito) e `dove` li decide il main dall'indirizzo di chi manda.
    FILO_CONVERSAZIONE_APP: 'filo_conversazione_app',
    // L'app ha cancellato la sua conversazione: via anche dal filo. { app, rif } o { app, prefisso }. Solo filo://.
    FILO_CONVERSAZIONE_APP_DIMENTICA: 'filo_conversazione_app_dimentica',
    // Il documento dell'app ha cambiato nome: le sue righe lo seguono. { app, rif | prefisso, soggetto }. Solo filo://.
    FILO_CONVERSAZIONE_APP_RINOMINA: 'filo_conversazione_app_rinomina',
    // Le righe che la home mostra: { chat? } → { ok, righe }. Solo filo://.
    FILO_RIGHE_APP: 'filo_righe_app',
    // ANNUNCIO (main → pagine di Filo, senza dati): le righe sono cambiate, chi le mostra le richiede.
    FILO_RIGHE_APP_CAMBIATE: 'filo_righe_app_cambiate',
    // #869 — la home è la coda del filo. Solo filo://: è la cronologia dell'utente.
    // { prima?, fino?, dopo?, quanti? } → { ok, elementi, inizio, ultimo, chatCorrente? } (src/shared/filoCoda.js).
    FILO_CODA: 'filo_coda',
    // Cercare nel filo senza passare dal modello: { q } → { ok, messaggi, pagine, termini, tanti }.
    FILO_CERCA: 'filo_cerca',
    // Togliere dal filo pagine visitate, per id: { ids } → { ok, tolte }. Con { url }: ogni visita di quell'indirizzo
    // e le sue schede chiuse (dalla ricerca, dove una pagina è un indirizzo).
    FILO_CODA_TOGLI_PAGINE: 'filo_coda_togli_pagine',
    // ANNUNCIO (main → pagine di Filo, senza dati): pagine entrate, rititolate o tolte dal filo, da qualunque strada; chi
    // le mostra le rilegge.
    FILO_PAGINE_CAMBIATE: 'filo_pagine_cambiate',
    // ANNUNCIO (main → schede): Filo ha scritto di sua iniziativa. { chat, i, ts, testo, fuso }.
    FILO_PARLA: 'filo_parla',
    // Una riga scritta in chat senza passare da un modello: la risposta a un
    // comando con lo slash (l'elenco dei comandi, la conferma di un timer, il
    // resoconto del riordino), il comando di terminale che l'utente ha digitato
    // e l'esito che la shell gli ha risposto. L'utente le legge sullo schermo,
    // dentro quella conversazione, quindi le deve ritrovare rileggendola.
    // `role` dice chi l'ha scritta ('filo', il valore di serie, oppure 'user'
    // per il comando digitato). { id, text, role? } → { ok }
    FILO_CHAT_NOTE: 'filo_chat_note',
    // Titolo e tipo scelti a mano dall'utente, dal menu del tasto destro in
    // Cronologia: il titolo generato può essere sbagliato, e una discussione
    // può essere finita fra i comandi. Quello che sceglie l'utente vince e non
    // viene più riscritto dal classificatore. { id, title?, kind? } → { ok, chats }
    FILO_CHAT_UPDATE: 'filo_chat_update',
    // Porta l'utente alla scheda dove una conversazione è ANCORA APERTA, invece
    // di aprirgliene una seconda copia. { id } → { ok, portato }
    FILO_CHAT_FOCUS: 'filo_chat_focus',

    // CRUD memoria/contenuti dashboard
    FILO_GET_MEMORY: 'filo_get_memory',
    // Compattazione FORZATA della memoria senza aspettare la soglia: a fine intervista le
    // lezioni devono essere in memoria quando Filo genera la prima home. Solo filo://.
    FILO_COMPACT_MEMORY: 'filo_compact_memory',
    // La memoria come la legge l'utente nelle Preferenze (#592): moduli divisi
    // in righe e lezioni ancora da riordinare. Solo pagine filo://.
    // Risposta: { ok, moduli: [{ nome, righe }], lezioni: [{ ts, text }] }
    FILO_MEMORY_VIEW: 'filo_memory_view',
    // Toglie UNA riga: { modulo, riga } oppure { lezione: { ts, text } }. La riga resta nascosta nel quaderno (#872).
    // Solo pagine filo://. Risposta: { ok, tolta } (false: non c'era più).
    FILO_MEMORY_FORGET: 'filo_memory_forget',
    // Il quaderno delle memorie (#872): righe con data e fonti risolte nel filo, lezioni, siti tenuti aperti e
    // righe nascoste. Solo pagine filo://.
    // Risposta: { ok, moduli: [{ nome, righe: [{ testo, via, nata, corretta, fonti: [{ id, ts, chat?, i? }] }] }], lezioni, sempreAperte, nascoste }
    FILO_QUADERNO: 'filo_quaderno',
    // La correzione di una riga: { via: { modulo, riga } | { lezione }, testo }. Risposta: { ok, corretta } o { ok:false, error }.
    FILO_MEMORY_EDIT: 'filo_memory_edit',
    // Una riga nascosta torna in memoria: { id }. Risposta: { ok, rimessa }.
    FILO_MEMORY_RESTORE: 'filo_memory_restore',
    // Una riga nascosta si cancella per sempre: { id }. Risposta: { ok, cancellata }.
    FILO_MEMORY_FOREVER: 'filo_memory_forever',
    // Dov'è un evento del filo, per saltarci dalla home (#872): { id }. Risposta: { ok, dove: { tipo, chat, i, ts, app } | null }.
    FILO_DOVE: 'filo_dove',
    // Main → sole pagine filo://: la memoria è cambiata. Porta { moduli, lezioni }
    // come FILO_MEMORY_VIEW, così chi la mostra non la richiede.
    FILO_MEMORY_CHANGED: 'filo_memory_changed',
    // Stato della micro-intervista di benvenuto (#524). Solo pagine filo://.
    // Risposta: { ok, onboarding: { done, ticked, thread, … }, welcome }
    FILO_GET_ONBOARDING: 'filo_get_onboarding',
    // Rilancia l'intervista da capo (pulsante in Preferenze): azzera spunte,
    // conversazione e il segno "già accolto". Solo pagine filo://.
    // L'intervista precedente NON si perde: viene archiviata in `past`.
    // Con { riprendi: true } («Riprendiamola» della home) riapre invece quella
    // chiusa a metà, dov'era. Risposta: { ok, onboarding, resume? }
    FILO_RESTART_ONBOARDING: 'filo_restart_onboarding',
    // Toglie un'intervista conservata { chiave } (la × in Preferenze). Solo
    // pagine filo://. Risposta: { ok, onboarding, tolta }
    FILO_ONBOARDING_TOGLI: 'filo_onboarding_togli',
    // Chiude l'intervista SENZA passare dal modello: è il pulsante "Salta
    // l'accoglienza" della chat, la via d'uscita che funziona anche quando il
    // modello non risponde (rete assente, provider giù, crediti finiti). Solo
    // pagine filo://. Risposta: { ok, onboarding }
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
    // «Installa» sulla carta della versione nuova (#786): scarica, e si installa alla chiusura. {} → { ok } | { ok:false, error }
    FILO_INSTALLA_AGGIORNAMENTO: 'filo_installa_aggiornamento',
    // Le carte della home (#870), solo pagine filo://. La mossa è quella di SN_CARTE_HOME.applica: la pagina
    // manda il cambio, non la disposizione intera. CAMBIATE va alle pagine di Filo quando la disposizione cambia.
    CARTE_HOME_GET: 'carte_home_get',             // {} → { ok, layout }
    CARTE_HOME_MODIFICA: 'carte_home_modifica',   // { mossa } → { ok, layout } | { ok:false, error, layout }
    CARTE_HOME_CAMBIATE: 'carte_home_cambiate',   // broadcast { layout }
    // I lavori lunghi in corso (una risposta di Filo, un comando del terminale): la home li mostra a sinistra.
    LAVORI_IN_CORSO: 'lavori_in_corso',           // {} → { ok, lavori: [{ id, tipo, chat, testo, iniziato }] }
    LAVORI_CAMBIATI: 'lavori_cambiati',           // broadcast { lavori }
    // I documenti dell'Editor dal più recente, per la sua carta nella home. Solo pagine filo://.
    EDITOR_RECENTI: 'editor_recenti',             // {} → { ok, totale, file: [{ id, titolo, modificato }] }
    // L'utente ha confermato (popup livello 2 / digitato "conferma" livello 3)
    // un'azione di Filo rimasta in sospeso: ora va eseguita davvero. { action }
    FILO_CONFIRM_ACTION: 'filo_confirm_action',
    // L'utente ha detto no alla stessa conferma: non parte niente, lo contano solo i contatori (#1461). { action }
    FILO_CONFIRM_RIFIUTATA: 'filo_confirm_rifiutata',
    // I cambi di stato come eventi del filo (#867). Solo dalle pagine di Filo: leggono e riscrivono le
    // impostazioni dell'utente. LEGGI { ids } → { eventi }; ANNULLA { id } → { ok, eventi }.
    CAMBI_LEGGI: 'cambi_leggi',
    CAMBI_ANNULLA: 'cambi_annulla',
    CAMBI_AGGIORNATI: 'cambi_aggiornati',           // main → pagine di Filo { ids }: un cambio è nato o è stato annullato

    // L'utente aggiunge al calendario del suo computer l'evento che Filo gli
    // ha proposto in chat: il main scrive un .ics e lo apre col programma di
    // calendario. → { ok, file, aperto, error }  { evento: { data, ora, titolo, dettagli } }
    //
    // ORIGINE: solo filo:// (scrive un file e chiede al sistema di aprirlo, e
    // la risposta contiene un percorso assoluto). Una pagina web che potesse
    // chiamarlo farebbe aprire un file al sistema operativo.
    CALENDAR_ADD: 'calendar_add',

    // Primo dispatch (non ancora confermato) di UNA singola azione di Filo,
    // usato dall'agente "Aiuto" (sidebar) per attivare le azioni tipizzate di
    // Filo — es. inviare un feedback — passando dallo stesso registro dei
    // livelli di sicurezza della chat dashboard. Torna { executed, kept,
    // needsConfirm, describe }: se needsConfirm il client mostra il popup di
    // conferma e poi rimanda l'azione via FILO_CONFIRM_ACTION. { action }
    // Da un sito visitato (con FILO_CONFIRM_ACTION) torna senza `output`: quello che l'azione ha letto resta a Filo.
    FILO_RUN_ACTION: 'filo_run_action',
    // #530 — l'agente "Aiuto" chiede se una sua azione sulla pagina (copia, cerca,
    // condividi) parte, chiede o no. { costo, campo } → { risposta, digita, perche, no? }.
    FILO_DECIDI_PAGINA: 'filo_decidi_pagina',
    // #530 — l'Aiuto si è aperto: comincia una conversazione nuova, che non ha ancora letto niente. {}
    FILO_AIUTO_NUOVO: 'filo_aiuto_nuovo',

    // #810 — un indirizzo web proposto da un modello in una pagina di Filo si apre solo dopo la porta delle
    // uscite. { url, parole } → { aperto, frase }
    FILO_APRI_PROPOSTA: 'filo_apri_proposta',
    // #810 — un collegamento scritto da un modello nelle superfici di Filo dentro una pagina web (assistente di pagina,
    // Spiega, richiesta rapida) lo apre il main dopo la porta delle uscite. Aperto ai content script: non dà più di un
    // window.open. { url, parole, sfondo } → { aperto, frase, avvisato }
    APRI_COLLEGAMENTO_FILO: 'apri_collegamento_filo',
    // #810 — main → pagina di Filo: un indirizzo che la pagina ha chiesto di aprire (menu, link) è stato fermato
    // dalla porta delle uscite. { frase }
    USCITA_FERMATA: 'uscita_fermata',
    // #810 — il testo che l'assistente di pagina vuole scrivere in un campo passa dalla porta delle uscite.
    // { testo, parole } → { blocca, frase }
    CONTROLLA_CAMPO: 'controlla_campo',

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
    // Risposta della pagina a una scorciatoia consegnata con ricevuta: se non l'ha presa, la fa il main (#839). { ricevuta, presa }
    SHORTCUT_RECEIPT: 'shortcut_receipt',
    // Contropartita di RUN_IN_TOP_FRAME: arriva SOLO al frame principale della
    // scheda e gli fa eseguire l'azione di pagina chiesta da un riquadro. { iconId }
    TOP_FRAME_COMMAND: 'top_frame_command',
    // Un altro frame della stessa scheda ha aperto il suo menu: chiudi il tuo. Gli eventi del
    // mouse non attraversano il confine di un iframe, e i due resterebbero aperti insieme.
    CLOSE_OTHER_MENUS: 'close_other_menus',
    // #589.11 — un riquadro con un menu di Filo aperto chiede alla pagina che lo contiene di sospendere gli effetti
    // grafici sopra di lui. Va dal riquadro al main { n, si }, e il main lo gira alla SOLA pagina madre come
    // VISTO_PERMESSO { n, si }: la pagina crede a una richiesta solo se la chiave le arriva anche da qui.
    VISTO_SOSPENDI: 'visto_sospendi',
    VISTO_PERMESSO: 'visto_permesso',
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
    // Broadcast da background -> dashboard (#663): è cambiato se Filo ha o no
    // un modello da chiamare. La configurazione condivisa arriva dalla rete
    // DOPO che la prima home è già a schermo: senza questo avviso l'utente
    // resta davanti al cartello «non posso rispondere» finché non ricarica.
    // { ready: bool }
    FILO_READY_CHANGED: 'filo_ready_changed',
    // Broadcast da background -> content: una lettura ad alta voce è attiva
    // (in QUALCHE scheda) oppure no. Ogni scheda usa questo flag per mostrare
    // "Interrompi lettura" nel menu anche se non è lei a leggere. { active: bool }
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
    // In pausa (#896) gli handler qui sopra rispondono { status:'paused', paused:true, error } (invio, riscatto)
    // o { paused:true, error, … } (stato, tentativo, classifica) a chi non vede il Red Team.
    // REDTEAM_VISIBILITY: { attendi? } → { ok, visible } (a un sito) | { ok, visible, owner, openToAll, letto }.
    REDTEAM_VISIBILITY: 'redteam_visibility',
    // Broadcast main → pagine di Filo: { visible } quando cambia.
    REDTEAM_VISIBILITY_CHANGED: 'redteam_visibility_changed',
    // L'interruttore «Red Team aperto a tutti» di Gestione (SOLO owner, solo da Filo).
    //   GET { } → { ok, openToAll, letto } · SET { openToAll } → { ok, openToAll } | { ok:false, error }.
    REDTEAM_OPEN_GET: 'redteam_open_get',
    REDTEAM_OPEN_SET: 'redteam_open_set',

    // Bacheca e Deck builder dei Mazzi in pausa per chi non è owner (#1592), `nome` 'bacheca' | 'mazzi'.
    // IN_PAUSA_STATO (solo da Filo): { attendi? } → { ok, bacheca: stato, mazzi: stato },
    //   stato = { visible, owner, openToAll, letto }. `attendi` aspetta la prima lettura dell'interruttore.
    IN_PAUSA_STATO: 'in_pausa_stato',
    // Broadcast main → shell e pagine di Filo: { nome, visible } quando cambia chi la vede.
    IN_PAUSA_CAMBIATO: 'in_pausa_cambiato',
    // Gli interruttori di Gestione (SOLO owner, solo da Filo).
    //   GET { nome } → { ok, openToAll, letto } · SET { nome, openToAll } → { ok, openToAll } | { ok:false, error }.
    IN_PAUSA_GET: 'in_pausa_get',
    IN_PAUSA_SET: 'in_pausa_set',
  };

  // Port-based streaming
  const PORTS = {
    AI_STREAM: 'ai_stream',
  };

  global.SN_MSG = { MSG, PORTS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
