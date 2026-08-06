// Censimento dei punti in cui Filo usa un modello.
//
// PERCHÉ ESISTE
//   Filo chiama modelli ovunque, spesso senza che si veda: riordina le schede,
//   riassume le pagine, giudica i feedback, decide cosa vale la pena ricordare.
//   Una politica sui modelli che vale solo nei punti di cui ci si ricorda non è
//   una politica: serve l'elenco COMPLETO, e serve che nessun punto prenda il
//   modello da un valore deciso nel codice.
//
//   Questo file è quell'elenco, ed è anche la SORGENTE DI VERITÀ della lista di
//   funzioni mostrata in Opzioni → Modelli (vedi modelChainEditor.js): un punto
//   che non è qui non compare da nessuna parte, quindi non può nascondersi.
//
// COME SI LEGGE UNA VOCE
//   id        identificativo stabile (non riusarlo, non cambiarlo più)
//   label     nome della funzione, per l'utente (italiano, niente nomi di file)
//   area      dove vive, per raggruppare l'elenco
//   from      da dove viene il modello:
//               'user'  → impostazione di chi usa Filo (Opzioni → Modelli)
//               'owner' → impostazione di chi gestisce Filo (Gestione → Modelli
//                         di supporto): sono i punti che girano sui server di
//                         Filo, non sul computer di chi lo usa
//               'none'  → questo punto NON usa nessun modello (è scritto qui
//                         apposta: sono i punti che sembrano usarne uno e non
//                         lo fanno, così non si continua a cercarlo)
//               'code'  → il modello è deciso dal codice e nessuno può
//                         cambiarlo. DEVE restare vuoto: è la condizione che il
//                         test `modelUsage.test.mjs` verifica.
//   ref       per 'user' il nome interno della funzione; per 'owner' lo slot
//   where     dove si imposta, in parole (per l'utente)
//   note      dettaglio opzionale
//
// REGOLA (stesso patto di patchNotes.js e capabilities.js)
//   Ogni volta che aggiungi, sposti o togli un punto in cui Filo usa un modello,
//   aggiorna questo file nello stesso commit. Il test incrocia l'elenco col
//   codice reale e diventa rosso se uno dei due deriva dall'altro.

(function (global) {
  'use strict';

  const A = (global.SN_CONST && global.SN_CONST.ACTIONS) || {};

  // Dove si imposta, in parole. Testo per l'utente: niente percorsi di file.
  const WHERE_USER = 'Opzioni → Modelli';
  const WHERE_OWNER = 'Gestione → Modelli di supporto (riservato a chi gestisce Filo)';

  function user(id, label, area, action, note) {
    return { id, label, area, from: 'user', ref: action, where: WHERE_USER, note: note || '' };
  }
  function owner(id, label, area, slot, note) {
    return { id, label, area, from: 'owner', ref: slot, where: WHERE_OWNER, note: note || '' };
  }
  function none(id, label, area, note) {
    return { id, label, area, from: 'none', ref: '', where: '', note: note || '' };
  }

  // ── L'elenco ────────────────────────────────────────────────────────────────
  // Ordinato per area, così si legge come un indice.
  const ENTRIES = [
    // Testo selezionato e pagine web
    user('explain', 'Spiega la selezione', 'Pagine web', A.EXPLAIN),
    user('explain-deep', 'Approfondisci la selezione', 'Pagine web', A.EXPLAIN_DEEP),
    user('explain-link', 'Spiega un link', 'Pagine web', A.EXPLAIN_LINK),
    user('translate-selection', 'Traduci la selezione', 'Pagine web', A.TRANSLATE_SELECTION),
    user('translate-page', 'Traduci la pagina', 'Pagine web', A.TRANSLATE_PAGE),
    user('edit-text', 'Riscrivi il testo selezionato', 'Pagine web', A.EDIT_TEXT),
    user('categorize', 'Categorizza una pagina', 'Pagine web', A.CATEGORIZE),
    user('describe-image', 'Descrivi un\'immagine', 'Pagine web', A.DESCRIBE_IMAGE),
    user('transcribe-image', 'Leggi il testo di un\'immagine', 'Pagine web', A.TRANSCRIBE_IMAGE),
    user('spellcheck-word', 'Correttore ortografico — parola', 'Scrittura', A.SPELLCHECK_WORD),
    user('spellcheck-semantic', 'Correttore ortografico — frase', 'Scrittura', A.SPELLCHECK_SEMANTIC),
    user('transcribe-audio', 'Dettatura dal microfono', 'Scrittura', A.TRANSCRIBE_AUDIO),
    user('tts', 'Lettura ad alta voce', 'Scrittura', A.TTS),

    // Aiuto
    user('help', 'Sidebar Aiuto', 'Aiuto', A.HELP),
    user('help-intent-guess', 'Aiuto — sintesi dell\'intento', 'Aiuto', A.HELP_INTENT_GUESS),
    user('help-intent-judge', 'Aiuto — controllo dell\'intento', 'Aiuto', A.HELP_INTENT_JUDGE),

    // Home e memoria
    user('filo-chat', 'Chat con Filo', 'Home', A.FILO_CHAT),
    user('filo-dashboard', 'Generazione della home', 'Home', A.FILO_DASHBOARD),
    user('filo-lesson', 'Cosa vale la pena ricordare dopo una conversazione', 'Memoria', A.FILO_LESSON),
    user('filo-compact', 'Riordino dei ricordi', 'Memoria', A.FILO_COMPACT),

    // Schede
    user('tab-triage', 'Riordino automatico delle schede', 'Schede', A.FILO_TAB_TRIAGE),
    user('tab-summary', 'Riassunto di una scheda alla chiusura', 'Schede', A.FILO_TAB_SUMMARY),
    user('archive-embed', 'Indicizzazione delle schede archiviate', 'Schede', A.ARCHIVE_EMBED,
      'Modello di indicizzazione (produce vettori, non parole): senza, la ricerca fra le schede archiviate resta quella per parole.'),
    user('tab-search', 'Ricerca fra le schede archiviate', 'Schede', A.FILO_TAB_SEARCH),

    // Editor
    user('editor-title', 'Editor — titolo del documento', 'Editor', A.EDITOR_TITLE),
    user('editor-summary', 'Editor — riassunto del documento', 'Editor', A.EDITOR_SUMMARY),
    user('editor-chat', 'Editor — chat col documento', 'Editor', A.EDITOR_CHAT),

    // Mazzi
    user('decks-chat', 'Mazzi — ricerca carte in chat', 'Mazzi', A.DECKS_CHAT),
    user('decks-opinion', 'Mazzi — parere su una carta', 'Mazzi', A.DECKS_OPINION),
    user('decks-autotag', 'Mazzi — etichette automatiche', 'Mazzi', A.DECKS_AUTOTAG),
    user('decks-search-filter', 'Mazzi — filtro dei risultati di ricerca', 'Mazzi', A.DECKS_SEARCH_FILTER),

    // Sicurezza e navigazione
    user('safebrowse-judge', 'Giudizio sui siti pericolosi', 'Sicurezza', A.SAFEBROWSE_JUDGE),
    user('geoblock-classify', 'Riconoscimento dei blocchi geografici', 'Sicurezza', A.GEOBLOCK_CLASSIFY),

    // Feedback
    user('feedback-title', 'Titolo automatico di un feedback', 'Feedback', A.FEEDBACK_TITLE),
    user('manage-search', 'Ricerca fra i feedback', 'Feedback', A.MANAGE_SEARCH),

    // Diagnostica
    user('provider-test', 'Prova di un fornitore («Prova» accanto alla chiave)', 'Diagnostica', A.PROVIDER_TEST),

    // ── Punti che girano sui server di Filo (li imposta chi gestisce Filo) ────
    owner('sanitizer', 'Sanificatore dei feedback', 'Feedback (server)', 'sanitizer'),
    owner('judge1', 'Giudice 1 dei feedback', 'Feedback (server)', 'judge1'),
    owner('judge2', 'Giudice 2 dei feedback', 'Feedback (server)', 'judge2'),
    owner('judge3', 'Giudice 3 dei feedback', 'Feedback (server)', 'judge3'),
    owner('judge-dynamic', 'Giudice dinamico dei feedback', 'Feedback (server)', 'judgeDynamic'),
    owner('judge-redteam', 'Giudice degli attacchi (red-team)', 'Feedback (server)', 'judgeRedTeam'),
    owner('judge-priority', 'Giudice della priorità dei feedback', 'Feedback (server)', 'judgePriority'),

    // ── Punti che sembrano usare un modello e non lo usano ───────────────────
    // Stanno nell'elenco apposta: senza, si continuerebbe a cercare dove si
    // imposta un modello che non c'è.
    none('cmd-classify', 'Livello di sicurezza di un comando da terminale', 'Sicurezza',
      'Deciso da regole fisse, mai da un modello: un modello convinto a sbagliare eseguirebbe comandi pericolosi.'),
    none('tab-duplicates', 'Riconoscimento delle schede doppie', 'Schede',
      'Confronto esatto degli indirizzi: non serve un modello e il risultato non deve dipendere da uno.'),
    none('page-style-sanitize', 'Controllo dello stile che Filo applica a una pagina', 'Pagine web',
      'Il modello propone lo stile, ma cosa è ammesso lo decidono regole fisse.'),
    none('feedback-groomer', 'Accorpamento dei feedback doppi', 'Feedback',
      'Confronti testuali deterministici.'),
    none('web-search', 'Ricerca sul web della sidebar Aiuto', 'Aiuto',
      'È un motore di ricerca, non un modello; i risultati vengono poi letti dal modello dell\'Aiuto.'),
  ];

  // ── Interrogazioni ──────────────────────────────────────────────────────────

  function list() {
    return ENTRIES.map((e) => ({ ...e }));
  }

  // Le funzioni impostabili da chi usa Filo, nell'ordine dell'elenco. È la lista
  // che genera la griglia di Opzioni → Modelli: elenco e griglia non possono
  // divergere perché sono la stessa cosa.
  function userActions() {
    return ENTRIES.filter((e) => e.from === 'user' && e.ref).map((e) => e.ref);
  }

  // Gli slot impostabili da chi gestisce Filo.
  function ownerSlots() {
    return ENTRIES.filter((e) => e.from === 'owner' && e.ref).map((e) => e.ref);
  }

  // I punti che prendono il modello da un valore deciso nel codice. Deve essere
  // sempre vuoto: è l'invariante di questo censimento.
  function hardcoded() {
    return ENTRIES.filter((e) => e.from === 'code').map((e) => e.id);
  }

  // L'elenco raggruppato per area, nell'ordine di prima apparizione.
  function byArea() {
    const out = [];
    const index = new Map();
    for (const e of ENTRIES) {
      if (!index.has(e.area)) {
        const group = { area: e.area, entries: [] };
        index.set(e.area, group);
        out.push(group);
      }
      index.get(e.area).entries.push({ ...e });
    }
    return out;
  }

  function byId(id) {
    const e = ENTRIES.find((x) => x.id === id);
    return e ? { ...e } : null;
  }

  global.SN_MODEL_USAGE = {
    ENTRIES,
    list,
    byArea,
    byId,
    userActions,
    ownerSlots,
    hardcoded,
    WHERE_USER,
    WHERE_OWNER,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
